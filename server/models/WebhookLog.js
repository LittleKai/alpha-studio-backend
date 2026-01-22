import mongoose from 'mongoose';

const webhookLogSchema = new mongoose.Schema({
    // Source of webhook (casso, momo, vnpay, etc.)
    source: {
        type: String,
        required: true,
        enum: ['casso', 'momo', 'vnpay', 'manual', 'other'],
        index: true
    },

    // Raw payload received
    payload: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },

    // Parsed/extracted data
    parsedData: {
        transactionCode: String,
        amount: Number,
        description: String,
        bankTransactionId: String,
        when: Date
    },

    // Processing status
    status: {
        type: String,
        enum: ['received', 'processing', 'matched', 'unmatched', 'error', 'ignored'],
        default: 'received',
        index: true
    },

    // If matched to a transaction
    matchedTransactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction',
        default: null
    },

    // If matched to a user
    matchedUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

    // Error message if processing failed
    errorMessage: {
        type: String,
        default: null
    },

    // Processing details/notes
    processingNotes: {
        type: String,
        default: null
    },

    // IP address of webhook sender
    ipAddress: {
        type: String,
        default: null
    },

    // Headers received
    headers: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    }
}, {
    timestamps: true
});

// Indexes for efficient querying
webhookLogSchema.index({ createdAt: -1 });
webhookLogSchema.index({ 'parsedData.transactionCode': 1 });
webhookLogSchema.index({ source: 1, status: 1 });

const WebhookLog = mongoose.model('WebhookLog', webhookLogSchema);

export default WebhookLog;
