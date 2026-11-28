/**
 * Resolve Express `trust proxy` setting safely for Fly.io / reverse-proxy deployments.
 * Uses an explicit hop count (`1`) instead of `true` so `express-rate-limit`
 * honors `X-Forwarded-For` without triggering `ERR_ERL_PERMISSIVE_TRUST_PROXY`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number | string | boolean}
 */
export function resolveTrustProxy(env = process.env) {
    const raw = typeof env?.TRUST_PROXY === 'string' ? env.TRUST_PROXY.trim() : '';
    if (raw) {
        const lower = raw.toLowerCase();
        if (lower === 'false' || lower === '0') return false;
        if (lower === 'true') return 1;
        if (/^\d+$/.test(raw)) {
            const hops = Number(raw);
            return hops > 0 ? hops : false;
        }
        return raw;
    }

    if (Boolean(env?.FLY_APP_NAME) || env?.NODE_ENV === 'production') {
        return 1;
    }
    return false;
}
