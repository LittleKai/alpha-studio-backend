import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

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

function copyRequiredDirectory(sourcePath, destPath) {
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Required directory not found: ${sourcePath}`);
    }

    if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { recursive: true, force: true });
    }

    fs.cpSync(sourcePath, destPath, { recursive: true });
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
    copyRequiredDirectory(
        path.join(ZALO_BOT_SERVICE_DIR, 'node_modules'),
        path.join(serviceReleaseDir, 'node_modules')
    );

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
            'set "ENTRY_JS=%SERVICE_DIR%\\dist\\server.js"',
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
        updatePubspecVersion(targetFullVersion);
    } else {
        console.log(`Using current version from pubspec.yaml: ${currentFullVersion} (no version bump requested)`);
    }

    const versionStr = targetFullVersion.split('+')[0]; // major.minor.patch
    const releaseNotes = process.argv[3] || `Bản phát hành tự động Alpha CRM v${versionStr}`;

    // 1. Build APK (Android)
    console.log('\n[1/6] Building Flutter APK...');
    try {
        execSync('flutter build apk --release', { cwd: CRM_DIR, stdio: 'inherit' });
        console.log('✅ APK built successfully!');
    } catch (err) {
        console.error('❌ Error building APK:', err.message);
        process.exit(1);
    }

    // 2. Build Windows EXE
    console.log('\n[2/6] Building Flutter Windows Executable...');
    try {
        execSync('flutter build windows --release', { cwd: CRM_DIR, stdio: 'inherit' });
        console.log('✅ Windows build files generated successfully!');
    } catch (err) {
        console.error('❌ Error building Windows app:', err.message);
        process.exit(1);
    }

    // 3. Build local Zalo backend for the Windows package
    console.log('\n[3/6] Building local Zalo backend...');
    try {
        execSync('npm.cmd run build', { cwd: ZALO_BOT_SERVICE_DIR, stdio: 'inherit' });
        console.log('Local Zalo backend built successfully!');
    } catch (err) {
        console.error('Error building local Zalo backend:', err.message);
        process.exit(1);
    }

    // 4. Build Flutter Web & Publish to React Public Directory
    console.log('\n[4/6] Building Flutter Web App...');
    try {
        execSync('flutter build web --release --base-href "/crm/"', { cwd: CRM_DIR, stdio: 'inherit' });
        console.log('✅ Web build generated successfully!');
        
        console.log('Copying Web build to React public/crm folder...');
        const webBuildDir = path.join(CRM_DIR, 'build/web');
        const publicCrmDir = path.resolve(WORKSPACE_ROOT, 'alpha-studio/public/crm');
        
        if (fs.existsSync(publicCrmDir)) {
            fs.rmSync(publicCrmDir, { recursive: true, force: true });
        }
        fs.mkdirSync(publicCrmDir, { recursive: true });
        
        fs.cpSync(webBuildDir, publicCrmDir, { recursive: true });
        console.log(`✅ Web build successfully copied to: ${publicCrmDir}`);
    } catch (err) {
        console.error('❌ Error building or publishing Web app:', err.message);
        process.exit(1);
    }

    // 5. Stage local backend and compress Windows Release directory
    console.log('\n[5/6] Staging local Zalo backend and zipping Windows release folder...');
    const winReleaseDir = path.join(CRM_DIR, 'build/windows/x64/runner/Release');
    const zipDestPath = path.join(CRM_DIR, `build/alpha-crm-windows-v${versionStr}.zip`);

    if (fs.existsSync(zipDestPath)) {
        fs.unlinkSync(zipDestPath);
    }

    try {
        stageZaloBackendForWindows(winReleaseDir);
        console.log('Local Zalo backend staged beside the Windows app.');

        // Utilize native PowerShell Compress-Archive since the workspace is on Windows
        const zipCmd = `powershell -Command "Compress-Archive -Path '${winReleaseDir}\\*' -DestinationPath '${zipDestPath}' -Force"`;
        console.log(`Running: ${zipCmd}`);
        execSync(zipCmd, { stdio: 'inherit' });
        console.log(`✅ Windows release successfully zipped to: ${zipDestPath}`);
    } catch (err) {
        console.error('❌ Error zipping Windows release:', err.message);
        process.exit(1);
    }

    // 6. Upload to Backblaze B2
    console.log('\n[6/6] Uploading binaries and updating metadata on Backblaze B2...');
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

    const apkLocalPath = path.join(CRM_DIR, 'build/app/outputs/flutter-apk/app-release.apk');
    const apkKey = `crm-app/releases/alpha-crm-v${versionStr}.apk`;
    const winKey = `crm-app/releases/alpha-crm-windows-v${versionStr}.zip`;

    const apkSize = fs.statSync(apkLocalPath).size;
    const winSize = fs.statSync(zipDestPath).size;

    const apkUrl = `${CDN_BASE_URL}/${apkKey}`;
    const winUrl = `${CDN_BASE_URL}/${winKey}`;

    try {
        // Upload APK
        console.log(`Uploading Android APK: ${apkKey} (${(apkSize / 1024 / 1024).toFixed(2)} MB)...`);
        const apkBuffer = fs.readFileSync(apkLocalPath);
        await s3.send(new PutObjectCommand({
            Bucket: B2_BUCKET_NAME,
            Key: apkKey,
            Body: apkBuffer,
            ContentType: 'application/vnd.android.package-archive'
        }));
        console.log(`✅ APK uploaded successfully! URL: ${apkUrl}`);

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
                name: `alpha-crm-v${versionStr}.apk`,
                browser_download_url: apkUrl,
                size: apkSize
            },
            {
                name: `alpha-crm-windows-v${versionStr}.zip`,
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

        console.log('\n=== RELEASE FINISHED SUCCESSFULLY! ===');
        console.log(`Android Download URL: ${apkUrl}`);
        console.log(`Windows Download URL: ${winUrl}`);
        console.log(`Metadata URL: ${CDN_BASE_URL}/${versionKey}`);

    } catch (err) {
        console.error('❌ Error during B2 upload/update process:', err.message);
        process.exit(1);
    }
}

main();
