import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export function encodeManifestValue(value) {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        return {
            $migrationEncoding: 'base64',
            value: Buffer.from(value).toString('base64')
        };
    }
    if (value?._bsontype === 'Binary') {
        const bytes = typeof value.value === 'function' ? value.value(true) : value.buffer;
        return {
            $migrationEncoding: 'bson-binary-base64',
            value: Buffer.from(bytes).toString('base64')
        };
    }
    return value;
}

export function decodeManifestValue(value) {
    if (value?.$migrationEncoding === 'base64' || value?.$migrationEncoding === 'bson-binary-base64') {
        return Buffer.from(value.value, 'base64');
    }
    if (value?.type === 'Buffer' && Array.isArray(value.data)) {
        return Buffer.from(value.data);
    }
    return value;
}

export function createManifestWriter(filePath) {
    return async function appendManifest(entry) {
        await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
        await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    };
}

export async function readManifest(filePath) {
    const content = await readFile(filePath, 'utf8');
    return content
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}
