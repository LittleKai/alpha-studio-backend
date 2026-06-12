import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

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
