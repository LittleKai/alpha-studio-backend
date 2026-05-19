import { DIRECTIONS, ensureDraft, invalid, isObject, makeId, ok } from './common.js';

export default {
    name: 'run.add',
    description: 'Add a run for multi-wall layouts.',
    validateArgs: (args) => (
        isObject(args.origin) && Number.isFinite(args.origin.x) && Number.isFinite(args.origin.z) && DIRECTIONS.has(args.direction)
            ? ok()
            : invalid('origin.x, origin.z, and direction are required.')
    ),
    handler: async (args, ctx) => {
        ensureDraft(ctx.draftModel);
        const runId = args.id || makeId('run');
        if (ctx.draftModel.runs.some((run) => run.id === runId)) return { ok: false, error: `runId ${runId} already exists.` };
        ctx.draftModel.runs.push({ id: runId, origin: args.origin, direction: args.direction, modules: [] });
        return { ok: true, data: { runId } };
    }
};
