import mongoose from 'mongoose';

const interiorAgentStepSchema = new mongoose.Schema({
    index: Number,
    thought: String,
    tool: String,
    args: mongoose.Schema.Types.Mixed,
    result: mongoose.Schema.Types.Mixed,
    latencyMs: Number
}, { _id: false });

const interiorAgentLogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'InteriorProject', required: true, index: true },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    status: { type: String, enum: ['committed', 'aborted', 'maxSteps', 'error'], default: 'error', index: true },
    stepsCount: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    finalReply: { type: String, default: '' },
    abortReason: { type: String, default: '' },
    steps: { type: [interiorAgentStepSchema], default: [] },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), expires: 0 }
}, { timestamps: true });

interiorAgentLogSchema.index({ userId: 1, createdAt: -1 });
interiorAgentLogSchema.index({ projectId: 1, createdAt: -1 });

export default mongoose.model('InteriorAgentLog', interiorAgentLogSchema);
