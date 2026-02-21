/**
 * One-time script: configure CORS on the B2 bucket so browsers can PUT directly.
 * Run once: node scripts/setup-b2-cors.js
 */
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
dotenv.config();

const {
    B2_ENDPOINT,
    B2_REGION = 'us-west-004',
    B2_ACCESS_KEY_ID,
    B2_SECRET_ACCESS_KEY,
    B2_BUCKET_NAME,
} = process.env;

if (!B2_ENDPOINT || !B2_ACCESS_KEY_ID || !B2_SECRET_ACCESS_KEY || !B2_BUCKET_NAME) {
    console.error('Missing B2 env vars. Make sure .env is configured.');
    process.exit(1);
}

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

const corsConfig = {
    CORSRules: [
        {
            AllowedHeaders: ['*'],
            AllowedMethods: ['PUT', 'GET', 'HEAD'],
            AllowedOrigins: [
                'http://localhost:5173',
                'http://localhost:3000',
                'https://alphastudio.vercel.app',
            ],
            // Video streaming requires Content-Range and Accept-Ranges to be exposed
            // so the browser can handle byte-range requests (needed for seek/buffering)
            ExposeHeaders: ['ETag', 'Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type'],
            MaxAgeSeconds: 3600,
        },
    ],
};

try {
    await s3.send(new PutBucketCorsCommand({
        Bucket: B2_BUCKET_NAME,
        CORSConfiguration: corsConfig,
    }));
    console.log('✅ CORS configured on bucket:', B2_BUCKET_NAME);

    // Verify
    const result = await s3.send(new GetBucketCorsCommand({ Bucket: B2_BUCKET_NAME }));
    console.log('Current CORS rules:', JSON.stringify(result.CORSRules, null, 2));
} catch (err) {
    console.error('❌ Failed to set CORS:', err.message);
    process.exit(1);
}
