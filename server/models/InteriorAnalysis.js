import mongoose from 'mongoose';
import { noInlineMediaPlugin } from '../validation/inlineMedia.js';

const interiorAnalysisSchema = new mongoose.Schema({
    cacheKey: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    imageUrl: { type: String, required: true },
    hints: { type: String, default: '' },
    modelJson: { type: mongoose.Schema.Types.Mixed, required: true },
    usedModel: { type: String, default: '' },
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
        index: { expires: 0 }
    }
}, { timestamps: true });

interiorAnalysisSchema.plugin(noInlineMediaPlugin);

export default mongoose.models.InteriorAnalysis
    || mongoose.model('InteriorAnalysis', interiorAnalysisSchema, 'interior_analysis');
