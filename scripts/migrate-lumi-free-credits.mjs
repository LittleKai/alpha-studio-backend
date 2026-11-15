/**
 * Nâng mức AI Credit miễn phí mặc định của LumiStage từ 3 lên LUMI_FREE_AI_CREDITS (50)
 * cho các tài khoản chưa từng dùng AI (lumiStage.freeAiCreditsRemaining === 3 hoặc chưa có trường này).
 *
 * Chạy khô mặc định, không ghi gì nếu thiếu --apply:
 *
 *   node scripts/migrate-lumi-free-credits.mjs
 *   node scripts/migrate-lumi-free-credits.mjs --apply
 */

import 'dotenv/config';
import mongoose from 'mongoose';

import User from '../server/models/User.js';
import { LUMI_FREE_AI_CREDITS } from '../server/utils/lumiCatalog.js';

const apply = process.argv.includes('--apply');

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('Thiếu MONGODB_URI trong .env');

    await mongoose.connect(uri);
    console.log(apply ? '── GHI THẬT ──' : '── CHẠY KHÔ (thêm --apply để ghi) ──');

    const filter = {
        $or: [
            { 'lumiStage.freeAiCreditsRemaining': 3 },
            { 'lumiStage.freeAiCreditsRemaining': { $exists: false } }
        ]
    };

    const count = await User.countDocuments(filter);
    const sample = await User.find(filter).select('email lumiStage.freeAiCreditsRemaining').limit(10).lean();

    console.log(`Tìm thấy ${count} tài khoản cần nâng freeAiCreditsRemaining → ${LUMI_FREE_AI_CREDITS}.`);
    for (const u of sample) {
        console.log(`  · ${u.email} (hiện tại: ${u.lumiStage?.freeAiCreditsRemaining ?? 'chưa có'})`);
    }

    if (apply && count > 0) {
        const res = await User.updateMany(filter, {
            $set: { 'lumiStage.freeAiCreditsRemaining': LUMI_FREE_AI_CREDITS }
        });
        console.log(`Đã cập nhật ${res.modifiedCount} tài khoản.`);
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
