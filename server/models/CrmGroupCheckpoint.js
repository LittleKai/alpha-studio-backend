import mongoose from 'mongoose';

const crmGroupCheckpointSchema = new mongoose.Schema({
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
    name: {
        type: String,
        required: true,
        trim: true
    },
    fromAt: {
        type: Date,
        required: true
    },
    toAt: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['open', 'summarized', 'archived'],
        default: 'open',
        index: true
    },
    messageCount: {
        type: Number,
        default: 0
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    }
}, {
    timestamps: true
});

crmGroupCheckpointSchema.index({ userId: 1, groupId: 1, createdAt: -1 });

const CrmGroupCheckpoint = mongoose.model('CrmGroupCheckpoint', crmGroupCheckpointSchema);

export default CrmGroupCheckpoint;
