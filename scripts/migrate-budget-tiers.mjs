/**
 * Chuyển `budgetTier` của EventLibraryItem sang thang mới, thấp hơn nhiều.
 *
 * Thang cũ bắt đầu từ "dưới 200 triệu" và kéo tới "trên 20 tỷ" — quá cao so với
 * quy mô thật của phần lớn nội dung trong thư viện, nên gần như mọi mục dồn vào
 * hai bậc đầu. Thang mới chia mịn ở khoảng dưới 2 tỷ.
 *
 * Giá trị cũ KHÔNG còn nằm trong enum của model, nên mục chưa migrate sẽ hiện
 * nhãn thô ngoài trang và không lưu lại được qua `PUT /api/event-library/:id`.
 *
 * Ánh xạ theo **điểm giữa** của bậc cũ — bậc cũ là một khoảng, không có giá trị
 * chính xác để quy đổi:
 *
 *   under_200m (0–200tr)   → 50m_200m    (giữa ≈ 100 triệu)
 *   200m_1b    (200tr–1tỷ) → 500m_2b     (giữa ≈ 600 triệu)
 *   1b_5b      (1–5 tỷ)    → over_2b     (giữa ≈ 3 tỷ)
 *   5b_20b     (5–20 tỷ)   → over_2b     (giữa ≈ 12,5 tỷ)
 *   over_20b               → over_2b
 *
 * Chạy khô mặc định, không ghi gì nếu thiếu --apply:
 *
 *   node scripts/migrate-budget-tiers.mjs
 *   node scripts/migrate-budget-tiers.mjs --apply
 */

import 'dotenv/config';
import mongoose from 'mongoose';

import EventLibraryItem, { BUDGET_TIERS } from '../server/models/EventLibraryItem.js';

const TIER_MAP = {
    under_200m: '50m_200m',
    '200m_1b': '500m_2b',
    '1b_5b': 'over_2b',
    '5b_20b': 'over_2b',
    over_20b: 'over_2b'
};

const apply = process.argv.includes('--apply');

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('Thiếu MONGODB_URI trong .env');

    await mongoose.connect(uri);
    console.log(apply ? '── GHI THẬT ──' : '── CHẠY KHÔ (thêm --apply để ghi) ──');

    let changed = 0;
    for (const [from, to] of Object.entries(TIER_MAP)) {
        if (!BUDGET_TIERS.includes(to)) throw new Error(`Bậc đích không hợp lệ: ${to}`);

        const docs = await EventLibraryItem
            .find({ budgetTier: from })
            .select('slug title budgetTier')
            .lean();
        if (docs.length === 0) continue;

        console.log(`\n${from} → ${to}  (${docs.length} mục)`);
        for (const doc of docs) console.log(`  · ${doc.slug}`);

        if (apply) {
            const res = await EventLibraryItem.updateMany({ budgetTier: from }, { $set: { budgetTier: to } });
            console.log(`  đã ghi ${res.modifiedCount}`);
        }
        changed += docs.length;
    }

    // Bậc lạ còn sót lại (không thuộc thang cũ lẫn thang mới) — phải xử lý tay
    const stray = await EventLibraryItem
        .find({ budgetTier: { $nin: [...BUDGET_TIERS, '', ...Object.keys(TIER_MAP)] } })
        .select('slug budgetTier')
        .lean();
    if (stray.length > 0) {
        console.log('\n⚠ Bậc không nhận ra, cần xem tay:');
        for (const doc of stray) console.log(`  · ${doc.slug} → ${doc.budgetTier}`);
    }

    console.log(`\nTổng: ${changed} mục thuộc thang cũ.`);
    await mongoose.disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
