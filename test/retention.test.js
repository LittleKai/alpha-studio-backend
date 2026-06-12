import test from 'node:test';
import assert from 'node:assert/strict';
import {
    RETENTION_MS,
    terminalPurgeAt,
    compactTerminalAgentState
} from '../server/retention/policy.js';
import WebhookLog from '../server/models/WebhookLog.js';
import ChatMessage from '../server/models/ChatMessage.js';
import CrmAuditLog from '../server/models/CrmAuditLog.js';
import CrmExecutionLog from '../server/models/CrmExecutionLog.js';
import CrmMessage from '../server/models/CrmMessage.js';
import CrmGroupMessage from '../server/models/CrmGroupMessage.js';
import CrmAgentCommand from '../server/models/CrmAgentCommand.js';
import CloudSession from '../server/models/CloudSession.js';

function findIndex(model, key) {
    return model.schema.indexes().find(([fields]) => (
        JSON.stringify(fields) === JSON.stringify(key)
    ));
}

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

test('history and diagnostic models declare approved TTL indexes', () => {
    assert.equal(
        findIndex(WebhookLog, { createdAt: 1 })?.[1]?.expireAfterSeconds,
        RETENTION_MS.webhook / 1000
    );
    for (const model of [
        ChatMessage,
        CrmAuditLog,
        CrmExecutionLog,
        CrmMessage,
        CrmGroupMessage
    ]) {
        assert.equal(
            findIndex(model, { createdAt: 1 })?.[1]?.expireAfterSeconds,
            RETENTION_MS.crmHistory / 1000,
            `${model.modelName} should retain history for one year`
        );
    }
});

test('active commands and sessions use nullable purgeAt TTL indexes', () => {
    assert.equal(
        findIndex(CrmAgentCommand, { purgeAt: 1 })?.[1]?.expireAfterSeconds,
        0
    );
    assert.equal(
        findIndex(CloudSession, { purgeAt: 1 })?.[1]?.expireAfterSeconds,
        0
    );
    assert.equal(findIndex(CrmAgentCommand, { expiresAt: 1 }), undefined);
});
