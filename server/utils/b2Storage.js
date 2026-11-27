import {
    S3Client, DeleteObjectCommand, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
    CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
    ListObjectsV2Command,
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
        // B2 expects origins of the form scheme://host[:port] with no path
        // and no trailing slash. Sanitize defensively so a sloppy env value
        // (e.g. FRONTEND_URL='https://example.com/') doesn't fail the whole
        // CORS update.
        const sanitizeOrigin = (raw) => {
            if (!raw || typeof raw !== 'string') return null;
            try {
                const u = new URL(raw.trim());
                if (!u.protocol || !u.host) return null;
                return `${u.protocol}//${u.host}`;
            } catch {
                return null;
            }
        };

        const origins = [
            'http://localhost:5173',
            'http://localhost:5174',
            'http://localhost:3000',
        ];
        for (const raw of [
            process.env.FRONTEND_URL,
            process.env.FRONTEND_URL_PROD,
            'https://giaiphapsangtao.com',
        ]) {
            const ok = sanitizeOrigin(raw);
            if (ok && !origins.includes(ok)) origins.push(ok);
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
 * Content-Disposition for downloads: ASCII `filename` fallback + RFC 5987 `filename*`
 * so non-ASCII (Vietnamese) names are not saved as percent-encoded text.
 */
export function attachmentDisposition(filename) {
    const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
    const encoded = encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Generate a presigned GET URL for downloading/streaming a file from B2
 * @param {string} key - Object key (path in bucket)
 * @param {number} expiresIn - URL expiry in seconds (default 4 hours)
 * @returns {string} presigned URL
 */
export async function generatePresignedDownloadUrl(key, expiresIn = 14400, filename = null) {
    const params = {
        Bucket: process.env.B2_BUCKET_NAME,
        Key: key,
    };
    if (filename) {
        params.ResponseContentDisposition = attachmentDisposition(filename);
    }
    const command = new GetObjectCommand(params);
    return getSignedUrl(getS3(), command, { expiresIn });
}

/**
 * Convert a public CDN URL (built with CDN_BASE_URL) to a B2 presigned download URL.
 * Used when the CDN is unreachable (e.g. Cloudflare 525 SNI mismatch) but the
 * caller still needs the file served — presigned URL goes direct to B2.
 * Returns null if the URL does not belong to our CDN, so callers can fall back.
 * @param {string} url
 * @param {number} expiresIn
 * @returns {Promise<string|null>}
 */
export async function cdnUrlToPresignedDownload(url, expiresIn = 14400) {
    if (!url || typeof url !== 'string') return null;
    const cdnBase = process.env.CDN_BASE_URL;
    if (!cdnBase) return null;
    const base = cdnBase.endsWith('/') ? cdnBase : cdnBase + '/';
    if (!url.startsWith(base)) return null;
    const key = url.slice(base.length).split('?')[0];
    if (!key) return null;
    return generatePresignedDownloadUrl(key, expiresIn);
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

export async function headFile(key) {
    try {
        const response = await getS3().send(new HeadObjectCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: key,
        }));
        return {
            exists: true,
            size: response.ContentLength ?? null,
            contentType: response.ContentType ?? null
        };
    } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') {
            return {
                exists: false,
                size: null,
                contentType: null
            };
        }
        throw error;
    }
}

export async function downloadFile(key) {
    const response = await getS3().send(new GetObjectCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: key,
    }));
    if (!response.Body) return Buffer.alloc(0);
    if (typeof response.Body.transformToByteArray === 'function') {
        return Buffer.from(await response.Body.transformToByteArray());
    }

    const chunks = [];
    for await (const chunk of response.Body) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

/**
 * Upload bytes from the backend directly to B2.
 * Used when the backend receives a file (e.g. proxied from the flow agent)
 * and needs to persist it without a browser round trip.
 * @param {string} key - Object key (path in bucket)
 * @param {Buffer|Uint8Array} body - File bytes
 * @param {string} contentType - MIME type
 * @returns {{ key: string, publicUrl: string }}
 */
export async function uploadFile(key, body, contentType, extra = {}) {
    await getS3().send(new PutObjectCommand({
        ...(extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {}),
        Bucket: process.env.B2_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType,
    }));
    return { key, publicUrl: `${process.env.CDN_BASE_URL}/${key}` };
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

/**
 * List all objects in the B2 bucket (handles pagination automatically).
 * @returns {Promise<Array<{ key: string, size: number, lastModified: Date }>>}
 */
export async function listAllFiles() {
    const s3 = getS3();
    const bucket = process.env.B2_BUCKET_NAME;
    const files = [];
    let continuationToken;

    do {
        const response = await s3.send(new ListObjectsV2Command({
            Bucket: bucket,
            ...(continuationToken && { ContinuationToken: continuationToken }),
        }));

        for (const obj of (response.Contents || [])) {
            files.push({
                key: obj.Key,
                size: obj.Size,
                lastModified: obj.LastModified,
            });
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return files;
}

// ─── LED Studio Private Workspace Bucket ─────────────────────────────────────

let _workspaceS3 = null;
let _workspaceCorsConfigured = false;

export function getLedWorkspaceBucketName() {
    return String(process.env.B2_LED_WORKSPACE_BUCKET || process.env.B2_PRIVATE_BUCKET_NAME || '').trim();
}

export function isLedWorkspaceB2Configured() {
    const bucket = getLedWorkspaceBucketName();
    const endpoint = process.env.B2_LED_WORKSPACE_ENDPOINT || process.env.B2_ENDPOINT;
    const keyId = process.env.B2_LED_WORKSPACE_KEY_ID || process.env.B2_ACCESS_KEY_ID;
    const appKey = process.env.B2_LED_WORKSPACE_APP_KEY || process.env.B2_SECRET_ACCESS_KEY;
    return Boolean(bucket && endpoint && keyId && appKey);
}

function getWorkspaceS3() {
    if (!_workspaceS3) {
        const endpoint = process.env.B2_LED_WORKSPACE_ENDPOINT || process.env.B2_ENDPOINT;
        const region = process.env.B2_LED_WORKSPACE_REGION || process.env.B2_REGION || 'us-west-004';
        const accessKeyId = process.env.B2_LED_WORKSPACE_KEY_ID || process.env.B2_ACCESS_KEY_ID;
        const secretAccessKey = process.env.B2_LED_WORKSPACE_APP_KEY || process.env.B2_SECRET_ACCESS_KEY;

        if (!endpoint || !accessKeyId || !secretAccessKey || !getLedWorkspaceBucketName()) {
            throw new Error('Missing LED Workspace B2 environment variables');
        }

        _workspaceS3 = new S3Client({
            endpoint,
            region,
            credentials: { accessKeyId, secretAccessKey },
            forcePathStyle: true,
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
        });
    }
    return _workspaceS3;
}

export async function configureLedWorkspaceBucketCors() {
    if (_workspaceCorsConfigured || !isLedWorkspaceB2Configured()) return;
    try {
        const keyId = process.env.B2_LED_WORKSPACE_KEY_ID || process.env.B2_ACCESS_KEY_ID;
        const appKey = process.env.B2_LED_WORKSPACE_APP_KEY || process.env.B2_SECRET_ACCESS_KEY;
        const bucketName = getLedWorkspaceBucketName();

        const sanitizeOrigin = (raw) => {
            if (!raw || typeof raw !== 'string') return null;
            try {
                const u = new URL(raw.trim());
                if (!u.protocol || !u.host) return null;
                return `${u.protocol}//${u.host}`;
            } catch {
                return null;
            }
        };

        const origins = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'];
        for (const raw of [process.env.FRONTEND_URL, process.env.FRONTEND_URL_PROD, 'https://giaiphapsangtao.com']) {
            const ok = sanitizeOrigin(raw);
            if (ok && !origins.includes(ok)) origins.push(ok);
        }

        const authRes = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
            headers: { Authorization: 'Basic ' + Buffer.from(`${keyId}:${appKey}`).toString('base64') },
        });
        if (!authRes.ok) throw new Error(`B2 auth failed: ${authRes.status}`);
        const auth = await authRes.json();
        const apiUrl = auth.apiInfo?.storageApi?.apiUrl || auth.apiUrl;
        if (!apiUrl) throw new Error('B2 auth response missing apiUrl');

        const bucketsRes = await fetch(
            `${apiUrl}/b2api/v3/b2_list_buckets?accountId=${auth.accountId}&bucketName=${encodeURIComponent(bucketName)}`,
            { headers: { Authorization: auth.authorizationToken } }
        );
        if (!bucketsRes.ok) throw new Error(`B2 list buckets failed: ${bucketsRes.status}`);
        const { buckets } = await bucketsRes.json();
        if (!buckets || buckets.length === 0) throw new Error(`Workspace bucket "${bucketName}" not found`);

        const updateRes = await fetch(`${apiUrl}/b2api/v3/b2_update_bucket`, {
            method: 'POST',
            headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accountId: auth.accountId,
                bucketId: buckets[0].bucketId,
                corsRules: [{
                    corsRuleName: 'allowLedWorkspaceDirectUpload',
                    allowedOrigins: origins,
                    allowedOperations: ['s3_put', 's3_get', 's3_head'],
                    allowedHeaders: ['*'],
                    exposeHeaders: ['ETag', 'x-amz-version-id'],
                    maxAgeSeconds: 3600,
                }],
            }),
        });
        if (!updateRes.ok) {
            const errBody = await updateRes.text();
            throw new Error(`B2 update workspace bucket failed: ${updateRes.status} ${errBody}`);
        }
        _workspaceCorsConfigured = true;
    } catch (err) {
        console.warn('[B2] Workspace bucket CORS auto-config failed:', err.message);
    }
}

export async function generateWorkspacePresignedPutUrl(key, contentType, contentLength, expiresIn = 900) {
    const params = {
        Bucket: getLedWorkspaceBucketName(),
        Key: key,
        ContentType: contentType,
    };
    if (Number.isFinite(contentLength) && contentLength > 0) {
        params.ContentLength = contentLength;
    }
    const presignedUrl = await getSignedUrl(getWorkspaceS3(), new PutObjectCommand(params), { expiresIn });
    return { presignedUrl, bucketName: getLedWorkspaceBucketName(), key };
}

export async function generateWorkspacePresignedGetUrl(key, versionId = null, expiresIn = 3600, filename = null) {
    const params = {
        Bucket: getLedWorkspaceBucketName(),
        Key: key,
    };
    if (versionId && versionId !== 'null') params.VersionId = versionId;
    params.ResponseContentDisposition = filename ? attachmentDisposition(filename) : 'attachment';
    return getSignedUrl(getWorkspaceS3(), new GetObjectCommand(params), { expiresIn });
}

export async function putWorkspaceObject(key, body, contentType, contentLength = undefined) {
    const params = {
        Bucket: getLedWorkspaceBucketName(),
        Key: key,
        Body: body,
        ContentType: contentType,
    };
    if (Number.isFinite(contentLength) && contentLength >= 0) {
        params.ContentLength = contentLength;
    }
    const response = await getWorkspaceS3().send(new PutObjectCommand(params));
    return {
        bucketName: getLedWorkspaceBucketName(),
        key,
        versionId: response.VersionId || 'null',
        etag: response.ETag || null,
    };
}

export async function headWorkspaceObject(key, versionId = null) {
    try {
        const params = { Bucket: getLedWorkspaceBucketName(), Key: key };
        if (versionId && versionId !== 'null') params.VersionId = versionId;
        const response = await getWorkspaceS3().send(new HeadObjectCommand(params));
        return {
            exists: true,
            size: response.ContentLength ?? null,
            contentType: response.ContentType ?? null,
            versionId: response.VersionId || versionId || 'null',
        };
    } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound' || error?.Code === 'NoSuchVersion') {
            return { exists: false, size: null, contentType: null, versionId: null };
        }
        throw error;
    }
}

export async function readWorkspaceObjectHeadBytes(key, versionId = null, maxBytes = 4096) {
    const limit = Math.max(1, Number(maxBytes) || 4096);
    const params = {
        Bucket: getLedWorkspaceBucketName(),
        Key: key,
        Range: `bytes=0-${limit - 1}`,
    };
    if (versionId && versionId !== 'null') {
        params.VersionId = versionId;
    }
    const response = await getWorkspaceS3().send(new GetObjectCommand(params));
    if (!response?.Body) return Buffer.alloc(0);
    if (typeof response.Body.transformToByteArray === 'function') {
        const arr = await response.Body.transformToByteArray();
        return Buffer.from(arr);
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of response.Body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buf);
        total += buf.length;
        if (total >= limit) break;
    }
    return Buffer.concat(chunks, Math.min(total, limit));
}

export async function deleteWorkspaceObjectVersion(key, versionId) {
    try {
        const params = { Bucket: getLedWorkspaceBucketName(), Key: key };
        if (versionId && versionId !== 'null') {
            params.VersionId = versionId;
        }
        await getWorkspaceS3().send(new DeleteObjectCommand(params));
        return { deleted: true, versionId: versionId || 'null' };
    } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound' || error?.Code === 'NoSuchVersion') {
            return { deleted: true, alreadyAbsent: true, versionId: versionId || 'null' };
        }
        throw error;
    }
}
