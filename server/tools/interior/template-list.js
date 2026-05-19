import InteriorTemplate from '../../models/InteriorTemplate.js';
import { ok } from './common.js';

function serialize(row) {
    return {
        id: row.templateId,
        version: row.version,
        category: row.category,
        tags: row.tags || [],
        description: row.description || row.name || { vi: row.templateId, en: row.templateId },
        paramsBounds: row.params || {}
    };
}

export default {
    name: 'template.list',
    description: 'List seed and approved catalog templates, optionally filtered by category or search.',
    validateArgs: () => ok(),
    handler: async (args) => {
        const query = { status: { $in: ['seed', 'approved'] } };
        if (args.category) query.category = args.category;
        const rows = await InteriorTemplate.find(query).sort({ templateId: 1, version: -1 }).lean();
        const search = typeof args.search === 'string' ? args.search.toLowerCase().trim() : '';
        const seen = new Set();
        const templates = [];
        for (const row of rows) {
            if (seen.has(row.templateId)) continue;
            const hay = `${row.templateId} ${row.category} ${(row.tags || []).join(' ')} ${row.description?.vi || ''} ${row.description?.en || ''}`.toLowerCase();
            if (search && !hay.includes(search)) continue;
            seen.add(row.templateId);
            templates.push(serialize(row));
        }
        return { ok: true, data: { templates } };
    }
};
