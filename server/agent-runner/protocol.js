function stripFences(text) {
    return String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
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
    } catch (error) {
        return { ok: false, error: `Invalid JSON: ${error.message}` };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'AI turn must be a JSON object.' };
    if (typeof value.thought !== 'string' || !value.thought.trim()) return { ok: false, error: 'thought must be a non-empty string.' };
    if (typeof value.tool !== 'string' || !value.tool.trim()) return { ok: false, error: 'tool must be a non-empty string.' };
    if (!value.args || typeof value.args !== 'object' || Array.isArray(value.args)) return { ok: false, error: 'args must be an object.' };
    return { ok: true, value: { thought: value.thought.trim(), tool: value.tool.trim(), args: value.args } };
}
