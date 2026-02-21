import { S3Client, DeleteObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Lazy-initialized: dotenv.config() in index.js runs before any request,
// but AFTER ES module imports — so we must NOT read process.env at module level.
let _s3 = null;

function getS3() {
    if (!_s3) {
        const { B2_ENDPOINT, B2_REGION = 'us-west-004', B2_ACCESS_KEY_ID, B2_SECRET_ACCESS_KEY } = process.env;

        if (!B2_ENDPOINT || !B2_ACCESS_KEY_ID || !B2_SECRET_ACCESS_KEY) {
            throw new Error('Missing B2 environment variables (B2_ENDPOINT, B2_ACCESS_KEY_ID, B2_SECRET_ACCESS_KEY)');
        }

        _s3 = new S3Client({
            endpoint: B2_ENDPOINT,
            region: B2_REGION,
            credentials: {
                accessKeyId: B2_ACCESS_KEY_ID,
                secretAccessKey: B2_SECRET_ACCESS_KEY,
            },
            forcePathStyle: true, // Required for B2
            // Disable auto-checksums — B2 does not support x-amz-checksum-crc32
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
        });
    }
    return _s3;
}

/**
 * Generate a presigned URL for uploading a file directly to B2
 * @param {string} key - Object key (path in bucket)
 * @param {string} contentType - MIME type of the file
 * @param {number} expiresIn - URL expiry in seconds (default 15 minutes)
 * @returns {{ presignedUrl: string, publicUrl: string }}
 */
export async function generatePresignedUploadUrl(key, contentType, expiresIn = 900) {
    const command = new PutObjectCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(getS3(), command, { expiresIn });
    const publicUrl = `${process.env.CDN_BASE_URL}/${key}`;

    return { presignedUrl, publicUrl };
}

/**
 * Generate a presigned GET URL for downloading/streaming a file from B2
 * @param {string} key - Object key (path in bucket)
 * @param {number} expiresIn - URL expiry in seconds (default 4 hours)
 * @returns {string} presigned URL
 */
export async function generatePresignedDownloadUrl(key, expiresIn = 14400) {
    const command = new GetObjectCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: key,
    });
    return getSignedUrl(getS3(), command, { expiresIn });
}

/**
 * Delete a file from B2
 * @param {string} key - Object key to delete
 */
export async function deleteFile(key) {
    await getS3().send(new DeleteObjectCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: key,
    }));
}
