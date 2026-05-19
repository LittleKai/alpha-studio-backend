import mongoose from 'mongoose';

const interiorRenderSchema = new mongoose.Schema({
    cacheKey: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    stylePrompt: { type: String, default: '' },
    viewUrl: { type: String, required: true },
    renderUrl: { type: String, default: '' },
    modelSnapshot: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

export default mongoose.models.InteriorRender
    || mongoose.model('InteriorRender', interiorRenderSchema, 'interior_renders');
