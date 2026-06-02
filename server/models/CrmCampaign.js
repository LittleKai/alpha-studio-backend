import mongoose from 'mongoose';

const crmCampaignSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    templateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmTemplate',
        required: true
    },
    targetCustomerIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmCustomer'
    }],
    targetGroupIds: [{
        type: String
    }],
    manualRecipients: [{
        phone: { type: String, default: '' },
        name: { type: String, default: '' }
    }],
    channel: {
        type: String,
        enum: ['email', 'zalo', 'sms'],
        default: 'zalo'
    },
    status: {
        type: String,
        enum: ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'],
        default: 'draft',
        index: true
    },
    scheduledAt: {
        type: Date,
        default: null
    },
    startedAt: {
        type: Date,
        default: null
    },
    finishedAt: {
        type: Date,
        default: null
    },
    audienceType: {
        type: String,
        enum: ['all', 'tags', 'lifecycleStage', 'list', 'custom', 'groups', 'friends', 'manual'],
        default: 'all'
    },
    targetSummary: {
        type: String,
        default: ''
    },
    selectedDeviceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmDevice',
        default: null
    },
    selectedAccountId: {
        type: String,
        default: null
    },
    rateLimit: {
        minDelaySeconds: { type: Number, default: 3 },
        maxDelaySeconds: { type: Number, default: 5 },
        dailyCap: { type: Number, default: 500 }
    },
    requireHumanApproval: {
        type: Boolean,
        default: false
    },
    humanApprovedAt: {
        type: Date,
        default: null
    },
    metrics: {
        totalSent: { type: Number, default: 0 },
        totalTargets: { type: Number, default: 0 },
        successCount: { type: Number, default: 0 },
        failedCount: { type: Number, default: 0 },
        cancelledCount: { type: Number, default: 0 }
    },
    lastProgressAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

crmCampaignSchema.index({ userId: 1, status: 1 });

const CrmCampaign = mongoose.model('CrmCampaign', crmCampaignSchema);

export default CrmCampaign;
