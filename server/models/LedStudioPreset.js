import mongoose from 'mongoose';

export const PRESET_CATEGORIES = [
  'stage_template',
  'matrix_fx_preset',
  'ofl_fixture',
  'ilda_laser',
  'glb_prop'
];

export const PRESET_TYPES = [
  ...PRESET_CATEGORIES,
  'stage_3d',
  'matrix_cue'
];

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
