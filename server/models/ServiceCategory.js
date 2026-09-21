import mongoose from 'mongoose';
import { noInlineMediaPlugin } from '../validation/inlineMedia.js';
import { generateUniqueSlugForModel } from '../utils/slugify.js';

/**
 * Phân mục của trang `/services` (thiết kế sự kiện, ảnh → 3D SketchUp, nội thất
 * tự động, AutoCAD, workflow automation…).
 *
 * Admin/mod tự tạo trong route admin thay vì hard-code hằng số, để thêm dịch vụ
 * mới không phải deploy lại frontend. Bài viết trỏ vào đây qua
 * `Article.serviceCategory`.
 */

/** Tên palette dùng lại của `SECTION_PALETTES` bên frontend. */
export const ACCENTS = ['violet', 'sky', 'emerald', 'amber', 'rose'];

const serviceCategorySchema = new mongoose.Schema({
    title: {
        vi: { type: String, required: [true, 'Cần tên tiếng Việt'] },
        en: { type: String, default: '' }
    },
    slug: { type: String, unique: true, index: true },
    description: {
        vi: { type: String, default: '' },
        en: { type: String, default: '' }
    },
    coverImage: { type: String, default: '' },
    // Emoji hoặc ký tự ngắn hiển thị trên tile landing khi chưa có ảnh bìa
    icon: { type: String, default: '', maxlength: 8 },
    accent: { type: String, enum: ACCENTS, default: 'violet' },
    order: { type: Number, default: 0 },
    status: { type: String, enum: ['published', 'hidden'], default: 'published', index: true }
}, { timestamps: true });

serviceCategorySchema.plugin(noInlineMediaPlugin);

// Slug đọc được (dùng làm `?cat=` trên URL) — chỉ sinh lại khi tên vi đổi.
serviceCategorySchema.pre('save', async function (next) {
    if (this.isModified('title.vi') || !this.slug) {
        this.slug = await generateUniqueSlugForModel(this.title.vi, this.constructor, this._id);
    }
    next();
});

serviceCategorySchema.index({ status: 1, order: 1 });

const ServiceCategory = mongoose.model('ServiceCategory', serviceCategorySchema);
export default ServiceCategory;
