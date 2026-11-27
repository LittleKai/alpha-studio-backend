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
  }
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
