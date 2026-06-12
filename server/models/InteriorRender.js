import mongoose from 'mongoose';
import { noInlineMediaPlugin } from '../validation/inlineMedia.js';

const interiorRenderSchema = new mongoose.Schema({
    cacheKey: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    stylePrompt: { type: String, default: '' },
    viewUrl: { type: String, required: true },
    renderUrl: { type: String, default: '' },
    modelSnapshot: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

interiorRenderSchema.plugin(noInlineMediaPlugin);

export default mongoose.models.InteriorRender
    || mongoose.model('InteriorRender', interiorRenderSchema, 'interior_renders');
