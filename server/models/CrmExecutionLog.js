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
        required: true,
        index: true
    },
    channel: {
        type: String,
        enum: ['email', 'zalo', 'sms'],
        default: 'zalo'
    },
    status: {
        type: String,
        enum: ['success', 'failed'],
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
    }
}, {
    timestamps: true
});

crmExecutionLogSchema.index({ userId: 1, campaignId: 1 });

const CrmExecutionLog = mongoose.model('CrmExecutionLog', crmExecutionLogSchema);

export default CrmExecutionLog;
