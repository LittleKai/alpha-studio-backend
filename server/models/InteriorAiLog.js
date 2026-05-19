import mongoose from 'mongoose';

const LOG_TTL_SECONDS = 30 * 24 * 60 * 60;

const interiorAiLogSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'InteriorProject', required: true, index: true },
        stage: { type: String, enum: ['proposal', 'apply'], required: true },
        model: { type: String, default: '' },
        versionIndex: { type: Number, default: null },
        prompt: { type: String, default: '' },
        refImageUrls: { type: [String], default: [] },
        rawResponse: { type: String, default: '' },
        parsedReply: { type: String, default: '' },
        latencyMs: { type: Number, default: null },
        usage: {
            type: {
                promptTokens: Number,
                completionTokens: Number,
                totalTokens: Number
            },
            default: null
        },
        status: { type: String, enum: ['ok', 'parse-failed', 'validation-failed', 'upstream-error'], required: true },
        errorMessage: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now, expires: LOG_TTL_SECONDS }
    },
    { versionKey: false }
);

interiorAiLogSchema.index({ projectId: 1, createdAt: -1 });
interiorAiLogSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('InteriorAiLog', interiorAiLogSchema);
