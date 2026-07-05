import mongoose from 'mongoose';

const crmChannelIntegrationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    channel: {
        type: String,
        enum: ['facebook_page', 'tiktok'],
        required: true
    },
    externalAccountId: {
        type: String,
        required: true,
        trim: true
    },
    appId: {
        type: String,
        trim: true,
        default: ''
    },
    verifyToken: {
        type: String,
        required: true
    },
    appSecret: {
        type: String,
        required: true
    },
    enabled: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

crmChannelIntegrationSchema.index({ userId: 1, channel: 1 });
crmChannelIntegrationSchema.index({ channel: 1, externalAccountId: 1 }, { unique: true });

const CrmChannelIntegration = mongoose.model('CrmChannelIntegration', crmChannelIntegrationSchema);

export default CrmChannelIntegration;
