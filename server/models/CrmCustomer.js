import mongoose from 'mongoose';

const crmCustomerSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        trim: true,
        lowercase: true,
        default: ''
    },
    phone: {
        type: String,
        trim: true,
        default: ''
    },
    company: {
        type: String,
        trim: true,
        default: ''
    },
    notes: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['lead', 'contact', 'customer', 'inactive'],
        default: 'lead',
        index: true
    },
    zaloUserId: {
        type: String,
        trim: true,
        default: ''
    },
    zaloThreadId: {
        type: String,
        trim: true,
        default: ''
    },
    tags: [{
        type: String,
        trim: true
    }],
    source: {
        type: String,
        trim: true,
        default: ''
    },
    lifecycleStage: {
        type: String,
        enum: ['lead', 'subscriber', 'opportunity', 'customer', 'evangelist', 'other'],
        default: 'lead'
    },
    consentStatus: {
        type: String,
        enum: ['granted', 'revoked', 'pending'],
        default: 'pending'
    },
    consentEvidence: {
        type: String,
        default: ''
    },
    lastInteractionAt: {
        type: Date,
        default: null
    },
    lastMessageAt: {
        type: Date,
        default: null
    },
    customFields: {
        type: Map,
        of: String,
        default: {}
    }
}, {
    timestamps: true
});

crmCustomerSchema.index({ userId: 1, createdAt: -1 });
crmCustomerSchema.index({ userId: 1, phone: 1 });
crmCustomerSchema.index({ userId: 1, zaloUserId: 1 });
crmCustomerSchema.index({ userId: 1, tags: 1 });
crmCustomerSchema.index({ userId: 1, lifecycleStage: 1 });

const CrmCustomer = mongoose.model('CrmCustomer', crmCustomerSchema);

export default CrmCustomer;
