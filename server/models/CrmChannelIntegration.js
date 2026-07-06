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
        enum: ['facebook_page', 'tiktok', 'instagram', 'whatsapp', 'telegram', 'webchat'],
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
        type: String
    },
    appSecret: {
        type: String
    },
    botToken: {
        type: String
    },
    enabled: {
        type: Boolean,
        default: true
    },
    // Webchat-only public widget display config (no 3rd-party API for this channel,
    // so this is the only place the public config endpoint can read it from).
    widgetName: {
        type: String,
        trim: true
    },
    welcomeMessage: {
        type: String,
        trim: true
    },
    primaryColorHex: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

crmChannelIntegrationSchema.index({ userId: 1, channel: 1 });
crmChannelIntegrationSchema.index({ channel: 1, externalAccountId: 1 }, { unique: true });

const CrmChannelIntegration = mongoose.model('CrmChannelIntegration', crmChannelIntegrationSchema);

export default CrmChannelIntegration;
