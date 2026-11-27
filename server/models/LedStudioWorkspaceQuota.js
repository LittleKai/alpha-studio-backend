import mongoose from 'mongoose';

const ledStudioWorkspaceQuotaSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  activeSlots: {
    type: Number,
    default: 0,
    min: 0
  },
  reservedBytes: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});

export default mongoose.models.LedStudioWorkspaceQuota ||
  mongoose.model('LedStudioWorkspaceQuota', ledStudioWorkspaceQuotaSchema);
