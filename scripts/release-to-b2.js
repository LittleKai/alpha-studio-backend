// Note: The release/build flow and usage options are documented in the skill file:
// alpha-studio/.claude/skills/CRM_AUTOMATED_RELEASE_SKILL.md

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import http from 'http';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import readline from 'readline';

// Resolve directory paths in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_DIR = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(BACKEND_DIR, '..');
const CRM_DIR = path.resolve(WORKSPACE_ROOT, 'tools/alpha-crm');
const ZALO_BOT_SERVICE_DIR = path.resolve(CRM_DIR, 'integration/zalo-bot-service');

// Load environment variables from backend .env
dotenv.config({ path: path.join(BACKEND_DIR, '.env') });

const {
    B2_ENDPOINT,
    B2_REGION = 'us-west-004',
    B2_ACCESS_KEY_ID,
    B2_SECRET_ACCESS_KEY,
    B2_BUCKET_NAME,
    CDN_BASE_URL
} = process.env;

/**
 * Reads the version line from tools/alpha-crm/pubspec.yaml
 */
function getPubspecVersion() {
    const pubspecPath = path.join(CRM_DIR, 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath)) {
        throw new Error(`pubspec.yaml not found at: ${pubspecPath}`);
    }
    const content = fs.readFileSync(pubspecPath, 'utf8');
    const match = content.match(/^version:\s*(.+)$/m);
    if (!match) {
        throw new Error(`Could not find version field in pubspec.yaml`);
    }
    return match[1].trim();
}

/**
 * Updates the version line in tools/alpha-crm/pubspec.yaml
 */
function updatePubspecVersion(newVersion) {
    const pubspecPath = path.join(CRM_DIR, 'pubspec.yaml');
    let content = fs.readFileSync(pubspecPath, 'utf8');
    content = content.replace(/^version:\s*.+$/m, `version: ${newVersion}`);
    fs.writeFileSync(pubspecPath, content, 'utf8');
    console.log(`[pubspec.yaml] Bumped version to: ${newVersion}`);
}

/**
 * Helper to calculate the next version string
 */
function calculateNextVersion(currentVersion, action) {
    // Format: major.minor.patch+build
    const [versionPart, buildPart] = currentVersion.split('+');
    let [major, minor, patch] = versionPart.split('.').map(Number);
    let build = Number(buildPart || '1');

    build += 1; // Always increment build number

    if (action === 'patch') {
        patch += 1;
    } else if (action === 'minor') {
        minor += 1;
        patch = 0;
    } else if (action === 'major') {
        major += 1;
        minor = 0;
        patch = 0;
    } else if (action && action.match(/^\d+\.\d+\.\d+$/)) {
        // Direct semver string passed
        return `${action}+${build}`;
    } else {
        throw new Error(`Invalid version action or semver string: ${action}. Use 'patch', 'minor', 'major', or a specific version like '1.0.2'`);
    }

    return `${major}.${minor}.${patch}+${build}`;
}

/**
 * Compares two semver strings (major.minor.patch)
 * Returns > 0 if v1 > v2, < 0 if v1 < v2, 0 if equal
 */
function compareSemver(v1, v2) {
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const n1 = p1[i] || 0;
        const n2 = p2[i] || 0;
        if (n1 !== n2) {
            return n1 - n2;
        }
    }
    return 0;
}

/**
 * Prompts user for confirmation in the terminal
 */
function askConfirmation(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function copyRequiredDirectory(sourcePath, destPath) {
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Required directory not found: ${sourcePath}`);
    }

    if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { recursive: true, force: true });
    }

    fs.cpSync(sourcePath, destPath, { recursive: true });
}

/**
 * Copies only the runtime dependency closure of the given root packages from a
 * source node_modules into a destination node_modules (flat install layout).
 * Used to ship just the native better-sqlite3 closure beside the esbuild bundle,
 * instead of the whole node_modules tree. Follows each package's "dependencies"
 * recursively. dereference:true flattens any junction/symlink so the staged copy
 * is a real folder (regression guard for the session-#52 junction bug).
 * Returns the Set of staged package names.
 */
function stageDependencyClosure(srcNodeModules, destNodeModules, rootPackages, ignorePackages = []) {
    const ignore = new Set(ignorePackages);
    const visited = new Set();
    const queue = [...rootPackages];
    while (queue.length > 0) {
        const pkgName = queue.shift();
        if (visited.has(pkgName) || ignore.has(pkgName)) continue;
        const srcPkgDir = path.join(srcNodeModules, pkgName);
        if (!fs.existsSync(srcPkgDir)) {
            throw new Error(
                `[stage] Runtime dependency "${pkgName}" not found in ${srcNodeModules}. ` +
                `Run "npm install" in the backend before releasing.`
            );
        }
        visited.add(pkgName);
        fs.cpSync(srcPkgDir, path.join(destNodeModules, pkgName), {
            recursive: true,
            dereference: true,
        });
        try {
            const meta = JSON.parse(
                fs.readFileSync(path.join(srcPkgDir, 'package.json'), 'utf8')
            );
            for (const dep of Object.keys(meta.dependencies || {})) {
                if (!visited.has(dep)) queue.push(dep);
            }
        } catch { /* no resolvable dependencies to follow */ }
    }
    return visited;
}

/**
 * Polls http://127.0.0.1:<port>/health until it returns 200 {status:'ok'} or times out.
 * Resolves true if healthy, false on timeout.
 */
function waitForHealth(port, timeoutMs) {
    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const retry = () => {
            if (Date.now() >= deadline) { resolve(false); return; }
            setTimeout(tryOnce, 500);
        };
        const tryOnce = () => {
            const req = http.get(
                { host: '127.0.0.1', port, path: '/health', timeout: 2000 },
                (res) => {
                    let body = '';
                    res.on('data', (c) => { body += c; });
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(body);
                            if (res.statusCode === 200 && json.status === 'ok') {
                                resolve(true);
                                return;
                            }
                        } catch { /* not ready yet */ }
                        retry();
                    });
                }
            );
            req.on('error', retry);
            req.on('timeout', () => { req.destroy(); retry(); });
        };
        tryOnce();
    });
}

/**
 * Hardening guard: asserts the bundle + native addon are present and boots the staged
 * backend on a throwaway port to confirm it serves /health before we zip & upload.
 * Throws (aborting the release) if anything is wrong.
 */
async function verifyStagedBackend(serviceReleaseDir) {
    // 1. The esbuild bundle must exist (this is the single production entrypoint).
    const bundlePath = path.join(serviceReleaseDir, 'dist', 'server.cjs');
    if (!fs.existsSync(bundlePath)) {
        throw new Error(
            `[verify] Bundled backend entrypoint missing: ${bundlePath}. ` +
            `Run "npm run bundle" in the backend and re-run the release.`
        );
    }

    // 2. The native addon better-sqlite3 cannot be inlined, so its compiled binary must be
    //    staged as a real file (not a junction/symlink). Regression guard for session-#52.
    const nativeAddon = path.join(
        serviceReleaseDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'
    );
    const addonStat = fs.lstatSync(nativeAddon); // throws if missing
    if (addonStat.isSymbolicLink()) {
        throw new Error(
            `[verify] better-sqlite3 native addon is a symlink/junction, not a real file: ${nativeAddon}.`
        );
    }

    // 3. Smoke-test: boot the staged backend on a throwaway port and wait for /health.
    const nodeExe = path.join(serviceReleaseDir, 'node.exe');
    const entryJs = path.join(serviceReleaseDir, 'dist', 'server.cjs');
    const SMOKE_PORT = 8799;

    console.log(`[verify] Smoke-testing staged backend on port ${SMOKE_PORT}...`);
    const child = spawn(nodeExe, [entryJs], {
        cwd: serviceReleaseDir,
        env: {
            ...process.env,
            PORT: String(SMOKE_PORT),
            LOCAL_BIND_PORT: String(SMOKE_PORT),
            NODE_ENV: 'production',
        },
        stdio: 'inherit',
    });

    let healthy = false;
    try {
        healthy = await waitForHealth(SMOKE_PORT, 15000);
    } finally {
        try {
            if (process.platform === 'win32') {
                execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
            } else {
                child.kill('SIGKILL');
            }
        } catch { /* process may already be gone */ }
    }

    // Remove the ephemeral active-port.json the smoke-test wrote so it is not shipped.
    try {
        fs.rmSync(path.join(serviceReleaseDir, '.data', 'active-port.json'), { force: true });
    } catch { /* ignore */ }

    if (!healthy) {
        throw new Error(
            '[verify] Staged backend failed the /health smoke-test — release aborted. ' +
            'Inspect the staged dist/ and node_modules under ' + serviceReleaseDir + '.'
        );
    }
    console.log('[verify] Staged backend responded healthy on /health. OK.');
}

function stageZaloBackendForWindows(winReleaseDir) {
    const serviceReleaseDir = path.join(winReleaseDir, 'zalo-bot-service');

    if (process.platform !== 'win32') {
        throw new Error('Windows backend bundle requires a Windows Node.js runtime. Run this release script on Windows.');
    }

    for (const launcherName of ['zalo-bot-service.exe', 'zalo-bot-service.cmd', 'zalo-bot-service.bat']) {
        const launcherPath = path.join(winReleaseDir, launcherName);
        if (fs.existsSync(launcherPath)) {
            fs.unlinkSync(launcherPath);
        }
    }

    if (fs.existsSync(serviceReleaseDir)) {
        fs.rmSync(serviceReleaseDir, { recursive: true, force: true });
    }
    fs.mkdirSync(serviceReleaseDir, { recursive: true });

    copyRequiredDirectory(
        path.join(ZALO_BOT_SERVICE_DIR, 'dist'),
        path.join(serviceReleaseDir, 'dist')
    );
    // The backend ships as a single esbuild bundle (dist/server.cjs). Only the native
    // addon better-sqlite3 cannot be inlined into JS, so stage just its runtime closure
    // instead of the full 50MB+ node_modules tree. dereference:true flattens any
    // junction/symlink (regression guard for the session-#52 zca-js junction bug).
    const stagedDeps = stageDependencyClosure(
        path.join(ZALO_BOT_SERVICE_DIR, 'node_modules'),
        path.join(serviceReleaseDir, 'node_modules'),
        ['better-sqlite3'],
        // prebuild-install only runs during "npm install" (to fetch the prebuilt binary);
        // it is never required at runtime, so skip it and its ~25-package install-time tree.
        ['prebuild-install']
    );
    console.log(`Staged ${stagedDeps.size} native backend dependencies: ${[...stagedDeps].join(', ')}`);

    for (const fileName of ['package.json', 'package-lock.json', '.env.example', 'README.md']) {
        const sourcePath = path.join(ZALO_BOT_SERVICE_DIR, fileName);
        if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, path.join(serviceReleaseDir, fileName));
        }
    }

    const nodeRuntimePath = path.join(serviceReleaseDir, 'node.exe');
    fs.copyFileSync(process.execPath, nodeRuntimePath);

    const launcherPath = path.join(winReleaseDir, 'zalo-bot-service.cmd');
    fs.writeFileSync(
        launcherPath,
        [
            '@echo off',
            'setlocal',
            'set "SERVICE_DIR=%~dp0zalo-bot-service"',
            'set "NODE_EXE=%SERVICE_DIR%\\node.exe"',
            'set "ENTRY_JS=%SERVICE_DIR%\\dist\\server.cjs"',
            'if "%NODE_ENV%"=="" set "NODE_ENV=production"',
            'if not exist "%NODE_EXE%" (',
            '  echo Missing bundled Node.js runtime: "%NODE_EXE%" 1>&2',
            '  exit /b 1',
            ')',
            'if not exist "%ENTRY_JS%" (',
            '  echo Missing backend entrypoint: "%ENTRY_JS%" 1>&2',
            '  exit /b 1',
            ')',
            'cd /d "%SERVICE_DIR%"',
            '"%NODE_EXE%" "%ENTRY_JS%"',
            ''
        ].join('\r\n'),
        'utf8'
    );

    fs.writeFileSync(
        path.join(serviceReleaseDir, 'README.production.txt'),
        [
            'Alpha CRM local Zalo backend bundle',
            '',
            'This folder is generated by alpha-studio-backend/scripts/release-to-b2.js.',
            'Do not copy build-machine .env or .data secrets into public release ZIPs.',
            'Runtime data such as device secrets, Zalo credentials, QR images, and logs are created under .data on the user machine.',
            ''
        ].join('\r\n'),
        'utf8'
    );

    // Generate a production .env with safe defaults so the backend starts
    // with the same feature set as development mode.
    // Secrets/credentials are NOT included — they are created at runtime.
    const prodEnvLines = [
        '# Auto-generated production defaults by release-to-b2.js',
        '# Edit this file to customise your local backend settings.',
        '',
        'PORT=8787',
        'NODE_ENV=production',
        '',
        '# Channel mode: personal_zca | official_oa | mock',
        'ZALO_CHANNEL_MODE=personal_zca',
        '',
        '# Loopback security',
        'LOCAL_BIND_HOST=127.0.0.1',
        'LOCAL_BIND_PORT=8787',
        '',
        '# Cloud CRM API',
        'CRM_CLOUD_API_URL=https://alpha-studio-backend.fly.dev/api',
        'CRM_AGENT_MODE=enabled',
        '',
        '# Local-first Live Chat (full message storage on this PC)',
        'LOCAL_FIRST_LIVE_CHAT=true',
        '',
        '# Safety defaults',
        'ZALO_ALLOW_PERSONAL_AUTOMATION=true',
        'ZALO_ALLOW_FRIEND_AUTOMATION=false',
        'ZALO_ALLOW_GROUP_AUTOMATION=false',
        'ZALO_REQUIRE_HUMAN_APPROVAL=true',
        'ZALO_MAX_BATCH_SIZE=20',
        'ZALO_DAILY_SEND_LIMIT=100',
        ''
    ];
    fs.writeFileSync(
        path.join(serviceReleaseDir, '.env'),
        prodEnvLines.join('\r\n'),
        'utf8'
    );
}

/**
 * Keeps only the current version and the 2 most recent previous versions,
 * deleting older APK and ZIP build files on Backblaze B2.
 */
async function cleanupOldReleases(s3, currentVersionStr) {
    console.log('\nCleaning up old releases on B2 (keeping current + 2 previous versions)...');
    try {
        const listRes = await s3.send(new ListObjectsV2Command({
            Bucket: B2_BUCKET_NAME,
            Prefix: 'crm-app/releases/'
        }));

        if (!listRes.Contents || listRes.Contents.length === 0) {
            console.log('No releases found to clean up.');
            return;
        }

        // Map files to their parsed version
        const fileRegex = /^crm-app\/releases\/alpha-crm-(?:windows-)?v([\d.]+)\.(?:apk|zip)$/;
        const fileVersionMap = []; // array of { key, version }

        for (const item of listRes.Contents) {
            const match = item.Key.match(fileRegex);
            if (match) {
                fileVersionMap.push({
                    key: item.Key,
                    version: match[1]
                });
            }
        }

        // Find unique versions
        const uniqueVersions = Array.from(new Set(fileVersionMap.map(x => x.version)));
        console.log(`Found ${uniqueVersions.length} unique versions on B2:`, uniqueVersions);

        if (uniqueVersions.length <= 3) {
            console.log('3 or fewer unique versions found on B2. No cleanup needed.');
            return;
        }

        // Sort unique versions in ascending order
        uniqueVersions.sort((v1, v2) => {
            const p1 = v1.split('.').map(Number);
            const p2 = v2.split('.').map(Number);
            for (let i = 0; i < 3; i++) {
                const n1 = p1[i] || 0;
                const n2 = p2[i] || 0;
                if (n1 !== n2) {
                    return n1 - n2;
                }
            }
            return 0;
        });

        // We want to keep the 3 newest versions
        const keepVersions = uniqueVersions.slice(-3);
        const deleteVersions = uniqueVersions.slice(0, -3);

        console.log('Versions to KEEP:', keepVersions);
        console.log('Versions to DELETE:', deleteVersions);

        const deleteKeys = fileVersionMap
            .filter(x => deleteVersions.includes(x.version))
            .map(x => ({ Key: x.key }));

        if (deleteKeys.length > 0) {
            console.log(`Deleting ${deleteKeys.length} old build files from B2...`);
            for (const item of deleteKeys) {
                console.log(` - Deleting: ${item.Key}`);
            }

            await s3.send(new DeleteObjectsCommand({
                Bucket: B2_BUCKET_NAME,
                Delete: {
                    Objects: deleteKeys,
                    Quiet: true
                }
            }));
            console.log('✅ Old build files successfully deleted from B2.');
        } else {
            console.log('No build files matched the delete versions.');
        }
    } catch (err) {
        console.error('⚠️ Warning: Failed to clean up old B2 releases:', err.message);
    }
}

async function main() {
    console.log('=== ALPHA CRM AUTOMATED B2 RELEASE ===');

    if (!B2_ENDPOINT || !B2_ACCESS_KEY_ID || !B2_SECRET_ACCESS_KEY || !B2_BUCKET_NAME || !CDN_BASE_URL) {
        console.error('❌ Error: Missing B2 environment variables in backend .env file!');
        process.exit(1);
    }

    const action = process.argv[2]; // 'patch', 'minor', 'major', '1.0.2', or undefined to skip bump
    const currentFullVersion = getPubspecVersion();
    let targetFullVersion = currentFullVersion;

    if (action && action !== 'none' && action !== 'skip' && action !== 'current' && action !== 'nobump') {
        console.log(`Current version in pubspec.yaml: ${currentFullVersion}`);
        targetFullVersion = calculateNextVersion(currentFullVersion, action);

        const currentSemver = currentFullVersion.split('+')[0];
        const targetSemver = targetFullVersion.split('+')[0];

        if (compareSemver(targetSemver, currentSemver) < 0) {
            console.warn(`\n⚠️  CẢNH BÁO: Bạn đang thực hiện hạ cấp phiên bản (Downgrade)!`);
            console.warn(`   Phiên bản hiện tại: ${currentSemver}`);
            console.warn(`   Phiên bản đích:     ${targetSemver}`);

            if (process.stdin.isTTY) {
                const answer = await askConfirmation(`Bạn có chắc chắn muốn hạ cấp phiên bản không? (y/N): `);
                if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
                    console.log('❌ Đã hủy quá trình phát hành.');
                    process.exit(1);
                }
            } else {
                console.error('❌ Lỗi: Không được phép hạ cấp phiên bản trong chế độ không tương tác (Non-interactive mode).');
                process.exit(1);
            }
        }

        updatePubspecVersion(targetFullVersion);
    } else {
        console.log(`Using current version from pubspec.yaml: ${currentFullVersion} (no version bump requested)`);
    }

    const versionStr = targetFullVersion.split('+')[0]; // major.minor.patch
    const releaseNotes = process.argv[3] || `Bản phát hành tự động Alpha CRM v${versionStr}`;

    // 1. Build APK (Android)
    console.log('\n[1/5] Building Flutter APK...');
    try {
        // execSync('shorebird release android --artifact apk', { cwd: CRM_DIR, stdio: 'inherit' });
        console.log('✅ APK built successfully! (SKIPPED FOR WINDOWS ONLY)');
    } catch (err) {
        console.error('❌ Error building APK:', err.message);
        process.exit(1);
    }

    // 2. Build Windows EXE
    console.log('\n[2/5] Building Flutter Windows Executable...');
    try {
        const buildNum = targetFullVersion.split('+')[1] || '1';
        execSync(`flutter build windows --release --build-name=${versionStr} --build-number=${buildNum}`, { cwd: CRM_DIR, stdio: 'inherit' });
        console.log('✅ Windows build files generated successfully!');
    } catch (err) {
        console.error('❌ Error building Windows app:', err.message);
        process.exit(1);
    }

    // 3. Build + bundle local Zalo backend for the Windows package
    console.log('\n[3/5] Building local Zalo backend (esbuild single-file bundle)...');
    try {
        execSync('npm.cmd run bundle', { cwd: ZALO_BOT_SERVICE_DIR, stdio: 'inherit' });
        console.log('Local Zalo backend built + bundled successfully!');
    } catch (err) {
        console.error('Error building local Zalo backend:', err.message);
        process.exit(1);
    }

    // 4. Stage local backend and compress Windows Release directory
    console.log('\n[4/5] Staging local Zalo backend and zipping Windows release folder...');
    const winReleaseDir = path.join(CRM_DIR, 'build/windows/x64/runner/Release');
    const zipDestPath = path.join(CRM_DIR, 'build/alpha-crm-windows.zip');

    if (fs.existsSync(zipDestPath)) {
        fs.unlinkSync(zipDestPath);
    }

    try {
        stageZaloBackendForWindows(winReleaseDir);
        console.log('Local Zalo backend staged beside the Windows app.');
        await verifyStagedBackend(path.join(winReleaseDir, 'zalo-bot-service'));

        // Utilize native PowerShell Compress-Archive since the workspace is on Windows
        const zipCmd = `powershell -Command "Compress-Archive -Path '${winReleaseDir}\\*' -DestinationPath '${zipDestPath}' -Force"`;
        console.log(`Running: ${zipCmd}`);
        execSync(zipCmd, { stdio: 'inherit' });
        console.log(`✅ Windows release successfully zipped to: ${zipDestPath}`);
    } catch (err) {
        console.error('❌ Error zipping Windows release:', err.message);
        process.exit(1);
    }

    // 5. Upload to Backblaze B2
    console.log('\n[5/5] Uploading binaries and updating metadata on Backblaze B2...');
    const s3 = new S3Client({
        endpoint: B2_ENDPOINT,
        region: B2_REGION,
        credentials: {
            accessKeyId: B2_ACCESS_KEY_ID,
            secretAccessKey: B2_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
    });

    const winKey = 'crm-app/releases/alpha-crm-windows.zip';

    const winSize = fs.statSync(zipDestPath).size;

    const winUrl = `${CDN_BASE_URL}/${winKey}`;

    try {
        // Upload APK
        console.log(`Uploading Android APK: Skipped`);

        // Upload ZIP
        console.log(`Uploading Windows ZIP: ${winKey} (${(winSize / 1024 / 1024).toFixed(2)} MB)...`);
        const winBuffer = fs.readFileSync(zipDestPath);
        await s3.send(new PutObjectCommand({
            Bucket: B2_BUCKET_NAME,
            Key: winKey,
            Body: winBuffer,
            ContentType: 'application/zip'
        }));
        console.log(`✅ Windows ZIP uploaded successfully! URL: ${winUrl}`);

        // Update crm-app/version.json
        console.log('\nUpdating version.json on B2...');
        const versionKey = 'crm-app/version.json';
        let versionJson = {
            tag_name: `v${versionStr}`,
            name: `Alpha CRM v${versionStr}`,
            body: releaseNotes,
            published_at: new Date().toISOString(),
            assets: []
        };

        try {
            // Try downloading existing version.json to append or update
            const getRes = await s3.send(new GetObjectCommand({
                Bucket: B2_BUCKET_NAME,
                Key: versionKey
            }));
            const streamToString = (stream) =>
                new Promise((resolve, reject) => {
                    const chunks = [];
                    stream.on('data', (chunk) => chunks.push(chunk));
                    stream.on('error', reject);
                    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                });
            const bodyStr = await streamToString(getRes.Body);
            const existing = JSON.parse(bodyStr);
            console.log(`Found existing version.json (v${existing.tag_name})`);
        } catch (getErr) {
            console.log('Creating a new version.json on B2 (no existing file found).');
        }

        // Set the assets with exact metadata sizes & public URLs
        versionJson.assets = [
            {
                name: 'alpha-crm-windows.zip',
                browser_download_url: winUrl,
                size: winSize
            }
        ];

        // Upload version.json back to B2
        await s3.send(new PutObjectCommand({
            Bucket: B2_BUCKET_NAME,
            Key: versionKey,
            Body: JSON.stringify(versionJson, null, 2),
            ContentType: 'application/json'
        }));
        console.log(`✅ version.json updated successfully on B2! URL: ${CDN_BASE_URL}/${versionKey}`);

        // Clean up old releases from B2 bucket, keeping current + 2 previous versions
        await cleanupOldReleases(s3, versionStr);

        console.log('\n=== RELEASE FINISHED SUCCESSFULLY! ===');
        console.log(`Windows Download URL: ${winUrl}`);
        console.log(`Metadata URL: ${CDN_BASE_URL}/${versionKey}`);

    } catch (err) {
        console.error('❌ Error during B2 upload/update process:', err.message);
        process.exit(1);
    }
}

main();
