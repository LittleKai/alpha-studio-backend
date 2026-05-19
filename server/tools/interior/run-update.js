import { DIRECTIONS, findRun, invalid, isObject, ok } from './common.js';

export default {
    name: 'run.update',
    description: 'Modify a run origin or direction.',
    validateArgs: (args) => (typeof args.runId === 'string' ? ok() : invalid('runId is required.')),
    handler: async (args, ctx) => {
        const run = findRun(ctx, args.runId);
        if (!run) return { ok: false, error: `Run ${args.runId} not found.` };
        if (args.origin !== undefined) {
            if (!isObject(args.origin) || !Number.isFinite(args.origin.x) || !Number.isFinite(args.origin.z)) return { ok: false, error: 'origin.x/z must be numbers.' };
            run.origin = args.origin;
        }
        if (args.direction !== undefined) {
            if (!DIRECTIONS.has(args.direction)) return { ok: false, error: 'Invalid direction.' };
            run.direction = args.direction;
        }
        return { ok: true, data: { run } };
    }
};
