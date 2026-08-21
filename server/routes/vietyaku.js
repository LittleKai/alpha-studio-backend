import express from 'express';
import SystemSetting from '../models/SystemSetting.js';

const router = express.Router();

const SETTING_KEY = 'vietyaku_latest_release';
const FALLBACK_VERSION = '1.1.0';

const GITHUB_RELEASES_URL = 'https://github.com/LittleKai/VietYaku/releases';

// Lazy: dotenv.config() in index.js runs before any request but AFTER ES module
// imports, so reading process.env at module level would capture undefined.
function baseUrl() {
    const cdn = (process.env.CDN_BASE_URL || 'https://f004.backblazeb2.com/file/alpha-studio').replace(/\/+$/, '');
    return `${cdn}/vietyaku-app`;
}

function manifestUrl() {
    return `${baseUrl()}/version.json`;
}

function windowsZipUrl(version) {
    return `${baseUrl()}/releases/VietYaku-windows-x64-v${version}.zip`;
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

    const androidAsset = assets.find((asset) => {
        const name = (asset.name || '').toLowerCase();
        return name.includes('android') && name.endsWith('.apk');
    }) || assets.find((asset) => (asset.name || '').toLowerCase().endsWith('.apk'));

    return {
        version,
        windowsZipUrl: windowsAsset?.browser_download_url || windowsZipUrl(version),
        windowsSize: windowsAsset?.size,
        androidApkUrl: androidAsset?.browser_download_url,
        androidSize: androidAsset?.size,
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
            // Cache-bust at the edge: version.json is overwritten in place on every
            // release, so a cached copy (positive or negative) pins this endpoint to a
            // stale answer. `cache: 'no-store'` only covers Node's own cache, not the CDN.
            const response = await fetch(`${manifestUrl()}?t=${Date.now()}`, { cache: 'no-store' });
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
