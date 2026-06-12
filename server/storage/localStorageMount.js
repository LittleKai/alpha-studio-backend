export function localStorageMount(env = process.env) {
    if ((env.STORAGE_PROVIDER || 'b2') !== 'local') return null;

    let route = '/storage';
    if (env.LOCAL_STORAGE_PUBLIC_URL) {
        try {
            route = new URL(env.LOCAL_STORAGE_PUBLIC_URL).pathname.replace(/\/+$/, '') || '/storage';
        } catch {
            route = '/storage';
        }
    }
    return {
        route,
        root: env.LOCAL_STORAGE_ROOT || './.data/storage'
    };
}
