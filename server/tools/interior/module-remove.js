import { findModule, invalid, ok } from './common.js';

export default {
    name: 'module.remove',
    description: 'Remove a module by id.',
    validateArgs: (args) => (typeof args.moduleId === 'string' ? ok() : invalid('moduleId is required.')),
    handler: async (args, ctx) => {
        const found = findModule(ctx, args.moduleId);
        if (!found) return { ok: false, error: `Module ${args.moduleId} not found.` };
        found.run.modules.splice(found.index, 1);
        return { ok: true, data: { removed: true } };
    }
};
