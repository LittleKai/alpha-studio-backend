function positiveInt(env, name, fallback, { allowZero = false } = {}) {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;

    const value = Number.parseInt(raw, 10);
    const minimum = allowZero ? 0 : 1;
    if (!Number.isInteger(value) || value < minimum) {
        throw new Error(`${name} must be ${allowZero ? 'zero or ' : ''}a positive integer`);
    }
    return value;
}

export function buildMongoOptions(env = process.env) {
    const maxPoolSize = positiveInt(env, 'MONGODB_MAX_POOL_SIZE', 5);
    const minPoolSize = positiveInt(env, 'MONGODB_MIN_POOL_SIZE', 0, { allowZero: true });

    if (minPoolSize > maxPoolSize) {
        throw new Error('MONGODB_MIN_POOL_SIZE cannot exceed MONGODB_MAX_POOL_SIZE');
    }

    return {
        autoIndex: false,
        maxPoolSize,
        minPoolSize,
        serverSelectionTimeoutMS: positiveInt(env, 'MONGODB_SERVER_SELECTION_TIMEOUT_MS', 5000),
        socketTimeoutMS: positiveInt(env, 'MONGODB_SOCKET_TIMEOUT_MS', 45000),
        maxIdleTimeMS: positiveInt(env, 'MONGODB_MAX_IDLE_TIME_MS', 60000)
    };
}
