import { findRun, invalid, isObject, isPositiveNumber, makeId, ok } from './common.js';

function validateDimsForRaw(args) {
    return isPositiveNumber(args.width) && isPositiveNumber(args.height) && isPositiveNumber(args.depth);
}

export default {
    name: 'module.add',
    description: 'Add a module to an existing run using tpl, tplInline, or raw box fields.',
    validateArgs: (args) => {
        if (typeof args.runId !== 'string') return invalid('runId is required.');
        const tplCount = [args.tpl, args.tplInline].filter(Boolean).length;
        if (tplCount > 1) return invalid('Use only one of tpl or tplInline.');
        for (const key of ['x', 'y', 'z']) if (!Number.isFinite(args[key])) return invalid(`${key} must be a number.`);
        if (tplCount === 0 && !validateDimsForRaw(args)) return invalid('Raw modules require positive width, height, and depth.');
        if (args.style !== undefined && !isObject(args.style)) return invalid('style must be an object.');
        return ok();
    },
    handler: async (args, ctx) => {
        const run = findRun(ctx, args.runId);
        if (!run) return { ok: false, error: `Run ${args.runId} not found.` };
        const moduleId = makeId('mod');
        const module = {
            id: moduleId,
            x: args.x,
            y: args.y,
            z: args.z,
            ...(args.width !== undefined ? { width: args.width } : {}),
            ...(args.height !== undefined ? { height: args.height } : {}),
            ...(args.depth !== undefined ? { depth: args.depth } : {}),
            ...(args.tpl ? { tpl: args.tpl } : {}),
            ...(args.tplInline ? { tpl: args.tplInline } : {}),
            ...(args.style ? { style: args.style } : {}),
            ...(args.label ? { label: args.label } : {}),
            ...(args.kind ? { kind: args.kind } : {}),
            ...(args.materialRef ? { materialRef: args.materialRef } : {}),
            ...(args.color ? { color: args.color } : {})
        };
        run.modules.push(module);
        return { ok: true, data: { moduleId, module } };
    }
};
