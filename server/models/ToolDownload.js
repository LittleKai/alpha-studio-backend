import mongoose from 'mongoose';

const toolDownloadSchema = new mongoose.Schema({
    toolId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
    },
    toolName: {
        type: String,
        required: true,
        trim: true,
    },
    totalDownloads: {
        type: Number,
        default: 0,
        min: 0,
    },
    platforms: {
        windows: { type: Number, default: 0, min: 0 },
        android: { type: Number, default: 0, min: 0 },
        mac: { type: Number, default: 0, min: 0 },
        linux: { type: Number, default: 0, min: 0 },
        other: { type: Number, default: 0, min: 0 },
    },
    versions: {
        type: Map,
        of: Number,
        default: () => new Map(),
    },
    lastDownloadedAt: {
        type: Date,
        default: null,
    },
    recentDownloads: [{
        platform: { type: String, default: 'windows' },
        version: { type: String, default: '' },
        ip: { type: String, default: '' },
        userAgent: { type: String, default: '' },
        downloadedAt: { type: Date, default: Date.now },
    }],
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});

export default mongoose.model('ToolDownload', toolDownloadSchema);
