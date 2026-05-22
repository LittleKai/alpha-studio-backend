import { applyTemplateDimensionDefaults, cleanPatch, findModule, invalid, isObject, ok } from './common.js';

export default {
    name: 'module.update',
    description: 'Patch an existing module.',
    validateArgs: (args) => (typeof args.moduleId === 'string' && isObject(args.patch) ? ok() : invalid('moduleId and patch object are required.')),
    handler: async (args, ctx) => {
        const found = findModule(ctx, args.moduleId);
        if (!found) return { ok: false, error: `Module ${args.moduleId} not found.` };
        Object.assign(found.module, cleanPatch(args.patch));
        applyTemplateDimensionDefaults(found.module);
        return { ok: true, data: { module: found.module } };
    }
};
