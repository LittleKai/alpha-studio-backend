import InteriorTemplate from '../../models/InteriorTemplate.js';
import { invalid, ok } from './common.js';

function words(text) {
    return new Set(String(text || '').toLowerCase().split(/[^a-z0-9áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ-]+/i).filter(Boolean));
}

export default {
    name: 'template.suggest',
    description: 'Rank catalog templates by simple tag and text overlap with a description.',
    validateArgs: (args) => (typeof args.description === 'string' && args.description.trim() ? ok() : invalid('description is required.')),
    handler: async (args) => {
        const wanted = words(args.description);
        const rows = await InteriorTemplate.find({ status: { $in: ['seed', 'approved'] } }).lean();
        const ranked = rows.map((row) => {
            const hayWords = words(`${row.templateId} ${row.category} ${(row.tags || []).join(' ')} ${row.description?.vi || ''} ${row.description?.en || ''}`);
            let score = 0;
            for (const word of wanted) if (hayWords.has(word)) score += 1;
            return { id: row.templateId, score, why: score ? 'Matched tags/category/description words.' : 'Fallback catalog candidate.' };
        }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, Math.min(Math.max(args.count || 5, 1), 10));
        return { ok: true, data: { ranked } };
    }
};
