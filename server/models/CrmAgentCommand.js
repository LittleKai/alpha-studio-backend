import mongoose from 'mongoose';

const crmAgentCommandSchema = new mongoose.Schema({
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
    deviceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmDevice',
        required: true,
        index: true
    },
    type: {
        type: String,
        required: true
    },
    payload: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    status: {
        type: String,
        enum: ['queued', 'sent', 'running', 'succeeded', 'failed', 'cancelled', 'expired'],
        default: 'queued',
        index: true
    },
    idempotencyKey: {
        type: String,
        index: true
    },
    result: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    errorMessage: {
        type: String,
        default: ''
    },
    queuedAt: {
        type: Date,
        default: Date.now
    },
    sentAt: {
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

// Composite index for fetching queued commands for a specific device
crmAgentCommandSchema.index({ deviceId: 1, status: 1, createdAt: 1 });

const CrmAgentCommand = mongoose.model('CrmAgentCommand', crmAgentCommandSchema);

export default CrmAgentCommand;
