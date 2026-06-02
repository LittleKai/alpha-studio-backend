import mongoose from 'mongoose';

const crmTaskSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
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
    relatedType: {
        type: String,
        enum: ['customer', 'group', 'conversation', 'insight', 'manual'],
        default: 'manual',
        index: true
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmCustomer',
        default: null,
        index: true
    },
    groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmZaloGroup',
        default: null
    },
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmConversation',
        default: null
    },
    insightId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmGroupInsight',
        default: null
    },
    dueAt: {
        type: Date,
        default: null,
        index: true
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
    },
    ownerNote: {
        type: String,
        default: ''
    },
    leadScoreSnapshot: {
        type: Number,
        default: 0
    },
    manualScoreAdjustment: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

crmTaskSchema.index({ userId: 1, status: 1, dueAt: 1 });
crmTaskSchema.index({ userId: 1, priority: 1, createdAt: -1 });

const CrmTask = mongoose.model('CrmTask', crmTaskSchema);

export default CrmTask;
