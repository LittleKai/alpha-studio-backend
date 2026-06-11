import crypto from 'node:crypto';

export function sha256(body) {
    return crypto.createHash('sha256').update(body).digest('hex');
}

export function buildStorageMetadata({
    provider,
    key,
    url,
    filename,
    mimeType,
    body
}) {
    return {
        provider,
        key,
        url,
        filename,
        mimeType,
        size: body.byteLength,
        checksum: sha256(body)
    };
}

export function migrationObjectKey({
    collection,
    documentId,
    fieldPath,
    checksum,
    extension = ''
}) {
    const safePath = fieldPath.replaceAll('.', '-').replace(/[^a-zA-Z0-9_-]/g, '-');
    return `migrations/mongodb-m0/${collection}/${documentId}/${safePath}-${checksum.slice(0, 16)}${extension}`;
}
