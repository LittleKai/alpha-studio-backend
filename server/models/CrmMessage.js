import mongoose from 'mongoose';
import { CRM_MESSAGE_TYPES } from '../utils/crmLiveChat.js';

const crmMessageSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmConversation',
        required: true,
        index: true
    },
    deviceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmDevice',
        default: null,
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
        default: 'user'
    },
    direction: {
        type: String,
        enum: ['inbound', 'outbound'],
        required: true,
        index: true
    },
    senderId: {
        type: String,
        trim: true,
        default: ''
    },
    senderName: {
        type: String,
        trim: true,
        default: ''
    },
    content: {
        type: String,
        default: '',
        maxlength: 16000
    },
    messageType: {
        type: String,
        enum: CRM_MESSAGE_TYPES,
        default: 'text'
    },
    attachments: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    providerMessageId: {
        type: String,
        trim: true,
        default: ''
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    status: {
        type: String,
        enum: ['received', 'queued', 'sent', 'delivered', 'failed', 'recalled'],
        default: 'received',
        index: true
    },
    errorMessage: {
        type: String,
        default: ''
    },
    receivedAt: {
        type: Date,
        default: null
    },
    sentAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

crmMessageSchema.virtual('zaloMsgId').get(function getZaloMsgId() {
    return this.providerMessageId;
});

crmMessageSchema.set('toJSON', { virtuals: true });
crmMessageSchema.set('toObject', { virtuals: true });

crmMessageSchema.index({ conversationId: 1, createdAt: -1 });
crmMessageSchema.index(
    { userId: 1, accountId: 1, providerMessageId: 1 },
    {
        unique: true,
        partialFilterExpression: { providerMessageId: { $type: 'string', $gt: '' } }
    }
);

const CrmMessage = mongoose.model('CrmMessage', crmMessageSchema);

export default CrmMessage;
