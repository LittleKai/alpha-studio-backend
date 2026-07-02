import mongoose from 'mongoose';

const skillSchema = new mongoose.Schema({
    source: { type: String, default: '' },
    url: { type: String, default: '' },
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    headline: { type: String, default: '' },
    headline_vi: { type: String, default: '' },
    short_description: { type: String, default: '' },
    short_description_vi: { type: String, default: '' },
    tier: { type: String, enum: ['Gold', 'Silver', 'Bronze', ''], default: 'Bronze' },
    category: { type: String, default: 'Productivity' },
    difficulty: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced', ''], default: 'Beginner' },
    install_type: { type: String, default: '' },
    estimated_time_saving: { type: String, default: '' },
    author: { type: String, default: '' },
    install_command: { type: String, default: '' },
    source_repo_url: { type: String, default: '' },
    works_with: [{ type: String }],
    tags: [{ type: String }],
    sections: {
        overview: { type: String, default: '' },
        overview_vi: { type: String, default: '' },
        setup: { type: String, default: '' },
        setup_vi: { type: String, default: '' },
        usage: { type: String, default: '' },
        usage_vi: { type: String, default: '' },
        requirements: [{ type: String }],
        related_skills: [{ type: String }]
    }
}, {
    timestamps: true
});

// Text index for search — create manually in MongoDB shell:
// db.skills.createIndex({ name: 'text', headline: 'text', short_description: 'text', tags: 'text', author: 'text' })

export default mongoose.model('Skill', skillSchema);
