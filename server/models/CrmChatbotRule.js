import mongoose from 'mongoose';

const crmChatbotRuleSchema = new mongoose.Schema({
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
    description: {
        type: String,
        trim: true,
        default: '',
        maxlength: 1000
    },
    keywords: [{
        type: String,
        trim: true
    }],
    matchMode: {
        type: String,
        enum: ['contains', 'exact', 'startsWith'],
        default: 'contains'
    },
    response: {
        type: String,
        required: true,
        maxlength: 8000
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    priority: {
        type: Number,
        default: 100,
        index: true
    },
    channelScope: {
        type: String,
        enum: ['all', 'user', 'group'],
        default: 'user'
    },
    handoffKeywords: [{
        type: String,
        trim: true
    }],
    // Zalo account ids this rule applies to. Empty = all accounts (default).
    accountIds: [{
        type: String,
        trim: true
    }],
    businessHours: {
        enabled: { type: Boolean, default: false },
        timezone: { type: String, default: 'Asia/Ho_Chi_Minh' },
        days: [{ type: Number }],
        start: { type: String, default: '08:00' },
        end: { type: String, default: '18:00' }
    }
}, {
    timestamps: true
});

crmChatbotRuleSchema.index({ userId: 1, isActive: 1, priority: 1 });

const CrmChatbotRule = mongoose.model('CrmChatbotRule', crmChatbotRuleSchema);

export default CrmChatbotRule;
