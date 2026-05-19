import { extractDsl, validateTemplateStructure } from '../../utils/templateValidator.js';
import { invalid, isObject, ok } from './common.js';

export default {
    name: 'template.create',
    description: 'Create an inline template after backend DSL validation.',
    validateArgs: (args) => (isObject(args) && typeof args.id === 'string' ? ok() : invalid('template id is required.')),
    handler: async (args, ctx) => {
        const check = validateTemplateStructure(args);
        if (!check.valid) return { ok: false, error: check.message };
        ctx.draftModel.inlineTemplates = isObject(ctx.draftModel.inlineTemplates) ? ctx.draftModel.inlineTemplates : {};
        ctx.draftModel.inlineTemplates[args.id] = {
            id: args.id,
            version: args.version || 1,
            category: args.category,
            tags: Array.isArray(args.tags) ? args.tags : [],
            description: args.description || { vi: args.id, en: args.id },
            params: args.params || {},
            style: args.style || args.styleOptions || {},
            ...extractDsl(args)
        };
        return { ok: true, data: { id: args.id, validationWarnings: [] } };
    }
};
