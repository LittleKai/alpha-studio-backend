import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildActiveDeviceConflict } from '../../utils/crmDeviceSessions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const crmSource = readFileSync(join(__dirname, '../crm.js'), 'utf8');

const sourceBetween = (start, end) => {
    const startIndex = crmSource.indexOf(start);
    const endIndex = crmSource.indexOf(end, startIndex);

    assert.notStrictEqual(startIndex, -1, `Missing source marker: ${start}`);
    assert.notStrictEqual(endIndex, -1, `Missing source marker: ${end}`);

    return crmSource.slice(startIndex, endIndex);
};

test('crm.js imports the typed device-session service contracts', () => {
    assert.match(
        crmSource,
        /import\s*{\s*buildActiveDeviceConflict,\s*createAgentSecret,\s*replaceActiveDevice\s*}\s*from\s*['"]\.\.\/utils\/crmDeviceSessions\.js['"]/
    );
});

test('registration conflict exposes only safe active-device metadata', () => {
    const lastSeenAt = new Date('2026-06-06T01:02:03.000Z');

    assert.deepStrictEqual(buildActiveDeviceConflict({
        displayName: 'Office PC',
        lastSeenAt,
        agentSecretHash: 'secret-hash',
        machineFingerprintHash: 'fingerprint-hash',
        lastIp: '203.0.113.10'
    }), {
        displayName: 'Office PC',
        lastSeenAt
    });

    const registerRoute = sourceBetween(
        "router.post('/devices/register'",
        "// POST /api/crm/devices/force-logout-old"
    );

    assert.match(registerRoute, /CrmDevice\.findOne\(\{\s*subscriptionId:\s*sub\._id,\s*status:\s*['"]active['"]\s*}\)/);
    assert.match(registerRoute, /res\.status\(409\)\.json\(\{/);
    assert.match(registerRoute, /code:\s*['"]DEVICE_ALREADY_ACTIVE['"]/);
    assert.match(registerRoute, /device:\s*buildActiveDeviceConflict\(activeDevice\)/);
    assert.match(registerRoute, /const\s*{\s*agentSecret,\s*agentSecretHash\s*}\s*=\s*createAgentSecret\(\)/);
});

test('agent authentication distinguishes revoked devices from bad secrets', () => {
    const middleware = sourceBetween(
        'const agentAuthMiddleware = async',
        'const userOrAgentAuth = async'
    );

    assert.match(
        middleware,
        /if\s*\(!deviceId\)\s*{\s*return res\.status\(403\)\.json\(\{[\s\S]*?code:\s*['"]DEVICE_REVOKED['"]/
    );
    assert.match(
        middleware,
        /if\s*\(!agentSecret\)\s*{\s*return res\.status\(403\)\.json\(\{[\s\S]*?code:\s*['"]INVALID_AGENT_CREDENTIALS['"]/
    );
    assert.match(middleware, /CrmDevice\.findOne\(\{\s*_id:\s*deviceId,\s*status:\s*['"]active['"]\s*}\)/);
    assert.match(
        middleware,
        /if\s*\(!device\)\s*{\s*return res\.status\(403\)\.json\(\{[\s\S]*?code:\s*['"]DEVICE_REVOKED['"]/
    );
    assert.match(
        middleware,
        /revokedAgentSecretHashes[\s\S]*?includes\(incomingSecretHash\)[\s\S]*?code:\s*['"]DEVICE_REVOKED['"]/
    );
    assert.match(
        middleware,
        /if\s*\(device\.agentSecretHash\s*!==\s*incomingSecretHash\)\s*{\s*return res\.status\(403\)\.json\(\{[\s\S]*?code:\s*['"]INVALID_AGENT_CREDENTIALS['"]/
    );
});

test('CrmDevice schema stores revoked agent secret hashes for old-PC detection', () => {
    const modelSource = readFileSync(
        join(__dirname, '../../models/CrmDevice.js'),
        'utf8'
    );

    assert.match(modelSource, /revokedAgentSecretHashes:\s*\[\s*{\s*type:\s*String/);
});

test('force replacement validates input, rotates credentials, and returns the one-time secret', () => {
    const route = sourceBetween(
        "router.post('/devices/force-logout-old'",
        "// POST /api/crm/devices/:id/disable"
    );

    assert.match(
        route,
        /router\.post\(\s*['"]\/devices\/force-logout-old['"][\s\S]*?crmDeviceLimiter[\s\S]*?authMiddleware[\s\S]*?requireActiveSubscription/
    );
    assert.match(route, /if\s*\(!machineFingerprint\s*\|\|\s*!displayName\)/);
    assert.match(route, /const\s*{\s*agentSecret,\s*agentSecretHash\s*}\s*=\s*createAgentSecret\(\)/);
    assert.match(route, /machineFingerprintHash\s*=\s*crypto\.createHash\(['"]sha256['"]\)\.update\(machineFingerprint\)\.digest\(['"]hex['"]\)/);
    assert.match(route, /replaceActiveDevice\(\{\s*userId:\s*req\.user\._id,\s*subscriptionId:\s*sub\._id,\s*deviceInput:\s*\{/);

    const deviceInputStart = route.indexOf('deviceInput: {');
    assert.notStrictEqual(deviceInputStart, -1);
    const deviceInputTail = route.slice(deviceInputStart);
    const deviceInputEnd = /\r?\n\s{12}\}\r?\n\s{8}\}\);/.exec(deviceInputTail);
    assert.ok(deviceInputEnd);
    const deviceInput = deviceInputTail.slice(0, deviceInputEnd.index);

    for (const field of [
        'machineFingerprintHash',
        'displayName',
        'platform',
        'appVersion',
        'agentVersion',
        'agentSecretHash',
        'lastIp'
    ]) {
        assert.match(deviceInput, new RegExp(`\\b${field}\\b`), `Missing replacement field: ${field}`);
    }

    assert.match(route, /data:\s*{\s*deviceId:\s*device\._id,\s*agentSecret\s*}/);
});

test('pairing revoke removes only the mobile remote relationship', () => {
    const route = sourceBetween(
        "router.post('/pairing/revoke'",
        "// GET /api/crm/pairing/:id"
    );

    assert.match(route, /\$pull:\s*{[\s\S]*pairedMobileUserIds/);
    assert.match(route, /pairedMobileDevices:\s*{\s*userId:\s*requestedMobileUserId\s*}/);
    assert.doesNotMatch(route, /status\s*[:=]\s*['"]disabled['"]/);
    assert.doesNotMatch(route, /replacedAt/);
});

test('pairing confirmation records mobile display metadata', () => {
    const route = sourceBetween(
        "router.post('/pairing/confirm'",
        "// POST /api/crm/pairing/revoke"
    );

    assert.match(route, /pairedMobileDevices\.push\(\{/);
    assert.match(route, /userId:\s*req\.user\._id/);
    assert.match(route, /\bplatform\b/);
    assert.match(route, /\bdisplayName\b/);
});
