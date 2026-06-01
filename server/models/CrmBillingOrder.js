import mongoose from 'mongoose';

const crmBillingOrderSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    productId: {
        type: String,
        required: true
    },
    orderType: {
        type: String,
        enum: ['subscription', 'ai_pack'],
        required: true
    },
    paymentMethod: {
        type: String,
        enum: ['credit', 'bank_transfer'],
        required: true
    },
    amountVnd: {
        type: Number,
        required: true
    },
    credits: {
        type: Number,
        required: true
    },
    transactionCode: {
        type: String,
        required: true,
        unique: true,
        index: true,
        uppercase: true,
        trim: true
    },
    status: {
        type: String,
        enum: ['pending', 'fulfilling', 'paid', 'cancelled', 'expired', 'failed'],
        default: 'pending',
        index: true
    },
    fulfilledAt: {
        type: Date,
        default: null
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true
});

const CrmBillingOrder = mongoose.model('CrmBillingOrder', crmBillingOrderSchema);

export default CrmBillingOrder;
