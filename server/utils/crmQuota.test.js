import test from 'node:test';
import assert from 'node:assert';
import { hasQuota, consumeQuota, refundQuota } from './crmQuota.js';

test('CRM Quota Utilities', (t) => {
    // 1. Test inactive subscription has no quota
    const inactiveSub = {
        status: 'expired',
        includedAiLimit: 500,
        includedAiUsed: 0,
        extraAiRemaining: 100
    };
    assert.strictEqual(hasQuota(inactiveSub), false);
    assert.strictEqual(consumeQuota(inactiveSub), 'none');

    // 2. Test active subscription with remaining included quota
    const activeSub = {
        status: 'active',
        includedAiLimit: 10,
        includedAiUsed: 5,
        extraAiRemaining: 0
    };
    assert.strictEqual(hasQuota(activeSub), true);
    assert.strictEqual(consumeQuota(activeSub), 'included');
    assert.strictEqual(activeSub.includedAiUsed, 6);

    // 3. Test active subscription exhausting included quota and consuming extra quota
    const exhaustedIncludedSub = {
        status: 'active',
        includedAiLimit: 10,
        includedAiUsed: 10,
        extraAiRemaining: 5
    };
    assert.strictEqual(hasQuota(exhaustedIncludedSub), true);
    assert.strictEqual(consumeQuota(exhaustedIncludedSub), 'extra');
    assert.strictEqual(exhaustedIncludedSub.extraAiRemaining, 4);

    // 4. Test fully exhausted active subscription
    const fullyExhaustedSub = {
        status: 'active',
        includedAiLimit: 10,
        includedAiUsed: 10,
        extraAiRemaining: 0
    };
    assert.strictEqual(hasQuota(fullyExhaustedSub), false);
    assert.strictEqual(consumeQuota(fullyExhaustedSub), 'none');

    // 5. Test refunding included quota
    const refundSub = {
        status: 'active',
        includedAiLimit: 10,
        includedAiUsed: 5,
        extraAiRemaining: 2
    };
    assert.strictEqual(refundQuota(refundSub, 'included'), true);
    assert.strictEqual(refundSub.includedAiUsed, 4);

    // 6. Test refunding extra quota
    assert.strictEqual(refundQuota(refundSub, 'extra'), true);
    assert.strictEqual(refundSub.extraAiRemaining, 3);

    // 7. Test refunding invalid/none quota
    assert.strictEqual(refundQuota(refundSub, 'none'), false);
    assert.strictEqual(refundQuota(refundSub, null), false);
});
