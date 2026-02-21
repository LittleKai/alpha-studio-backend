/**
 * One-time script: set B2 bucket to public-read so video URLs and file URLs are accessible.
 * Run: node scripts/set-b2-bucket-public.js
 */
import { S3Client, PutBucketAclCommand, GetBucketAclCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
dotenv.config();

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

const BUCKET = process.env.B2_BUCKET_NAME;

try {
    await s3.send(new PutBucketAclCommand({ Bucket: BUCKET, ACL: 'public-read' }));
    console.log('✅ Bucket set to public-read:', BUCKET);

    const acl = await s3.send(new GetBucketAclCommand({ Bucket: BUCKET }));
    console.log('Current grants:', JSON.stringify(acl.Grants, null, 2));
} catch (err) {
    console.error('❌ Failed:', err.message);
    process.exit(1);
}
