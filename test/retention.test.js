import test from 'node:test';
import assert from 'node:assert/strict';
import {
    RETENTION_MS,
    terminalPurgeAt,
    compactTerminalAgentState
} from '../server/retention/policy.js';

test('calculates queue purge seven days after terminal time', () => {
    const finishedAt = new Date('2026-06-12T00:00:00.000Z');
    assert.equal(
        terminalPurgeAt('queue', finishedAt).toISOString(),
        '2026-06-19T00:00:00.000Z'
    );
});

test('removes resumable payload from terminal agent logs', () => {
    assert.deepEqual(compactTerminalAgentState({
        status: 'committed',
        messages: [{ role: 'user', content: 'large' }],
        draftModel: { modules: [] }
    }), {
        status: 'committed',
        messages: [],
        draftModel: null
    });
});

test('preserves resumable payload for paused agent logs', () => {
    const update = {
        status: 'paused',
        messages: [{ role: 'user', content: 'resume' }],
        draftModel: { modules: [] }
    };
    assert.deepEqual(compactTerminalAgentState(update), update);
});

test('retention constants match approved policy', () => {
    assert.equal(RETENTION_MS.technicalLog, 30 * 24 * 60 * 60 * 1000);
    assert.equal(RETENTION_MS.webhook, 90 * 24 * 60 * 60 * 1000);
    assert.equal(RETENTION_MS.crmHistory, 365 * 24 * 60 * 60 * 1000);
});
