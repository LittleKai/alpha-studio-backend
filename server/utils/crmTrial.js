import CrmSubscription from '../models/CrmSubscription.js';
import CrmAuditLog from '../models/CrmAuditLog.js';
import { CRM_TRIAL } from './crmCatalog.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const buildCrmTrialSubscriptionData = ({ userId, now = new Date() }) => ({
    userId,
    status: 'active',
    plan: CRM_TRIAL.id,
    entitlementType: 'trial',
    periodStart: now,
    periodEnd: new Date(now.getTime() + CRM_TRIAL.durationDays * DAY_MS),
    includedAiLimit: CRM_TRIAL.includedAiLimit,
    includedAiUsed: 0,
    extraAiRemaining: 0,
    deviceLimit: CRM_TRIAL.deviceLimit,
    trialStartedAt: now,
    lastRenewedAt: now
});

export const createInitialCrmTrialSubscription = async ({
    userId,
    models = { CrmSubscription, CrmAuditLog },
    now = new Date()
}) => {
    const existingTrial = await models.CrmSubscription.findOne({
        userId,
        entitlementType: 'trial'
    });

    if (existingTrial) {
        return { created: false, subscription: existingTrial };
    }

    const subscription = new models.CrmSubscription(
        buildCrmTrialSubscriptionData({ userId, now })
    );
    await subscription.save();

    if (models.CrmAuditLog) {
        await models.CrmAuditLog.create({
            userId,
            subscriptionId: subscription._id || null,
            action: 'subscription_trial_started',
            details: {
                plan: CRM_TRIAL.id,
                durationDays: CRM_TRIAL.durationDays,
                includedAiLimit: CRM_TRIAL.includedAiLimit
            }
        });
    }

    return { created: true, subscription };
};
