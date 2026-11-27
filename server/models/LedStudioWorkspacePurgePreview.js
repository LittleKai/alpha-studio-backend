import mongoose from 'mongoose';

const purgeCandidateSchema = new mongoose.Schema({
  assetId: { type: String, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  objectKey: { type: String, required: true },
  versionId: { type: String, required: true },
  sizeBytes: { type: Number, required: true },
  mimeType: { type: String, default: '' },
  deleted: { type: Boolean, default: false },
  skippedReason: { type: String, default: '' },
  error: { type: String, default: '' }
}, { _id: false });

const ledStudioWorkspacePurgePreviewSchema = new mongoose.Schema({
  previewId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  cutoffAt: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'executing', 'completed', 'failed'],
    default: 'pending'
  },
  candidates: {
    type: [purgeCandidateSchema],
    default: []
  },
  totalFiles: {
    type: Number,
    default: 0
  },
  totalBytes: {
    type: Number,
    default: 0
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  executedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

export default mongoose.models.LedStudioWorkspacePurgePreview ||
  mongoose.model('LedStudioWorkspacePurgePreview', ledStudioWorkspacePurgePreviewSchema);
