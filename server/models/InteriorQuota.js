import mongoose from 'mongoose';

const interiorQuotaSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    bucket: { type: String, required: true },
    count: { type: Number, default: 0 },
    windowStart: { type: Date, required: true }
}, { timestamps: true });

interiorQuotaSchema.index({ userId: 1, bucket: 1, windowStart: 1 }, { unique: true });

export default mongoose.models.InteriorQuota
    || mongoose.model('InteriorQuota', interiorQuotaSchema, 'interior_quota');
