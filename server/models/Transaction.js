import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false // Can be null for unmatched webhooks
    },

    // Transaction type
    type: {
        type: String,
        enum: ['topup', 'spend', 'refund', 'manual_topup', 'bonus'],
        default: 'topup',
        index: true
    },

    amount: {
        type: Number,
        required: [true, 'Amount is required'],
        min: [0, 'Amount cannot be negative']
    },
    credits: {
        type: Number,
        required: [true, 'Credits is required']
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'cancelled'],
        default: 'pending'
    },
    transactionCode: {
        type: String,
        required: [true, 'Transaction code is required'],
        unique: true,
        trim: true,
        uppercase: true
    },
    paymentMethod: {
        type: String,
        enum: ['bank_transfer', 'momo', 'vnpay', 'manual', 'system'],
        default: 'bank_transfer'
    },

    // Service usage tracking (for spend transactions)
    serviceType: {
        type: String,
        enum: ['gpu_rental', 'course', 'job_post', 'partner_fee', 'other', null],
        default: null
    },
    serviceDetails: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },

    webhookData: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    webhookLogId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WebhookLog',
        default: null
    },
    bankTransactionId: {
        type: String,
        default: null
    },
    description: {
        type: String,
        default: ''
    },

    // Admin processing
    processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    adminNote: {
        type: String,
        default: null
    },

    processedAt: {
        type: Date,
        default: null
    },
    failedReason: {
        type: String,
        default: null
    },
    expiresAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Indexes for faster queries
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ transactionCode: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ type: 1, createdAt: -1 });
transactionSchema.index({ serviceType: 1 });
transactionSchema.index({ processedBy: 1 });
transactionSchema.index({ createdAt: -1 });

// Virtual for formatted amount
transactionSchema.virtual('formattedAmount').get(function() {
    return new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND'
    }).format(this.amount);
});

// Ensure virtuals are included in JSON output
transactionSchema.set('toJSON', { virtuals: true });
transactionSchema.set('toObject', { virtuals: true });

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;
