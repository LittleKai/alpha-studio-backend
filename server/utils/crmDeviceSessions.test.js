import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
    buildActiveDeviceConflict,
    createAgentSecret,
    replaceActiveDevice
} from './crmDeviceSessions.js';

test('buildActiveDeviceConflict exposes only safe device metadata', () => {
    const lastSeenAt = new Date('2026-06-06T01:02:03.000Z');
    const conflict = buildActiveDeviceConflict({
        displayName: 'Office PC',
        lastSeenAt,
        agentSecretHash: 'secret-hash',
        machineFingerprintHash: 'fingerprint-hash',
        lastIp: '203.0.113.10',
        agentSecret: 'raw-secret'
    });

    assert.deepStrictEqual(conflict, {
        displayName: 'Office PC',
        lastSeenAt
    });
    assert.deepStrictEqual(Object.keys(conflict), ['displayName', 'lastSeenAt']);
});

test('createAgentSecret returns a random 32-byte hex secret and its SHA-256 hash', () => {
    const first = createAgentSecret();
    const second = createAgentSecret();

    assert.match(first.agentSecret, /^[a-f0-9]{64}$/);
    assert.match(first.agentSecretHash, /^[a-f0-9]{64}$/);
    assert.strictEqual(
        first.agentSecretHash,
        crypto.createHash('sha256').update(first.agentSecret).digest('hex')
    );
    assert.notStrictEqual(first.agentSecret, second.agentSecret);
});

const createTransactionHarness = ({ activeDevice = null, transactionError = null } = {}) => {
    const calls = [];
    const session = {
        async withTransaction(callback) {
            calls.push('withTransaction');
            if (transactionError) {
                throw transactionError;
            }
            return callback();
        },
        async endSession() {
            calls.push('endSession');
        }
    };
    const query = {
        sessionArg: null,
        session(value) {
            this.sessionArg = value;
            calls.push(['activeDevice.session', value]);
            return this;
        },
        async then(resolve) {
            calls.push('activeDevice.resolve');
            return resolve(activeDevice);
        }
    };
    const createdActiveDevice = { _id: 'new-device-id', displayName: 'New PC' };
    const historicalDevice = { _id: 'historical-device-id', status: 'replaced' };

    const mongooseClient = {
        async startSession() {
            calls.push('startSession');
            return session;
        }
    };
    const models = {
        CrmDevice: {
            findOne(filter) {
                calls.push(['activeDevice.findOne', filter]);
                return query;
            },
            async create(documents, options) {
                calls.push(['device.create', documents, options]);
                return documents[0].status === 'replaced'
                    ? [historicalDevice]
                    : [createdActiveDevice];
            }
        },
        CrmAuditLog: {
            async create(documents, options) {
                calls.push(['audit.create', documents, options]);
                return documents;
            }
        }
    };

    return {
        calls,
        createdActiveDevice,
        historicalDevice,
        models,
        mongooseClient,
        query,
        session
    };
};

test('replaceActiveDevice creates history then reuses the active record to remain unique-index safe', async () => {
    const oldRegisteredAt = new Date('2026-01-02T03:04:05.000Z');
    const oldLastSeenAt = new Date('2026-06-05T03:04:05.000Z');
    const activeDevice = {
        _id: 'active-device-id',
        userId: 'user-id',
        subscriptionId: 'subscription-id',
        machineFingerprintHash: 'old-fingerprint-hash',
        displayName: 'Old PC',
        platform: 'windows',
        appVersion: '1.0.0',
        agentVersion: '1.1.0',
        status: 'active',
        agentSecretHash: 'old-agent-secret-hash',
        revokedAgentSecretHashes: ['older-agent-secret-hash'],
        lastSeenAt: oldLastSeenAt,
        lastIp: '203.0.113.5',
        registeredAt: oldRegisteredAt,
        replacedAt: null,
        async save(options) {
            harness.calls.push(['activeDevice.save', { ...this }, options]);
        }
    };
    const harness = createTransactionHarness({ activeDevice });
    const deviceInput = {
        displayName: 'New PC',
        machineFingerprintHash: 'new-fingerprint-hash',
        platform: 'linux',
        appVersion: '2.0.0',
        agentVersion: '2.1.0',
        agentSecretHash: 'new-agent-secret-hash',
        lastIp: '198.51.100.5'
    };

    const result = await replaceActiveDevice({
        mongooseClient: harness.mongooseClient,
        models: harness.models,
        userId: 'user-id',
        subscriptionId: 'subscription-id',
        deviceInput
    });

    assert.deepStrictEqual(result, {
        device: activeDevice,
        replacedDevice: harness.historicalDevice
    });
    assert.strictEqual(harness.query.sessionArg, harness.session);
    assert.strictEqual(activeDevice._id, 'active-device-id');
    assert.strictEqual(activeDevice.status, 'active');
    assert.strictEqual(activeDevice.replacedAt, null);
    assert.ok(activeDevice.registeredAt instanceof Date);
    assert.ok(activeDevice.lastSeenAt instanceof Date);
    assert.notStrictEqual(activeDevice.registeredAt, oldRegisteredAt);
    assert.notStrictEqual(activeDevice.lastSeenAt, oldLastSeenAt);
    assert.strictEqual(activeDevice.machineFingerprintHash, deviceInput.machineFingerprintHash);
    assert.strictEqual(activeDevice.agentSecretHash, deviceInput.agentSecretHash);
    assert.deepStrictEqual(activeDevice.revokedAgentSecretHashes, [
        'older-agent-secret-hash',
        'old-agent-secret-hash'
    ]);
    assert.strictEqual(activeDevice.displayName, deviceInput.displayName);
    assert.strictEqual(activeDevice.platform, deviceInput.platform);
    assert.strictEqual(activeDevice.appVersion, deviceInput.appVersion);
    assert.strictEqual(activeDevice.agentVersion, deviceInput.agentVersion);
    assert.strictEqual(activeDevice.lastIp, deviceInput.lastIp);

    const findCall = harness.calls.find((call) => Array.isArray(call) && call[0] === 'activeDevice.findOne');
    assert.deepStrictEqual(findCall[1], {
        userId: 'user-id',
        subscriptionId: 'subscription-id',
        status: 'active'
    });

    const createIndex = harness.calls.findIndex((call) => Array.isArray(call) && call[0] === 'device.create');
    const saveIndex = harness.calls.findIndex((call) => Array.isArray(call) && call[0] === 'activeDevice.save');
    const auditIndex = harness.calls.findIndex((call) => Array.isArray(call) && call[0] === 'audit.create');
    assert.ok(createIndex < saveIndex);
    assert.ok(saveIndex < auditIndex);

    const createCall = harness.calls[createIndex];
    assert.deepStrictEqual(createCall[1], [{
        userId: 'user-id',
        subscriptionId: 'subscription-id',
        machineFingerprintHash: 'old-fingerprint-hash',
        displayName: 'Old PC',
        platform: 'windows',
        appVersion: '1.0.0',
        agentVersion: '1.1.0',
        status: 'replaced',
        agentSecretHash: 'old-agent-secret-hash',
        lastSeenAt: oldLastSeenAt,
        lastIp: '203.0.113.5',
        registeredAt: oldRegisteredAt,
        replacedAt: activeDevice.registeredAt
    }]);
    assert.strictEqual(createCall[2].session, harness.session);
    assert.strictEqual(
        harness.calls.filter((call) => Array.isArray(call) && call[0] === 'device.create').length,
        1,
        'unique-index regression: replacement must not insert a second active device'
    );
    assert.strictEqual(createCall[1][0].status, 'replaced');

    const saveCall = harness.calls[saveIndex];
    assert.strictEqual(saveCall[1]._id, 'active-device-id');
    assert.strictEqual(saveCall[1].status, 'active');
    assert.strictEqual(saveCall[2].session, harness.session);

    const auditCall = harness.calls[auditIndex];
    assert.deepStrictEqual(auditCall[1], [{
        userId: 'user-id',
        subscriptionId: 'subscription-id',
        deviceId: 'active-device-id',
        action: 'device_replaced',
        details: {
            replacedDeviceId: 'historical-device-id',
            activeDeviceId: 'active-device-id'
        }
    }]);
    assert.strictEqual(auditCall[2].session, harness.session);
    assert.deepStrictEqual(harness.calls.slice(0, 2), ['startSession', 'withTransaction']);
    assert.strictEqual(harness.calls.at(-1), 'endSession');
});

test('replaceActiveDevice creates and audits an active device when no old device exists', async () => {
    const harness = createTransactionHarness();

    const result = await replaceActiveDevice({
        mongooseClient: harness.mongooseClient,
        models: harness.models,
        userId: 'user-id',
        subscriptionId: 'subscription-id',
        deviceInput: { displayName: 'Only PC' }
    });

    assert.strictEqual(result.device, harness.createdActiveDevice);
    assert.strictEqual(result.replacedDevice, null);
    assert.ok(!harness.calls.some((call) => Array.isArray(call) && call[0] === 'activeDevice.save'));

    const createCall = harness.calls.find((call) => Array.isArray(call) && call[0] === 'device.create');
    assert.deepStrictEqual(createCall[1], [{
        displayName: 'Only PC',
        userId: 'user-id',
        subscriptionId: 'subscription-id',
        status: 'active'
    }]);
    assert.strictEqual(createCall[2].session, harness.session);

    const auditCall = harness.calls.find((call) => Array.isArray(call) && call[0] === 'audit.create');
    assert.deepStrictEqual(auditCall[1][0].details, {
        replacedDeviceId: null,
        activeDeviceId: 'new-device-id'
    });
    assert.strictEqual(harness.calls.at(-1), 'endSession');
});

test('replaceActiveDevice ends the session when the transaction throws', async () => {
    const transactionError = new Error('transaction failed');
    const harness = createTransactionHarness({ transactionError });

    await assert.rejects(
        replaceActiveDevice({
            mongooseClient: harness.mongooseClient,
            models: harness.models,
            userId: 'user-id',
            subscriptionId: 'subscription-id',
            deviceInput: { displayName: 'New PC' }
        }),
        transactionError
    );

    assert.deepStrictEqual(harness.calls, [
        'startSession',
        'withTransaction',
        'endSession'
    ]);
});
