import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB, { disconnectDB } from '../server/db/connection.js';
import { createStorage } from '../server/storage/index.js';
import { createManifestWriter } from '../server/migrations/m0/manifest.js';
import { scanMongoMedia } from '../server/migrations/m0/scan.js';
import { runMigrationActions } from '../server/migrations/m0/apply.js';

function argumentValue(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

const apply = process.argv.includes('--apply');
const manifestPath = argumentValue('--manifest');
const batchSize = Number(argumentValue('--batch-size') || 25);
const concurrency = Number(argumentValue('--concurrency') || 2);

if (apply && !manifestPath) {
    console.error('--apply requires --manifest <path>');
    process.exitCode = 2;
} else {
    try {
        await connectDB();
        const actions = [];
        for await (const action of scanMongoMedia({
            db: mongoose.connection.db,
            batchSize
        })) {
            actions.push(action);
            if (!apply) {
                console.log(JSON.stringify({
                    collection: action.collection,
                    documentId: action.documentId,
                    fieldPath: action.fieldPath,
                    byteSize: action.byteSize,
                    mimeType: action.mimeType,
                    checksum: action.checksum,
                    key: action.key
                }));
            }
        }

        const summary = await runMigrationActions({
            actions,
            apply,
            storage: apply ? createStorage() : null,
            getCollection: (name) => mongoose.connection.db.collection(name),
            appendManifest: apply ? createManifestWriter(manifestPath) : async () => {},
            appendFailure: apply ? createManifestWriter(`${manifestPath}.failures.jsonl`) : async () => {},
            concurrency
        });
        console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...summary }, null, 2));
        if (summary.failed > 0) process.exitCode = 1;
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    } finally {
        await disconnectDB();
    }
}
