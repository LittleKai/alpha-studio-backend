import mongoose from 'mongoose';
import { noInlineMediaPlugin } from '../validation/inlineMedia.js';
import sectionSchema from './contentSection.js';

const articleSchema = new mongoose.Schema({
    title: {
        vi: { type: String, required: [true, 'Cần tiêu đề tiếng Việt'] },
        en: { type: String, default: '' }
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
        enum: ['about', 'services', 'news'],
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
    tags: [{ type: String }],

    // Chỉ dùng cho category 'services' — phân mục hiển thị trên /services
    serviceCategory: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ServiceCategory',
        default: null
    },

    // Thân bài có cấu trúc (bài dịch vụ). Route chỉ nhận 4 kind giới thiệu —
    // xem SERVICE_SECTION_KINDS trong utils/contentSections.js
    sections: { type: [sectionSchema], default: [] },

    // Tổng số lượt tải file đính kèm — tăng mỗi khi người dùng bấm tải file
    downloadCount: {
        type: Number,
        default: 0,
        min: 0,
    },

    // Tệp tham khảo tải về (.skp, .html, .pdf…). Ảnh KHÔNG nằm ở đây — ảnh đi
    // Cloudinary trong khối `gallery`. Cùng hình dạng với
    // `EventLibraryItem.attachments` để orphan checker trong routes/admin.js
    // đọc được `fileKey`.
    attachments: {
        type: [new mongoose.Schema({
            name: { type: String, default: '' },
            url: { type: String, default: '' },
            fileKey: { type: String, default: '' },
            size: { type: String, default: '' },
            mime: { type: String, default: '' }
        }, { _id: false })],
        default: []
    }
}, {
    timestamps: true
});

articleSchema.plugin(noInlineMediaPlugin);

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
articleSchema.index({ serviceCategory: 1, status: 1, order: 1 });
articleSchema.index({
    'title.vi': 'text',
    'title.en': 'text',
    'content.vi': 'text',
    'content.en': 'text',
    tags: 'text'
});

const Article = mongoose.model('Article', articleSchema);
export default Article;
