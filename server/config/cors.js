const DEFAULT_ALLOWED_ORIGINS = [
    'null',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:3002',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3002',
    'http://127.0.0.1:5173',
    'https://alphastudio.vercel.app',
    'https://giaiphapsangtao.com',
    'https://www.giaiphapsangtao.com'
];

function normalizeOrigin(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (raw === 'null') return 'null';

    try {
        return new URL(raw).origin;
    } catch {
        return raw.replace(/\/+$/, '');
    }
}

function splitOrigins(value) {
    return String(value || '')
        .split(/[\s,]+/)
        .map(normalizeOrigin)
        .filter(Boolean);
}

export function buildAllowedOrigins(env = process.env) {
    const origins = new Set(DEFAULT_ALLOWED_ORIGINS.map(normalizeOrigin));

    for (const key of ['FRONTEND_URL', 'FRONTEND_URL_PROD', 'FRONTEND_URLS', 'CORS_ORIGINS']) {
        for (const origin of splitOrigins(env[key])) {
            origins.add(origin);
        }
    }

    return Array.from(origins);
}

export function buildCorsOptions(env = process.env) {
    const allowedOrigins = buildAllowedOrigins(env);

    return {
        origin: function(origin, callback) {
            // Allow requests with no origin (mobile apps, curl, etc.) and
            // Origin: null from local file:// workshop pages.
            if (!origin) return callback(null, true);

            if (origin === 'null' || allowedOrigins.includes(normalizeOrigin(origin))) {
                return callback(null, true);
            }

            console.warn('CORS blocked origin:', origin);
            return callback(null, false);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Agent-Device-Id',
            'X-Agent-Secret'
        ]
    };
}
