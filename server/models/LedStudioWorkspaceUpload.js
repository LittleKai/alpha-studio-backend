import mongoose from 'mongoose';
import { WORKSPACE_ASSET_KINDS } from './LedStudioWorkspaceAsset.js';

export const WORKSPACE_UPLOAD_MODES = ['proxy_stream', 'presigned_put'];
export const WORKSPACE_UPLOAD_STATUSES = ['pending', 'completed', 'expired', 'failed'];

const ledStudioWorkspaceUploadSchema = new mongoose.Schema({
  uploadId: {
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
  mode: {
    type: String,
    enum: WORKSPACE_UPLOAD_MODES,
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
  status: {
    type: String,
    enum: WORKSPACE_UPLOAD_STATUSES,
    default: 'pending'
  },
  assetId: {
    type: String,
    default: null
  },
  versionId: {
    type: String,
    default: null
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  errorMessage: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

ledStudioWorkspaceUploadSchema.index({ owner: 1, status: 1, expiresAt: 1 });

export default mongoose.models.LedStudioWorkspaceUpload ||
  mongoose.model('LedStudioWorkspaceUpload', ledStudioWorkspaceUploadSchema);
