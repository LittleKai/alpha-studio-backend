/**
 * Shared view-counting cooldown helpers so rapid page refreshes or StrictMode
 * double-mounts do not inflate view counters.
 */
export const VIEW_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const VIEW_STORE_MAX = 5000;

const defaultStore = new Map();

/**
 * Build a viewer key scoped to user ID when authenticated, otherwise client IP.
 * Reads `x-forwarded-for` first because `trust proxy` is not enabled on the app.
 */
export function viewerKey(req, resourceKey) {
    if (req.user?._id) return `${String(req.user._id)}:${resourceKey}`;
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return `${forwarded || req.ip || 'unknown'}:${resourceKey}`;
}

/**
 * Return `true` when this view should be counted and record the timestamp.
 */
export function shouldCountView(key, now = Date.now(), store = defaultStore) {
    const last = store.get(key);
    if (last !== undefined && now - last < VIEW_COOLDOWN_MS) return false;
    store.set(key, now);
    if (store.size > VIEW_STORE_MAX) {
        for (const [k, ts] of store) {
            if (now - ts >= VIEW_COOLDOWN_MS) store.delete(k);
        }
        for (const k of store.keys()) {
            if (store.size <= VIEW_STORE_MAX) break;
            store.delete(k);
        }
    }
    return true;
}
