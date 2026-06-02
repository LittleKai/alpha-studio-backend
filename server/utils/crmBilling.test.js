import test from 'node:test';
import assert from 'node:assert';
import { fulfillCrmBillingOrder } from './crmBilling.js';

const createQuery = (value) => ({
    sessionArg: null,
    sortArg: null,
    session(session) {
        this.sessionArg = session;
        return this;
    },
    sort(sort) {
        this.sortArg = sort;
        return this;
    },
    async then(resolve) {
        return resolve(value);
    }
});

test('fulfillCrmBillingOrder wraps claim, entitlement, transaction, and paid status in one Mongo transaction', async () => {
    const calls = [];
    const session = { id: 'session-1' };
    const mongooseClient = {
        async startSession() {
            calls.push('startSession');
            return {
                async withTransaction(fn) {
                    calls.push('withTransaction');
                    return fn();
                },
                async endSession() {
                    calls.push('endSession');
                }
            };
        }
    };

    const order = {
        _id: 'order-1',
        userId: 'user-1',
        productId: 'crm_monthly',
        orderType: 'subscription',
        amountVnd: 500000,
        credits: 525,
        transactionCode: 'CRMABC123',
        metadata: {},
        async save(options) {
            calls.push(['order.save', this.status, options.session]);
        },
        markModified(path) {
            calls.push(['order.markModified', path]);
        }
    };

    const oldSub = {
        _id: 'sub-1',
        periodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
        includedAiUsed: 300,
        async save(options) {
            calls.push(['subscription.save', this.periodEnd instanceof Date, options.session]);
        }
    };

    const transaction = { _id: 'tx-1' };

    const models = {
        CrmBillingOrder: {
            findOneAndUpdate(filter, update, options) {
                calls.push(['order.claim', filter, update, options.session]);
                return Promise.resolve(order);
            },
            findOne() {
                throw new Error('existing order lookup should not run when claim succeeds');
            }
        },
        CrmSubscription: {
            findOne(filter) {
                calls.push(['subscription.findOne', filter]);
                return createQuery(oldSub);
            }
        },
        Transaction: {
            findOne(filter) {
                calls.push(['transaction.findOne', filter]);
                return createQuery(null);
            },
            async create(docs, options) {
                calls.push(['transaction.create', docs[0].serviceType, options.session]);
                return [transaction];
            }
        }
    };

    const result = await fulfillCrmBillingOrder({
        selector: { transactionCode: 'CRMABC123' },
        expectedAmountVnd: 500000,
        source: 'webhook',
        bankTxId: 'bank-1',
        webhookData: { id: 'bank-1' },
        webhookLogId: 'log-1',
        models,
        mongooseClient
    });

    assert.strictEqual(result.status, 'fulfilled');
    assert.strictEqual(result.order.status, 'paid');
    assert.ok(result.order.fulfilledAt instanceof Date);
    assert.strictEqual(result.order.metadata.fulfillment.source, 'webhook');
    assert.strictEqual(result.order.metadata.fulfillment.transactionId, 'tx-1');
    assert.deepStrictEqual(calls.slice(0, 2), ['startSession', 'withTransaction']);
    assert.ok(calls.some((call) => Array.isArray(call) && call[0] === 'order.claim' && call[1].status === 'pending'));
    assert.ok(calls.some((call) => Array.isArray(call) && call[0] === 'transaction.create' && call[1] === 'alpha_crm_subscription'));
    assert.deepStrictEqual(calls.at(-1), 'endSession');
});

test('fulfillCrmBillingOrder reports fulfilling orders as recoverable conflict instead of success', async () => {
    const session = {};
    const mongooseClient = {
        async startSession() {
            return {
                async withTransaction(fn) {
                    return fn();
                },
                async endSession() {}
            };
        }
    };

    const models = {
        CrmBillingOrder: {
            findOneAndUpdate() {
                return Promise.resolve(null);
            },
            findOne() {
                return createQuery({ status: 'fulfilling', userId: 'user-1' });
            }
        },
        CrmSubscription: {},
        Transaction: {}
    };

    const result = await fulfillCrmBillingOrder({
        selector: { transactionCode: 'CRMLOCK1' },
        models,
        mongooseClient
    });

    assert.strictEqual(result.status, 'already_fulfilling');
    assert.match(result.message, /manual recovery/i);
});
