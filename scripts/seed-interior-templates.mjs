// Idempotent seed: upsert built-in Interior Design Engine templates and
// approved Workshop components into the InteriorTemplate collection.
//
// Usage: node scripts/seed-interior-templates.mjs
import 'dotenv/config';
import mongoose from 'mongoose';
import InteriorTemplate from '../server/models/InteriorTemplate.js';
import { seedInteriorTemplateAssets } from '../server/utils/interiorTemplateAssets.js';

async function main() {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('[seed] MONGODB_URI env not set.');
        process.exit(1);
    }
    await mongoose.connect(mongoUri);
    console.log('[seed] connected to MongoDB.');

    const stats = await seedInteriorTemplateAssets({ logger: console });
    const visible = await InteriorTemplate.countDocuments({ status: { $in: ['seed', 'approved'] } });
    console.log(`[seed] done. built-in=${stats.builtins.processed || 0}, workshop=${stats.workshop.processed || 0}, visible=${visible}.`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
});
