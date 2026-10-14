import mongoose from 'mongoose';

/**
 * Khối thân bài dùng chung cho `EventLibraryItem` và `Article` (bài dịch vụ).
 *
 * Thân bài là một danh sách khối, không phải một khối HTML duy nhất — nội dung
 * ngành sự kiện (case study, playbook) vốn có cấu trúc: bảng mục tiêu, dải KPI,
 * hành trình trải nghiệm, bài học rút ra…
 *
 * Mỗi khối chỉ dùng những field thuộc `kind` của nó; các field còn lại để rỗng.
 * Gộp vào một schema thay vì tách 8 sub-schema để mảng `sections` giữ được thứ
 * tự người đăng sắp xếp.
 *
 * Schema chứa đủ 8 `kind`; nơi dùng tự giới hạn tập kind cho phép khi làm sạch
 * payload — xem `sanitizeSections(sections, allowedKinds)`.
 *
 * Nội dung cũ vẫn lưu ở các field không hậu tố (tiếng Việt). Các field hậu tố
 * `En` là bản tiếng Anh tùy chọn, giữ tương thích với dữ liệu thư viện cũ.
 */
export const SECTION_KINDS = [
    'richText', 'keyValue', 'metrics', 'bulletGroups', 'steps', 'quote', 'gallery', 'linkedItems'
];

export const sectionSchema = new mongoose.Schema({
    kind: { type: String, enum: SECTION_KINDS, required: true },
    title: { type: String, default: '' },
    titleEn: { type: String, default: '' },

    // kind: richText — HTML từ TinyMCE, render kèm class `.tinymce-content`
    html: { type: String, default: '' },
    htmlEn: { type: String, default: '' },

    // kind: keyValue — bảng 2 cột (Mục tiêu → Chỉ số, Breakdown sản xuất…)
    rows: {
        type: [new mongoose.Schema({
            label: { type: String, default: '' },
            value: { type: String, default: '' }
        }, { _id: false })],
        default: []
    },
    rowsEn: {
        type: [new mongoose.Schema({
            label: { type: String, default: '' },
            value: { type: String, default: '' }
        }, { _id: false })],
        default: []
    },

    // kind: metrics — dải số liệu trong thân bài (khác `metrics` cấp mục, vốn
    // là dải hiển thị trên card)
    metrics: {
        type: [new mongoose.Schema({
            label: { type: String, default: '' },
            value: { type: String, default: '' },
            note: { type: String, default: '' }
        }, { _id: false })],
        default: []
    },
    metricsEn: {
        type: [new mongoose.Schema({
            label: { type: String, default: '' },
            value: { type: String, default: '' },
            note: { type: String, default: '' }
        }, { _id: false })],
        default: []
    },

    // kind: bulletGroups — nhiều cột bullet có tiêu đề (Điểm mạnh / Thách thức / Khuyến nghị)
    groups: {
        type: [new mongoose.Schema({
            title: { type: String, default: '' },
            items: [{ type: String }]
        }, { _id: false })],
        default: []
    },
    groupsEn: {
        type: [new mongoose.Schema({
            title: { type: String, default: '' },
            items: [{ type: String }]
        }, { _id: false })],
        default: []
    },

    // kind: steps — danh sách đánh số (Experience Journey, workflow nhiều bước)
    steps: {
        type: [new mongoose.Schema({
            title: { type: String, default: '' },
            desc: { type: String, default: '' }
        }, { _id: false })],
        default: []
    },
    stepsEn: {
        type: [new mongoose.Schema({
            title: { type: String, default: '' },
            desc: { type: String, default: '' }
        }, { _id: false })],
        default: []
    },

    // kind: quote — insight cốt lõi
    quote: { type: String, default: '' },
    quoteBy: { type: String, default: '' },
    quoteEn: { type: String, default: '' },
    quoteByEn: { type: String, default: '' },

    // kind: gallery — URL ảnh (Cloudinary)
    images: [{ type: String }],

    // kind: linkedItems — trỏ sang mục khác trong thư viện theo slug
    links: {
        type: [new mongoose.Schema({
            slug: { type: String, default: '' },
            label: { type: String, default: '' }
        }, { _id: false })],
        default: []
    },
    linksEn: {
        type: [new mongoose.Schema({
            slug: { type: String, default: '' },
            label: { type: String, default: '' }
        }, { _id: false })],
        default: []
    }
}, { _id: false });

export default sectionSchema;
