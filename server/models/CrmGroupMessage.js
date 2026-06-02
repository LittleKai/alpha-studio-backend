import mongoose from 'mongoose';

const crmGroupMessageSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmZaloGroup',
        required: true,
        index: true
    },
    accountId: {
        type: String,
        required: true,
        trim: true
    },
    providerMessageId: {
        type: String,
        trim: true,
        default: ''
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
    sentAt: {
        type: Date,
        default: null,
        index: true
    },
    capturedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

crmGroupMessageSchema.index({ groupId: 1, sentAt: -1 });
crmGroupMessageSchema.index(
    { userId: 1, accountId: 1, providerMessageId: 1 },
    {
        unique: true,
        partialFilterExpression: { providerMessageId: { $type: 'string', $gt: '' } }
    }
);

const CrmGroupMessage = mongoose.model('CrmGroupMessage', crmGroupMessageSchema);

export default CrmGroupMessage;
