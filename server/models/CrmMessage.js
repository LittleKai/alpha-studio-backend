import mongoose from 'mongoose';

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
        enum: ['text', 'image', 'file', 'sticker', 'unknown'],
        default: 'text'
    },
    providerMessageId: {
        type: String,
        trim: true,
        default: ''
    },
    status: {
        type: String,
        enum: ['received', 'queued', 'sent', 'delivered', 'failed'],
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
