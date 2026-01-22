import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false // Can be null for unmatched webhooks
    },
    amount: {
        type: Number,
        required: [true, 'Amount is required'],
        min: [1000, 'Minimum amount is 1000 VND']
    },
    credits: {
        type: Number,
        required: [true, 'Credits is required'],
        min: [0, 'Credits cannot be negative']
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
        enum: ['bank_transfer', 'momo', 'vnpay'],
        default: 'bank_transfer'
    },
    webhookData: {
        type: mongoose.Schema.Types.Mixed,
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

// Index for faster queries
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ transactionCode: 1 });
transactionSchema.index({ status: 1 });

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
