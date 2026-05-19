import mongoose from 'mongoose';

const TEMPLATE_STATUS = ['seed', 'pending', 'approved', 'deprecated'];
const TEMPLATE_CATEGORY = [
    // General
    'upper-cabinet', 'lower-cabinet', 'wardrobe', 'shelf', 'desk', 'void', 'other',
    // Kitchen-specific
    'base-cabinet', 'wall-cabinet', 'tall-cabinet', 'drawer-base', 'corner-cabinet', 'island', 'kitchen-other'
];

const interiorTemplateSchema = new mongoose.Schema(
    {
        templateId: { type: String, required: true, index: true },
        version: { type: Number, required: true, default: 1 },
        name: {
            vi: { type: String, default: '' },
            en: { type: String, default: '' }
        },
        description: {
            vi: { type: String, default: '', maxlength: 2000 },
            en: { type: String, default: '', maxlength: 2000 }
        },
        category: { type: String, enum: TEMPLATE_CATEGORY, required: true, index: true },
        tags: { type: [String], default: [] },
        params: { type: mongoose.Schema.Types.Mixed, default: {} },
        styleOptions: { type: mongoose.Schema.Types.Mixed, default: {} },
        dsl: { type: mongoose.Schema.Types.Mixed, required: true },
        status: { type: String, enum: TEMPLATE_STATUS, default: 'pending', index: true },
        authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        sourceProjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'InteriorProject', default: null },
        sourceInlineId: { type: String, default: null },
        usageCount: { type: Number, default: 0 },
        previewDims: { type: mongoose.Schema.Types.Mixed, default: null }
    },
    { timestamps: true }
);

interiorTemplateSchema.index({ templateId: 1, version: -1 }, { unique: true });
interiorTemplateSchema.index({ status: 1, category: 1, updatedAt: -1 });
interiorTemplateSchema.index({ status: 1, tags: 1 });

interiorTemplateSchema.set('toJSON', { virtuals: true });

export const INTERIOR_TEMPLATE_STATUS = TEMPLATE_STATUS;
export const INTERIOR_TEMPLATE_CATEGORY = TEMPLATE_CATEGORY;

export default mongoose.model('InteriorTemplate', interiorTemplateSchema);
