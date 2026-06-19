import mongoose from 'mongoose';

const crmSubscriptionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    status: {
        type: String,
        enum: ['active', 'expired', 'cancelled', 'past_due'],
        default: 'active',
        index: true
    },
    plan: {
        type: String,
        default: 'crm_monthly'
    },
    entitlementType: {
        type: String,
        enum: ['trial', 'paid'],
        default: 'paid',
        index: true
    },
    periodStart: {
        type: Date,
        default: Date.now
    },
    periodEnd: {
        type: Date,
        required: true
    },
    includedAiLimit: {
        type: Number,
        default: 500
    },
    includedAiUsed: {
        type: Number,
        default: 0
    },
    extraAiRemaining: {
        type: Number,
        default: 0
    },
    deviceLimit: {
        type: Number,
        default: 1
    },
    autoRenewCredit: {
        type: Boolean,
        default: false
    },
    lastRenewedAt: {
        type: Date,
        default: Date.now
    },
    trialStartedAt: {
        type: Date,
        default: null
    },
    cancelledAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Composite index for quick status queries per user
crmSubscriptionSchema.index({ userId: 1, status: 1 });
crmSubscriptionSchema.index(
    { userId: 1, entitlementType: 1 },
    {
        unique: true,
        partialFilterExpression: { entitlementType: 'trial' },
        name: 'unique_trial_subscription_per_user'
    }
);

const CrmSubscription = mongoose.model('CrmSubscription', crmSubscriptionSchema);

export default CrmSubscription;
