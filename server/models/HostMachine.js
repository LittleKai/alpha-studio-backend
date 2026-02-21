import mongoose from 'mongoose';

const hostMachineSchema = new mongoose.Schema({
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
        enum: ['available', 'busy', 'offline'],
        default: 'offline'
    },
    specs: {
        cpu: { type: String, default: '' },
        ram: { type: String, default: '' },
        gpu: { type: String, default: '' }
    },
    maxContainers: {
        type: Number,
        default: 5
    },
    currentContainers: {
        type: Number,
        default: 0
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

hostMachineSchema.index({ status: 1, enabled: 1 });
hostMachineSchema.index({ machineId: 1 }, { unique: true });

export default mongoose.model('HostMachine', hostMachineSchema);
