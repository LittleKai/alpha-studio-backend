import mongoose from 'mongoose';

export const WORKSPACE_ASSET_KINDS = ['model', 'image', 'texture', 'audio', 'video', 'binary'];
export const WORKSPACE_ASSET_STATUSES = ['active', 'purged'];

const ledStudioWorkspaceAssetSchema = new mongoose.Schema({
  assetId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sha256: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  sizeBytes: {
    type: Number,
    required: true,
    min: 1
  },
  mimeType: {
    type: String,
    required: true,
    trim: true
  },
  kind: {
    type: String,
    enum: WORKSPACE_ASSET_KINDS,
    required: true
  },
  bucketName: {
    type: String,
    required: true,
    trim: true
  },
  objectKey: {
    type: String,
    required: true,
    trim: true
  },
  versionId: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: WORKSPACE_ASSET_STATUSES,
    default: 'active'
  },
  deletedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

ledStudioWorkspaceAssetSchema.index({ owner: 1, sha256: 1, status: 1 });
ledStudioWorkspaceAssetSchema.index({ objectKey: 1, versionId: 1 }, { unique: true });
ledStudioWorkspaceAssetSchema.index({ status: 1, deletedAt: 1 });

export default mongoose.models.LedStudioWorkspaceAsset ||
  mongoose.model('LedStudioWorkspaceAsset', ledStudioWorkspaceAssetSchema);
