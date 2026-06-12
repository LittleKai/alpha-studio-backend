import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildStorageMetadata } from './storageMetadata.js';

export class LocalStorageAdapter {
    constructor({ root, publicBaseUrl }) {
        this.root = path.resolve(root);
        this.publicBaseUrl = publicBaseUrl.replace(/\/+$/, '');
    }

    resolveKey(key) {
        const target = path.resolve(this.root, key);
        if (target === this.root || !target.startsWith(`${this.root}${path.sep}`)) {
            throw new Error('Storage key resolves outside the storage root');
        }
        return target;
    }

    async put({ key, body, contentType, filename }) {
        const target = this.resolveKey(key);
        const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(temp, body);
        await rename(temp, target);

        return buildStorageMetadata({
            provider: 'local',
            key,
            url: `${this.publicBaseUrl}/${key.replaceAll('\\', '/')}`,
            filename,
            mimeType: contentType,
            body
        });
    }

    async exists(key) {
        try {
            await access(this.resolveKey(key));
            return true;
        } catch (error) {
            if (error?.code === 'ENOENT') return false;
            throw error;
        }
    }

    async get(key) {
        return readFile(this.resolveKey(key));
    }

    async delete(key) {
        await rm(this.resolveKey(key), { force: true });
    }
}
