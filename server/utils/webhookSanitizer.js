const SENSITIVE_KEY = /authorization|cookie|token|secret|password|signature|api[-_]?key/i;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 4000;
const MAX_TOTAL_LENGTH = 16_000;

function sanitizeValue(value, key, depth) {
    if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
        return value.length > MAX_STRING_LENGTH
            ? `${value.slice(0, MAX_STRING_LENGTH)}[TRUNCATED]`
            : value;
    }
    if (typeof value !== 'object') return value;
    if (depth >= MAX_DEPTH) return '[TRUNCATED]';
    if (Array.isArray(value)) {
        return value
            .slice(0, MAX_ARRAY_ITEMS)
            .map((item) => sanitizeValue(item, '', depth + 1));
    }

    return Object.fromEntries(
        Object.entries(value).map(([childKey, childValue]) => [
            childKey,
            sanitizeValue(childValue, childKey, depth + 1)
        ])
    );
}

function boundTotalSize(value) {
    const serialized = JSON.stringify(value);
    if (serialized.length <= MAX_TOTAL_LENGTH) return value;
    return {
        truncated: true,
        preview: serialized.slice(0, MAX_TOTAL_LENGTH)
    };
}

export function sanitizeWebhook({ headers = {}, payload = {} }) {
    return {
        headers: boundTotalSize(sanitizeValue(headers, '', 0)),
        payload: boundTotalSize(sanitizeValue(payload, '', 0))
    };
}
