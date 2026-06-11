import {
    deleteFile,
    headFile,
    uploadFile
} from '../utils/b2Storage.js';
import { buildStorageMetadata } from './storageMetadata.js';

export class B2StorageAdapter {
    constructor({
        putObject = ({ key, body, contentType }) => uploadFile(key, body, contentType),
        headObject = headFile,
        deleteObject = deleteFile
    } = {}) {
        this.putObject = putObject;
        this.headObject = headObject;
        this.deleteObject = deleteObject;
    }

    async put({ key, body, contentType, filename }) {
        const uploaded = await this.putObject({ key, body, contentType });
        return buildStorageMetadata({
            provider: 'b2',
            key: uploaded.key,
            url: uploaded.publicUrl,
            filename,
            mimeType: contentType,
            body
        });
    }

    async exists(key) {
        const result = await this.headObject(key);
        return result.exists;
    }

    async head(key) {
        return this.headObject(key);
    }

    async delete(key) {
        await this.deleteObject(key);
    }
}
