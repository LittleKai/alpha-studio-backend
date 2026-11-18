/**
 * CRM Quota Management Utilities
 * Handles checking, consuming, and refunding AI Credits (billed by token) on a subscription.
 */
import { AI_MIN_CHARGE_CREDITS, roundCredits } from './aiPricing.js';

export const getRemainingSubscriptionCredits = (subscription) => {
    if (!subscription) {
        return { includedRemaining: 0, extraRemaining: 0, totalRemaining: 0 };
    }
    const includedRemaining = roundCredits(
        Math.max(0, (Number(subscription.includedAiLimit) || 0) - (Number(subscription.includedAiUsed) || 0))
    );
    const extraRemaining = roundCredits(
        Math.max(0, Number(subscription.extraAiRemaining) || 0)
    );
    return {
        includedRemaining,
        extraRemaining,
        totalRemaining: roundCredits(includedRemaining + extraRemaining)
    };
};

/**
 * Checks if subscription is active and has enough AI Credits available.
 * @param {Object} subscription - CrmSubscription document/object
 * @param {Number} requiredCredits - Minimum credits required (defaults to min charge)
 * @returns {Boolean}
 */
export const hasQuota = (subscription, requiredCredits = AI_MIN_CHARGE_CREDITS) => {
    if (!subscription || subscription.status !== 'active') {
        return false;
    }

    const units = roundCredits(Math.max(AI_MIN_CHARGE_CREDITS, Number(requiredCredits) || AI_MIN_CHARGE_CREDITS));
    const { totalRemaining } = getRemainingSubscriptionCredits(subscription);
    return totalRemaining >= units;
};

/**
 * Consumes fractional or integer AI Credits from a subscription (`included` first, then `extra`).
 */
export const consumeQuotaUnits = (subscription, requiredCredits = 1, { allowPartial = false } = {}) => {
    const units = roundCredits(Math.max(0, Number(requiredCredits) || 0));
    if (!subscription || subscription.status !== 'active' || units <= 0) {
        return { bucket: 'none', units: 0, included: 0, extra: 0 };
    }

    const { includedRemaining, extraRemaining, totalRemaining } = getRemainingSubscriptionCredits(subscription);
    if (!allowPartial && totalRemaining < units) {
        return { bucket: 'none', units: 0, included: 0, extra: 0 };
    }

    const toConsume = allowPartial ? Math.min(units, totalRemaining) : units;
    if (toConsume <= 0) {
        return { bucket: 'none', units: 0, included: 0, extra: 0 };
    }

    const included = roundCredits(Math.min(includedRemaining, toConsume));
    const extra = roundCredits(Math.min(extraRemaining, Math.max(0, toConsume - included)));

    if (included > 0) {
        subscription.includedAiUsed = roundCredits((Number(subscription.includedAiUsed) || 0) + included);
    }
    if (extra > 0) {
        subscription.extraAiRemaining = roundCredits(Math.max(0, (Number(subscription.extraAiRemaining) || 0) - extra));
    }

    const bucket = included > 0 && extra > 0
        ? 'mixed'
        : included > 0
            ? 'included'
            : extra > 0
                ? 'extra'
                : 'none';

    return { bucket, units: roundCredits(included + extra), included, extra };
};

export const consumeQuota = (subscription) => {
    return consumeQuotaUnits(subscription, 1).bucket;
};

export const refundQuota = (subscription, bucket) => {
    if (!subscription || !bucket || bucket === 'none') {
        return false;
    }

    if (bucket === 'included') {
        if ((Number(subscription.includedAiUsed) || 0) > 0) {
            subscription.includedAiUsed = roundCredits(Math.max(0, (Number(subscription.includedAiUsed) || 0) - 1));
            return true;
        }
    } else if (bucket === 'extra') {
        subscription.extraAiRemaining = roundCredits((Number(subscription.extraAiRemaining) || 0) + 1);
        return true;
    }

    return false;
};

export const refundQuotaUnits = (subscription, consumption) => {
    if (!subscription || !consumption || consumption.bucket === 'none') {
        return false;
    }

    const included = roundCredits(Math.max(0, Number(consumption.included) || 0));
    const extra = roundCredits(Math.max(0, Number(consumption.extra) || 0));

    if (included > 0) {
        subscription.includedAiUsed = roundCredits(Math.max(0, (Number(subscription.includedAiUsed) || 0) - included));
    }
    if (extra > 0) {
        subscription.extraAiRemaining = roundCredits((Number(subscription.extraAiRemaining) || 0) + extra);
    }

    return included > 0 || extra > 0;
};

async function debitSubscriptionCreditsAtomic({ CrmSubscription, subscriptionId, targetCredits, maxAttempts = 5 }) {
    const target = roundCredits(Math.max(0, Number(targetCredits) || 0));
    if (!CrmSubscription || !subscriptionId || target <= 0) {
        return { subIncluded: 0, subExtra: 0, totalDebited: 0, sub: null };
    }

    let lastSub = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const sub = await CrmSubscription.findById(subscriptionId);
        lastSub = sub;
        if (!sub || sub.status !== 'active') {
            return { subIncluded: 0, subExtra: 0, totalDebited: 0, sub };
        }

        const { includedRemaining, extraRemaining } = getRemainingSubscriptionCredits(sub);
        const wantInc = roundCredits(Math.min(includedRemaining, target));
        const wantExt = roundCredits(Math.min(extraRemaining, Math.max(0, roundCredits(target - wantInc))));
        if (wantInc <= 0 && wantExt <= 0) {
            return { subIncluded: 0, subExtra: 0, totalDebited: 0, sub };
        }

        const filter = { _id: subscriptionId, status: 'active' };
        const inc = {};
        if (wantInc > 0) {
            filter.$expr = { $gte: [{ $subtract: ['$includedAiLimit', '$includedAiUsed'] }, Math.max(0, wantInc - 1e-6)] };
            inc.includedAiUsed = wantInc;
        }
        if (wantExt > 0) {
            filter.extraAiRemaining = { $gte: Math.max(0, wantExt - 1e-6) };
            inc.extraAiRemaining = -wantExt;
        }

        const updated = await CrmSubscription.findOneAndUpdate(filter, { $inc: inc }, { new: true });
        if (updated) {
            return {
                subIncluded: wantInc,
                subExtra: wantExt,
                totalDebited: roundCredits(wantInc + wantExt),
                sub: updated
            };
        }
    }

    return { subIncluded: 0, subExtra: 0, totalDebited: 0, sub: lastSub };
}

async function refundSubscriptionCreditsAtomic({ CrmSubscription, subscriptionId, subIncluded = 0, subExtra = 0 }) {
    const incVal = roundCredits(Math.max(0, Number(subIncluded) || 0));
    const extVal = roundCredits(Math.max(0, Number(subExtra) || 0));
    if (!CrmSubscription || !subscriptionId || (incVal <= 0 && extVal <= 0)) {
        return null;
    }

    const filter = { _id: subscriptionId };
    const inc = {};
    if (incVal > 0) {
        filter.includedAiUsed = { $gte: Math.max(0, incVal - 1e-6) };
        inc.includedAiUsed = -incVal;
    }
    if (extVal > 0) {
        inc.extraAiRemaining = extVal;
    }

    const updated = await CrmSubscription.findOneAndUpdate(filter, { $inc: inc }, { new: true });
    if (updated || incVal <= 0) {
        return updated;
    }

    // Fallback if includedAiUsed was reset concurrently below incVal: refund only extra
    const fallbackInc = extVal > 0 ? { extraAiRemaining: extVal } : null;
    if (fallbackInc) {
        return CrmSubscription.findOneAndUpdate({ _id: subscriptionId }, { $inc: fallbackInc }, { new: true });
    }
    return CrmSubscription.findById(subscriptionId);
}

/**
 * Atomically reserves estimated AI Credits from subscription (`included` -> `extra`) and user wallet
 * BEFORE calling the upstream AI provider. Prevents concurrent lost-updates and low-balance prompt abuse.
 */
export async function reserveCrmAiCreditsAtomic({
    CrmSubscription,
    User,
    subscriptionId,
    userId,
    estimatedCredits = AI_MIN_CHARGE_CREDITS,
    isUnlimitedRole = false
}) {
    if (isUnlimitedRole) {
        return {
            ok: true,
            isUnlimitedRole: true,
            reservedCredits: 0,
            subIncluded: 0,
            subExtra: 0,
            walletReserved: 0,
            latestSub: await CrmSubscription.findById(subscriptionId),
            latestWalletBalance: null
        };
    }

    const reserveTarget = roundCredits(Math.max(AI_MIN_CHARGE_CREDITS, Number(estimatedCredits) || AI_MIN_CHARGE_CREDITS));
    const subDebit = await debitSubscriptionCreditsAtomic({
        CrmSubscription,
        subscriptionId,
        targetCredits: reserveTarget
    });

    if (!subDebit.sub || subDebit.sub.status !== 'active') {
        if (subDebit.totalDebited > 0) {
            await refundSubscriptionCreditsAtomic({
                CrmSubscription,
                subscriptionId,
                subIncluded: subDebit.subIncluded,
                subExtra: subDebit.subExtra
            });
        }
        return {
            ok: false,
            statusCode: 403,
            message: 'Gói Alpha CRM không hoạt động hoặc đã hết hạn.'
        };
    }

    const remNeed = roundCredits(Math.max(0, reserveTarget - subDebit.totalDebited));
    let walletReserved = 0;
    let latestWalletBalance = null;

    if (remNeed > 0) {
        const debitedUser = await User.findOneAndUpdate(
            { _id: userId, balance: { $gte: Math.max(0, remNeed - 1e-6) } },
            { $inc: { balance: -remNeed } },
            { new: true }
        );
        if (!debitedUser) {
            await refundSubscriptionCreditsAtomic({
                CrmSubscription,
                subscriptionId,
                subIncluded: subDebit.subIncluded,
                subExtra: subDebit.subExtra
            });
            return {
                ok: false,
                statusCode: 403,
                message: 'Hết hạn mức AI Credit. Vui lòng nạp thêm Credit hoặc mua gói AI Top-up.'
            };
        }
        walletReserved = remNeed;
        latestWalletBalance = roundCredits(debitedUser.balance);
    }

    return {
        ok: true,
        isUnlimitedRole: false,
        reservedCredits: roundCredits(subDebit.totalDebited + walletReserved),
        subIncluded: subDebit.subIncluded,
        subExtra: subDebit.subExtra,
        walletReserved,
        latestSub: subDebit.sub,
        latestWalletBalance
    };
}

/**
 * Atomically refunds a pre-call reservation when the upstream AI call fails.
 */
export async function refundCrmAiCreditsAtomic({
    CrmSubscription,
    User,
    subscriptionId,
    userId,
    reservation
}) {
    if (!reservation || reservation.isUnlimitedRole) {
        return;
    }
    await refundSubscriptionCreditsAtomic({
        CrmSubscription,
        subscriptionId,
        subIncluded: reservation.subIncluded,
        subExtra: reservation.subExtra
    });
    const walletVal = roundCredits(Math.max(0, Number(reservation.walletReserved) || 0));
    if (walletVal > 0) {
        await User.findOneAndUpdate(
            { _id: userId },
            { $inc: { balance: walletVal } },
            { new: true }
        );
    }
}

/**
 * Atomically reconciles pre-call reserved credits against actual token billing after upstream success.
 */
export async function settleCrmAiCreditsAtomic({
    CrmSubscription,
    User,
    subscriptionId,
    userId,
    reservation,
    actualCredits
}) {
    if (!reservation || reservation.isUnlimitedRole) {
        return {
            chargedCredits: 0,
            unbilledCredits: 0,
            subIncluded: 0,
            subExtra: 0,
            walletSpent: 0,
            bucketUsed: 'none',
            latestSub: reservation?.latestSub || await CrmSubscription.findById(subscriptionId),
            latestWalletBalance: null
        };
    }

    const target = roundCredits(Math.max(0, Number(actualCredits) || 0));
    const reserved = roundCredits(reservation.reservedCredits || 0);
    let subIncluded = roundCredits(reservation.subIncluded || 0);
    let subExtra = roundCredits(reservation.subExtra || 0);
    let walletSpent = roundCredits(reservation.walletReserved || 0);
    let latestSub = reservation.latestSub || null;
    let latestWalletBalance = reservation.latestWalletBalance ?? null;

    if (target < reserved) {
        let excess = roundCredits(reserved - target);
        const refundWallet = roundCredits(Math.min(walletSpent, excess));
        if (refundWallet > 0) {
            const refundedUser = await User.findOneAndUpdate(
                { _id: userId },
                { $inc: { balance: refundWallet } },
                { new: true }
            );
            walletSpent = roundCredits(walletSpent - refundWallet);
            excess = roundCredits(excess - refundWallet);
            if (refundedUser) {
                latestWalletBalance = roundCredits(refundedUser.balance);
            }
        }

        const refundExt = roundCredits(Math.min(subExtra, excess));
        const refundInc = roundCredits(Math.min(subIncluded, Math.max(0, roundCredits(excess - refundExt))));
        if (refundExt > 0 || refundInc > 0) {
            const updatedSub = await refundSubscriptionCreditsAtomic({
                CrmSubscription,
                subscriptionId,
                subIncluded: refundInc,
                subExtra: refundExt
            });
            subExtra = roundCredits(subExtra - refundExt);
            subIncluded = roundCredits(subIncluded - refundInc);
            if (updatedSub) {
                latestSub = updatedSub;
            }
        }
    } else if (target > reserved) {
        const delta = roundCredits(target - reserved);
        const extraSubDebit = await debitSubscriptionCreditsAtomic({
            CrmSubscription,
            subscriptionId,
            targetCredits: delta
        });
        subIncluded = roundCredits(subIncluded + extraSubDebit.subIncluded);
        subExtra = roundCredits(subExtra + extraSubDebit.subExtra);
        if (extraSubDebit.sub) {
            latestSub = extraSubDebit.sub;
        }

        let remDelta = roundCredits(Math.max(0, delta - extraSubDebit.totalDebited));
        for (let attempt = 0; attempt < 3 && remDelta > 0; attempt += 1) {
            const fullDebit = await User.findOneAndUpdate(
                { _id: userId, balance: { $gte: Math.max(0, remDelta - 1e-6) } },
                { $inc: { balance: -remDelta } },
                { new: true }
            );
            if (fullDebit) {
                walletSpent = roundCredits(walletSpent + remDelta);
                latestWalletBalance = roundCredits(fullDebit.balance);
                remDelta = 0;
                break;
            }
            const freshUser = await User.findById(userId);
            const avail = roundCredits(Math.max(0, Number(freshUser?.balance || 0)));
            if (avail <= 0) {
                latestWalletBalance = 0;
                break;
            }
            const take = roundCredits(Math.min(avail, remDelta));
            const partialDebit = await User.findOneAndUpdate(
                { _id: userId, balance: { $gte: Math.max(0, take - 1e-6) } },
                { $inc: { balance: -take } },
                { new: true }
            );
            if (partialDebit) {
                walletSpent = roundCredits(walletSpent + take);
                latestWalletBalance = roundCredits(partialDebit.balance);
                remDelta = roundCredits(remDelta - take);
                break;
            }
        }
    }

    const subUsed = roundCredits(subIncluded + subExtra);
    const chargedCredits = roundCredits(subUsed + walletSpent);
    const bucketUsed = subUsed > 0 && walletSpent > 0
        ? 'mixed'
        : walletSpent > 0
            ? 'wallet'
            : subIncluded > 0 && subExtra > 0
                ? 'mixed'
                : subIncluded > 0
                    ? 'included'
                    : subExtra > 0
                        ? 'extra'
                        : 'none';

    return {
        chargedCredits,
        unbilledCredits: roundCredits(Math.max(0, target - chargedCredits)),
        subIncluded,
        subExtra,
        walletSpent,
        bucketUsed,
        latestSub,
        latestWalletBalance
    };
}
