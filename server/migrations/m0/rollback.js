import mongoose from 'mongoose';
import { decodeManifestValue } from './manifest.js';

function documentIdForQuery(documentId) {
    return mongoose.Types.ObjectId.isValid(documentId)
        ? new mongoose.Types.ObjectId(documentId)
        : documentId;
}

function rollbackResult(entry, status, extra = {}) {
    return {
        migration: entry.migration,
        collection: entry.collection,
        documentId: entry.documentId,
        fieldPath: entry.fieldPath,
        status,
        objectKey: entry.object?.key || null,
        ...extra,
        processedAt: new Date().toISOString()
    };
}

export async function rollbackManifestEntries({
    entries,
    apply = false,
    getCollection,
    storage,
    appendResult = async () => {}
}) {
    const candidates = entries.filter((entry) => (
        entry.migration === 'mongodb-m0-v1'
        && (entry.status === 'applied' || entry.status === 'conflict')
    )).reverse();
    const summary = {
        planned: candidates.length,
        restored: 0,
        cleaned: 0,
        conflicts: 0,
        failed: 0
    };
    if (!apply) return summary;

    for (const entry of candidates) {
        try {
            if (entry.status === 'conflict') {
                if (entry.object?.migrationOwned === true && entry.object.key) {
                    await storage.delete(entry.object.key);
                    summary.cleaned += 1;
                    await appendResult(rollbackResult(entry, 'cleaned-conflict-object', {
                        objectDeleted: true
                    }));
                } else {
                    await appendResult(rollbackResult(entry, 'skipped-unowned-conflict-object', {
                        objectDeleted: false
                    }));
                }
                continue;
            }

            const result = await getCollection(entry.collection).updateOne(
                {
                    _id: documentIdForQuery(entry.documentId),
                    [entry.fieldPath]: entry.afterValue
                },
                {
                    $set: {
                        [entry.fieldPath]: decodeManifestValue(entry.beforeValue)
                    }
                }
            );
            if (result.matchedCount !== 1) {
                summary.conflicts += 1;
                await appendResult(rollbackResult(entry, 'conflict'));
                continue;
            }

            let objectDeleted = false;
            if (entry.object?.migrationOwned === true && entry.object.key) {
                await storage.delete(entry.object.key);
                objectDeleted = true;
            }
            summary.restored += 1;
            await appendResult(rollbackResult(entry, 'restored', { objectDeleted }));
        } catch (error) {
            summary.failed += 1;
            await appendResult(rollbackResult(entry, 'failed', { error: error.message }));
        }
    }
    return summary;
}
