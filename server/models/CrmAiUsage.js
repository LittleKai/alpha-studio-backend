import mongoose from 'mongoose';

const crmAiUsageSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    subscriptionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmSubscription',
        required: true,
        index: true
    },
    requestType: {
        type: String,
        default: 'chat'
    },
    provider: {
        type: String,
        default: 'gcli'
    },
    model: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['succeeded', 'failed'],
        required: true,
        index: true
    },
    quotaBucket: {
        type: String,
        enum: ['included', 'extra', 'none'],
        default: 'none'
    },
    tokens: {
        promptTokens: { type: Number, default: 0 },
        completionTokens: { type: Number, default: 0 },
        totalTokens: { type: Number, default: 0 }
    },
    latencyMs: {
        type: Number,
        default: 0
    },
    errorMessage: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

const CrmAiUsage = mongoose.model('CrmAiUsage', crmAiUsageSchema);

export default CrmAiUsage;
