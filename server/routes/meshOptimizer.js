import express from 'express';
import SystemSetting from '../models/SystemSetting.js';

const router = express.Router();

const SETTING_KEY = 'mesh_optimizer_latest_release';
const FALLBACK_VERSION = '1.0.0';

function baseUrl() {
    const cdn = (process.env.CDN_BASE_URL || 'https://download.giaiphapsangtao.com/file/alpha-studio').replace(/\/+$/, '');
    return `${cdn}/mesh-optimizer-app`;
}

export function toCdnUrl(url) {
    if (!url || typeof url !== 'string') return url;
    const cdn = (process.env.CDN_BASE_URL || 'https://download.giaiphapsangtao.com/file/alpha-studio').replace(/\/+$/, '');
    return url.replace('https://f004.backblazeb2.com/file/alpha-studio', cdn);
}

function manifestUrl() {
    return `${baseUrl()}/version.json`;
}

function windowsZipUrl(version) {
    return `${baseUrl()}/releases/alpha-mesh-optimizer-windows-v${version}.zip`;
}

/**
 * Parse `mesh-optimizer-app/version.json` uploaded by the build-and-release skill.
 */
export function parseMeshOptimizerManifest(manifest) {
    const rawVersion = manifest?.tag_name || manifest?.version || FALLBACK_VERSION;
    const version = String(rawVersion).startsWith('v') ? String(rawVersion).slice(1) : String(rawVersion);

    const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
    const windowsZipAsset = assets.find((asset) => {
        const name = (asset.name || '').toLowerCase();
        return name.includes('windows') && name.endsWith('.zip');
    }) || assets.find((asset) => (asset.name || '').toLowerCase().endsWith('.zip'));

    const installerAsset = assets.find((asset) => {
        const name = (asset.name || '').toLowerCase();
        return (name.includes('setup') || name.includes('installer')) && (name.endsWith('.exe') || name.endsWith('.msi'));
    }) || assets.find((asset) => {
        const name = (asset.name || '').toLowerCase();
        return name.endsWith('.exe') || name.endsWith('.msi');
    });

    return {
        version,
        windowsZipUrl: toCdnUrl(windowsZipAsset?.browser_download_url) || windowsZipUrl(version),
        windowsSize: windowsZipAsset?.size,
        windowsInstallerUrl: installerAsset ? toCdnUrl(installerAsset.browser_download_url) : undefined,
        installerSize: installerAsset?.size,
        releaseNotes: manifest?.body || 'ALPHA Mesh Optimizer release build',
        releaseUrl: manifest?.html_url || '',
        publishedAt: manifest?.published_at || new Date().toISOString(),
    };
}

// GET /api/mesh-optimizer/releases/latest
router.get('/releases/latest', async (_req, res) => {
    try {
        let release = null;
        try {
            const response = await fetch(`${manifestUrl()}?t=${Date.now()}`, { cache: 'no-store' });
            if (response.ok) {
                release = parseMeshOptimizerManifest(await response.json());
                await SystemSetting.findOneAndUpdate(
                    { key: SETTING_KEY },
                    { value: release },
                    { upsert: true, new: true }
                );
            }
        } catch (fetchError) {
            console.error('Failed to fetch Mesh Optimizer release metadata from B2:', fetchError.message);
        }

        if (release) {
            return res.json({ success: true, message: 'OK', data: release });
        }

        const setting = await SystemSetting.findOne({ key: SETTING_KEY });
        if (setting && setting.value) {
            const val = { ...setting.value };
            if (val.windowsZipUrl) val.windowsZipUrl = toCdnUrl(val.windowsZipUrl);
            if (val.windowsInstallerUrl) val.windowsInstallerUrl = toCdnUrl(val.windowsInstallerUrl);
            return res.json({ success: true, message: 'OK', data: val });
        }

        return res.json({
            success: true,
            message: 'OK',
            data: {
                version: FALLBACK_VERSION,
                windowsZipUrl: windowsZipUrl(FALLBACK_VERSION),
                releaseNotes: 'ALPHA Mesh Optimizer release build',
                releaseUrl: '',
                publishedAt: new Date().toISOString(),
            },
        });
    } catch (error) {
        console.error('Error fetching latest Mesh Optimizer release:', error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi server khi lấy thông tin bản phát hành ALPHA Mesh Optimizer mới nhất',
        });
    }
});

export default router;
