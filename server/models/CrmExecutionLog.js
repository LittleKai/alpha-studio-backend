import mongoose from 'mongoose';

const crmExecutionLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    campaignId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmCampaign',
        index: true,
        default: null
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmCustomer',
        default: null,
        index: true
    },
    channel: {
        type: String,
        enum: ['email', 'zalo', 'sms'],
        default: 'zalo'
    },
    status: {
        type: String,
        enum: ['queued', 'running', 'success', 'failed', 'cancelled'],
        required: true,
        index: true
    },
    details: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    errorMessage: {
        type: String,
        default: ''
    },
    deviceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmDevice',
        default: null
    },
    accountId: {
        type: String,
        default: null
    },
    templateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmTemplate',
        default: null
    },
    recipientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmCustomer',
        default: null
    },
    recipientPhone: {
        type: String,
        default: ''
    },
    recipientName: {
        type: String,
        default: ''
    },
    threadType: {
        type: String,
        default: 'zalo'
    },
    messagePreview: {
        type: String,
        default: ''
    },
    providerMessageId: {
        type: String,
        default: ''
    },
    attemptedAt: {
        type: Date,
        default: null
    },
    sentAt: {
        type: Date,
        default: null
    },
    deliveredAt: {
        type: Date,
        default: null
    },
    failedAt: {
        type: Date,
        default: null
    },
    campaignSnapshot: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    }
}, {
    timestamps: true
});

crmExecutionLogSchema.index({ userId: 1, campaignId: 1 });

const CrmExecutionLog = mongoose.model('CrmExecutionLog', crmExecutionLogSchema);

export default CrmExecutionLog;
