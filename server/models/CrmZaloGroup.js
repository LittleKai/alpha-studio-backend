import mongoose from 'mongoose';

const crmZaloGroupSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    deviceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmDevice',
        default: null,
        index: true
    },
    accountId: {
        type: String,
        required: true,
        trim: true
    },
    groupId: {
        type: String,
        required: true,
        trim: true
    },
    name: {
        type: String,
        trim: true,
        default: ''
    },
    avatarUrl: {
        type: String,
        trim: true,
        default: ''
    },
    memberCount: {
        type: Number,
        default: 0
    },
    role: {
        type: String,
        trim: true,
        default: 'member'
    },
    isManaged: {
        type: Boolean,
        default: false,
        index: true
    },
    managedSince: {
        type: Date,
        default: null
    },
    lastSyncedAt: {
        type: Date,
        default: null
    },
    lastMessageAt: {
        type: Date,
        default: null
    },
    summaryCadence: {
        type: String,
        enum: ['manual', 'daily', 'weekly'],
        default: 'manual'
    },
    tags: [{
        type: String,
        trim: true
    }],
    notes: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

crmZaloGroupSchema.index({ userId: 1, accountId: 1, groupId: 1 }, { unique: true });
crmZaloGroupSchema.index({ userId: 1, isManaged: 1, lastMessageAt: -1 });

const CrmZaloGroup = mongoose.model('CrmZaloGroup', crmZaloGroupSchema);

export default CrmZaloGroup;
