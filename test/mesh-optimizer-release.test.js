import test from 'node:test';
import assert from 'node:assert/strict';

process.env.CDN_BASE_URL = 'https://cdn.example.test/file/alpha-studio';

import { parseMeshOptimizerManifest } from '../server/routes/meshOptimizer.js';

const DERIVED_BASE = 'https://cdn.example.test/file/alpha-studio/mesh-optimizer-app';

const FULL_MANIFEST = {
    tag_name: 'v1.0.0',
    version: '1.0.0',
    name: 'ALPHA Mesh Optimizer v1.0.0',
    body: '## Release notes\n- Initial release',
    html_url: 'https://github.com/LittleKai/alpha-mesh-optimizer/releases/tag/v1.0.0',
    published_at: '2026-11-28T12:00:00Z',
    assets: [
        {
            name: 'alpha-mesh-optimizer-windows-v1.0.0.zip',
            browser_download_url:
                'https://download.giaiphapsangtao.com/file/alpha-studio/mesh-optimizer-app/releases/alpha-mesh-optimizer-windows-v1.0.0.zip',
            size: 18500123,
            content_type: 'application/zip',
        },
        {
            name: 'alpha-mesh-optimizer-setup-v1.0.0.exe',
            browser_download_url:
                'https://download.giaiphapsangtao.com/file/alpha-studio/mesh-optimizer-app/releases/alpha-mesh-optimizer-setup-v1.0.0.exe',
            size: 14200000,
            content_type: 'application/vnd.microsoft.portable-executable',
        },
    ],
};

test('parseMeshOptimizerManifest parses ZIP and optional installer assets', () => {
    const release = parseMeshOptimizerManifest(FULL_MANIFEST);

    assert.equal(release.version, '1.0.0');
    assert.equal(release.windowsZipUrl, FULL_MANIFEST.assets[0].browser_download_url);
    assert.equal(release.windowsSize, 18500123);
    assert.equal(release.windowsInstallerUrl, FULL_MANIFEST.assets[1].browser_download_url);
    assert.equal(release.installerSize, 14200000);
    assert.equal(release.releaseNotes, '## Release notes\n- Initial release');
    assert.equal(release.releaseUrl, FULL_MANIFEST.html_url);
    assert.equal(release.publishedAt, '2026-11-28T12:00:00Z');
});

test('parseMeshOptimizerManifest strips leading v from tag_name', () => {
    assert.equal(parseMeshOptimizerManifest({ tag_name: 'v1.2.3' }).version, '1.2.3');
    assert.equal(parseMeshOptimizerManifest({ version: '1.2.3' }).version, '1.2.3');
});

test('parseMeshOptimizerManifest derives B2 ZIP URL when assets are missing', () => {
    const release = parseMeshOptimizerManifest({ tag_name: 'v1.0.5', assets: [] });

    assert.equal(
        release.windowsZipUrl,
        `${DERIVED_BASE}/releases/alpha-mesh-optimizer-windows-v1.0.5.zip`,
    );
    assert.equal(release.windowsSize, undefined);
    assert.equal(release.windowsInstallerUrl, undefined);
});

test('parseMeshOptimizerManifest never throws on malformed manifest', () => {
    const release = parseMeshOptimizerManifest(null);

    assert.equal(release.version, '1.0.0');
    assert.match(release.windowsZipUrl, /alpha-mesh-optimizer-windows-v1\.0\.0\.zip$/);
    assert.equal(release.releaseUrl, '');
});
