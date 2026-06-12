import { B2StorageAdapter } from './b2StorageAdapter.js';
import { LocalStorageAdapter } from './localStorageAdapter.js';

export function createStorage(env = process.env) {
    const provider = env.STORAGE_PROVIDER || 'b2';
    if (provider === 'local') {
        return new LocalStorageAdapter({
            root: env.LOCAL_STORAGE_ROOT || './.data/storage',
            publicBaseUrl: env.LOCAL_STORAGE_PUBLIC_URL || 'http://localhost:3001/storage'
        });
    }
    if (provider !== 'b2') {
        throw new Error(`Unsupported STORAGE_PROVIDER: ${provider}`);
    }
    return new B2StorageAdapter();
}

export {
    B2StorageAdapter,
    LocalStorageAdapter
};
