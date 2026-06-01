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
    }
}, {
    timestamps: true
});

crmCustomerSchema.index({ userId: 1, createdAt: -1 });

const CrmCustomer = mongoose.model('CrmCustomer', crmCustomerSchema);

export default CrmCustomer;
