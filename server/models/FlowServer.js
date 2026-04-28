import mongoose from 'mongoose';

const flowServerSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    machineId: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    agentUrl: {
        type: String,
        required: true,
        trim: true
    },
    secret: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['available', 'degraded', 'offline'],
        default: 'offline'
    },
    tokenValid: {
        type: Boolean,
        default: false
    },
    tokenExpiresAt: {
        type: Date,
        default: null
    },
    projectId: {
        type: String,
        default: ''
    },
    lastPingAt: {
        type: Date,
        default: null
    },
    enabled: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

flowServerSchema.index({ status: 1, enabled: 1 });

export default mongoose.model('FlowServer', flowServerSchema);
