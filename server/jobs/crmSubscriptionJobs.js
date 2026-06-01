import CrmSubscription from '../models/CrmSubscription.js';
import User from '../models/User.js';
import CrmAuditLog from '../models/CrmAuditLog.js';
import { CRM_PLANS } from '../utils/crmCatalog.js';

export const runSubscriptionMaintenance = async () => {
    try {
        const now = new Date();
        const expiredSubscriptions = await CrmSubscription.find({
            status: 'active',
            periodEnd: { $lt: now }
        });

        for (const sub of expiredSubscriptions) {
            // Check auto renew
            if (sub.autoRenewCredit) {
                const plan = CRM_PLANS[sub.plan];
                if (!plan) {
                    sub.status = 'expired';
                    await sub.save();
                    continue;
                }

                const user = await User.findById(sub.userId);
                const cost = plan.priceCredits;
                
                if (user && user.balance >= cost) {
                    user.balance -= cost;
                    await user.save();

                    const oldPeriodEnd = new Date(sub.periodEnd);
                    sub.periodEnd = new Date(oldPeriodEnd.getTime() + 30 * 24 * 60 * 60 * 1000);
                    sub.includedAiUsed = 0; // reset quota
                    await sub.save();

                    await CrmAuditLog.create({
                        userId: user._id,
                        subscriptionId: sub._id,
                        action: 'subscription_auto_renewed',
                        details: { cost }
                    });
                    continue;
                }
            }
            
            // Mark expired
            sub.status = 'expired';
            await sub.save();
            await CrmAuditLog.create({
                userId: sub.userId,
                subscriptionId: sub._id,
                action: 'subscription_expired'
            });
        }
        console.log(`Processed ${expiredSubscriptions.length} subscriptions for expiry/renewal.`);
    } catch (error) {
        console.error('Error in runSubscriptionMaintenance:', error);
    }
};
