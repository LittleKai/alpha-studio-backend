import mongoose from 'mongoose';
import { RETENTION_MS } from '../retention/policy.js';

const CrmAuditLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmSubscription' },
  deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmDevice' },
  action: { type: String, required: true }, // 'subscription_created', 'device_registered', etc.
  details: { type: Object },
  ipAddress: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// Index for faster queries
CrmAuditLogSchema.index({ userId: 1, createdAt: -1 });
CrmAuditLogSchema.index({ subscriptionId: 1, createdAt: -1 });
CrmAuditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: RETENTION_MS.crmHistory / 1000 }
);

export default mongoose.models.CrmAuditLog || mongoose.model('CrmAuditLog', CrmAuditLogSchema);
