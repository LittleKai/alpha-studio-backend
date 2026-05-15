import SystemSetting from '../models/SystemSetting.js';

/**
 * Tất cả hàm `call*` trả về { text, usage, model } để caller log/save token info.
 * - usage: null nếu provider không expose (vd OpenClaw gateway).
 * - model: model thực tế đã dùng (echo từ response hoặc fallback).
 */

// ─── gcli multi-key pool with weighted random selection ────────────────────
// Env format: `GCLI_API_KEY=key1:weight1,key2:weight2,key3` (weight default = 1)
// Backward compat: a single key without weight still works.
// Cached by raw env string so reloading env in dev is detected automatically.
let _gcliKeysRaw = null;
let _gcliKeysCache = null;

function parseGcliKeys(raw) {
    if (!raw || typeof raw !== 'string') return [];
    return raw.split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const colonIdx = part.lastIndexOf(':');
            if (colonIdx > 0) {
                const maybeKey = part.slice(0, colonIdx).trim();
                const maybeWeight = Number(part.slice(colonIdx + 1).trim());
                if (Number.isFinite(maybeWeight) && maybeWeight > 0 && maybeKey) {
                    return { key: maybeKey, weight: maybeWeight };
                }
            }
            return { key: part, weight: 1 };
        })
        .filter((k) => k.key);
}

function getGcliKeys() {
    const raw = process.env.GCLI_API_KEY || process.env.GCLI_DIRECT_TOKEN || '';
    if (raw === _gcliKeysRaw && _gcliKeysCache !== null) return _gcliKeysCache;
    _gcliKeysRaw = raw;
    _gcliKeysCache = parseGcliKeys(raw);
    return _gcliKeysCache;
}

function pickGcliKey() {
    const keys = getGcliKeys();
    if (keys.length === 0) return null;
    if (keys.length === 1) return keys[0].key;
    const totalWeight = keys.reduce((sum, k) => sum + k.weight, 0);
    let r = Math.random() * totalWeight;
    for (const k of keys) {
        r -= k.weight;
        if (r <= 0) return k.key;
    }
    return keys[keys.length - 1].key;
}

function maskKey(key) {
    if (!key || key.length < 8) return '****';
    return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

// Gemini qua gcli upstream KHÔNG tự fetch HTTPS URL — bắt buộc base64 data URL.
// Flash sẽ hallucinate plausibly (prompt_tokens ≈ 11) khi không có ảnh, Pro thì
// báo thẳng "không có ảnh". Vì vậy mọi URL phải được fetch + encode trước khi gửi.
async function fetchImageAsDataUrl(url) {
    if (typeof url !== 'string') throw new Error('Invalid image URL.');
    if (url.startsWith('data:')) return url; // Đã là data URL → pass through.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
    const contentType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new Error('Image fetch returned empty body.');
    return `data:${contentType};base64,${buffer.toString('base64')}`;
}

export async function callOpenClaw(content, sessionId) {
    const openClawUrl = process.env.OPENCLAW_URL || 'http://localhost:18791/api/chat';
    const proxyResponse = await fetch(openClawUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: [{ role: 'user', content }],
            sessionId
        })
    });

    const raw = await proxyResponse.text();
    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error(`OpenClaw trả về phản hồi không hợp lệ (mã ${proxyResponse.status}).`);
    }

    if (!proxyResponse.ok || !data.success) {
        throw new Error(data.message || `OpenClaw lỗi (mã ${proxyResponse.status}).`);
    }

    const text = data.data?.text || data.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('Trợ lý AI trả về phản hồi rỗng.');
    return { text, usage: null, model: data.model || null };
}

/**
 * Gọi thẳng gcli upstream (https://gcli.ggchan.dev) — KHÔNG qua local proxy 18790, KHÔNG qua OpenClaw 18791.
 * @param {string} content - Prompt text
 * @param {object} [options]
 * @param {string} [options.model] - Override model (e.g., 'gemini-3.1-pro-preview').
 * @param {string[]} [options.images] - Image URLs hoặc data URLs để gửi kèm (multimodal).
 *                                       Format chuẩn OpenAI: { type: 'image_url', image_url: { url } }
 */
export async function callGcliDirect(content, options = {}) {
    const url = process.env.GCLI_DIRECT_URL || 'https://gcli.ggchan.dev/v1/chat/completions';
    const model = options.model || process.env.GCLI_DIRECT_MODEL || 'gemini-3.1-flash-lite';
    // Pool nhiều key với weighted random — xem parseGcliKeys() ở đầu file.
    const token = pickGcliKey();
    if (!token) {
        throw new Error('Thiếu GCLI_API_KEY trong env backend.');
    }

    const images = Array.isArray(options.images) ? options.images.filter(Boolean) : [];
    // Fetch + encode mỗi URL → data URL. Nếu fetch fail thì giữ URL gốc (AI sẽ
    // hallucinate, nhưng request vẫn pass — không crash toàn bộ flow).
    const encodedImages = await Promise.all(images.map(async (imgUrl) => {
        try {
            return await fetchImageAsDataUrl(imgUrl);
        } catch (err) {
            console.warn(`[gcli] fetchImageAsDataUrl failed for ${imgUrl.slice(0, 80)}...: ${err.message}`);
            return imgUrl;
        }
    }));
    const userContent = encodedImages.length > 0
        ? [
            { type: 'text', text: content },
            ...encodedImages.map((url) => ({ type: 'image_url', image_url: { url } }))
        ]
        : content;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: userContent }]
        })
    });

    const raw = await response.text();
    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error(`gcli trả về phản hồi không hợp lệ (mã ${response.status}).`);
    }

    if (!response.ok) {
        throw new Error(data.error?.message || data.message || `gcli lỗi (mã ${response.status}).`);
    }

    const text = data.choices?.[0]?.message?.content || data.data?.text || '';
    if (!text) throw new Error('Trợ lý AI trả về phản hồi rỗng.');

    const usage = data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? null,
            completionTokens: data.usage.completion_tokens ?? null,
            totalTokens: data.usage.total_tokens ?? null
        }
        : null;

    if (usage) {
        const keyCount = getGcliKeys().length;
        const keyTag = keyCount > 1 ? ` key=${maskKey(token)} (pool=${keyCount})` : '';
        console.log(`[gcli] model=${model}${keyTag} tokens: prompt=${usage.promptTokens} completion=${usage.completionTokens} total=${usage.totalTokens}`);
    }

    return { text, usage, model: data.model || model };
}

export async function shouldUseOpenClawForChat() {
    const setting = await SystemSetting.findOne({ key: 'useOpenClawForChat' }).lean();
    if (setting?.value === undefined) return true;
    return setting.value !== false && setting.value !== 'false';
}

export async function getGcliBotModel() {
    const setting = await SystemSetting.findOne({ key: 'gcliBotModel' }).lean();
    return setting?.value || process.env.GCLI_DIRECT_MODEL || 'gemini-3.1-flash-lite';
}

export async function callConfiguredAiProvider(content, sessionId) {
    const useOpenClaw = await shouldUseOpenClawForChat();
    if (useOpenClaw) return callOpenClaw(content, sessionId);
    const model = await getGcliBotModel();
    return callGcliDirect(content, { model });
}
