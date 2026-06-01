/**
 * CRM Quota Management Utilities
 * Handles checking, consuming, and refunding AI quota on a subscription.
 */

/**
 * Checks if subscription is active and has quota available
 * @param {Object} subscription - CrmSubscription document/object
 * @returns {Boolean}
 */
export const hasQuota = (subscription) => {
    if (!subscription || subscription.status !== 'active') {
        return false;
    }

    const hasIncludedRemaining = subscription.includedAiUsed < subscription.includedAiLimit;
    const hasExtraRemaining = subscription.extraAiRemaining > 0;

    return hasIncludedRemaining || hasExtraRemaining;
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
    if (!subscription || subscription.status !== 'active') {
        return 'none';
    }

    // Spend included quota first
    if (subscription.includedAiUsed < subscription.includedAiLimit) {
        subscription.includedAiUsed += 1;
        return 'included';
    }

    // Spend extra quota second
    if (subscription.extraAiRemaining > 0) {
        subscription.extraAiRemaining -= 1;
        return 'extra';
    }

    return 'none';
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
