const DEFAULT_CDN = 'https://download.giaiphapsangtao.com/file/alpha-studio';
const RAW_B2_BASE = 'https://f004.backblazeb2.com/file/alpha-studio';
const FALLBACK_VERSION = '0.4.0';
const FALLBACK_PUBLISHED_AT = '2026-11-18T20:00:18.805Z';
const DEFAULT_MEMO_TTL_MS = 60_000;

// Per-CDN in-memory memo to avoid hitting B2 origin and MongoDB on every public page view.
const releaseMemoByCdn = new Map();
const persistedFingerprintByCdn = new Map();

export function resetCrmReleaseMemo() {
    releaseMemoByCdn.clear();
    persistedFingerprintByCdn.clear();
}

export function resolveCdnBase(cdnBase) {
    return String(cdnBase || process.env.CDN_BASE_URL || DEFAULT_CDN).replace(/\/+$/, '');
}

export function toCrmCdnUrl(url, cdnBase) {
    if (!url || typeof url !== 'string') return url;
    const cdn = resolveCdnBase(cdnBase);
    return url.replace(RAW_B2_BASE, cdn);
}

function findAsset(assets, predicate) {
    if (!Array.isArray(assets)) return undefined;
    return assets.find((asset) => asset && typeof asset.name === 'string' && predicate(asset.name.toLowerCase()));
}

function hasValidManifestVersion(manifest) {
    if (!manifest || typeof manifest !== 'object') return false;
    const raw = String(manifest.version || manifest.tag_name || '').trim();
    return raw.length > 0;
}

function releaseFingerprint(release) {
    if (!release || typeof release !== 'object') return '';
    return [
        release.version || '',
        release.windowsInstallerUrl || '',
        release.androidApkUrl || '',
        release.publishedAt || '',
    ].join('|');
}

export function parseCrmManifest(manifest, cdnBase) {
    const cdn = resolveCdnBase(cdnBase);
    const raw = manifest && typeof manifest === 'object' ? manifest : {};
    const rawVersion = String(raw.version || raw.tag_name || FALLBACK_VERSION).trim();
    const version = rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;

    const topAssets = Array.isArray(raw.assets) ? raw.assets : [];
    const winPlatformAssets = Array.isArray(raw.platform_releases?.windows?.assets)
        ? raw.platform_releases.windows.assets
        : [];
    const androidPlatformAssets = Array.isArray(raw.platform_releases?.android?.assets)
        ? raw.platform_releases.android.assets
        : [];

    const isWindowsName = (name) => name.endsWith('.zip') || name.endsWith('.exe') || name.endsWith('.msix');
    const isAndroidName = (name) => name.endsWith('.apk');

    const windowsAsset = findAsset(topAssets, isWindowsName) || findAsset(winPlatformAssets, isWindowsName);
    const androidAsset = findAsset(topAssets, isAndroidName) || findAsset(androidPlatformAssets, isAndroidName);

    return {
        version,
        windowsInstallerUrl: windowsAsset?.browser_download_url
            ? toCrmCdnUrl(windowsAsset.browser_download_url, cdn)
            : `${cdn}/crm-app/releases/alpha-crm-windows-v${version}.zip`,
        windowsSize: windowsAsset?.size,
        androidApkUrl: androidAsset?.browser_download_url
            ? toCrmCdnUrl(androidAsset.browser_download_url, cdn)
            : `${cdn}/crm-app/releases/alpha-crm-v${version}.apk`,
        androidSize: androidAsset?.size,
        releaseNotes: raw.body || 'Bản phát hành chính thức Alpha CRM',
        releaseUrl: raw.html_url || undefined,
        sha256: raw.sha256 || undefined,
        publishedAt: raw.published_at || FALLBACK_PUBLISHED_AT,
    };
}

export function normalizeCachedCrmRelease(cachedValue, cdnBase) {
    if (!cachedValue || typeof cachedValue !== 'object') return null;
    const val = { ...cachedValue };
    if (val.windowsInstallerUrl) val.windowsInstallerUrl = toCrmCdnUrl(val.windowsInstallerUrl, cdnBase);
    if (val.androidApkUrl) val.androidApkUrl = toCrmCdnUrl(val.androidApkUrl, cdnBase);
    return val;
}

/**
 * Resolve the latest Alpha CRM release metadata.
 *
 * B2 `crm-app/version.json` is the source of truth (updated by release scripts),
 * fetched with an edge cache-buster and memoized in memory for `ttlMs` (default 60s)
 * to prevent per-request origin & DB write amplification on the public endpoint.
 * `SystemSetting` (`crm_latest_release`) is updated only when the resolved release
 * fingerprint changes and is used strictly as an offline fallback when CDN fails
 * or returns a malformed manifest without version/tag_name.
 */
export async function resolveCrmLatestRelease({
    cdnBase,
    fetchImpl = fetch,
    getCachedSetting,
    saveCachedSetting,
    now = Date.now,
    ttlMs = DEFAULT_MEMO_TTL_MS,
    logger = console,
} = {}) {
    const cdn = resolveCdnBase(cdnBase);
    const currentMs = now();

    if (ttlMs > 0) {
        const memo = releaseMemoByCdn.get(cdn);
        if (memo && currentMs - memo.at < ttlMs) {
            return memo.value;
        }
    }

    const manifestUrl = `${cdn}/crm-app/version.json?t=${currentMs}`;

    try {
        const response = await fetchImpl(manifestUrl, {
            cache: 'no-store',
            signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
        });
        if (response.ok) {
            const rawManifest = await response.json();
            if (hasValidManifestVersion(rawManifest)) {
                const parsed = parseCrmManifest(rawManifest, cdn);
                if (ttlMs > 0) {
                    releaseMemoByCdn.set(cdn, { value: parsed, at: currentMs });
                }
                const nextFp = releaseFingerprint(parsed);
                if (typeof saveCachedSetting === 'function' && persistedFingerprintByCdn.get(cdn) !== nextFp) {
                    try {
                        await saveCachedSetting(parsed);
                        persistedFingerprintByCdn.set(cdn, nextFp);
                    } catch (cacheErr) {
                        logger.error('Failed to cache CRM release metadata:', cacheErr.message);
                    }
                }
                return parsed;
            }
            logger.error('Ignoring malformed CRM manifest without version/tag_name');
        }
    } catch (fetchError) {
        logger.error('Failed to fetch CRM release metadata from Backblaze B2:', fetchError.message);
    }

    if (typeof getCachedSetting === 'function') {
        try {
            const cached = normalizeCachedCrmRelease(await getCachedSetting(), cdn);
            if (cached) return cached;
        } catch (dbErr) {
            logger.error('Failed to read cached CRM release metadata from DB:', dbErr.message);
        }
    }

    return parseCrmManifest(null, cdn);
}
