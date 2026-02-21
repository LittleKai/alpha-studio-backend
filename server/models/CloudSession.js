import mongoose from 'mongoose';

const cloudSessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    hostMachineId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HostMachine',
        required: true
    },
    containerId: {
        type: String,
        required: true
    },
    noVncUrl: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'ended'],
        default: 'active'
    },
    startedAt: {
        type: Date,
        default: Date.now
    },
    endedAt: {
        type: Date,
        default: null
    },
    endReason: {
        type: String,
        enum: ['user_disconnect', 'admin_force', 'machine_offline', 'error', null],
        default: null
    }
}, { timestamps: true });

cloudSessionSchema.index({ userId: 1, status: 1 });
cloudSessionSchema.index({ hostMachineId: 1, status: 1 });
cloudSessionSchema.index({ status: 1, startedAt: 1 });

export default mongoose.model('CloudSession', cloudSessionSchema);
