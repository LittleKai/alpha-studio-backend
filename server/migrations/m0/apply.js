import { sha256 } from '../../storage/storageMetadata.js';
import { encodeManifestValue } from './manifest.js';

function manifestEntry(action, uploaded, status) {
    return {
        migration: 'mongodb-m0-v1',
        collection: action.collection,
        documentId: action.documentId,
        fieldPath: action.fieldPath,
        beforeValue: encodeManifestValue(action.beforeValue),
        afterValue: uploaded.url,
        object: {
            provider: uploaded.provider,
            key: uploaded.key,
            url: uploaded.url,
            checksum: action.checksum,
            size: action.byteSize,
            migrationOwned: true
        },
        status,
        appliedAt: new Date().toISOString()
    };
}

export async function applyMigrationAction({
    action,
    collection,
    storage,
    appendManifest
}) {
    const uploaded = await storage.put({
        key: action.key,
        body: action.body,
        contentType: action.mimeType,
        filename: action.filename
    });
    if (!await storage.exists(uploaded.key)) {
        throw new Error(`Migrated object was not found after upload: ${uploaded.key}`);
    }
    const storedBody = Buffer.from(await storage.get(uploaded.key));
    if (sha256(storedBody) !== action.checksum) {
        throw new Error(`Migrated object checksum mismatch: ${uploaded.key}`);
    }

    const result = await collection.updateOne(
        { _id: action.documentKey ?? action.documentId, [action.fieldPath]: action.beforeValue },
        { $set: { [action.fieldPath]: uploaded.url } }
    );
    const status = result.matchedCount === 1 ? 'applied' : 'conflict';
    const entry = manifestEntry(action, uploaded, status);
    await appendManifest(entry);
    return { status, entry };
}

export async function runMigrationActions({
    actions,
    apply = false,
    storage,
    getCollection,
    appendManifest = async () => {},
    appendFailure = async () => {},
    concurrency = 2
}) {
    const list = Array.from(actions);
    const summary = {
        planned: list.length,
        applied: 0,
        conflicts: 0,
        failed: 0
    };
    if (!apply) return summary;

    let nextIndex = 0;
    async function worker() {
        while (nextIndex < list.length) {
            const action = list[nextIndex++];
            try {
                const result = await applyMigrationAction({
                    action,
                    collection: getCollection(action.collection),
                    storage,
                    appendManifest
                });
                if (result.status === 'applied') summary.applied += 1;
                else summary.conflicts += 1;
            } catch (error) {
                summary.failed += 1;
                await appendFailure({
                    migration: 'mongodb-m0-v1',
                    collection: action.collection,
                    documentId: action.documentId,
                    fieldPath: action.fieldPath,
                    error: error.message,
                    failedAt: new Date().toISOString()
                });
            }
        }
    }

    await Promise.all(Array.from(
        { length: Math.max(1, Math.min(concurrency, list.length || 1)) },
        () => worker()
    ));
    return summary;
}
