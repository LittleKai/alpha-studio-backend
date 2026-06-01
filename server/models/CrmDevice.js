import mongoose from 'mongoose';

const crmDeviceSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    subscriptionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmSubscription',
        required: true,
        index: true
    },
    machineFingerprintHash: {
        type: String,
        required: true,
        index: true
    },
    displayName: {
        type: String,
        required: true
    },
    platform: {
        type: String,
        default: 'windows'
    },
    appVersion: {
        type: String,
        default: ''
    },
    agentVersion: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['pending', 'active', 'disabled', 'replaced'],
        default: 'active',
        index: true
    },
    agentSecretHash: {
        type: String,
        required: true
    },
    pairedMobileUserIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    lastSeenAt: {
        type: Date,
        default: Date.now
    },
    lastIp: {
        type: String,
        default: ''
    },
    registeredAt: {
        type: Date,
        default: Date.now
    },
    replacedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Compound indexes
crmDeviceSchema.index({ userId: 1, status: 1 });

// Strictly enforce one active device per subscription at the database layer (race-safe)
crmDeviceSchema.index(
    { subscriptionId: 1 },
    { 
        name: 'unique_active_device_per_subscription',
        unique: true, 
        partialFilterExpression: { status: 'active' } 
    }
);

const CrmDevice = mongoose.model('CrmDevice', crmDeviceSchema);

export default CrmDevice;
