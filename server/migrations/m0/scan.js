import { migrationObjectKey, sha256 } from '../../storage/storageMetadata.js';
import {
    collectionsWithMediaFields,
    mediaFieldsForCollection
} from './mediaFields.js';

const DATA_URL_PATTERN = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([a-zA-Z0-9+/=\s]+)$/;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

const MIME_EXTENSIONS = new Map([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/gif', '.gif'],
    ['image/webp', '.webp'],
    ['audio/mpeg', '.mp3'],
    ['audio/wav', '.wav'],
    ['video/mp4', '.mp4'],
    ['application/pdf', '.pdf'],
    ['application/json', '.json'],
    ['text/plain', '.txt']
]);

function bsonBinaryBytes(value) {
    if (value?._bsontype !== 'Binary') return null;
    if (typeof value.value === 'function') return Buffer.from(value.value(true));
    if (value.buffer) return Buffer.from(value.buffer);
    return null;
}

export function decodeInlineMedia(value, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
    let body;
    let mimeType = 'application/octet-stream';
    if (typeof value === 'string') {
        const match = value.match(DATA_URL_PATTERN);
        if (!match) return null;
        mimeType = match[1] || mimeType;
        body = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    } else if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        body = Buffer.from(value);
    } else {
        body = bsonBinaryBytes(value);
    }

    if (!body) return null;
    if (body.byteLength > maxBytes) {
        throw new Error(`Inline media exceeds migration limit (${body.byteLength} > ${maxBytes})`);
    }
    return { body, mimeType };
}

function expandRecursive(value, pathParts, output) {
    const path = pathParts.join('.');
    if (decodeInlineMedia(value)) output.push({ fieldPath: path, value });
    if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || value instanceof Uint8Array) return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => expandRecursive(item, [...pathParts, String(index)], output));
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        expandRecursive(child, [...pathParts, key], output);
    }
}

export function expandFieldGlob(document, fieldGlob) {
    const tokens = fieldGlob.split('.');
    const output = [];

    function visit(value, tokenIndex, pathParts) {
        if (tokenIndex === tokens.length) {
            output.push({ fieldPath: pathParts.join('.'), value });
            return;
        }
        const token = tokens[tokenIndex];
        if (token === '**') {
            expandRecursive(value, pathParts, output);
            return;
        }
        if (token === '*') {
            if (Array.isArray(value)) {
                value.forEach((item, index) => visit(item, tokenIndex + 1, [...pathParts, String(index)]));
            } else if (value && typeof value === 'object') {
                Object.entries(value).forEach(([key, item]) => visit(item, tokenIndex + 1, [...pathParts, key]));
            }
            return;
        }
        if (value !== null && value !== undefined && typeof value === 'object' && token in value) {
            visit(value[token], tokenIndex + 1, [...pathParts, token]);
        }
    }

    visit(document, 0, []);
    return output;
}

export function scanDocument({
    collection,
    document,
    fieldDefinitions = mediaFieldsForCollection(collection),
    maxBytes
}) {
    const actions = [];
    const seenPaths = new Set();
    for (const definition of fieldDefinitions) {
        if (definition.collection !== collection) continue;
        for (const match of expandFieldGlob(document, definition.field)) {
            if (seenPaths.has(match.fieldPath)) continue;
            const decoded = decodeInlineMedia(match.value, { maxBytes });
            if (!decoded) continue;
            seenPaths.add(match.fieldPath);
            const checksum = sha256(decoded.body);
            const extension = MIME_EXTENSIONS.get(decoded.mimeType) || '';
            actions.push({
                collection,
                documentId: document._id.toString(),
                documentKey: document._id,
                fieldPath: match.fieldPath,
                beforeValue: match.value,
                body: decoded.body,
                byteSize: decoded.body.byteLength,
                mimeType: decoded.mimeType,
                checksum,
                filename: `${definition.filenameHint || 'media'}${extension}`,
                key: migrationObjectKey({
                    collection,
                    documentId: document._id.toString(),
                    fieldPath: match.fieldPath,
                    checksum,
                    extension
                })
            });
        }
    }
    return actions;
}

function collectionProjection(definitions) {
    return definitions.reduce((projection, definition) => {
        projection[definition.field.split('.')[0]] = 1;
        return projection;
    }, { _id: 1 });
}

export async function* scanMongoMedia({
    db,
    registry,
    batchSize = 25,
    maxBytes
}) {
    for (const collectionName of collectionsWithMediaFields(registry)) {
        const definitions = mediaFieldsForCollection(collectionName, registry);
        const cursor = db.collection(collectionName).find(
            {},
            { projection: collectionProjection(definitions), batchSize }
        );
        for await (const document of cursor) {
            yield* scanDocument({
                collection: collectionName,
                document,
                fieldDefinitions: definitions,
                maxBytes
            });
        }
    }
}
