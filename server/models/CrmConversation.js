import mongoose from 'mongoose';

const crmConversationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    deviceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmDevice',
        default: null,
        index: true
    },
    channel: {
        type: String,
        enum: ['zalo_personal', 'zalo_oa', 'facebook_page', 'tiktok', 'instagram', 'whatsapp', 'telegram', 'webchat'],
        default: 'zalo_personal',
        index: true
    },
    accountId: {
        type: String,
        required: true,
        trim: true
    },
    threadId: {
        type: String,
        required: true,
        trim: true
    },
    threadType: {
        type: String,
        enum: ['user', 'group'],
        default: 'user',
        index: true
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmCustomer',
        default: null,
        index: true
    },
    displayName: {
        type: String,
        trim: true,
        default: ''
    },
    avatarUrl: {
        type: String,
        trim: true,
        default: ''
    },
    lastMessagePreview: {
        type: String,
        default: ''
    },
    lastMessageAt: {
        type: Date,
        default: null,
        index: true
    },
    unreadCount: {
        type: Number,
        default: 0
    },
    tags: [{
        type: String,
        trim: true
    }],
    notes: {
        type: String,
        default: ''
    },
    assignedStatus: {
        type: String,
        enum: ['open', 'pending', 'resolved'],
        default: 'open',
        index: true
    },
    chatbotEnabled: {
        type: Boolean,
        default: false
    },
    lastInboundAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

crmConversationSchema.index({ userId: 1, accountId: 1, threadId: 1, threadType: 1 }, { unique: true });
crmConversationSchema.index({ userId: 1, lastMessageAt: -1 });

const CrmConversation = mongoose.model('CrmConversation', crmConversationSchema);

export default CrmConversation;
