import mongoose from 'mongoose';

const crmPairingSessionSchema = new mongoose.Schema({
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
    deviceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrmDevice',
        required: true,
        index: true
    },
    pairingCodeHash: {
        type: String,
        required: true,
        index: true
    },
    qrTokenHash: {
        type: String,
        required: true,
        index: true
    },
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'expired', 'cancelled'],
        default: 'pending',
        index: true
    },
    expiresAt: {
        type: Date,
        required: true,
        index: true // TTL index can be configured on MongoDB if desired
    },
    confirmedAt: {
        type: Date,
        default: null
    },
    confirmedByUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    }
}, {
    timestamps: true
});

const CrmPairingSession = mongoose.model('CrmPairingSession', crmPairingSessionSchema);

export default CrmPairingSession;
