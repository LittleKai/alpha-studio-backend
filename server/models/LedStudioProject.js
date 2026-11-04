import mongoose from 'mongoose';

const ledStudioProjectSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 140
  },
  description: {
    type: String,
    default: '',
    maxlength: 1000
  },
  b2FileKey: {
    type: String,
    required: true,
    trim: true
  },
  fileSize: {
    type: Number,
    default: 0,
    min: 0
  },
  thumbnailUrl: {
    type: String,
    default: ''
  },
  thumbnailPublicId: {
    type: String,
    default: ''
  },
  visibility: {
    type: String,
    enum: ['private', 'public'],
    default: 'private'
  },
  stageSummary: {
    widthM: { type: Number, default: 0 },
    depthM: { type: Number, default: 0 },
    heightM: { type: Number, default: 0 },
    ledCount: { type: Number, default: 0 },
    lightCount: { type: Number, default: 0 },
    cueCount: { type: Number, default: 0 }
  },
  projectPayload: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
    select: false
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
  unlockedPro: {
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
}, { timestamps: true });

export default mongoose.model('LedStudioProject', ledStudioProjectSchema);
