import test from 'node:test';
import assert from 'node:assert/strict';

// Pin the base URL so the derived-URL assertions do not depend on whatever
// CDN_BASE_URL the machine running the tests happens to have.
process.env.CDN_BASE_URL = 'https://cdn.example.test/file/alpha-studio';

import { parseVietYakuManifest } from '../server/routes/vietyaku.js';

const DERIVED_BASE = 'https://cdn.example.test/file/alpha-studio/vietyaku-app';

const FULL_MANIFEST = {
    tag_name: 'v1.2.0',
    version: '1.2.0',
    name: 'VietYaku v1.2.0',
    body: '## Có gì mới\n- Sửa lỗi',
    html_url: 'https://github.com/LittleKai/VietYaku/releases/tag/v1.2.0',
    published_at: '2026-08-21T03:00:00Z',
    assets: [
        {
            name: 'VietYaku-windows-x64-v1.2.0.zip',
            browser_download_url:
                'https://cdn.giaiphapsangtao.com/file/alpha-studio/vietyaku-app/releases/VietYaku-windows-x64-v1.2.0.zip',
            size: 63831612,
            content_type: 'application/zip',
        },
    ],
};

test('parses the manifest uploaded by the build-and-release skill', () => {
    const release = parseVietYakuManifest(FULL_MANIFEST);

    assert.equal(release.version, '1.2.0');
    assert.equal(release.windowsZipUrl, FULL_MANIFEST.assets[0].browser_download_url);
    assert.equal(release.windowsSize, 63831612);
    assert.equal(release.releaseNotes, '## Có gì mới\n- Sửa lỗi');
    assert.equal(release.releaseUrl, FULL_MANIFEST.html_url);
    assert.equal(release.publishedAt, '2026-08-21T03:00:00Z');
});

test('strips the leading v from tag_name', () => {
    assert.equal(parseVietYakuManifest({ tag_name: 'v2.0.1' }).version, '2.0.1');
    assert.equal(parseVietYakuManifest({ version: '2.0.1' }).version, '2.0.1');
});

test('derives the B2 download URL when the manifest has no assets', () => {
    const release = parseVietYakuManifest({ tag_name: 'v1.3.0', assets: [] });

    assert.equal(
        release.windowsZipUrl,
        `${DERIVED_BASE}/releases/VietYaku-windows-x64-v1.3.0.zip`
    );
    assert.equal(release.windowsSize, undefined);
});

test('falls back to the GitHub releases page when html_url is missing', () => {
    const release = parseVietYakuManifest({ tag_name: 'v1.3.0' });

    assert.equal(release.releaseUrl, 'https://github.com/LittleKai/VietYaku/releases');
});

test('picks a zip asset even when the name does not contain "windows"', () => {
    const release = parseVietYakuManifest({
        tag_name: 'v1.4.0',
        assets: [
            { name: 'notes.txt', browser_download_url: 'https://example.com/notes.txt' },
            { name: 'VietYaku-v1.4.0.zip', browser_download_url: 'https://example.com/app.zip', size: 10 },
        ],
    });

    assert.equal(release.windowsZipUrl, 'https://example.com/app.zip');
    assert.equal(release.windowsSize, 10);
});

test('picks an android apk asset when present', () => {
    const release = parseVietYakuManifest({
        tag_name: 'v1.5.0',
        assets: [
            { name: 'VietYaku-windows-x64-v1.5.0.zip', browser_download_url: 'https://example.com/app.zip', size: 50000000 },
            { name: 'VietYaku-android-v1.5.0.apk', browser_download_url: 'https://example.com/app.apk', size: 30000000 },
        ],
    });

    assert.equal(release.windowsZipUrl, 'https://example.com/app.zip');
    assert.equal(release.androidApkUrl, 'https://example.com/app.apk');
    assert.equal(release.androidSize, 30000000);
});

test('never throws on a malformed manifest', () => {
    const release = parseVietYakuManifest(null);

    assert.equal(release.version, '1.1.0');
    assert.match(release.windowsZipUrl, /VietYaku-windows-x64-v1\.1\.0\.zip$/);
    assert.equal(release.androidApkUrl, undefined);
});
