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
    cancelledAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Composite index for quick status queries per user
crmSubscriptionSchema.index({ userId: 1, status: 1 });

const CrmSubscription = mongoose.model('CrmSubscription', crmSubscriptionSchema);

export default CrmSubscription;
