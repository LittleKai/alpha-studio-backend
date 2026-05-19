import { ensureDraft, moduleStats, ok } from './common.js';

export default {
    name: 'model.preview',
    description: 'Inspect current draft cabinet model and counts.',
    validateArgs: () => ok(),
    handler: async (args, ctx) => {
        ensureDraft(ctx.draftModel);
        return { ok: true, data: { cabinetModel: ctx.draftModel, stats: moduleStats(ctx.draftModel) } };
    }
};
