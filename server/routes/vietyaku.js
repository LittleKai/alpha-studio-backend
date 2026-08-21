import express from 'express';
import SystemSetting from '../models/SystemSetting.js';

const router = express.Router();

const B2_BASE_URL = 'https://cdn.giaiphapsangtao.com/file/alpha-studio/vietyaku-app';
const MANIFEST_URL = `${B2_BASE_URL}/version.json`;
const SETTING_KEY = 'vietyaku_latest_release';
const FALLBACK_VERSION = '1.1.0';

const GITHUB_RELEASES_URL = 'https://github.com/LittleKai/VietYaku/releases';

function windowsZipUrl(version) {
    return `${B2_BASE_URL}/releases/VietYaku-windows-x64-v${version}.zip`;
}

/**
 * Parse the `vietyaku-app/version.json` manifest uploaded by the VietYaku
 * build-and-release skill. Shape mirrors a GitHub release payload.
 */
export function parseVietYakuManifest(manifest) {
    const rawVersion = manifest?.tag_name || manifest?.version || FALLBACK_VERSION;
    const version = rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;

    const assets = manifest?.assets || [];
    const windowsAsset = assets.find((asset) => {
        const name = (asset.name || '').toLowerCase();
        return name.includes('windows') && name.endsWith('.zip');
    }) || assets.find((asset) => (asset.name || '').toLowerCase().endsWith('.zip'));

    return {
        version,
        windowsZipUrl: windowsAsset?.browser_download_url || windowsZipUrl(version),
        windowsSize: windowsAsset?.size,
        releaseNotes: manifest?.body || '',
        releaseUrl: manifest?.html_url || GITHUB_RELEASES_URL,
        publishedAt: manifest?.published_at || new Date().toISOString(),
    };
}

// GET /api/vietyaku/releases/latest
router.get('/releases/latest', async (_req, res) => {
    try {
        let release = null;
        try {
            const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
            if (response.ok) {
                release = parseVietYakuManifest(await response.json());
                await SystemSetting.findOneAndUpdate(
                    { key: SETTING_KEY },
                    { value: release },
                    { upsert: true, new: true }
                );
            }
        } catch (fetchError) {
            console.error('Failed to fetch VietYaku release metadata from B2:', fetchError.message);
        }

        if (release) {
            return res.json({ success: true, message: 'OK', data: release });
        }

        // CDN unreachable → serve the last manifest we cached
        const setting = await SystemSetting.findOne({ key: SETTING_KEY });
        if (setting && setting.value) {
            return res.json({ success: true, message: 'OK', data: setting.value });
        }

        return res.json({
            success: true,
            message: 'OK',
            data: {
                version: FALLBACK_VERSION,
                windowsZipUrl: windowsZipUrl(FALLBACK_VERSION),
                releaseNotes: '',
                releaseUrl: GITHUB_RELEASES_URL,
                publishedAt: new Date().toISOString(),
            },
        });
    } catch (error) {
        console.error('Error fetching latest VietYaku release:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi lấy thông tin bản phát hành VietYaku mới nhất'
        });
    }
});

export default router;
