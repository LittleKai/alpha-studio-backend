import mongoose from 'mongoose';

const crmChatbotLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmConversation',
        default: null,
        index: true
    },
    idempotencyKey: {
        type: String,
        trim: true,
        default: null
    },
    accountId: {
        type: String,
        trim: true,
        default: ''
    },
    threadId: {
        type: String,
        trim: true,
        default: ''
    },
    messageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmMessage',
        default: null
    },
    ruleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmChatbotRule',
        default: null
    },
    mode: {
        type: String,
        enum: ['keyword', 'ai', 'handoff', 'none'],
        default: 'none',
        index: true
    },
    aiUsageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmAiUsage',
        default: null
    },
    promptPreview: {
        type: String,
        default: ''
    },
    responsePreview: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['succeeded', 'failed', 'skipped'],
        default: 'succeeded',
        index: true
    },
    errorMessage: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

crmChatbotLogSchema.index({ userId: 1, createdAt: -1 });
crmChatbotLogSchema.index(
    { userId: 1, idempotencyKey: 1 },
    {
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: 'string' } }
    }
);

const CrmChatbotLog = mongoose.model('CrmChatbotLog', crmChatbotLogSchema);

export default CrmChatbotLog;
