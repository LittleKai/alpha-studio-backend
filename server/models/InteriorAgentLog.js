import mongoose from 'mongoose';

const interiorAgentStepSchema = new mongoose.Schema({
    index: Number,
    thought: String,
    tool: String,
    args: mongoose.Schema.Types.Mixed,
    result: mongoose.Schema.Types.Mixed,
    latencyMs: Number,
    model: { type: String, default: '' },
    tokens: {
        type: {
            prompt: { type: Number, default: 0 },
            completion: { type: Number, default: 0 },
            total: { type: Number, default: 0 }
        },
        default: null
    },
    retries: { type: Number, default: 0 },
    error: { type: String, default: '' }
}, { _id: false });

const interiorAgentLogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'InteriorProject', required: true, index: true },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    // 'running' added for in-flight runs; 'paused' for resumable runs (maxSteps,
    // disconnect, rate-limit exhaustion). Terminal states ('committed', 'aborted',
    // 'error') don't write back to the run record after they finalize.
    status: { type: String, enum: ['running', 'paused', 'committed', 'aborted', 'maxSteps', 'error'], default: 'running', index: true },
    stepsCount: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    finalReply: { type: String, default: '' },
    abortReason: { type: String, default: '' },
    steps: { type: [interiorAgentStepSchema], default: [] },

    // Resume support: full LLM message buffer + current draft model. On resume,
    // runner rehydrates these so AI continues from the exact conversation
    // state, including any error feedback messages that were appended.
    messages: { type: [mongoose.Schema.Types.Mixed], default: [] },
    draftModel: { type: mongoose.Schema.Types.Mixed, default: null },
    userPrompt: { type: String, default: '' },
    refImageUrls: { type: [String], default: [] },
    selectedModel: { type: String, default: '' },
    delegateFlash: { type: Boolean, default: false },
    nextTurnModel: { type: String, default: '' },
    lastActiveAt: { type: Date, default: Date.now, index: true },

    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), expires: 0 }
}, { timestamps: true });

interiorAgentLogSchema.index({ userId: 1, createdAt: -1 });
interiorAgentLogSchema.index({ projectId: 1, createdAt: -1 });
interiorAgentLogSchema.index({ userId: 1, status: 1, lastActiveAt: -1 });

export default mongoose.model('InteriorAgentLog', interiorAgentLogSchema);
