import test from 'node:test';
import assert from 'node:assert';
import {
    consumeQuota,
    consumeQuotaUnits,
    hasQuota,
    refundCrmAiCreditsAtomic,
    refundQuota,
    refundQuotaUnits,
    reserveCrmAiCreditsAtomic,
    settleCrmAiCreditsAtomic
} from './crmQuota.js';

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

    // 8. Test two-unit Pro model quota consumption from included quota
    const proIncludedSub = {
        status: 'active',
        includedAiLimit: 10,
        includedAiUsed: 5,
        extraAiRemaining: 0
    };
    assert.strictEqual(hasQuota(proIncludedSub, 2), true);
    const proIncludedConsumption = consumeQuotaUnits(proIncludedSub, 2);
    assert.deepStrictEqual(proIncludedConsumption, {
        bucket: 'included',
        units: 2,
        included: 2,
        extra: 0
    });
    assert.strictEqual(proIncludedSub.includedAiUsed, 7);
    assert.strictEqual(refundQuotaUnits(proIncludedSub, proIncludedConsumption), true);
    assert.strictEqual(proIncludedSub.includedAiUsed, 5);

    // 9. Test two-unit Pro model quota consumption can bridge included + extra quota
    const proMixedSub = {
        status: 'active',
        includedAiLimit: 10,
        includedAiUsed: 9,
        extraAiRemaining: 3
    };
    assert.strictEqual(hasQuota(proMixedSub, 2), true);
    const proMixedConsumption = consumeQuotaUnits(proMixedSub, 2);
    assert.deepStrictEqual(proMixedConsumption, {
        bucket: 'mixed',
        units: 2,
        included: 1,
        extra: 1
    });
    assert.strictEqual(proMixedSub.includedAiUsed, 10);
    assert.strictEqual(proMixedSub.extraAiRemaining, 2);
    assert.strictEqual(refundQuotaUnits(proMixedSub, proMixedConsumption), true);
    assert.strictEqual(proMixedSub.includedAiUsed, 9);
    assert.strictEqual(proMixedSub.extraAiRemaining, 3);

    // 10. Test two-unit consumption rejects if only one credit remains (unless allowPartial)
    const proInsufficientSub = {
        status: 'active',
        includedAiLimit: 10,
        includedAiUsed: 10,
        extraAiRemaining: 1
    };
    assert.strictEqual(hasQuota(proInsufficientSub, 2), false);
    assert.deepStrictEqual(consumeQuotaUnits(proInsufficientSub, 2), {
        bucket: 'none',
        units: 0,
        included: 0,
        extra: 0
    });

    // 11. Test fractional token-based Credit consumption & partial bridge without float drift
    const fractionalSub = {
        status: 'active',
        includedAiLimit: 100,
        includedAiUsed: 99.85,
        extraAiRemaining: 5.5
    };
    assert.strictEqual(hasQuota(fractionalSub, 0.01), true);
    const fracConsumed = consumeQuotaUnits(fractionalSub, 0.4, { allowPartial: true });
    assert.deepStrictEqual(fracConsumed, {
        bucket: 'mixed',
        units: 0.4,
        included: 0.15,
        extra: 0.25
    });
    assert.strictEqual(fractionalSub.includedAiUsed, 100);
    assert.strictEqual(fractionalSub.extraAiRemaining, 5.25);
    assert.strictEqual(refundQuotaUnits(fractionalSub, fracConsumed), true);
    assert.strictEqual(fractionalSub.includedAiUsed, 99.85);
    assert.strictEqual(fractionalSub.extraAiRemaining, 5.5);
});

function createAtomicMockModels({ subState, userState }) {
    const CrmSubscription = {
        async findById(id) {
            return subState._id === id ? { ...subState } : null;
        },
        async findOneAndUpdate(filter, update) {
            if (filter._id !== subState._id) return null;
            if (filter.status && subState.status !== filter.status) return null;
            if (filter.$expr && filter.$expr.$gte) {
                const reqInc = filter.$expr.$gte[1];
                if (subState.includedAiLimit - subState.includedAiUsed < reqInc) return null;
            }
            if (filter.includedAiUsed && filter.includedAiUsed.$gte !== undefined) {
                if (subState.includedAiUsed < filter.includedAiUsed.$gte) return null;
            }
            if (filter.extraAiRemaining && filter.extraAiRemaining.$gte !== undefined) {
                if (subState.extraAiRemaining < filter.extraAiRemaining.$gte) return null;
            }
            if (update.$inc) {
                if (update.$inc.includedAiUsed !== undefined) {
                    subState.includedAiUsed = subState.includedAiUsed + update.$inc.includedAiUsed;
                }
                if (update.$inc.extraAiRemaining !== undefined) {
                    subState.extraAiRemaining = subState.extraAiRemaining + update.$inc.extraAiRemaining;
                }
            }
            return { ...subState };
        }
    };

    const User = {
        async findById(id) {
            return userState._id === id ? { ...userState } : null;
        },
        async findOneAndUpdate(filter, update) {
            if (filter._id !== userState._id) return null;
            if (filter.balance && filter.balance.$gte !== undefined) {
                if (userState.balance < filter.balance.$gte) return null;
            }
            if (update.$inc && update.$inc.balance !== undefined) {
                userState.balance = userState.balance + update.$inc.balance;
            }
            return { ...userState };
        }
    };

    return { CrmSubscription, User };
}

test('Atomic CRM AI reserve-settle-refund blocks low-balance big prompt & prevents concurrent double-spend', async () => {
    // 1. Big prompt estimate rejected when sub + wallet < estimatedCredits (and rolls back partial sub debit)
    const lowSub = { _id: 'sub1', status: 'active', includedAiLimit: 100, includedAiUsed: 99.5, extraAiRemaining: 0 };
    const lowUser = { _id: 'u1', balance: 0.2 };
    const lowModels = createAtomicMockModels({ subState: lowSub, userState: lowUser });

    const rejected = await reserveCrmAiCreditsAtomic({
        ...lowModels,
        subscriptionId: 'sub1',
        userId: 'u1',
        estimatedCredits: 2.5
    });
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.statusCode, 403);
    assert.strictEqual(lowSub.includedAiUsed, 99.5); // rolled back cleanly
    assert.strictEqual(lowUser.balance, 0.2);

    // 2. Concurrent reservations compete atomically for remaining wallet + subscription credits
    const concSub = { _id: 'sub2', status: 'active', includedAiLimit: 10, includedAiUsed: 9, extraAiRemaining: 0 };
    const concUser = { _id: 'u2', balance: 0.5 };
    const concModels = createAtomicMockModels({ subState: concSub, userState: concUser });

    const [r1, r2] = await Promise.all([
        reserveCrmAiCreditsAtomic({ ...concModels, subscriptionId: 'sub2', userId: 'u2', estimatedCredits: 1.0 }),
        reserveCrmAiCreditsAtomic({ ...concModels, subscriptionId: 'sub2', userId: 'u2', estimatedCredits: 1.0 })
    ]);
    assert.strictEqual([r1.ok, r2.ok].filter(Boolean).length, 1);
    assert.strictEqual(concSub.includedAiUsed, 10);
    assert.strictEqual(concUser.balance, 0.5);

    // 3. Settlement refunds excess reserve (wallet first, then extra, then included)
    const settleSub = { _id: 'sub3', status: 'active', includedAiLimit: 10, includedAiUsed: 9.5, extraAiRemaining: 1.0 };
    const settleUser = { _id: 'u3', balance: 5.0 };
    const settleModels = createAtomicMockModels({ subState: settleSub, userState: settleUser });

    const resv = await reserveCrmAiCreditsAtomic({
        ...settleModels,
        subscriptionId: 'sub3',
        userId: 'u3',
        estimatedCredits: 2.0
    });
    assert.strictEqual(resv.ok, true);
    assert.strictEqual(resv.subIncluded, 0.5);
    assert.strictEqual(resv.subExtra, 1.0);
    assert.strictEqual(resv.walletReserved, 0.5);

    const settled = await settleCrmAiCreditsAtomic({
        ...settleModels,
        subscriptionId: 'sub3',
        userId: 'u3',
        reservation: resv,
        actualCredits: 0.75
    });
    assert.strictEqual(settled.chargedCredits, 0.75);
    assert.strictEqual(settled.walletSpent, 0);
    assert.strictEqual(settled.bucketUsed, 'mixed');
    assert.strictEqual(settleUser.balance, 5.0);
    assert.strictEqual(settleSub.extraAiRemaining, 0.75);
    assert.strictEqual(settleSub.includedAiUsed, 10);

    // 4. Upstream failure refunds entire reservation
    const failResv = await reserveCrmAiCreditsAtomic({
        ...settleModels,
        subscriptionId: 'sub3',
        userId: 'u3',
        estimatedCredits: 1.25
    });
    assert.strictEqual(failResv.ok, true);
    await refundCrmAiCreditsAtomic({
        ...settleModels,
        subscriptionId: 'sub3',
        userId: 'u3',
        reservation: failResv
    });
    assert.strictEqual(settleSub.extraAiRemaining, 0.75);
    assert.strictEqual(settleUser.balance, 5.0);

    // 5. Float drift case (100 - 99.7 === 0.29999999999999716 < 0.3) without mock tolerance
    const driftSub = { _id: 'sub4', status: 'active', includedAiLimit: 100, includedAiUsed: 99.7, extraAiRemaining: 0 };
    const driftUser = { _id: 'u4', balance: 0 };
    const driftModels = createAtomicMockModels({ subState: driftSub, userState: driftUser });

    const driftResv = await reserveCrmAiCreditsAtomic({
        ...driftModels,
        subscriptionId: 'sub4',
        userId: 'u4',
        estimatedCredits: 0.3
    });
    assert.strictEqual(driftResv.ok, true);
    assert.strictEqual(driftResv.subIncluded, 0.3);
    assert.strictEqual(Math.round(driftSub.includedAiUsed * 10000) / 10000, 100);
});
