function stripFences(text) {
    return String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

// AI sometimes emits raw newlines / tabs / control characters inside JSON
// string literals (e.g. `{"reply":"line1\nline2"}` with a real newline byte
// rather than the escape sequence `\n`). Strict JSON.parse rejects these with
// "Bad control character in string literal". This pass walks the text in a
// minimal state machine, escapes control chars only when we know we are inside
// a string literal, and leaves the rest untouched. This is forgiving enough to
// recover the majority of AI mistakes without changing legitimate payload.
function sanitizeControlChars(jsonText) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < jsonText.length; i += 1) {
        const ch = jsonText[i];
        const code = ch.charCodeAt(0);
        if (inString) {
            if (escaped) {
                escaped = false;
                out += ch;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                out += ch;
                continue;
            }
            if (ch === '"') {
                inString = false;
                out += ch;
                continue;
            }
            if (ch === '\n') { out += '\\n'; continue; }
            if (ch === '\r') { out += '\\r'; continue; }
            if (ch === '\t') { out += '\\t'; continue; }
            if (ch === '\b') { out += '\\b'; continue; }
            if (ch === '\f') { out += '\\f'; continue; }
            if (code < 0x20) {
                out += `\\u${code.toString(16).padStart(4, '0')}`;
                continue;
            }
            out += ch;
        } else {
            if (ch === '"') {
                inString = true;
            }
            out += ch;
        }
    }
    return out;
}

function findBalancedJson(text) {
    const start = text.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

export function parseAiTurn(rawText) {
    const text = stripFences(rawText);
    const jsonText = findBalancedJson(text);
    if (!jsonText) return { ok: false, error: 'No balanced JSON object found.' };
    let value;
    try {
        value = JSON.parse(jsonText);
    } catch (firstError) {
        // Fallback: AI commonly emits unescaped newlines/tabs inside string
        // literals (e.g. the `reply` arg of model.commit). Try once more after
        // escaping control characters in-string.
        try {
            value = JSON.parse(sanitizeControlChars(jsonText));
        } catch (secondError) {
            return { ok: false, error: `Invalid JSON: ${firstError.message}` };
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'AI turn must be a JSON object.' };
    if (typeof value.thought !== 'string' || !value.thought.trim()) return { ok: false, error: 'thought must be a non-empty string.' };
    if (typeof value.tool !== 'string' || !value.tool.trim()) return { ok: false, error: 'tool must be a non-empty string.' };
    if (!value.args || typeof value.args !== 'object' || Array.isArray(value.args)) return { ok: false, error: 'args must be an object.' };
    return { ok: true, value: { thought: value.thought.trim(), tool: value.tool.trim(), args: value.args } };
}
