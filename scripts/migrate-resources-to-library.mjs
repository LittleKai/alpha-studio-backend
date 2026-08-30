/**
 * Chuyển bản ghi `Resource` (Kho tài nguyên cũ trong /workflow) sang
 * `EventLibraryItem` — bước dọn đường để gỡ hẳn feature Kho tài nguyên.
 *
 *   node scripts/migrate-resources-to-library.mjs            # dry-run
 *   node scripts/migrate-resources-to-library.mjs --apply    # ghi thật
 *
 * Idempotent: mục đã chuyển được nhận ra qua `origin.refId` = _id của Resource,
 * chạy lại sẽ bỏ qua chứ không tạo bản sao.
 *
 * File trên B2/Cloudinary KHÔNG bị đụng tới — bản ghi mới trỏ vào đúng URL/key
 * cũ, nên orphan checker vẫn coi chúng là đang được tham chiếu.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Resource from '../server/models/Resource.js';
// Import bắt buộc: Resource.author ref 'User', populate cần model đã đăng ký
import '../server/models/User.js';
import EventLibraryItem from '../server/models/EventLibraryItem.js';
import { slugifyTitle } from '../server/routes/eventLibrary.js';

const APPLY = process.argv.includes('--apply');

// `resourceType` cũ không map 1-1 sang `itemType` — tất cả đều là tài sản tải
// về, nên vào `template`, và giữ loại gốc lại trong `tags` để không mất thông tin.
const TYPE_TO_ITEM_TYPE = {
    template: 'template',
    dataset: 'report',
    'design-asset': 'template',
    'project-file': 'template',
    '3d-model': 'template',
    font: 'template',
    other: 'template'
};

function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
}

function toLibraryItem(resource, authorName) {
    const titleVi = resource.title?.vi || resource.title?.en || 'Tài nguyên';
    const tags = [
        ...(resource.tags || []),
        ...(resource.compatibleSoftware || []),
        resource.resourceType
    ].filter(Boolean);

    return {
        slug: slugifyTitle(titleVi),
        itemType: TYPE_TO_ITEM_TYPE[resource.resourceType] || 'template',
        ownership: 'user',
        visibility: resource.status === 'published' ? 'public' : 'private',
        owner: resource.author?._id || resource.author || null,
        title: { vi: titleVi, en: resource.title?.en || titleVi },
        summary: {
            vi: resource.description?.vi || resource.description?.en || '',
            en: resource.description?.en || resource.description?.vi || ''
        },
        content: { vi: '', en: '' },
        coverImage: resource.thumbnail?.url || '',
        gallery: (resource.previewImages || []).map(img => img.url).filter(Boolean),
        category: 'other',
        verification: 'unverified',
        depth: 'basic',
        tags,
        metrics: resource.file?.size ? [{ label: 'fileSize', value: formatSize(resource.file.size) }] : [],
        attachments: resource.file?.url ? [{
            name: resource.file.filename || titleVi,
            url: resource.file.url,
            fileKey: resource.file.publicId || '',
            size: formatSize(resource.file.size),
            mime: resource.file.mimeType || resource.file.format || ''
        }] : [],
        sections: [],
        authorName: authorName || '',
        origin: { kind: 'manual', refId: resource._id },
        stats: { views: resource.viewsCount || 0, uses: resource.downloadsCount || 0 }
    };
}

await mongoose.connect(process.env.MONGODB_URI);

const resources = await Resource.find({}).populate('author', 'name').lean();
console.log(`Tìm thấy ${resources.length} Resource.`);

let created = 0;
let skipped = 0;

for (const resource of resources) {
    const existing = await EventLibraryItem.findOne({ 'origin.refId': resource._id }).lean();
    if (existing) {
        console.log(`  bỏ qua (đã chuyển): ${resource.slug} → ${existing.slug}`);
        skipped++;
        continue;
    }

    const payload = toLibraryItem(resource, resource.author?.name);
    console.log(`  ${APPLY ? 'tạo' : 'sẽ tạo'}: ${resource.slug} → ${payload.slug} (${payload.itemType}, ${payload.visibility}, ${payload.attachments.length} file)`);
    if (APPLY) {
        await EventLibraryItem.create(payload);
        created++;
    }
}

console.log(APPLY
    ? `Xong: tạo ${created}, bỏ qua ${skipped}.`
    : `Dry-run: ${resources.length - skipped} mục sẽ được tạo, ${skipped} bỏ qua. Chạy lại với --apply để ghi.`);

await mongoose.disconnect();
