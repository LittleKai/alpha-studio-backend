import mongoose from 'mongoose';

const ledStudioWorkspaceProjectSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  id: {
    type: String,
    required: true,
    trim: true
  },
  createId: {
    type: String,
    default: null,
    trim: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 140
  },
  revision: {
    type: Number,
    default: 1,
    min: 1
  },
  lastSaveId: {
    type: String,
    default: null,
    trim: true
  },
  manifest: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({ schemaVersion: 1, catalogRefs: [], assets: [], scene: null })
  },
  manifestBytes: {
    type: Number,
    default: 0,
    min: 0
  },
  assetIds: {
    type: [String],
    default: []
  },
  hasLocalOnlyMedia: {
    type: Boolean,
    default: false
  },
  stageSummary: {
    widthM: { type: Number, default: 0 },
    depthM: { type: Number, default: 0 },
    heightM: { type: Number, default: 0 },
    ledCount: { type: Number, default: 0 },
    lightCount: { type: Number, default: 0 },
    cueCount: { type: Number, default: 0 }
  },
  shareEnabled: {
    type: Boolean,
    default: false
  },
  shareTokenHash: {
    type: String,
    default: null,
    index: true
  },
  shareExpiresAt: {
    type: Date,
    default: null
  },
  shareUntilPro: {
    type: Boolean,
    default: false
  },
  sharePasswordProtected: {
    type: Boolean,
    default: false
  },
  sharePasswordHash: {
    type: String,
    default: null,
    select: false
  },
  reviewStatus: {
    type: String,
    enum: ['pending', 'approved', 'changes_requested'],
    default: 'pending'
  },
  reviewBy: {
    type: String,
    default: '',
    maxlength: 120
  },
  reviewNote: {
    type: String,
    default: '',
    maxlength: 1000
  },
  reviewUpdatedAt: {
    type: Date,
    default: null
  },
  reviewComments: [{
    id: { type: String, required: true },
    author: { type: String, default: 'Khách hàng', maxlength: 100 },
    message: { type: String, required: true, maxlength: 800 },
    position: [{ type: Number }],
    targetName: { type: String, default: '', maxlength: 120 },
    resolved: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

ledStudioWorkspaceProjectSchema.index({ owner: 1, id: 1 }, { unique: true });
ledStudioWorkspaceProjectSchema.index(
  { owner: 1, createId: 1 },
  { unique: true, partialFilterExpression: { createId: { $type: 'string' } } }
);
ledStudioWorkspaceProjectSchema.index({ owner: 1, updatedAt: -1 });
ledStudioWorkspaceProjectSchema.index({ assetIds: 1 });

export default mongoose.models.LedStudioWorkspaceProject ||
  mongoose.model('LedStudioWorkspaceProject', ledStudioWorkspaceProjectSchema);
