import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, execSync } from 'child_process';
import {
    DeleteObjectsCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_DIR = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(BACKEND_DIR, '..');
const VOCAB_DIR = path.resolve(WORKSPACE_ROOT, 'tools/vocabflip');
const PUBLIC_VOCAB_DIR = path.resolve(WORKSPACE_ROOT, 'alpha-studio/public/vocab');
const B2_APP_PREFIX = 'vocabflip-app';

dotenv.config({ path: path.join(BACKEND_DIR, '.env') });

const {
    B2_ENDPOINT,
    B2_REGION = 'us-west-004',
    B2_ACCESS_KEY_ID,
    B2_SECRET_ACCESS_KEY,
    B2_BUCKET_NAME,
    CDN_BASE_URL,
} = process.env;

function getPubspecVersion() {
    const pubspecPath = path.join(VOCAB_DIR, 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath)) {
        throw new Error(`pubspec.yaml not found at: ${pubspecPath}`);
    }

    const content = fs.readFileSync(pubspecPath, 'utf8');
    const match = content.match(/^version:\s*(.+)$/m);
    if (!match) {
        throw new Error('Could not find version field in pubspec.yaml');
    }

    return match[1].trim();
}

function updatePubspecVersion(newVersion) {
    const pubspecPath = path.join(VOCAB_DIR, 'pubspec.yaml');
    const content = fs.readFileSync(pubspecPath, 'utf8')
        .replace(/^version:\s*.+$/m, `version: ${newVersion}`);
    fs.writeFileSync(pubspecPath, content, 'utf8');
    console.log(`[pubspec.yaml] Bumped version to: ${newVersion}`);
}

function calculateNextVersion(currentVersion, action) {
    const [versionPart, buildPart] = currentVersion.split('+');
    let [major, minor, patch] = versionPart.split('.').map(Number);
    let build = Number(buildPart || '1');

    build += 1;

    if (action === 'patch') {
        patch += 1;
    } else if (action === 'minor') {
        minor += 1;
        patch = 0;
    } else if (action === 'major') {
        major += 1;
        minor = 0;
        patch = 0;
    } else if (/^\d+\.\d+\.\d+$/.test(action || '')) {
        return `${action}+${build}`;
    } else {
        throw new Error(`Invalid version action: ${action}. Use patch, minor, major, or a version like 1.2.3.`);
    }

    return `${major}.${minor}.${patch}+${build}`;
}

function run(command, cwd) {
    console.log(`Running: ${command}`);
    execSync(command, { cwd, stdio: 'inherit' });
}

function copyWebBuild() {
    const webBuildDir = path.join(VOCAB_DIR, 'build/web');
    if (!fs.existsSync(webBuildDir)) {
        throw new Error(`Flutter web build not found at: ${webBuildDir}`);
    }

    if (fs.existsSync(PUBLIC_VOCAB_DIR)) {
        fs.rmSync(PUBLIC_VOCAB_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(PUBLIC_VOCAB_DIR, { recursive: true });
    fs.cpSync(webBuildDir, PUBLIC_VOCAB_DIR, { recursive: true });
    console.log(`Web build copied to: ${PUBLIC_VOCAB_DIR}`);
}

function zipWindowsRelease(versionStr) {
    const winReleaseDir = path.join(VOCAB_DIR, 'build/windows/x64/runner/Release');
    if (!fs.existsSync(winReleaseDir)) {
        throw new Error(`Windows release folder not found at: ${winReleaseDir}`);
    }

    const zipDestPath = path.join(VOCAB_DIR, 'build/vocabflip-windows.zip');
    if (fs.existsSync(zipDestPath)) {
        fs.unlinkSync(zipDestPath);
    }

    execFileSync(
        'powershell.exe',
        [
            '-NoProfile',
            '-Command',
            `Compress-Archive -Path '${winReleaseDir}\\*' -DestinationPath '${zipDestPath}' -Force`,
        ],
        { stdio: 'inherit' },
    );

    return zipDestPath;
}

function streamToString(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

function createB2Client() {
    return new S3Client({
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
}

async function uploadFile(s3, key, filePath, contentType) {
    const size = fs.statSync(filePath).size;
    await s3.send(new PutObjectCommand({
        Bucket: B2_BUCKET_NAME,
        Key: key,
        Body: fs.readFileSync(filePath),
        ContentType: contentType,
    }));

    const url = `${CDN_BASE_URL}/${key}`;
    console.log(`Uploaded: ${url} (${(size / 1024 / 1024).toFixed(2)} MB)`);
    return { url, size };
}

async function updateVersionMetadata(s3, versionStr, releaseNotes, apk, windowsZip) {
    const versionKey = `${B2_APP_PREFIX}/version.json`;

    try {
        const existing = await s3.send(new GetObjectCommand({
            Bucket: B2_BUCKET_NAME,
            Key: versionKey,
        }));
        const body = JSON.parse(await streamToString(existing.Body));
        console.log(`Found existing metadata: ${body.tag_name || body.version || 'unknown'}`);
    } catch {
        console.log('Creating new VocabFlip release metadata.');
    }

    const versionJson = {
        tag_name: `v${versionStr}`,
        name: `VocabFlip v${versionStr}`,
        body: releaseNotes,
        published_at: new Date().toISOString(),
        assets: [
            {
                name: `vocabflip-v${versionStr}.apk`,
                browser_download_url: apk.url,
                size: apk.size,
            },
            {
                name: 'vocabflip-windows.zip',
                browser_download_url: windowsZip.url,
                size: windowsZip.size,
            },
        ],
    };

    await s3.send(new PutObjectCommand({
        Bucket: B2_BUCKET_NAME,
        Key: versionKey,
        Body: JSON.stringify(versionJson, null, 2),
        ContentType: 'application/json',
    }));

    console.log(`Metadata updated: ${CDN_BASE_URL}/${versionKey}`);
}

async function cleanupOldReleases(s3) {
    console.log('Cleaning up old VocabFlip releases on B2 (keeping 3 newest versions)...');
    try {
        const listRes = await s3.send(new ListObjectsV2Command({
            Bucket: B2_BUCKET_NAME,
            Prefix: `${B2_APP_PREFIX}/releases/`,
        }));

        const items = listRes.Contents || [];
        const fileRegex = /^vocabflip-app\/releases\/vocabflip-(?:windows-)?v([\d.]+)\.(?:apk|zip)$/;
        const fileVersionMap = items
            .map((item) => {
                const key = item.Key || '';
                const match = key.match(fileRegex);
                return match ? { key, version: match[1] } : null;
            })
            .filter(Boolean);

        const uniqueVersions = Array.from(new Set(fileVersionMap.map((item) => item.version)));
        if (uniqueVersions.length <= 3) {
            console.log('3 or fewer versions found. No cleanup needed.');
            return;
        }

        uniqueVersions.sort((a, b) => {
            const left = a.split('.').map(Number);
            const right = b.split('.').map(Number);
            for (let i = 0; i < 3; i += 1) {
                const diff = (left[i] || 0) - (right[i] || 0);
                if (diff !== 0) return diff;
            }
            return 0;
        });

        const keepVersions = uniqueVersions.slice(-3);
        const deleteKeys = fileVersionMap
            .filter((item) => !keepVersions.includes(item.version))
            .map((item) => ({ Key: item.key }));

        if (deleteKeys.length === 0) {
            console.log('No old release files matched cleanup criteria.');
            return;
        }

        await s3.send(new DeleteObjectsCommand({
            Bucket: B2_BUCKET_NAME,
            Delete: {
                Objects: deleteKeys,
                Quiet: true,
            },
        }));
        console.log(`Deleted ${deleteKeys.length} old release files.`);
    } catch (error) {
        console.warn(`Release cleanup skipped: ${error.message}`);
    }
}

async function main() {
    console.log('=== VOCABFLIP AUTOMATED B2 RELEASE ===');

    if (!B2_ENDPOINT || !B2_ACCESS_KEY_ID || !B2_SECRET_ACCESS_KEY || !B2_BUCKET_NAME || !CDN_BASE_URL) {
        console.error('Missing B2 environment variables in alpha-studio-backend/.env');
        process.exit(1);
    }

    const args = process.argv.slice(2);
    let platform = 'all';
    const platformArgIndex = args.findIndex(a => a.startsWith('--platform='));
    if (platformArgIndex !== -1) {
        platform = args[platformArgIndex].split('=')[1];
        args.splice(platformArgIndex, 1);
    }

    const action = args[0];
    const noBumpActions = new Set(['none', 'skip', 'current', 'nobump']);
    const currentFullVersion = getPubspecVersion();
    let targetFullVersion = currentFullVersion;

    if (action && !noBumpActions.has(action.toLowerCase())) {
        console.log(`Current version in pubspec.yaml: ${currentFullVersion}`);
        targetFullVersion = calculateNextVersion(currentFullVersion, action);
        updatePubspecVersion(targetFullVersion);
    } else {
        console.log(`Using current version from pubspec.yaml: ${currentFullVersion}`);
    }

    const versionStr = targetFullVersion.split('+')[0];
    const releaseNotes = args.slice(1).join(' ') || `Automated VocabFlip release v${versionStr}`;

    if (platform === 'all' || platform === 'android') {
        console.log('\n[1/5] Building Android APK...');
        run('flutter build apk --release', VOCAB_DIR);
    } else {
        console.log('\n[1/5] Skipping Android APK build (--platform=' + platform + ')');
    }

    let zipPath;
    if (platform === 'all' || platform === 'windows') {
        console.log('\n[2/5] Building Windows app...');
        run('flutter build windows --release', VOCAB_DIR);
        zipPath = zipWindowsRelease(versionStr);
    } else {
        console.log('\n[2/5] Skipping Windows app build (--platform=' + platform + ')');
    }

    if (platform === 'all' || platform === 'web') {
        console.log('\n[3/5] Building Web app and publishing to frontend public/vocab...');
        run('flutter build web --release --base-href "/vocab/"', VOCAB_DIR);
        copyWebBuild();
    } else {
        console.log('\n[3/5] Skipping Web app build (--platform=' + platform + ')');
    }

    if (platform === 'all' || platform === 'android' || platform === 'windows') {
        console.log('\n[4/5] Uploading APK and Windows ZIP to B2...');
        const s3 = createB2Client();
        let apk, windowsZip;
        
        if (platform === 'all' || platform === 'android') {
            const apkPath = path.join(VOCAB_DIR, 'build/app/outputs/flutter-apk/app-release.apk');
            const apkKey = `${B2_APP_PREFIX}/releases/vocabflip-v${versionStr}.apk`;
            apk = await uploadFile(s3, apkKey, apkPath, 'application/vnd.android.package-archive');
        }
        
        if (platform === 'all' || platform === 'windows') {
            const winKey = `${B2_APP_PREFIX}/releases/vocabflip-windows.zip`;
            windowsZip = await uploadFile(s3, winKey, zipPath, 'application/zip');
        }

        if (platform === 'all') {
            console.log('\n[5/5] Updating release metadata...');
            await updateVersionMetadata(s3, versionStr, releaseNotes, apk, windowsZip);
            await cleanupOldReleases(s3);
        } else {
            console.log('\n[5/5] Skipping metadata update for partial build');
        }

        console.log('\n=== VOCABFLIP RELEASE FINISHED ===');
        if (apk) console.log(`Android: ${apk.url}`);
        if (windowsZip) console.log(`Windows: ${windowsZip.url}`);
        if (platform === 'all') console.log(`Metadata: ${CDN_BASE_URL}/${B2_APP_PREFIX}/version.json`);
    } else {
        console.log('\n=== VOCABFLIP WEB-ONLY RELEASE FINISHED ===');
        console.log(`Web app copied to public directory.`);
    }
}

main();
