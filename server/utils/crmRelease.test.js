import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseCrmManifest,
    resetCrmReleaseMemo,
    resolveCrmLatestRelease,
} from './crmRelease.js';

const TEST_CDN = 'https://cdn.example.test/file/alpha-studio';

const V040_MANIFEST = {
    tag_name: 'v0.4.0',
    version: '0.4.0',
    build_number: '35',
    name: 'Alpha CRM v0.4.0',
    body: '## Có gì mới trong phiên bản 0.4.0',
    html_url: 'https://github.com/LittleKai/alpha-crm/releases/tag/v0.4.0',
    published_at: '2026-11-18T20:00:18.805Z',
    assets: [
        {
            name: 'alpha-crm-windows-v0.4.0.zip',
            browser_download_url: 'https://f004.backblazeb2.com/file/alpha-studio/crm-app/releases/alpha-crm-windows-v0.4.0.zip',
            size: 74336312,
        },
        {
            name: 'alpha-crm-v0.4.0.apk',
            browser_download_url: 'https://download.giaiphapsangtao.com/file/alpha-studio/crm-app/releases/alpha-crm-v0.4.0.apk',
            size: 156929839,
        },
    ],
};

test('parseCrmManifest parses v0.4.0 manifest and rewrites raw B2 URLs to CDN', () => {
    const parsed = parseCrmManifest(V040_MANIFEST, TEST_CDN);
    assert.equal(parsed.version, '0.4.0');
    assert.equal(
        parsed.windowsInstallerUrl,
        `${TEST_CDN}/crm-app/releases/alpha-crm-windows-v0.4.0.zip`,
    );
    assert.equal(parsed.windowsSize, 74336312);
    assert.equal(
        parsed.androidApkUrl,
        'https://download.giaiphapsangtao.com/file/alpha-studio/crm-app/releases/alpha-crm-v0.4.0.apk',
    );
    assert.equal(parsed.androidSize, 156929839);
    assert.equal(parsed.publishedAt, '2026-11-18T20:00:18.805Z');
    assert.equal(parsed.releaseNotes, '## Có gì mới trong phiên bản 0.4.0');
});

test('parseCrmManifest falls back to platform_releases assets when top-level assets omit a platform', () => {
    const parsed = parseCrmManifest({
        tag_name: 'v0.4.1',
        assets: [],
        platform_releases: {
            windows: {
                assets: [{ name: 'alpha-crm-windows-v0.4.1.zip', browser_download_url: `${TEST_CDN}/crm-app/releases/alpha-crm-windows-v0.4.1.zip`, size: 123 }],
            },
            android: {
                assets: [{ name: 'alpha-crm-v0.4.1.apk', browser_download_url: `${TEST_CDN}/crm-app/releases/alpha-crm-v0.4.1.apk`, size: 456 }],
            },
        },
    }, TEST_CDN);

    assert.equal(parsed.version, '0.4.1');
    assert.equal(parsed.windowsInstallerUrl, `${TEST_CDN}/crm-app/releases/alpha-crm-windows-v0.4.1.zip`);
    assert.equal(parsed.androidApkUrl, `${TEST_CDN}/crm-app/releases/alpha-crm-v0.4.1.apk`);
});

test('resolveCrmLatestRelease prefers fresh B2 manifest over stale DB cache and updates cache', async () => {
    resetCrmReleaseMemo();
    let fetchedUrl = '';
    let fetchedOpts = null;
    let savedCache = null;

    const result = await resolveCrmLatestRelease({
        cdnBase: TEST_CDN,
        now: () => 1700000000000,
        fetchImpl: async (url, opts) => {
            fetchedUrl = url;
            fetchedOpts = opts;
            return new Response(JSON.stringify(V040_MANIFEST), { status: 200 });
        },
        getCachedSetting: async () => ({
            version: '0.2.5',
            windowsInstallerUrl: `${TEST_CDN}/crm-app/releases/alpha-crm-windows-v0.2.5.zip`,
            androidApkUrl: `${TEST_CDN}/crm-app/releases/alpha-crm-v0.2.5.apk`,
            publishedAt: '2026-10-30T09:25:37.860Z',
        }),
        saveCachedSetting: async (val) => {
            savedCache = val;
        },
    });

    assert.equal(fetchedUrl, `${TEST_CDN}/crm-app/version.json?t=1700000000000`);
    assert.equal(fetchedOpts.cache, 'no-store');
    assert.equal(result.version, '0.4.0');
    assert.equal(savedCache.version, '0.4.0');
});

test('resolveCrmLatestRelease memoizes within TTL and skips duplicate DB writes when unchanged', async () => {
    resetCrmReleaseMemo();
    let fetchCount = 0;
    let saveCount = 0;
    let clock = 1_700_000_000_000;

    const opts = {
        cdnBase: TEST_CDN,
        now: () => clock,
        ttlMs: 60_000,
        fetchImpl: async () => {
            fetchCount += 1;
            return new Response(JSON.stringify(V040_MANIFEST), { status: 200 });
        },
        saveCachedSetting: async () => {
            saveCount += 1;
        },
    };

    const r1 = await resolveCrmLatestRelease(opts);
    clock += 10_000;
    const r2 = await resolveCrmLatestRelease(opts);
    assert.equal(r1.version, '0.4.0');
    assert.equal(r2.version, '0.4.0');
    assert.equal(fetchCount, 1);
    assert.equal(saveCount, 1);

    // After TTL expires, fetches B2 again but does NOT rewrite unchanged DB cache
    clock += 60_000;
    await resolveCrmLatestRelease(opts);
    assert.equal(fetchCount, 2);
    assert.equal(saveCount, 1);
});

test('resolveCrmLatestRelease rejects 200 manifest without version/tag_name and preserves DB cache', async () => {
    resetCrmReleaseMemo();
    let saveCalled = false;

    const result = await resolveCrmLatestRelease({
        cdnBase: TEST_CDN,
        fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }),
        getCachedSetting: async () => ({
            version: '0.5.0',
            windowsInstallerUrl: `${TEST_CDN}/crm-app/releases/alpha-crm-windows-v0.5.0.zip`,
            androidApkUrl: `${TEST_CDN}/crm-app/releases/alpha-crm-v0.5.0.apk`,
            publishedAt: '2026-12-01T00:00:00.000Z',
        }),
        saveCachedSetting: async () => {
            saveCalled = true;
        },
        logger: { error: () => {} },
    });

    assert.equal(result.version, '0.5.0');
    assert.equal(saveCalled, false);
});

test('resolveCrmLatestRelease falls back to cached DB setting when B2 CDN is unreachable', async () => {
    resetCrmReleaseMemo();
    const result = await resolveCrmLatestRelease({
        cdnBase: TEST_CDN,
        fetchImpl: async () => {
            throw new Error('CDN timeout');
        },
        getCachedSetting: async () => ({
            version: '0.4.0',
            windowsInstallerUrl: 'https://f004.backblazeb2.com/file/alpha-studio/crm-app/releases/alpha-crm-windows-v0.4.0.zip',
            androidApkUrl: 'https://f004.backblazeb2.com/file/alpha-studio/crm-app/releases/alpha-crm-v0.4.0.apk',
            publishedAt: '2026-11-18T20:00:18.805Z',
        }),
        logger: { error: () => {} },
    });

    assert.equal(result.version, '0.4.0');
    assert.equal(result.windowsInstallerUrl, `${TEST_CDN}/crm-app/releases/alpha-crm-windows-v0.4.0.zip`);
    assert.equal(result.androidApkUrl, `${TEST_CDN}/crm-app/releases/alpha-crm-v0.4.0.apk`);
});

test('resolveCrmLatestRelease falls back to static default if both CDN and DB read fail', async () => {
    resetCrmReleaseMemo();
    const result = await resolveCrmLatestRelease({
        cdnBase: TEST_CDN,
        fetchImpl: async () => {
            throw new Error('CDN down');
        },
        getCachedSetting: async () => {
            throw new Error('Mongo disconnected');
        },
        logger: { error: () => {} },
    });

    assert.equal(result.version, '0.4.0');
    assert.equal(result.publishedAt, '2026-11-18T20:00:18.805Z');
});

test('resolveCrmLatestRelease still returns fresh B2 manifest even if cache write fails', async () => {
    resetCrmReleaseMemo();
    const result = await resolveCrmLatestRelease({
        cdnBase: TEST_CDN,
        fetchImpl: async () => new Response(JSON.stringify(V040_MANIFEST), { status: 200 }),
        saveCachedSetting: async () => {
            throw new Error('Mongo write failed');
        },
        logger: { error: () => {} },
    });

    assert.equal(result.version, '0.4.0');
});

test('parseCrmManifest never throws on null or malformed input and uses deterministic publishedAt', () => {
    const p1 = parseCrmManifest(null, TEST_CDN);
    const p2 = parseCrmManifest({}, TEST_CDN);
    assert.equal(p1.version, '0.4.0');
    assert.equal(p1.publishedAt, p2.publishedAt);
    assert.match(p1.windowsInstallerUrl, /alpha-crm-windows-v0\.4\.0\.zip$/);
    assert.match(p1.androidApkUrl, /alpha-crm-v0\.4\.0\.apk$/);
});
