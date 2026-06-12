import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildEndedSessionUpdate,
    buildTerminalAgentUpdate,
    buildTerminalCommandUpdate
} from '../server/retention/terminalUpdates.js';

test('builds terminal command update with seven-day purge', () => {
    const finishedAt = new Date('2026-06-12T00:00:00.000Z');
    assert.deepEqual(buildTerminalCommandUpdate('succeeded', finishedAt), {
        status: 'succeeded',
        finishedAt,
        purgeAt: new Date('2026-06-19T00:00:00.000Z')
    });
});

test('builds ended cloud session update with one-year purge', () => {
    const endedAt = new Date('2026-06-12T00:00:00.000Z');
    assert.deepEqual(buildEndedSessionUpdate('user_disconnect', endedAt), {
        status: 'ended',
        endedAt,
        endReason: 'user_disconnect',
        purgeAt: new Date('2027-06-12T00:00:00.000Z')
    });
});

test('compacts only terminal interior agent state', () => {
    assert.deepEqual(buildTerminalAgentUpdate({
        status: 'error',
        messages: [{ role: 'user', content: 'large' }],
        draftModel: { modules: [] }
    }), {
        status: 'error',
        messages: [],
        draftModel: null
    });

    const paused = {
        status: 'paused',
        messages: [{ role: 'user', content: 'resume' }],
        draftModel: { modules: [] }
    };
    assert.deepEqual(buildTerminalAgentUpdate(paused), paused);
});
