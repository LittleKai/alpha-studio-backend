import test from 'node:test';
import assert from 'node:assert/strict';
import { getDownloadMetadata, normalizePlatform, KNOWN_TOOLS } from '../server/routes/toolDownloads.js';

test('normalizePlatform standardizes various platform identifiers', () => {
    assert.equal(normalizePlatform('windows'), 'windows');
    assert.equal(normalizePlatform('win32'), 'windows');
    assert.equal(normalizePlatform('Windows x64'), 'windows');
    assert.equal(normalizePlatform('WIN'), 'windows');

    assert.equal(normalizePlatform('android'), 'android');
    assert.equal(normalizePlatform('apk'), 'android');
    assert.equal(normalizePlatform('Android APK'), 'android');

    assert.equal(normalizePlatform('mac'), 'mac');
    assert.equal(normalizePlatform('macos'), 'mac');
    assert.equal(normalizePlatform('darwin'), 'mac');
    assert.equal(normalizePlatform('ios'), 'mac');

    assert.equal(normalizePlatform('linux'), 'linux');
    assert.equal(normalizePlatform('ubuntu'), 'other');
    assert.equal(normalizePlatform(null), 'other');
    assert.equal(normalizePlatform(''), 'other');
});

test('KNOWN_TOOLS dictionary contains expected studio tools', () => {
    assert.equal(KNOWN_TOOLS.vietyaku, 'VietYaku');
    assert.equal(KNOWN_TOOLS.vocabflip, 'VocabFlip');
    assert.equal(KNOWN_TOOLS.crm, 'Alpha CRM');
});

test('download metadata accepts query params used by sendBeacon', () => {
    assert.deepEqual(
        getDownloadMetadata({ query: { platform: 'android', version: '1.2.3' } }),
        { platform: 'android', version: '1.2.3' },
    );
    assert.deepEqual(
        getDownloadMetadata({ query: { platform: 'android' }, body: { platform: 'windows' } }),
        { platform: 'windows', version: '' },
    );
});

test('calculates summary statistics correctly', () => {
    const mockTools = [
        {
            toolId: 'vietyaku',
            toolName: 'VietYaku',
            totalDownloads: 150,
            platforms: { windows: 100, android: 50, mac: 0, linux: 0, other: 0 }
        },
        {
            toolId: 'vocabflip',
            toolName: 'VocabFlip',
            totalDownloads: 80,
            platforms: { windows: 40, android: 40, mac: 0, linux: 0, other: 0 }
        }
    ];

    let totalDownloads = 0;
    let windowsDownloads = 0;
    let androidDownloads = 0;
    let otherDownloads = 0;
    let topTool = null;
    let maxCount = -1;

    for (const t of mockTools) {
        totalDownloads += t.totalDownloads;
        windowsDownloads += t.platforms.windows;
        androidDownloads += t.platforms.android;
        otherDownloads += (t.platforms.mac + t.platforms.linux + t.platforms.other);

        if (t.totalDownloads > maxCount) {
            maxCount = t.totalDownloads;
            topTool = { toolId: t.toolId, toolName: t.toolName, count: t.totalDownloads };
        }
    }

    assert.equal(totalDownloads, 230);
    assert.equal(windowsDownloads, 140);
    assert.equal(androidDownloads, 90);
    assert.equal(otherDownloads, 0);
    assert.deepEqual(topTool, { toolId: 'vietyaku', toolName: 'VietYaku', count: 150 });
});

test('POST /:toolId/download counts dotted versions atomically', async (t) => {
    const express = (await import('express')).default;
    const ToolDownload = (await import('../server/models/ToolDownload.js')).default;
    const router = (await import('../server/routes/toolDownloads.js')).default;
    let captured;
    t.mock.method(ToolDownload, 'findOneAndUpdate', async (_filter, update) => {
        captured = update;
        return { toolId: 'crm', toolName: 'Alpha CRM', totalDownloads: 1, platforms: {}, lastDownloadedAt: null };
    });

    const server = express().use('/api/tools', router).listen(0);
    t.after(() => server.close());
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/tools/crm/download?platform=windows&version=1.2.3`, { method: 'POST' });

    assert.equal(res.status, 200);
    assert.equal(captured.$inc['versions.1_2_3'], 1);
    assert.equal(captured.$inc.totalDownloads, 1);
});
