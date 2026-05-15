import SystemSetting from '../models/SystemSetting.js';

/**
 * Tất cả hàm `call*` trả về { text, usage, model } để caller log/save token info.
 * - usage: null nếu provider không expose (vd OpenClaw gateway).
 * - model: model thực tế đã dùng (echo từ response hoặc fallback).
 */

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
    // Đọc GCLI_API_KEY trước, fallback GCLI_DIRECT_TOKEN cho compat.
    const token = process.env.GCLI_API_KEY || process.env.GCLI_DIRECT_TOKEN;
    if (!token) {
        throw new Error('Thiếu GCLI_API_KEY trong env backend.');
    }

    const images = Array.isArray(options.images) ? options.images.filter(Boolean) : [];
    const userContent = images.length > 0
        ? [
            { type: 'text', text: content },
            ...images.map((imgUrl) => ({ type: 'image_url', image_url: { url: imgUrl } }))
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
        console.log(`[gcli] model=${model} tokens: prompt=${usage.promptTokens} completion=${usage.completionTokens} total=${usage.totalTokens}`);
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
