import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CRM_SSE_HELLO_DEVICE_SELECT,
    buildDeviceStatusEventPayload,
    normalizeSupervisorStats
} from '../server/routes/crm.js';

test('normalizeSupervisorStats accepts a well-formed payload', () => {
    const out = normalizeSupervisorStats({
        restartCount: 3,
        lastExitCode: 1,
        lastError: 'Tiến trình backend thoát bất ngờ với mã 1.',
        reportedAt: '2026-09-05T10:00:00.000Z'
    });

    assert.equal(out.restartCount, 3);
    assert.equal(out.lastExitCode, 1);
    assert.equal(out.lastError, 'Tiến trình backend thoát bất ngờ với mã 1.');
    assert.equal(out.reportedAt.toISOString(), '2026-09-05T10:00:00.000Z');
});

test('normalizeSupervisorStats returns null for unusable payloads so the route keeps the old value', () => {
    assert.equal(normalizeSupervisorStats(null), null);
    assert.equal(normalizeSupervisorStats(undefined), null);
    assert.equal(normalizeSupervisorStats('nope'), null);
    assert.equal(normalizeSupervisorStats({}), null);
    assert.equal(normalizeSupervisorStats({ restartCount: -1 }), null);
    assert.equal(normalizeSupervisorStats({ restartCount: 'nhiều' }), null);
});

test('normalizeSupervisorStats keeps lastExitCode null when the process never exited', () => {
    const out = normalizeSupervisorStats({ restartCount: 0, lastExitCode: null });
    assert.equal(out.restartCount, 0);
    assert.equal(out.lastExitCode, null);
    assert.equal(out.lastError, '');
});

test('normalizeSupervisorStats caps lastError so heartbeats cannot bloat the device doc', () => {
    const out = normalizeSupervisorStats({ restartCount: 1, lastError: 'x'.repeat(5000) });
    assert.equal(out.lastError.length, 500);
});

test('normalizeSupervisorStats falls back to now for a bad reportedAt', () => {
    const before = Date.now();
    const out = normalizeSupervisorStats({ restartCount: 1, reportedAt: 'không phải ngày' });
    assert.ok(out.reportedAt.getTime() >= before);
});

test('CRM_SSE_HELLO_DEVICE_SELECT includes appVersion and agentVersion for mobile compatibility checks', () => {
    const fields = CRM_SSE_HELLO_DEVICE_SELECT.split(/\s+/);
    assert.ok(fields.includes('appVersion'));
    assert.ok(fields.includes('agentVersion'));
    assert.ok(fields.includes('agentStatus'));
});

test('buildDeviceStatusEventPayload forwards appVersion and agentVersion or null', () => {
    const now = new Date('2026-10-28T00:00:00.000Z');
    assert.deepEqual(
        buildDeviceStatusEventPayload({
            _id: 'dev-1',
            agentStatus: 'online',
            appVersion: '0.2.3',
            agentVersion: '0.2.0',
            zaloAccounts: [{ accountId: 'z1', status: 'online' }],
            queueDepth: 0,
            lastHeartbeatAt: now
        }),
        {
            deviceId: 'dev-1',
            agentStatus: 'online',
            appVersion: '0.2.3',
            agentVersion: '0.2.0',
            zaloAccounts: [{ accountId: 'z1', status: 'online' }],
            queueDepth: 0,
            lastHeartbeatAt: now
        }
    );

    assert.deepEqual(
        buildDeviceStatusEventPayload({
            _id: 'dev-2',
            agentStatus: 'offline',
            appVersion: '',
            agentVersion: undefined,
            zaloAccounts: [],
            queueDepth: 1,
            lastHeartbeatAt: now
        }),
        {
            deviceId: 'dev-2',
            agentStatus: 'offline',
            appVersion: null,
            agentVersion: null,
            zaloAccounts: [],
            queueDepth: 1,
            lastHeartbeatAt: now
        }
    );
});
