import mongoose from 'mongoose';
import { noInlineMediaPlugin } from '../validation/inlineMedia.js';

const interiorVersionSchema = new mongoose.Schema({
    index: {
        type: Number,
        required: true
    },
    parentIndex: {
        type: Number,
        default: null
    },
    userPrompt: {
        type: String,
        default: '',
        maxlength: 8000
    },
    refImageUrls: {
        type: [String],
        default: []
    },
    modelJson: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    aiReply: {
        type: String,
        default: ''
    },
    askForInfo: {
        type: Boolean,
        default: false
    },
    isRollback: {
        type: Boolean,
        default: false
    },
    rollbackTargetIndex: {
        type: Number,
        default: null
    },
    aiModel: {
        type: String,
        default: null
    },
    usage: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    proposalText: {
        type: String,
        default: null,
        maxlength: 4000
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const interiorVersionArchiveSchema = new mongoose.Schema({
    provider: { type: String, required: true },
    key: { type: String, required: true },
    url: { type: String, default: '' },
    checksum: { type: String, required: true },
    size: { type: Number, required: true },
    fromIndex: { type: Number, required: true },
    toIndex: { type: Number, required: true },
    count: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now }
}, { _id: false });

const interiorProjectSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        default: 'Interior project',
        trim: true,
        maxlength: 120
    },
    currentVersionIndex: {
        type: Number,
        default: 0
    },
    versions: {
        type: [interiorVersionSchema],
        default: []
    },
    versionArchives: {
        type: [interiorVersionArchiveSchema],
        default: []
    },
    isDeleted: {
        type: Boolean,
        default: false,
        index: true
    }
}, {
    timestamps: true
});

interiorProjectSchema.plugin(noInlineMediaPlugin);

interiorProjectSchema.index({ userId: 1, isDeleted: 1, updatedAt: -1 });

const InteriorProject = mongoose.model('InteriorProject', interiorProjectSchema);

export default InteriorProject;
