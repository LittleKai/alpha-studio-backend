/**
 * Test script: verify B2 presigned download URL works
 *
 * Usage:
 *   node scripts/test-b2-download.js <b2-cdn-url>
 *
 * Example:
 *   node scripts/test-b2-download.js "https://f004.backblazeb2.com/file/alpha-studio/courses/videos/1234-test.mp4"
 */

import 'dotenv/config';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import https from 'https';
import http from 'http';

const cdnBase = process.env.CDN_BASE_URL;
const inputUrl = process.argv[2];

if (!inputUrl) {
    console.error('\n❌ Usage: node scripts/test-b2-download.js <b2-cdn-url>\n');
    process.exit(1);
}

if (!inputUrl.startsWith(cdnBase)) {
    console.error(`\n❌ URL does not start with CDN_BASE_URL="${cdnBase}"\n`);
    process.exit(1);
}

const key = inputUrl.slice(cdnBase.length + 1);
console.log(`\n📦 Key extracted: ${key}`);

const s3 = new S3Client({
    endpoint: process.env.B2_ENDPOINT,
    region: process.env.B2_REGION || 'us-west-004',
    credentials: {
        accessKeyId: process.env.B2_ACCESS_KEY_ID,
        secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
});

async function run() {
    try {
        // Step 1: HeadObject to verify the file exists
        console.log('\n🔍 Checking file exists via HeadObject...');
        const headCmd = new HeadObjectCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: key,
        });
        const head = await s3.send(headCmd);
        console.log(`✅ File exists: ${head.ContentLength} bytes, type: ${head.ContentType}`);

        // Step 2: Generate presigned GET URL
        console.log('\n🔑 Generating presigned GET URL (4h)...');
        const getCmd = new GetObjectCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: key,
        });
        const signedUrl = await getSignedUrl(s3, getCmd, { expiresIn: 14400 });
        console.log(`✅ Signed URL:\n   ${signedUrl.substring(0, 120)}...`);

        // Step 3: Make HTTP HEAD request to verify the signed URL is accessible
        console.log('\n🌐 Testing signed URL with HEAD request...');
        const statusCode = await headRequest(signedUrl);

        if (statusCode === 200) {
            console.log('✅ Signed URL is VALID and accessible (HTTP 200)');
            console.log('\n🎉 B2 presigned download is working correctly!\n');
        } else if (statusCode === 206) {
            console.log('✅ Signed URL is VALID and accessible (HTTP 206 Partial Content)');
            console.log('\n🎉 B2 presigned download is working correctly!\n');
        } else {
            console.error(`❌ Signed URL returned HTTP ${statusCode}`);
            console.log('\n💡 This means B2 is rejecting the signed URL. Check:');
            console.log('   - Application key has readFiles permission for this bucket');
            console.log('   - B2_BUCKET_NAME matches the actual bucket name');
            console.log('   - B2_ENDPOINT is correct for the region\n');
        }
    } catch (err) {
        console.error('\n❌ Error:', err.message);
        if (err.Code === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
            console.log('   File does not exist in B2. Check the URL or key.');
        } else if (err.$metadata?.httpStatusCode === 401) {
            console.log('   Credentials rejected. Check B2_ACCESS_KEY_ID and B2_SECRET_ACCESS_KEY.');
        }
        console.log();
    }
}

function headRequest(url) {
    return new Promise((resolve) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.request(url, { method: 'HEAD' }, (res) => {
            resolve(res.statusCode);
        });
        req.on('error', (e) => {
            console.error('   Network error:', e.message);
            resolve(-1);
        });
        req.end();
    });
}

run();
