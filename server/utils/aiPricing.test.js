import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AI_ALLOWED_MODELS,
    AI_MIN_CHARGE_CREDITS,
    AI_TOKEN_MODEL_PRICING,
    calculateAiTokenCredits,
    normalizeAiModel
} from './aiPricing.js';

test('AI pricing allows only flash-lite and 3.8-flash and removes pro/3.5-flash', () => {
    assert.deepEqual(AI_ALLOWED_MODELS, ['gemini-3.1-flash-lite', 'gemini-3.8-flash']);
    assert.equal(normalizeAiModel('gemini-3.1-pro'), 'gemini-3.8-flash');
    assert.equal(normalizeAiModel('gemini-3.5-flash'), 'gemini-3.8-flash');
    assert.equal(normalizeAiModel('gemini-3-flash'), 'gemini-3.1-flash-lite');
    assert.equal(normalizeAiModel('gemini-2.5-flash'), 'gemini-3.1-flash-lite');
    assert.equal(normalizeAiModel('gemini-3.8-flash-high'), 'gemini-3.8-flash');

    assert.equal(AI_TOKEN_MODEL_PRICING['gemini-3.1-flash-lite'].inputCreditsPerMillion, 13);
    assert.equal(AI_TOKEN_MODEL_PRICING['gemini-3.1-flash-lite'].outputCreditsPerMillion, 51);
    assert.equal(AI_TOKEN_MODEL_PRICING['gemini-3.1-flash-lite'].officialReference.discountRatio, '1/2');

    assert.equal(AI_TOKEN_MODEL_PRICING['gemini-3.8-flash'].inputCreditsPerMillion, 38);
    assert.equal(AI_TOKEN_MODEL_PRICING['gemini-3.8-flash'].outputCreditsPerMillion, 318);
    assert.equal(AI_TOKEN_MODEL_PRICING['gemini-3.8-flash'].officialReference.discountRatio, '1/2');

    const liteBill = calculateAiTokenCredits(
        { promptTokens: 1_000_000, completionTokens: 1_000_000 },
        { model: 'gemini-3.1-flash-lite' }
    );
    assert.equal(liteBill.credits, 64);

    const flashBill = calculateAiTokenCredits(
        { promptTokens: 1_000_000, completionTokens: 1_000_000 },
        { model: 'gemini-3.8-flash' }
    );
    assert.equal(flashBill.credits, 356);

    const tinyBill = calculateAiTokenCredits(
        { promptTokens: 10, completionTokens: 5 },
        { model: 'gemini-3.1-flash-lite' }
    );
    assert.equal(tinyBill.credits, AI_MIN_CHARGE_CREDITS);

    const byokBill = calculateAiTokenCredits(
        { promptTokens: 5000, completionTokens: 1000 },
        { model: 'gemini-3.8-flash', byok: true }
    );
    assert.equal(byokBill.credits, 0);
});
