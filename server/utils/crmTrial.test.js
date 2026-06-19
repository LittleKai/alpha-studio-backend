import test from 'node:test';
import assert from 'node:assert';
import {
    buildCrmTrialSubscriptionData,
    createInitialCrmTrialSubscription
} from './crmTrial.js';

test('buildCrmTrialSubscriptionData creates a 7-day 50-request trial', () => {
    const now = new Date('2026-06-19T00:00:00.000Z');
    const data = buildCrmTrialSubscriptionData({ userId: 'user-1', now });

    assert.strictEqual(data.userId, 'user-1');
    assert.strictEqual(data.status, 'active');
    assert.strictEqual(data.plan, 'crm_trial');
    assert.strictEqual(data.entitlementType, 'trial');
    assert.strictEqual(data.includedAiLimit, 50);
    assert.strictEqual(data.includedAiUsed, 0);
    assert.strictEqual(data.extraAiRemaining, 0);
    assert.strictEqual(data.deviceLimit, 1);
    assert.strictEqual(data.periodStart.toISOString(), '2026-06-19T00:00:00.000Z');
    assert.strictEqual(data.periodEnd.toISOString(), '2026-06-26T00:00:00.000Z');
    assert.strictEqual(data.trialStartedAt.toISOString(), '2026-06-19T00:00:00.000Z');
});

test('createInitialCrmTrialSubscription does not create a second trial', async () => {
    const existing = { _id: 'trial-1', entitlementType: 'trial' };
    const saves = [];
    const audits = [];

    const models = {
        CrmSubscription: {
            findOne(filter) {
                assert.deepStrictEqual(filter, {
                    userId: 'user-1',
                    entitlementType: 'trial'
                });
                return Promise.resolve(existing);
            }
        },
        CrmAuditLog: {
            create(doc) {
                audits.push(doc);
                return Promise.resolve(doc);
            }
        }
    };

    const result = await createInitialCrmTrialSubscription({
        userId: 'user-1',
        models
    });

    assert.strictEqual(result.created, false);
    assert.strictEqual(result.subscription, existing);
    assert.deepStrictEqual(saves, []);
    assert.deepStrictEqual(audits, []);
});

test('createInitialCrmTrialSubscription persists a first trial and audit log', async () => {
    const now = new Date('2026-06-19T00:00:00.000Z');
    const saves = [];
    const audits = [];

    class FakeCrmSubscription {
        constructor(data) {
            Object.assign(this, data);
            this._id = 'trial-1';
        }

        async save() {
            saves.push(this);
        }

        static findOne(filter) {
            assert.deepStrictEqual(filter, {
                userId: 'user-1',
                entitlementType: 'trial'
            });
            return Promise.resolve(null);
        }
    }

    const models = {
        CrmSubscription: FakeCrmSubscription,
        CrmAuditLog: {
            create(doc) {
                audits.push(doc);
                return Promise.resolve(doc);
            }
        }
    };

    const result = await createInitialCrmTrialSubscription({
        userId: 'user-1',
        models,
        now
    });

    assert.strictEqual(result.created, true);
    assert.strictEqual(saves.length, 1);
    assert.strictEqual(result.subscription.includedAiLimit, 50);
    assert.strictEqual(result.subscription.periodEnd.toISOString(), '2026-06-26T00:00:00.000Z');
    assert.deepStrictEqual(audits, [
        {
            userId: 'user-1',
            subscriptionId: 'trial-1',
            action: 'subscription_trial_started',
            details: {
                plan: 'crm_trial',
                durationDays: 7,
                includedAiLimit: 50
            }
        }
    ]);
});
