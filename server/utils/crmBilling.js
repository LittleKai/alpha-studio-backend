import mongoose from 'mongoose';
import Transaction from '../models/Transaction.js';
import CrmBillingOrder from '../models/CrmBillingOrder.js';
import CrmSubscription from '../models/CrmSubscription.js';
import { getCrmProduct } from './crmCatalog.js';

const DEFAULT_INCLUDED_AI_LIMIT = 1000;
const DEFAULT_DEVICE_LIMIT = 1;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const withSession = (query, session) => {
    if (!session) {
        return query;
    }
    if (query && typeof query.session === 'function') {
        return query.session(session);
    }
    return query;
};

const latestWithSession = (query, session) => {
    const sessionQuery = withSession(query, session);
    if (sessionQuery && typeof sessionQuery.sort === 'function') {
        return sessionQuery.sort({ createdAt: -1 });
    }
    return sessionQuery;
};

const buildCrmTransaction = ({ order, product, source, bankTxId, webhookData, webhookLogId, adminUserId }) => ({
    userId: order.userId,
    type: 'topup',
    amount: order.amountVnd,
    credits: order.credits,
    status: 'completed',
    transactionCode: order.transactionCode,
    paymentMethod: source === 'admin' ? 'manual' : 'bank_transfer',
    serviceType: order.orderType === 'subscription' ? 'alpha_crm_subscription' : 'alpha_crm_ai_pack',
    serviceDetails: {
        productId: order.productId,
        orderType: order.orderType,
        crmBillingOrderId: order._id,
        source
    },
    bankTransactionId: bankTxId || null,
    webhookData: webhookData || null,
    webhookLogId: webhookLogId || null,
    processedBy: adminUserId || null,
    processedAt: new Date(),
    description: `Mua goi CRM ${product ? product.name : order.productId} qua ${source === 'admin' ? 'duyet thu cong' : 'chuyen khoan ngan hang'}`
});

const isTrialSubscription = (subscription) => (
    subscription?.entitlementType === 'trial' ||
    subscription?.plan === 'crm_trial'
);

const createPaidSubscription = async ({ order, product, models, session, now, carryFromSub = null }) => {
    const subscription = new models.CrmSubscription({
        userId: order.userId,
        status: 'active',
        plan: order.productId,
        entitlementType: 'paid',
        periodStart: now,
        periodEnd: new Date(now.getTime() + MONTH_MS),
        includedAiLimit: product ? product.includedAiLimit : DEFAULT_INCLUDED_AI_LIMIT,
        includedAiUsed: 0,
        extraAiRemaining: carryFromSub ? carryFromSub.extraAiRemaining : 0,
        deviceLimit: product ? product.deviceLimit : DEFAULT_DEVICE_LIMIT,
        lastRenewedAt: now
    });
    await subscription.save({ session });
    return subscription;
};

export const applySubscriptionEntitlement = async ({ order, product, models, session }) => {
    const now = new Date();
    const oldActiveSub = await withSession(
        models.CrmSubscription.findOne({ userId: order.userId, status: 'active' }),
        session
    );

    if (oldActiveSub) {
        if (now > new Date(oldActiveSub.periodEnd)) {
            oldActiveSub.status = 'expired';
            await oldActiveSub.save({ session });

            return createPaidSubscription({
                order,
                product,
                models,
                session,
                now,
                carryFromSub: oldActiveSub
            });
        }

        if (isTrialSubscription(oldActiveSub)) {
            oldActiveSub.status = 'cancelled';
            oldActiveSub.cancelledAt = now;
            await oldActiveSub.save({ session });

            return createPaidSubscription({
                order,
                product,
                models,
                session,
                now,
                carryFromSub: oldActiveSub
            });
        }

        oldActiveSub.periodEnd = new Date(new Date(oldActiveSub.periodEnd).getTime() + MONTH_MS);
        oldActiveSub.plan = order.productId;
        oldActiveSub.entitlementType = 'paid';
        oldActiveSub.includedAiLimit = product ? product.includedAiLimit : DEFAULT_INCLUDED_AI_LIMIT;
        oldActiveSub.includedAiUsed = 0;
        oldActiveSub.lastRenewedAt = now;
        await oldActiveSub.save({ session });
        return oldActiveSub;
    }

    const latestSub = await latestWithSession(
        models.CrmSubscription.findOne({ userId: order.userId }),
        session
    );

    return createPaidSubscription({
        order,
        product,
        models,
        session,
        now,
        carryFromSub: latestSub
    });
};

const applyAiPackEntitlement = async ({ order, product, models, session }) => {
    const subscription = await latestWithSession(
        models.CrmSubscription.findOne({ userId: order.userId }),
        session
    );

    if (subscription) {
        subscription.extraAiRemaining += product ? product.extraAiLimit : 100;
        await subscription.save({ session });
        return subscription;
    }

    const newSub = new models.CrmSubscription({
        userId: order.userId,
        status: 'expired',
        plan: 'crm_monthly',
        entitlementType: 'paid',
        periodStart: new Date(),
        periodEnd: new Date(),
        includedAiLimit: DEFAULT_INCLUDED_AI_LIMIT,
        includedAiUsed: DEFAULT_INCLUDED_AI_LIMIT,
        extraAiRemaining: product ? product.extraAiLimit : 100,
        deviceLimit: DEFAULT_DEVICE_LIMIT
    });
    await newSub.save({ session });
    return newSub;
};

const getExistingOrderResult = (existingOrder) => {
    if (!existingOrder) {
        return { status: 'not_found', message: 'CRM billing order not found.' };
    }
    if (existingOrder.status === 'paid') {
        return { status: 'already_paid', order: existingOrder, message: 'CRM billing order already paid.' };
    }
    if (existingOrder.status === 'fulfilling') {
        return {
            status: 'already_fulfilling',
            order: existingOrder,
            message: 'CRM billing order is already fulfilling and needs manual recovery.'
        };
    }
    return {
        status: 'not_pending',
        order: existingOrder,
        message: `CRM billing order is ${existingOrder.status}.`
    };
};

export const fulfillCrmBillingOrder = async ({
    selector,
    expectedAmountVnd = null,
    source = 'webhook',
    bankTxId = null,
    webhookData = null,
    webhookLogId = null,
    adminUserId = null,
    models = { CrmBillingOrder, CrmSubscription, Transaction },
    mongooseClient = mongoose
}) => {
    const session = await mongooseClient.startSession();

    try {
        return await session.withTransaction(async () => {
            const transactionSession = session;
            const now = new Date();
            const order = await models.CrmBillingOrder.findOneAndUpdate(
                { ...selector, status: 'pending' },
                {
                    $set: {
                        status: 'fulfilling',
                        'metadata.fulfillment.startedAt': now,
                        'metadata.fulfillment.source': source
                    }
                },
                { new: true, session: transactionSession }
            );

            if (!order) {
                const existingOrder = await withSession(models.CrmBillingOrder.findOne(selector), transactionSession);
                return getExistingOrderResult(existingOrder);
            }

            if (expectedAmountVnd !== null && order.amountVnd !== expectedAmountVnd) {
                order.status = 'failed';
                order.metadata = {
                    ...(order.metadata || {}),
                    fulfillment: {
                        ...((order.metadata && order.metadata.fulfillment) || {}),
                        failedAt: now,
                        failedReason: `Amount mismatch: expected ${order.amountVnd}, got ${expectedAmountVnd}`,
                        source
                    }
                };
                if (typeof order.markModified === 'function') {
                    order.markModified('metadata');
                }
                await order.save({ session: transactionSession });
                return {
                    status: 'amount_mismatch',
                    order,
                    message: `CRM order amount mismatch: expected ${order.amountVnd}, got ${expectedAmountVnd}`
                };
            }

            const product = getCrmProduct(order.productId);
            const subscription = order.orderType === 'subscription'
                ? await applySubscriptionEntitlement({ order, product, models, session: transactionSession })
                : await applyAiPackEntitlement({ order, product, models, session: transactionSession });

            let transaction = await withSession(
                models.Transaction.findOne({ transactionCode: order.transactionCode }),
                transactionSession
            );

            if (!transaction) {
                const transactions = await models.Transaction.create([
                    buildCrmTransaction({
                        order,
                        product,
                        source,
                        bankTxId,
                        webhookData,
                        webhookLogId,
                        adminUserId
                    })
                ], { session: transactionSession });
                transaction = transactions[0];
            }

            order.status = 'paid';
            order.fulfilledAt = now;
            order.metadata = {
                ...(order.metadata || {}),
                fulfillment: {
                    ...((order.metadata && order.metadata.fulfillment) || {}),
                    source,
                    completedAt: now,
                    transactionId: transaction._id,
                    subscriptionId: subscription ? subscription._id : null
                }
            };
            if (typeof order.markModified === 'function') {
                order.markModified('metadata');
            }
            await order.save({ session: transactionSession });

            return { status: 'fulfilled', order, transaction, subscription };
        });
    } finally {
        await session.endSession();
    }
};
