const MEDIA_PATH_PATTERN = /(url|key|file|image|audio|video|avatar|thumbnail|attachment|media|background)/i;
const DATA_URL_PATTERN = /^data:[^;,]+(?:;[^;,=]+=[^;,]+)*;base64,/i;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64_MIN_LENGTH = 16 * 1024;
const MAX_DEPTH = 40;

export class InlineMediaError extends Error {
    constructor(path) {
        super(`Inline file/media is not allowed at ${path || '<root>'}`);
        this.name = 'InlineMediaError';
        this.code = 'INLINE_MEDIA_NOT_ALLOWED';
        this.path = path || '<root>';
    }
}

function isBinary(value) {
    return Buffer.isBuffer(value)
        || value instanceof Uint8Array
        || value?._bsontype === 'Binary';
}

function looksLikeInlineBase64(value, path) {
    if (DATA_URL_PATTERN.test(value)) return true;
    if (!MEDIA_PATH_PATTERN.test(path) || value.length < BASE64_MIN_LENGTH) return false;
    const compact = value.replace(/\s+/g, '');
    return compact.length >= BASE64_MIN_LENGTH
        && compact.length % 4 === 0
        && BASE64_PATTERN.test(compact);
}

export function assertNoInlineMedia(value, {
    path = '',
    depth = 0,
    seen = new WeakSet()
} = {}) {
    if (value === null || value === undefined) return;
    if (value instanceof Date) return;
    if (
        value.constructor?.name === 'ObjectId' ||
        value.constructor?.name === 'ObjectID' ||
        (value._bsontype && value._bsontype !== 'Binary')
    ) {
        return;
    }
    if (isBinary(value)) throw new InlineMediaError(path);
    if (typeof value === 'string') {
        if (looksLikeInlineBase64(value, path)) throw new InlineMediaError(path);
        return;
    }
    if (typeof value !== 'object' || depth >= MAX_DEPTH) return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            const itemPath = path ? `${path}.${index}` : String(index);
            assertNoInlineMedia(item, {
                path: itemPath,
                depth: depth + 1,
                seen
            });
        });
        return;
    }

    for (const [key, child] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        assertNoInlineMedia(child, {
            path: childPath,
            depth: depth + 1,
            seen
        });
    }
}

export function noInlineMediaPlugin(schema) {
    schema.pre('validate', function validateInlineMedia() {
        assertNoInlineMedia(this.toObject({
            depopulate: true,
            virtuals: false,
            transform: false
        }));
    });

    schema.pre(
        ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'],
        function validateInlineMediaUpdate() {
            assertNoInlineMedia(this.getUpdate());
        }
    );
}
