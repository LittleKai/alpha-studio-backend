import { invalid, ok } from './common.js';

export default {
    name: 'model.abort',
    description: 'Discard the draft and end the loop without saving.',
    terminal: true,
    validateArgs: (args) => (typeof args.reason === 'string' && args.reason.trim() ? ok() : invalid('reason is required.')),
    handler: async (args) => ({ ok: true, data: { aborted: true, reason: args.reason } })
};
