import mongoose from 'mongoose';

export const PRESET_CATEGORIES = [
  'stage_template',
  'matrix_fx_preset',
  'ofl_fixture',
  'ilda_laser',
  'glb_prop',
  'stage_pack'
];

export const PRESET_TYPES = [
  ...PRESET_CATEGORIES,
  'stage_3d',
  'matrix_cue'
];

const stagePackB2AssetsSchema = new mongoose.Schema({
  coreKey: { type: String, default: '' },
  audioKey: { type: String, default: '' },
  videoKey: { type: String, default: '' },
  thumbnailKey: { type: String, default: '' },
  galleryKeys: { type: [String], default: [] },
  coreBytes: { type: Number, default: 0, min: 0 },
  coreGzipBytes: { type: Number, default: 0, min: 0 },
  audioBytes: { type: Number, default: 0, min: 0 },
  videoBytes: { type: Number, default: 0, min: 0 },
  coreSha256: { type: String, default: '' },
  audioSha256: { type: String, default: '' },
  videoSha256: { type: String, default: '' },
  audioName: { type: String, default: '' },
  audioMime: { type: String, default: '' },
  videoName: { type: String, default: '' },
  videoMime: { type: String, default: '' },
  videoTargetRole: { type: String, default: '' },
  videoFit: { type: Number, default: 0 }
}, { _id: false });

const ledStudioPresetSchema = new mongoose.Schema({
  authorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  ownership: {
    type: String,
    enum: ['platform', 'community'],
    default: 'community',
    index: true
  },
  visibility: {
    type: String,
    enum: ['public', 'private'],
    default: 'public',
    index: true
  },
  isPublic: {
    type: Boolean,
    default: true,
    index: true
  },
  category: {
    type: String,
    enum: PRESET_TYPES,
    default: 'stage_template',
    index: true
  },
  presetType: {
    type: String,
    enum: PRESET_TYPES,
    default: 'stage_template',
    index: true
  },
  title: {
    vi: { type: String, required: true, trim: true, maxlength: 140 },
    en: { type: String, default: '', trim: true, maxlength: 140 }
  },
  summary: {
    type: String,
    default: '',
    maxlength: 1000
  },
  summaryEn: {
    type: String,
    default: '',
    maxlength: 1000
  },
  thumbnailUrl: {
    type: String,
    default: ''
  },
  b2AssetKey: {
    type: String,
    default: ''
  },
  slug: {
    type: String,
    trim: true,
    maxlength: 140,
    index: true
  },
  tags: {
    type: [String],
    default: []
  },
  galleryUrls: {
    type: [String],
    default: []
  },
  accessLevel: {
    type: String,
    enum: ['free', 'pro'],
    default: 'free',
    index: true
  },
  distribution: {
    type: String,
    enum: ['commercial-ok', 'internal_only'],
    default: 'commercial-ok',
    index: true
  },
  b2Assets: {
    type: stagePackB2AssetsSchema,
    default: undefined
  },
  payloadJson: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  payloadSummary: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  downloadCount: {
    type: Number,
    default: 0,
    min: 0
  }
}, { timestamps: true });

export default mongoose.model('LedStudioPreset', ledStudioPresetSchema);
