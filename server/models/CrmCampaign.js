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
    channel: {
        type: String,
        enum: ['email', 'zalo', 'sms'],
        default: 'zalo'
    },
    status: {
        type: String,
        enum: ['draft', 'scheduled', 'running', 'completed', 'cancelled'],
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
    }
}, {
    timestamps: true
});

crmCampaignSchema.index({ userId: 1, status: 1 });

const CrmCampaign = mongoose.model('CrmCampaign', crmCampaignSchema);

export default CrmCampaign;
