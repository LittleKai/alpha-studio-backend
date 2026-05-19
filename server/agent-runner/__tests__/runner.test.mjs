import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../tool-registry.js';
import { runAgentLoop } from '../runner.js';

test('runAgentLoop dispatches tools and exits on terminal tool', async () => {
    const registry = new ToolRegistry();
    const calls = [];
    registry.register({
        name: 'draft.add',
        description: 'Add value',
        validateArgs: (args) => ({ valid: Number.isFinite(args.value), errors: ['value must be number'] }),
        handler: async (args, ctx) => {
            ctx.values.push(args.value);
            return { ok: true, data: { values: ctx.values } };
        }
    });
    registry.register({
        name: 'model.commit',
        description: 'Commit model',
        terminal: true,
        validateArgs: () => ({ valid: true }),
        handler: async (args, ctx) => ({ ok: true, data: { reply: args.reply, values: ctx.values } })
    });

    const replies = [
        '{"thought":"add one","tool":"draft.add","args":{"value":1}}',
        '{"thought":"add two","tool":"draft.add","args":{"value":2}}',
        '{"thought":"finish","tool":"model.commit","args":{"reply":"done"}}'
    ];

    const result = await runAgentLoop({
        initialPrompt: 'build',
        systemPrompt: 'sys',
        registry,
        ctx: { values: [] },
        aiCall: async ({ messages }) => {
            calls.push(messages.map((m) => m.role).join(','));
            return { text: replies.shift(), usage: { totalTokens: 3 } };
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'committed');
    assert.deepEqual(result.data.values, [1, 2]);
    assert.equal(calls.length, 3);
    assert.ok(result.messages.some((msg) => msg.role === 'user' && msg.content.includes('"values"')));
});
