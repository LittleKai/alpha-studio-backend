import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema({
    // Google media UUID — used to mint signed CDN URLs via flow-agent /resign.
    // Plan 4 lazy re-sign: we never store the signed URL (6h TTL); backend
    // mints a fresh one per request against this UUID.
    mediaName: { type: String, required: true },
    ext: { type: String, default: '' },
    seed: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: null },  // video only

    // B2 persistence — set when user clicks "Save".
    saved: { type: Boolean, default: false },
    b2Key: { type: String, default: '' },
    b2Url: { type: String, default: '' },
    savedAt: { type: Date, default: null }
}, { _id: false });

const studioGenerationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    flowServerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FlowServer',
        required: true
    },
    type: {
        type: String,
        enum: ['image', 'video'],
        required: true
    },
    model: {
        type: String,
        required: true
    },
    prompt: {
        type: String,
        required: true
    },
    aspectRatio: {
        type: String,
        required: true
    },
    count: {
        type: Number,
        default: 1
    },
    hasReferenceImage: {
        type: Boolean,
        default: false
    },
    items: {
        type: [itemSchema],
        default: []
    },
    batchId: {
        type: String,
        default: ''
    },
    // Flow project the gen was actually placed into (filled in by flow-agent
    // after pool rotation). projectTitle is best-effort — pool stores it when
    // the project was auto-created via /admin/projects/create.
    projectId: {
        type: String,
        default: ''
    },
    projectTitle: {
        type: String,
        default: ''
    },
    // Derived from TTL — used by GET /media/:genId/:idx to detect expired cache.
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 48 * 3600 * 1000)
    }
}, { timestamps: true, toJSON: { virtuals: true } });

studioGenerationSchema.index({ userId: 1, createdAt: -1 });
studioGenerationSchema.index({ expiresAt: 1 });  // cleanup cron scan

export default mongoose.model('StudioGeneration', studioGenerationSchema);
