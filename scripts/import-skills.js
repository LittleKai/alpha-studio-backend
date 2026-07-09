/**
 * One-time migration script: imports skills.json into MongoDB.
 *
 * Usage:  node scripts/import-skills.js
 *         npm run import:skills
 */

import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

// Import the Skill model
import Skill from '../server/models/Skill.js';

const BATCH_SIZE = 500;
const SKILLS_JSON_PATH = resolve(__dirname, '..', '..', 'alpha-studio', 'public', 'data', 'skills.json');

async function importSkills() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('❌ MONGODB_URI not found in .env');
        process.exit(1);
    }

    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');

    // Read skills.json
    console.log(`📖 Reading skills from ${SKILLS_JSON_PATH}`);
    const raw = await readFile(SKILLS_JSON_PATH, 'utf-8');
    const skills = JSON.parse(raw);
    console.log(`📦 Found ${skills.length} skills in JSON file`);

    // Clear existing skills
    const deleted = await Skill.deleteMany({});
    console.log(`🗑️  Cleared ${deleted.deletedCount} existing skills`);

    // Batch insert
    let inserted = 0;
    for (let i = 0; i < skills.length; i += BATCH_SIZE) {
        const batch = skills.slice(i, i + BATCH_SIZE);

        // Clean each skill to match schema (strip crawl_meta, etc.)
        const cleaned = batch.map(skill => ({
            source: skill.source || '',
            url: skill.url || '',
            slug: skill.slug,
            name: skill.name,
            headline: skill.headline || '',
            headline_vi: skill.headline_vi || '',
            short_description: skill.short_description || '',
            short_description_vi: skill.short_description_vi || '',
            tier: ['Gold', 'Silver', 'Bronze'].includes(skill.tier) ? skill.tier : 'Bronze',
            category: skill.category || 'Productivity',
            difficulty: ['Beginner', 'Intermediate', 'Advanced'].includes(skill.difficulty) ? skill.difficulty : 'Beginner',
            install_type: skill.install_type || '',
            estimated_time_saving: skill.estimated_time_saving || '',
            author: skill.author || '',
            install_command: skill.install_command || '',
            source_repo_url: skill.source_repo_url || '',
            github_stars: Number(skill.github_stars) || 0,
            github_stars_updated_at: skill.github_stars_updated_at || '',
            works_with: skill.works_with || [],
            tags: skill.tags || [],
            sections: {
                overview: skill.sections?.overview || '',
                overview_vi: skill.sections?.overview_vi || '',
                setup: skill.sections?.setup || '',
                setup_vi: skill.sections?.setup_vi || '',
                usage: skill.sections?.usage || '',
                usage_vi: skill.sections?.usage_vi || '',
                requirements: skill.sections?.requirements || [],
                related_skills: skill.sections?.related_skills || []
            }
        }));

        try {
            await Skill.insertMany(cleaned, { ordered: false });
        } catch (error) {
            // insertMany with ordered:false will insert valid docs and throw for duplicates
            if (error.code === 11000) {
                const insertedCount = error.result?.insertedCount || 0;
                console.warn(`⚠️  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${insertedCount} inserted, some duplicates skipped`);
                inserted += insertedCount;
                continue;
            }
            throw error;
        }

        inserted += cleaned.length;
        console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1}: inserted ${cleaned.length} skills (${inserted}/${skills.length})`);
    }

    const finalCount = await Skill.countDocuments();
    console.log(`\n🎉 Import complete! ${finalCount} skills now in database.`);

    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
}

importSkills().catch(error => {
    console.error('❌ Import failed:', error);
    process.exit(1);
});
