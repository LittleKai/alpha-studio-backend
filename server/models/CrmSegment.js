import mongoose from 'mongoose';

const crmSegmentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ''
    },
    filters: {
        tags: [{ type: String }],
        lifecycleStage: { type: String, default: '' },
        consentStatus: { type: String, default: '' },
        lastInteractionFrom: { type: Date, default: null },
        lastInteractionTo: { type: Date, default: null },
        campaignResponse: { type: String, default: '' },
        source: { type: String, default: '' },
        search: { type: String, default: '' }
    }
}, {
    timestamps: true
});

crmSegmentSchema.index({ userId: 1, name: 1 }, { unique: true });

const CrmSegment = mongoose.model('CrmSegment', crmSegmentSchema);

export default CrmSegment;
