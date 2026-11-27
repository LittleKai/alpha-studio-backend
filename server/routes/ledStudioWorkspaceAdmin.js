import crypto from 'node:crypto';
import express from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import LedStudioWorkspaceProject from '../models/LedStudioWorkspaceProject.js';
import LedStudioWorkspaceAsset from '../models/LedStudioWorkspaceAsset.js';
import LedStudioWorkspaceUpload from '../models/LedStudioWorkspaceUpload.js';
import LedStudioWorkspacePurgePreview from '../models/LedStudioWorkspacePurgePreview.js';
import LedStudioWorkspaceQuota from '../models/LedStudioWorkspaceQuota.js';
import { deleteWorkspaceObjectVersion } from '../utils/b2Storage.js';

const router = express.Router();
router.use(authMiddleware);
router.use(adminOnly);

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const UNREFERENCED_GRACE_MS = 15 * 60 * 1000;

async function getReferencedAssetIdSet() {
  const projects = await LedStudioWorkspaceProject.find({}).select('assetIds').lean();
  const referenced = new Set();
  for (const p of projects) {
    if (Array.isArray(p.assetIds)) {
      for (const id of p.assetIds) referenced.add(id);
    }
  }
  const now = new Date();
  const pendingUploads = await LedStudioWorkspaceUpload.find({
    status: 'pending',
    expiresAt: { $gt: now }
  }).select('assetId sha256').lean();
  for (const u of pendingUploads) {
    if (u.assetId) referenced.add(u.assetId);
  }
  return referenced;
}

router.get('/summary', async (req, res) => {
  try {
    const graceCutoff = new Date(Date.now() - UNREFERENCED_GRACE_MS);
    const [activeAssets, referencedSet, expiredPendingCount] = await Promise.all([
      LedStudioWorkspaceAsset.find({ status: 'active' })
        .select('assetId sizeBytes owner objectKey versionId mimeType kind createdAt')
        .lean(),
      getReferencedAssetIdSet(),
      LedStudioWorkspaceUpload.countDocuments({
        status: 'pending',
        expiresAt: { $lte: new Date() }
      })
    ]);

    let referencedCount = 0;
    let referencedBytes = 0;
    let purgeableCount = 0;
    let purgeableBytes = 0;

    for (const a of activeAssets) {
      if (referencedSet.has(a.assetId)) {
        referencedCount += 1;
        referencedBytes += Number(a.sizeBytes) || 0;
      } else if (a.createdAt && new Date(a.createdAt) <= graceCutoff) {
        purgeableCount += 1;
        purgeableBytes += Number(a.sizeBytes) || 0;
      }
    }

    return res.json({
      success: true,
      message: 'OK',
      data: {
        referencedCount,
        referencedBytes,
        purgeableCount,
        purgeableBytes,
        expiredPendingCount
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/purge-preview', async (req, res) => {
  try {
    const cutoffAt = new Date(Date.now() - UNREFERENCED_GRACE_MS);
    const [activeAssets, referencedSet] = await Promise.all([
      LedStudioWorkspaceAsset.find({ status: 'active', createdAt: { $lte: cutoffAt } }).lean(),
      getReferencedAssetIdSet()
    ]);

    const candidates = [];
    let totalBytes = 0;
    for (const a of activeAssets) {
      if (!referencedSet.has(a.assetId)) {
        candidates.push({
          assetId: a.assetId,
          owner: a.owner,
          objectKey: a.objectKey,
          versionId: a.versionId,
          sizeBytes: a.sizeBytes,
          mimeType: a.mimeType,
          deleted: false,
          skippedReason: '',
          error: ''
        });
        totalBytes += Number(a.sizeBytes) || 0;
      }
    }

    const previewId = `lswg_${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);

    await LedStudioWorkspacePurgePreview.create({
      previewId,
      adminId: req.user._id,
      cutoffAt,
      status: 'pending',
      candidates,
      totalFiles: candidates.length,
      totalBytes,
      expiresAt
    });

    return res.json({
      success: true,
      message: 'Purge preview created',
      data: {
        previewId,
        totalFiles: candidates.length,
        totalBytes,
        expiresAt: expiresAt.toISOString()
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/purges/:previewId', async (req, res) => {
  let executingPreview = null;
  try {
    const preview = await LedStudioWorkspacePurgePreview.findOneAndUpdate(
      {
        previewId: req.params.previewId,
        adminId: req.user._id,
        status: 'pending',
        expiresAt: { $gt: new Date() }
      },
      { $set: { status: 'executing' } },
      { new: true }
    );

    if (!preview) {
      return res.status(409).json({
        success: false,
        message: 'Purge preview not found, expired, or already executed'
      });
    }
    executingPreview = preview;

    const currentReferenced = await getReferencedAssetIdSet();
    let deletedCount = 0;
    let deletedBytes = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const item of preview.candidates) {
      if (currentReferenced.has(item.assetId)) {
        item.skippedReason = 're-referenced';
        skippedCount += 1;
        continue;
      }
      try {
        await deleteWorkspaceObjectVersion(item.objectKey, item.versionId);
        await LedStudioWorkspaceAsset.updateOne(
          { assetId: item.assetId, versionId: item.versionId },
          { $set: { status: 'purged', deletedAt: new Date() } }
        );
        item.deleted = true;
        deletedCount += 1;
        deletedBytes += Number(item.sizeBytes) || 0;
      } catch (err) {
        item.error = err?.message || 'B2 delete failed';
        failedCount += 1;
      }
    }

    preview.status = 'completed';
    preview.executedAt = new Date();
    await preview.save();

    return res.json({
      success: true,
      message: 'Purge executed',
      data: {
        previewId: preview.previewId,
        deletedCount,
        deletedBytes,
        skippedCount,
        failedCount,
        failedItems: preview.candidates
          .filter((c) => c.error)
          .map((c) => ({ assetId: c.assetId, error: c.error }))
      }
    });
  } catch (err) {
    if (executingPreview) {
      executingPreview.status = 'failed';
      await executingPreview.save().catch((saveErr) => {
        console.error('[led-workspace-admin] failed to mark purge preview failed:', saveErr?.message || saveErr);
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/reconcile-uploads', async (req, res) => {
  try {
    const now = new Date();
    const expiredUploads = await LedStudioWorkspaceUpload.find({
      status: 'pending',
      expiresAt: { $lte: now }
    })
      .select('uploadId owner sizeBytes')
      .lean();

    let expiredCount = 0;
    const bytesByOwner = new Map();
    for (const u of expiredUploads) {
      const transitioned = await LedStudioWorkspaceUpload.findOneAndUpdate(
        { uploadId: u.uploadId, status: 'pending' },
        { $set: { status: 'expired' } },
        { new: true }
      ).lean();
      if (transitioned) {
        expiredCount += 1;
        const ownerKey = String(u.owner);
        bytesByOwner.set(ownerKey, (bytesByOwner.get(ownerKey) || 0) + (Number(u.sizeBytes) || 0));
      }
    }

    for (const [ownerId, bytes] of bytesByOwner.entries()) {
      if (bytes > 0) {
        await LedStudioWorkspaceQuota.updateOne(
          { owner: ownerId },
          [{ $set: { reservedBytes: { $max: [0, { $subtract: [{ $ifNull: ['$reservedBytes', 0] }, bytes] }] } } }]
        ).catch(() => {});
      }
    }

    return res.json({
      success: true,
      message: 'Reconciled expired uploads',
      data: { expiredCount }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
