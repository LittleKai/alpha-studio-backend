import {
    S3Client, DeleteObjectCommand, PutObjectCommand, GetObjectCommand,
    CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Lazy-initialized: dotenv.config() in index.js runs before any request,
// but AFTER ES module imports — so we must NOT read process.env at module level.
let _s3 = null;
let _corsConfigured = false;

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
 * Configure CORS on the B2 bucket via B2 native API (not S3 compat layer).
 * Called once at server startup — idempotent, errors are non-fatal.
 */
export async function configureBucketCors() {
    if (_corsConfigured) return;
    try {
        const origins = [
            'http://localhost:5173',
            'http://localhost:5174',
            'http://localhost:3000',
        ];
        if (process.env.FRONTEND_URL && !origins.includes(process.env.FRONTEND_URL)) {
            origins.push(process.env.FRONTEND_URL);
        }

        // Step 1: Authorize with B2 native API
        const authRes = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
            headers: {
                Authorization: 'Basic ' + Buffer.from(
                    `${process.env.B2_ACCESS_KEY_ID}:${process.env.B2_SECRET_ACCESS_KEY}`
                ).toString('base64'),
            },
        });
        if (!authRes.ok) throw new Error(`B2 auth failed: ${authRes.status}`);
        const auth = await authRes.json();

        // B2 API v3: apiUrl may be nested inside apiInfo.storageApi (newer format) or at top level (older)
        const apiUrl = auth.apiInfo?.storageApi?.apiUrl || auth.apiUrl;
        if (!apiUrl) throw new Error('B2 auth response missing apiUrl');

        // Step 2: Get bucketId by name
        const bucketsRes = await fetch(
            `${apiUrl}/b2api/v3/b2_list_buckets?accountId=${auth.accountId}&bucketName=${encodeURIComponent(process.env.B2_BUCKET_NAME)}`,
            { headers: { Authorization: auth.authorizationToken } }
        );
        if (!bucketsRes.ok) throw new Error(`B2 list buckets failed: ${bucketsRes.status}`);
        const { buckets } = await bucketsRes.json();
        if (!buckets || buckets.length === 0) throw new Error(`Bucket "${process.env.B2_BUCKET_NAME}" not found`);

        // Step 3: Update bucket CORS rules
        const updateRes = await fetch(`${apiUrl}/b2api/v3/b2_update_bucket`, {
            method: 'POST',
            headers: {
                Authorization: auth.authorizationToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                accountId: auth.accountId,
                bucketId: buckets[0].bucketId,
                corsRules: [{
                    corsRuleName: 'allowDirectUpload',
                    allowedOrigins: origins,
                    allowedOperations: ['s3_put', 's3_get', 's3_head'],
                    allowedHeaders: ['*'],
                    exposeHeaders: ['ETag'],
                    maxAgeSeconds: 3600,
                }],
            }),
        });
        if (!updateRes.ok) {
            const errBody = await updateRes.text();
            throw new Error(`B2 update bucket failed: ${updateRes.status} ${errBody}`);
        }

        _corsConfigured = true;
        console.log('[B2] CORS configured for origins:', origins);
    } catch (err) {
        // Non-fatal: log warning, upload will still work if CORS was set manually in B2 console
        console.warn('[B2] CORS auto-config failed (set CORS manually in B2 console):', err.message);
    }
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

// ─── Multipart Upload ────────────────────────────────────────────────────────

export async function initMultipartUpload(key, contentType) {
    const { UploadId } = await getS3().send(new CreateMultipartUploadCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
    }));
    return UploadId;
}

export async function generatePresignedPartUrl(key, uploadId, partNumber, expiresIn = 3600) {
    return getSignedUrl(getS3(), new UploadPartCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
    }), { expiresIn });
}

export async function finishMultipartUpload(key, uploadId, parts) {
    await getS3().send(new CompleteMultipartUploadCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
            Parts: parts.map(p => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
        },
    }));
}
