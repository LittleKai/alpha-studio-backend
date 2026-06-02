import mongoose from 'mongoose';

const crmGroupInsightSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmZaloGroup',
        required: true,
        index: true
    },
    summaryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmGroupSummary',
        default: null,
        index: true
    },
    type: {
        type: String,
        enum: ['opportunity', 'risk', 'question', 'follow_up'],
        default: 'opportunity',
        index: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ''
    },
    recommendedAction: {
        type: String,
        default: ''
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium',
        index: true
    },
    status: {
        type: String,
        enum: ['open', 'done', 'dismissed'],
        default: 'open',
        index: true
    }
}, {
    timestamps: true
});

crmGroupInsightSchema.index({ userId: 1, status: 1, priority: 1, createdAt: -1 });

const CrmGroupInsight = mongoose.model('CrmGroupInsight', crmGroupInsightSchema);

export default CrmGroupInsight;
