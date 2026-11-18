/**
 * Alpha Studio — Unified AI Model Catalog & Token-based Credit Pricing (1/2 Official Gemini Price)
 * System currency: 1 Credit = 100 VNĐ. BYOK = 0 Credit.
 */

export const CREDIT_UNIT_VND = 100;
export const AI_MIN_CHARGE_CREDITS = 0.01;

export const AI_DEFAULT_CHATBOT_MODEL = 'gemini-3.1-flash-lite';
export const AI_DEFAULT_BALANCED_MODEL = 'gemini-3.8-flash';
export const AI_ALLOWED_MODELS = Object.freeze([
    'gemini-3.1-flash-lite',
    'gemini-3.8-flash'
]);

/**
 * 1/2 giá niêm yết chính thức ($1 ≈ 25.400đ, 1 Credit = 100đ):
 * - gemini-3.1-flash-lite (gốc $0.10 In / $0.40 Out ≈ 25.4 / 101.6 Credits) -> 1/2 = 13 In / 51 Out Credits / 1M tokens
 * - gemini-3.8-flash      (gốc $0.30 In / $2.50 Out ≈ 76.2 / 635 Credits)   -> 1/2 = 38 In / 318 Out Credits / 1M tokens
 */
export const AI_TOKEN_MODEL_PRICING = Object.freeze({
    'gemini-3.1-flash-lite': Object.freeze({
        id: 'gemini-3.1-flash-lite',
        label: 'Gemini 3.1 Flash Lite',
        inputCreditsPerMillion: 13,
        outputCreditsPerMillion: 51,
        minChargeCredits: AI_MIN_CHARGE_CREDITS,
        officialReference: Object.freeze({
            inputCreditsPerMillion: 25.4,
            outputCreditsPerMillion: 101.6,
            discountRatio: '1/2'
        })
    }),
    'gemini-3.8-flash': Object.freeze({
        id: 'gemini-3.8-flash',
        label: 'Gemini 3.8 Flash',
        inputCreditsPerMillion: 38,
        outputCreditsPerMillion: 318,
        minChargeCredits: AI_MIN_CHARGE_CREDITS,
        officialReference: Object.freeze({
            inputCreditsPerMillion: 76.2,
            outputCreditsPerMillion: 635,
            discountRatio: '1/2'
        })
    })
});

const LEGACY_BALANCED_MODELS = new Set([
    'gemini-3.8-flash-low',
    'gemini-3.8-flash-medium',
    'gemini-3.8-flash-high',
    'gemini-3.1-pro',
    'gemini-3.1-pro-preview',
    'gemini-3.5-flash',
    'gemini-2.5-pro',
    'pro'
]);

const LEGACY_LITE_MODELS = new Set([
    'gemini-3-flash',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'flash'
]);

export function roundCredits(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.round(num * 10000) / 10000;
}

export function normalizeAiModel(value, fallback = AI_DEFAULT_CHATBOT_MODEL) {
    const clean = String(value || '').trim();
    if (AI_ALLOWED_MODELS.includes(clean)) {
        return clean;
    }
    if (LEGACY_BALANCED_MODELS.has(clean)) {
        return AI_DEFAULT_BALANCED_MODEL;
    }
    if (LEGACY_LITE_MODELS.has(clean)) {
        return AI_DEFAULT_CHATBOT_MODEL;
    }
    return AI_ALLOWED_MODELS.includes(fallback) ? fallback : AI_DEFAULT_CHATBOT_MODEL;
}

export function getAiModelTokenPricing(model) {
    const normalized = normalizeAiModel(model, AI_DEFAULT_BALANCED_MODEL);
    return AI_TOKEN_MODEL_PRICING[normalized] || AI_TOKEN_MODEL_PRICING[AI_DEFAULT_BALANCED_MODEL];
}

export function calculateAiTokenCredits(usage = {}, options = {}) {
    const model = normalizeAiModel(options.model, options.fallbackModel || AI_DEFAULT_BALANCED_MODEL);
    const pricing = getAiModelTokenPricing(model);

    if (options.byok === true) {
        const promptTokens = Math.max(0, Number(usage?.promptTokens) || 0);
        const completionTokens = Math.max(0, Number(usage?.completionTokens) || 0);
        const totalTokens = Math.max(promptTokens + completionTokens, Number(usage?.totalTokens) || 0);
        return {
            credits: 0,
            totalCredits: 0,
            vndEquivalent: 0,
            promptTokens,
            completionTokens,
            totalTokens,
            model,
            pricing,
            byok: true
        };
    }

    const promptTokens = Math.max(0, Number(usage?.promptTokens) || 0);
    const completionTokens = Math.max(0, Number(usage?.completionTokens) || 0);
    const totalTokens = Math.max(promptTokens + completionTokens, Number(usage?.totalTokens) || 0);

    const fallbackPrompt = Math.max(0, Number(options.fallbackPromptTokens) || 0);
    const fallbackCompletion = Math.max(0, Number(options.fallbackCompletionTokens) || 0);

    const effPrompt = promptTokens > 0 ? promptTokens : fallbackPrompt;
    const effCompletion = completionTokens > 0 ? completionTokens : fallbackCompletion;

    const rawCredits = (
        effPrompt * pricing.inputCreditsPerMillion +
        effCompletion * pricing.outputCreditsPerMillion
    ) / 1_000_000;

    const minCharge = Number.isFinite(Number(options.minChargeCredits))
        ? Number(options.minChargeCredits)
        : pricing.minChargeCredits;

    const credits = Math.max(minCharge, roundCredits(rawCredits));

    return {
        credits,
        totalCredits: credits,
        vndEquivalent: Math.round(credits * CREDIT_UNIT_VND),
        promptTokens: effPrompt,
        completionTokens: effCompletion,
        totalTokens: totalTokens || (effPrompt + effCompletion),
        model,
        pricing,
        byok: false
    };
}
