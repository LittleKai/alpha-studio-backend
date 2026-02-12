import mongoose from 'mongoose';

const articleSchema = new mongoose.Schema({
    title: {
        vi: { type: String, required: [true, 'Cần tiêu đề tiếng Việt'] },
        en: { type: String, required: [true, 'English title is required'] }
    },
    slug: {
        type: String,
        unique: true
    },
    excerpt: {
        vi: { type: String, default: '' },
        en: { type: String, default: '' }
    },
    content: {
        vi: { type: String, default: '' },
        en: { type: String, default: '' }
    },
    thumbnail: {
        type: String,
        default: ''
    },
    category: {
        type: String,
        enum: ['about', 'services'],
        required: [true, 'Category is required']
    },
    status: {
        type: String,
        enum: ['draft', 'published', 'archived'],
        default: 'draft'
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    order: {
        type: Number,
        default: 0
    },
    isFeatured: {
        type: Boolean,
        default: false
    },
    tags: [{ type: String }]
}, {
    timestamps: true
});

// Auto-generate slug from Vietnamese title before save
articleSchema.pre('save', function (next) {
    if (this.isModified('title.vi') || !this.slug) {
        const base = this.title.vi
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
        this.slug = `${base}-${Date.now().toString(36)}`;
    }
    next();
});

// Indexes
articleSchema.index({ category: 1, status: 1, order: 1 });
articleSchema.index({ slug: 1 }, { unique: true });
articleSchema.index({
    'title.vi': 'text',
    'title.en': 'text',
    'content.vi': 'text',
    'content.en': 'text',
    tags: 'text'
});

const Article = mongoose.model('Article', articleSchema);
export default Article;
