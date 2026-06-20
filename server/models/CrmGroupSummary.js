import mongoose from 'mongoose';

const crmGroupSummarySchema = new mongoose.Schema({
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
    checkpointId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmGroupCheckpoint',
        default: null,
        index: true
    },
    summaryText: {
        type: String,
        required: true
    },
    coveredFrom: {
        type: Date,
        default: null
    },
    coveredTo: {
        type: Date,
        default: null
    },
    messageCount: {
        type: Number,
        default: 0
    },
    keyTopics: [{ type: String }],
    decisions: [{ type: String }],
    questions: [{ type: String }],
    risks: [{ type: String }],
    opportunities: [{ type: String }],
    sentiment: {
        type: String,
        enum: ['positive', 'neutral', 'negative', 'mixed'],
        default: 'neutral'
    },
    aiUsageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmAiUsage',
        default: null
    },
    model: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

crmGroupSummarySchema.index({ userId: 1, groupId: 1, createdAt: -1 });

const CrmGroupSummary = mongoose.model('CrmGroupSummary', crmGroupSummarySchema);

export default CrmGroupSummary;
