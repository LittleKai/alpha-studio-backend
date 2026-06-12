import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import connectDB, { disconnectDB } from '../server/db/connection.js';
import { applyReviewedIndexPlan } from '../server/migrations/m0/indexPlan.js';
import { auditDatabase, auditToMarkdown } from '../server/migrations/m0/audit.js';

function argumentValue(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

const applyIndexes = process.argv.includes('--apply-indexes');
const outputBase = argumentValue('--output');

try {
    await connectDB();
    const indexChanges = applyIndexes
        ? await applyReviewedIndexPlan(mongoose.connection.db)
        : [];
    const report = await auditDatabase(mongoose.connection.db);
    const payload = {
        generatedAt: new Date().toISOString(),
        indexMode: applyIndexes ? 'applied' : 'dry-run',
        indexChanges,
        collections: report
    };
    console.log(JSON.stringify(payload, null, 2));

    if (outputBase) {
        const absoluteBase = path.resolve(outputBase);
        await mkdir(path.dirname(absoluteBase), { recursive: true });
        await writeFile(`${absoluteBase}.json`, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        await writeFile(`${absoluteBase}.md`, auditToMarkdown(report), 'utf8');
    }
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    await disconnectDB();
}
