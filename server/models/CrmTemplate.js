import mongoose from 'mongoose';

const crmTemplateSchema = new mongoose.Schema({
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
    subject: {
        type: String,
        trim: true,
        default: ''
    },
    body: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['email', 'zalo', 'sms'],
        default: 'zalo'
    },
    variables: [{
        type: String
    }],
    category: {
        type: String,
        default: 'general',
        trim: true
    },
    shortcut: {
        type: String,
        default: '',
        trim: true
    },
    isQuick: {
        type: Boolean,
        default: false,
        index: true
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    language: {
        type: String,
        default: 'vi'
    },
    lastUsedAt: {
        type: Date,
        default: null
    },
    usageCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

const CrmTemplate = mongoose.model('CrmTemplate', crmTemplateSchema);

export default CrmTemplate;
