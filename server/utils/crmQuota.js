/**
 * CRM Quota Management Utilities
 * Handles checking, consuming, and refunding AI quota on a subscription.
 */

/**
 * Checks if subscription is active and has quota available
 * @param {Object} subscription - CrmSubscription document/object
 * @returns {Boolean}
 */
export const hasQuota = (subscription, requiredUnits = 1) => {
    if (!subscription || subscription.status !== 'active') {
        return false;
    }

    const hasIncludedRemaining = subscription.includedAiUsed < subscription.includedAiLimit;
    const hasExtraRemaining = subscription.extraAiRemaining > 0;
    const units = Math.max(1, Number(requiredUnits) || 1);
    const totalRemaining = Math.max(0, subscription.includedAiLimit - subscription.includedAiUsed)
        + Math.max(0, subscription.extraAiRemaining);

    return (hasIncludedRemaining || hasExtraRemaining) && totalRemaining >= units;
};

export const consumeQuotaUnits = (subscription, requiredUnits = 1) => {
    const units = Math.max(1, Number(requiredUnits) || 1);
    if (!hasQuota(subscription, units)) {
        return { bucket: 'none', units: 0, included: 0, extra: 0 };
    }

    let included = 0;
    let extra = 0;

    for (let i = 0; i < units; i += 1) {
        if (subscription.includedAiUsed < subscription.includedAiLimit) {
            subscription.includedAiUsed += 1;
            included += 1;
        } else if (subscription.extraAiRemaining > 0) {
            subscription.extraAiRemaining -= 1;
            extra += 1;
        }
    }

    const bucket = included > 0 && extra > 0
        ? 'mixed'
        : included > 0
            ? 'included'
            : extra > 0
                ? 'extra'
                : 'none';

    return { bucket, units: included + extra, included, extra };
};

/**
 * Consumes one AI quota request.
 * Modifies the subscription object inline.
 * Callers MUST save the subscription document to persist changes.
 * 
 * @param {Object} subscription - CrmSubscription document
 * @returns {String} 'included' | 'extra' | 'none'
 */
export const consumeQuota = (subscription) => {
    return consumeQuotaUnits(subscription, 1).bucket;
};

/**
 * Refunds one consumed AI quota request if upstream call fails.
 * Modifies the subscription object inline.
 * Callers MUST save the subscription document to persist changes.
 * 
 * @param {Object} subscription - CrmSubscription document
 * @param {String} bucket - 'included' | 'extra' | 'none'
 * @returns {Boolean} true if refunded, false otherwise
 */
export const refundQuota = (subscription, bucket) => {
    if (!subscription || !bucket || bucket === 'none') {
        return false;
    }

    if (bucket === 'included') {
        if (subscription.includedAiUsed > 0) {
            subscription.includedAiUsed -= 1;
            return true;
        }
    } else if (bucket === 'extra') {
        subscription.extraAiRemaining += 1;
        return true;
    }

    return false;
};

export const refundQuotaUnits = (subscription, consumption) => {
    if (!subscription || !consumption || consumption.bucket === 'none') {
        return false;
    }

    const included = Math.max(0, Number(consumption.included) || 0);
    const extra = Math.max(0, Number(consumption.extra) || 0);

    if (included > 0) {
        subscription.includedAiUsed = Math.max(0, subscription.includedAiUsed - included);
    }
    if (extra > 0) {
        subscription.extraAiRemaining += extra;
    }

    return included > 0 || extra > 0;
};
