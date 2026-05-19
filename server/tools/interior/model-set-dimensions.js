import { invalid, isPositiveNumber, ok } from './common.js';

export default {
    name: 'model.setDimensions',
    description: 'Set top-level width, height, and depth in centimeters.',
    validateArgs: (args) => (
        isPositiveNumber(args.width) && isPositiveNumber(args.height) && isPositiveNumber(args.depth)
            ? ok()
            : invalid('width, height, and depth must be positive numbers.')
    ),
    handler: async (args, ctx) => {
        ctx.draftModel.width = args.width;
        ctx.draftModel.height = args.height;
        ctx.draftModel.depth = args.depth;
        if (args.units) ctx.draftModel.units = args.units;
        return { ok: true, data: { cabinetModel: ctx.draftModel } };
    }
};
