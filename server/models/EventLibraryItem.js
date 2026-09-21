import mongoose from 'mongoose';
import { noInlineMediaPlugin } from '../validation/inlineMedia.js';
import sectionSchema, { SECTION_KINDS } from './contentSection.js';

/**
 * Thư viện tri thức & case study cho ngành sự kiện – truyền thông.
 *
 * Một collection duy nhất chứa cả 7 loại nội dung (`itemType`) và cả hai nguồn
 * (`ownership`):
 *   - `platform` — dữ liệu crawl/biên tập của web, admin quản lý, luôn công khai.
 *   - `user`     — do người dùng tự tạo hoặc "đăng" từ Workflow, có `owner` và
 *                  `visibility` riêng cho từng tài khoản.
 */

export const ITEM_TYPES = [
    'case_study', 'prompt', 'workflow', 'skill', 'template', 'report', 'playbook'
];

export const CATEGORIES = [
    'event', 'activation', 'roadshow', 'booth_exhibition',
    'stage_production', 'digital_event', 'other'
];

export const OBJECTIVES = [
    'product_launch', 'brand_awareness', 'sales_activation',
    'customer_loyalty', 'internal_corporate'
];

export const KPIS = [
    'brand_recall', 'attendance_reach', 'engagement',
    'leads_database', 'sales_conversion'
];

export const BUDGET_TIERS = [
    'under_50m', '50m_200m', '200m_500m', '500m_2b', 'over_2b'
];

export const VERIFICATIONS = ['verified', 'partner_sourced', 'unverified'];

export const DEPTHS = ['basic', 'deep', 'benchmark', 'forecast'];

/**
 * Cấp quyền đọc nội dung chi tiết:
 *   - `public` — ai thấy mục là đọc được toàn bộ.
 *   - `pro`    — chỉ tài khoản đã từng tích luỹ đủ credit mới mở được thân bài
 *                và tệp đính kèm; người khác vẫn thấy card, tiêu đề, tóm tắt.
 */
export const ACCESS_LEVELS = ['public', 'pro'];

/**
 * Ngưỡng credit TÍCH LUỸ (không phải số dư hiện tại) để mở mục `pro`.
 * Tính cả credit nạp tiền lẫn credit admin cấp tay — xem `lifetimeCreditsOf`
 * trong `routes/eventLibrary.js`.
 */
export const PRO_MIN_LIFETIME_CREDITS = 200;

const localizedString = () => ({
    vi: { type: String, default: '' },
    en: { type: String, default: '' }
});

const metricSchema = new mongoose.Schema({
    // Nhãn hiển thị dưới con số trên card, ví dụ "Reach" / "Impressions"
    label: { type: String, default: '' },
    // Giá trị đã format sẵn để hiển thị, ví dụ "31.7K" — không tính toán lại
    value: { type: String, default: '' }
}, { _id: false });

const attachmentSchema = new mongoose.Schema({
    name: { type: String, default: '' },
    url: { type: String, default: '' },
    // Key B2 — dùng cho orphan checker trong routes/admin.js
    fileKey: { type: String, default: '' },
    size: { type: String, default: '' },
    mime: { type: String, default: '' }
}, { _id: false });

// Khối thân bài dùng chung với Article — xem `./contentSection.js`
export { SECTION_KINDS };


const eventLibraryItemSchema = new mongoose.Schema({
    slug: { type: String, required: true, unique: true, index: true },
    itemType: { type: String, enum: ITEM_TYPES, required: true, index: true },

    ownership: { type: String, enum: ['platform', 'user'], default: 'user', index: true },
    visibility: { type: String, enum: ['public', 'private'], default: 'private', index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    title: localizedString(),
    summary: localizedString(),
    // Nội dung HTML từ TinyMCE — render kèm class `.tinymce-content` ở frontend
    content: localizedString(),

    coverImage: { type: String, default: '' },

    category: { type: String, enum: CATEGORIES, default: 'other', index: true },
    industries: [{ type: String }],
    objectives: [{ type: String, enum: OBJECTIVES }],
    kpis: [{ type: String, enum: KPIS }],
    budgetTier: { type: String, enum: [...BUDGET_TIERS, ''], default: '' },
    verification: { type: String, enum: VERIFICATIONS, default: 'unverified', index: true },
    depth: { type: String, enum: DEPTHS, default: 'basic' },

    // Chỉ admin đặt được — xem `ACCESS_LEVELS`
    accessLevel: { type: String, enum: ACCESS_LEVELS, default: 'public', index: true },

    tags: [{ type: String }],

    metrics: { type: [metricSchema], default: [] },
    attachments: { type: [attachmentSchema], default: [] },

    // Ảnh phụ dưới ảnh bìa (Cloudinary)
    gallery: [{ type: String }],

    // Thân bài có cấu trúc — xem `sectionSchema`
    sections: { type: [sectionSchema], default: [] },

    // Nguồn của bản ghi platform (crawl / biên tập tay)
    sourceUrl: { type: String, default: '' },
    sourceName: { type: String, default: '' },

    // Tên tác giả hiển thị — với item `user` là tên chủ tài khoản lúc đăng
    authorName: { type: String, default: '' },

    // Bản ghi được sinh ra từ đâu, để tránh đăng trùng cùng một nguồn
    origin: {
        kind: {
            type: String,
            enum: ['manual', 'crawl', 'workflow_project', 'workflow_document'],
            default: 'manual'
        },
        refId: { type: mongoose.Schema.Types.ObjectId, default: null }
    },

    stats: {
        views: { type: Number, default: 0 },
        uses: { type: Number, default: 0 }
    },

    // ─── Tương tác của người đọc ───────────────────────────────────────────
    // `likes` giữ danh sách user để biết người đang xem đã thích chưa;
    // `likesCount` là bản đếm sẵn để danh sách không phải tính lại.
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    likesCount: { type: Number, default: 0 },

    ratings: {
        type: [new mongoose.Schema({
            user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
            score: { type: Number, min: 1, max: 5, required: true },
            // Nhận xét đi kèm chính phiếu chấm — thư viện không có khối bình luận riêng
            comment: { type: String, default: '' }
        }, { _id: false, timestamps: true })],
        default: []
    },
    rating: {
        average: { type: Number, default: 0 },
        count: { type: Number, default: 0 }
    }
}, {
    timestamps: true
});

eventLibraryItemSchema.plugin(noInlineMediaPlugin);

// Lọc danh sách luôn đi qua bộ ba này
eventLibraryItemSchema.index({ ownership: 1, visibility: 1, itemType: 1 });
// "Nội dung của tôi" trong thư viện
eventLibraryItemSchema.index({ owner: 1, createdAt: -1 });
// Chặn đăng trùng cùng một project/document
eventLibraryItemSchema.index({ 'origin.kind': 1, 'origin.refId': 1 });

// Text index để tìm kiếm — tạo tay trong MongoDB shell:
// db.eventlibraryitems.createIndex({ 'title.vi': 'text', 'title.en': 'text', 'summary.vi': 'text', 'summary.en': 'text', tags: 'text' })

export default mongoose.model('EventLibraryItem', eventLibraryItemSchema);
