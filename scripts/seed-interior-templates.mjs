// Idempotent seed: upsert built-in interior design templates from the engine
// source-of-truth folder into the InteriorTemplate collection with status="seed".
//
// Usage: node scripts/seed-interior-templates.mjs
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import InteriorTemplate from '../server/models/InteriorTemplate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SEED_DIR = path.resolve(__dirname, '../../tools/interior-design-engine/src/templates');

async function readJson(filePath) {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
}

async function main() {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('[seed] MONGODB_URI env not set.');
        process.exit(1);
    }
    await mongoose.connect(mongoUri);
    console.log('[seed] connected to MongoDB.');

    const manifestPath = path.join(SEED_DIR, 'manifest.json');
    const manifest = await readJson(manifestPath);
    if (!Array.isArray(manifest.templates) || manifest.templates.length === 0) {
        console.error('[seed] manifest.json has no templates.');
        process.exit(2);
    }

    let upserted = 0;
    for (const filename of manifest.templates) {
        const tplPath = path.join(SEED_DIR, filename);
        const tpl = await readJson(tplPath);
        if (!tpl.id || !tpl.category) {
            console.warn(`[seed] skip ${filename}: missing id/category.`);
            continue;
        }
        await InteriorTemplate.updateOne(
            { templateId: tpl.id, version: tpl.version || 1 },
            {
                $set: {
                    templateId: tpl.id,
                    version: tpl.version || 1,
                    name: tpl.name || tpl.description || { vi: tpl.id, en: tpl.id },
                    description: tpl.description || { vi: '', en: '' },
                    category: tpl.category,
                    tags: Array.isArray(tpl.tags) ? tpl.tags : [],
                    params: tpl.params || {},
                    styleOptions: tpl.style || {},
                    dsl: {
                        boxes: tpl.boxes || tpl.isoBoxes || []
                    },
                    status: 'seed',
                    authorId: null,
                    sourceProjectId: null,
                    sourceInlineId: null
                }
            },
            { upsert: true }
        );
        upserted += 1;
        console.log(`[seed] upserted ${tpl.id}@${tpl.version || 1}`);
    }

    console.log(`[seed] done. ${upserted} templates upserted.`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
});
