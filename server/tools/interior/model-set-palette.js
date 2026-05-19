import { invalid, ok, PALETTES } from './common.js';

export default {
    name: 'model.setPalette',
    description: 'Switch cabinet color palette.',
    validateArgs: (args) => (PALETTES.has(args.palette) ? ok() : invalid(`palette must be one of ${[...PALETTES].join(', ')}`)),
    handler: async (args, ctx) => {
        ctx.draftModel.palette = args.palette;
        return { ok: true, data: { palette: args.palette } };
    }
};
