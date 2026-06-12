import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB, { disconnectDB } from '../server/db/connection.js';
import { createStorage } from '../server/storage/index.js';
import { createManifestWriter, readManifest } from '../server/migrations/m0/manifest.js';
import { rollbackManifestEntries } from '../server/migrations/m0/rollback.js';

function argumentValue(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

const apply = process.argv.includes('--apply');
const manifestPath = argumentValue('--manifest');
const resultPath = argumentValue('--result') || (manifestPath ? `${manifestPath}.rollback.jsonl` : null);

if (!manifestPath) {
    console.error('--manifest <path> is required');
    process.exitCode = 2;
} else {
    try {
        const entries = await readManifest(manifestPath);
        await connectDB();
        const summary = await rollbackManifestEntries({
            entries,
            apply,
            getCollection: (name) => mongoose.connection.db.collection(name),
            storage: apply ? createStorage() : null,
            appendResult: apply ? createManifestWriter(resultPath) : async () => {}
        });
        console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', resultPath, ...summary }, null, 2));
        if (summary.failed > 0) process.exitCode = 1;
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    } finally {
        await disconnectDB();
    }
}
