import mongoose from 'mongoose';

const crmContactSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmCustomer',
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
    role: {
        type: String,
        trim: true,
        default: ''
    },
    notes: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

crmContactSchema.index({ userId: 1, customerId: 1 });

const CrmContact = mongoose.model('CrmContact', crmContactSchema);

export default CrmContact;
