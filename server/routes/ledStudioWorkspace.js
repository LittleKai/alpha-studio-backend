import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import LedStudioWorkspaceProject from '../models/LedStudioWorkspaceProject.js';
import LedStudioWorkspaceAsset, { WORKSPACE_ASSET_KINDS } from '../models/LedStudioWorkspaceAsset.js';
import LedStudioWorkspaceUpload from '../models/LedStudioWorkspaceUpload.js';
import LedStudioWorkspaceQuota from '../models/LedStudioWorkspaceQuota.js';
import {
  sanitizeStageSummary,
  hashShareToken,
  hashSharePassword,
  FREE_SHARE_MAX_HOURS,
  normalizeUserLumiState
} from './ledStudio.js';
import {
  isLedWorkspaceB2Configured,
  getLedWorkspaceBucketName,
  generateWorkspacePresignedPutUrl,
  generateWorkspacePresignedGetUrl,
  putWorkspaceObject,
  headWorkspaceObject,
  deleteWorkspaceObjectVersion,
  readWorkspaceObjectHeadBytes
} from '../utils/b2Storage.js';
import {
  WORKSPACE_UPLOAD_TTL_MS,
  WORKSPACE_TEMP_DIR,
  resolveWorkspaceEntitlement,
  isMediaKindAllowedForPlan,
  isDeclaredMimeAllowedForKind,
  detectMagicBytesMime,
  validateWorkspaceManifest,
  computeReferencedBytesForOwner,
  buildWorkspaceAssetKey
} from '../utils/ledWorkspacePolicy.js';

const router = express.Router();
router.use(authMiddleware);

const MAX_CONCURRENT_PROXY_UPLOADS = 4;
let activeProxyUploads = 0;

async function ensureWorkspaceQuotaDoc(ownerId) {
  const now = new Date();
  const [slotCount, pendingUploads] = await Promise.all([
    LedStudioWorkspaceProject.countDocuments({ owner: ownerId }),
    LedStudioWorkspaceUpload.find({ owner: ownerId, status: 'pending', expiresAt: { $gt: now } })
      .select('sizeBytes')
      .lean()
  ]);
  const pendingBytes = pendingUploads.reduce((sum, u) => sum + (Number(u.sizeBytes) || 0), 0);
  try {
    await LedStudioWorkspaceQuota.findOneAndUpdate(
      { owner: ownerId },
      { $setOnInsert: { activeSlots: slotCount, reservedBytes: pendingBytes } },
      { upsert: true }
    );
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
}

async function releaseReservedBytes(ownerId, bytes) {
  const dec = Number(bytes) || 0;
  if (dec <= 0) return;
  await LedStudioWorkspaceQuota.updateOne(
    { owner: ownerId },
    [{ $set: { reservedBytes: { $max: [0, { $subtract: [{ $ifNull: ['$reservedBytes', 0] }, dec] }] } } }]
  ).catch(() => {});
}

async function reconcileOwnerExpiredUploads(ownerId) {
  const now = new Date();
  const expired = await LedStudioWorkspaceUpload.find({
    owner: ownerId,
    status: 'pending',
    expiresAt: { $lte: now }
  })
    .select('uploadId sizeBytes')
    .lean();
  let released = 0;
  for (const item of expired) {
    const transitioned = await LedStudioWorkspaceUpload.findOneAndUpdate(
      { uploadId: item.uploadId, owner: ownerId, status: 'pending' },
      { $set: { status: 'expired' } }
    ).lean();
    if (transitioned) {
      released += Number(item.sizeBytes) || 0;
    }
  }
  if (released > 0) {
    await releaseReservedBytes(ownerId, released);
  }
}

function serializeProjectSummary(doc) {
  return {
    id: doc.id,
    title: doc.title,
    revision: doc.revision,
    hasLocalOnlyMedia: Boolean(doc.hasLocalOnlyMedia),
    stageSummary: doc.stageSummary || {},
    manifestBytes: doc.manifestBytes || 0,
    shareEnabled: Boolean(doc.shareEnabled),
    shareExpiresAt: doc.shareExpiresAt || null,
    shareUntilPro: Boolean(doc.shareUntilPro),
    passwordProtected: Boolean(doc.sharePasswordProtected),
    reviewStatus: doc.reviewStatus || 'pending',
    reviewBy: doc.reviewBy || '',
    reviewNote: doc.reviewNote || '',
    reviewUpdatedAt: doc.reviewUpdatedAt || null,
    reviewCommentsCount: Array.isArray(doc.reviewComments) ? doc.reviewComments.length : 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

router.get('/projects', async (req, res) => {
  try {
    const entitlement = resolveWorkspaceEntitlement(req.user);
    const [projects, quotaUsage] = await Promise.all([
      LedStudioWorkspaceProject.find({ owner: req.user._id })
        .sort({ updatedAt: -1 })
        .select('id title revision hasLocalOnlyMedia stageSummary manifestBytes shareEnabled shareExpiresAt shareUntilPro sharePasswordProtected reviewStatus reviewBy reviewNote reviewUpdatedAt reviewComments createdAt updatedAt')
        .lean(),
      computeReferencedBytesForOwner(req.user._id)
    ]);

    return res.json({
      success: true,
      message: 'OK',
      data: {
        projects: projects.map(serializeProjectSummary),
        usedSlots: projects.length,
        maxSlots: entitlement.maxSlots,
        usedBytes: quotaUsage.totalUsedBytes,
        maxBytes: entitlement.maxUserBytes,
        proActive: entitlement.proActive
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/projects', async (req, res) => {
  const entitlement = resolveWorkspaceEntitlement(req.user);
  const createId = typeof req.body?.createId === 'string' ? req.body.createId.trim() : '';
  const title = typeof req.body?.title === 'string' && req.body.title.trim()
    ? req.body.title.trim().slice(0, 140)
    : 'Untitled Stage';
  const manifest = req.body?.manifest ?? { schemaVersion: 1, catalogRefs: [], assets: [], scene: null };
  const hasLocalOnlyMedia = Boolean(req.body?.hasLocalOnlyMedia);

  const manifestCheck = validateWorkspaceManifest(manifest);
  if (!manifestCheck.ok) {
    return res.status(400).json({ success: false, message: manifestCheck.reason });
  }

  if (createId) {
    const existing = await LedStudioWorkspaceProject.findOne({ owner: req.user._id, createId }).lean();
    if (existing) {
      return res.status(200).json({
        success: true,
        message: 'Project created',
        data: { project: serializeProjectSummary(existing) }
      });
    }
  }

  let reservedSlot = false;
  try {
    // Ensure quota doc exists with accurate baseline before atomic increment
    await ensureWorkspaceQuotaDoc(req.user._id);

    const quotaDoc = await LedStudioWorkspaceQuota.findOneAndUpdate(
      { owner: req.user._id, activeSlots: { $lt: entitlement.maxSlots } },
      { $inc: { activeSlots: 1 } },
      { new: true }
    );

    if (!quotaDoc) {
      return res.status(409).json({
        success: false,
        code: 'PROJECT_QUOTA_EXCEEDED',
        message: `Project limit reached (${entitlement.maxSlots}/${entitlement.maxSlots})`
      });
    }
    reservedSlot = true;

    // Verify any initial assets belong to user
    if (manifestCheck.assetIds.length > 0) {
      const ownedAssets = await LedStudioWorkspaceAsset.find({
        owner: req.user._id,
        assetId: { $in: manifestCheck.assetIds },
        status: 'active'
      }).lean();
      if (ownedAssets.length !== manifestCheck.assetIds.length) {
        await LedStudioWorkspaceQuota.updateOne({ owner: req.user._id }, { $inc: { activeSlots: -1 } });
        return res.status(400).json({ success: false, message: 'One or more referenced assets are invalid or missing' });
      }
      for (const a of ownedAssets) {
        if (!isMediaKindAllowedForPlan(a.kind, entitlement.proActive)) {
          await LedStudioWorkspaceQuota.updateOne({ owner: req.user._id }, { $inc: { activeSlots: -1 } });
          return res.status(403).json({
            success: false,
            code: 'PRO_REQUIRED',
            message: 'Active Pro subscription required to attach audio/video assets'
          });
        }
      }
    }

    const projectId = `lswp_${crypto.randomUUID()}`;
    const created = await LedStudioWorkspaceProject.create({
      owner: req.user._id,
      id: projectId,
      createId: createId || null,
      title,
      revision: 1,
      manifest,
      manifestBytes: manifestCheck.manifestBytes,
      assetIds: manifestCheck.assetIds,
      hasLocalOnlyMedia,
      stageSummary: sanitizeStageSummary(req.body?.stageSummary || {})
    });

    return res.status(201).json({
      success: true,
      message: 'Project created',
      data: { project: serializeProjectSummary(created) }
    });
  } catch (err) {
    if (reservedSlot) {
      await LedStudioWorkspaceQuota.updateOne(
        { owner: req.user._id, activeSlots: { $gt: 0 } },
        { $inc: { activeSlots: -1 } }
      ).catch(() => {});
    }
    if (err?.code === 11000 && createId) {
      const existing = await LedStudioWorkspaceProject.findOne({ owner: req.user._id, createId }).lean();
      if (existing) {
        return res.status(200).json({
          success: true,
          message: 'Project created',
          data: { project: serializeProjectSummary(existing) }
        });
      }
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/projects/:id', async (req, res) => {
  try {
    const project = await LedStudioWorkspaceProject.findOne({
      id: req.params.id,
      owner: req.user._id
    }).lean();

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const assetUrls = {};
    if (Array.isArray(project.assetIds) && project.assetIds.length > 0) {
      const assets = await LedStudioWorkspaceAsset.find({
        owner: req.user._id,
        assetId: { $in: project.assetIds },
        status: 'active'
      }).lean();

      const configured = isLedWorkspaceB2Configured();
      const urls = await Promise.all(
        assets.map((a) =>
          configured
            ? generateWorkspacePresignedGetUrl(a.objectKey, a.versionId, 3600, `${a.assetId}.bin`)
            : Promise.resolve(null)
        )
      );
      assets.forEach((a, idx) => {
        assetUrls[a.assetId] = {
          assetId: a.assetId,
          sha256: a.sha256,
          sizeBytes: a.sizeBytes,
          mimeType: a.mimeType,
          kind: a.kind,
          downloadUrl: urls[idx]
        };
      });
    }

    return res.json({
      success: true,
      message: 'OK',
      data: {
        project: {
          ...serializeProjectSummary(project),
          reviewComments: Array.isArray(project.reviewComments) ? project.reviewComments : [],
          manifest: project.manifest
        },
        assetUrls
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/projects/:id', async (req, res) => {
  try {
    const entitlement = resolveWorkspaceEntitlement(req.user);
    const baseRevision = Number(req.body?.baseRevision);
    const saveId = typeof req.body?.saveId === 'string' ? req.body.saveId.trim() : '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 140) : undefined;
    const manifest = req.body?.manifest;
    const hasLocalOnlyMedia = req.body?.hasLocalOnlyMedia;

    if (!Number.isInteger(baseRevision) || baseRevision < 1) {
      return res.status(400).json({ success: false, message: 'Valid baseRevision is required' });
    }
    const manifestCheck = validateWorkspaceManifest(manifest);
    if (!manifestCheck.ok) {
      return res.status(400).json({ success: false, message: manifestCheck.reason });
    }

    const existing = await LedStudioWorkspaceProject.findOne({
      id: req.params.id,
      owner: req.user._id
    }).lean();

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Idempotent retry check
    if (saveId && existing.lastSaveId === saveId) {
      return res.status(200).json({
        success: true,
        message: 'Project saved',
        data: { project: serializeProjectSummary(existing) }
      });
    }

    if (existing.revision !== baseRevision) {
      return res.status(409).json({
        success: false,
        code: 'REVISION_CONFLICT',
        message: 'Project has a newer revision on the server',
        data: { currentRevision: existing.revision }
      });
    }

    const previousAssetSet = new Set(Array.isArray(existing.assetIds) ? existing.assetIds : []);
    if (manifestCheck.assetIds.length > 0) {
      const assets = await LedStudioWorkspaceAsset.find({
        owner: req.user._id,
        assetId: { $in: manifestCheck.assetIds },
        status: 'active'
      }).lean();
      if (assets.length !== manifestCheck.assetIds.length) {
        return res.status(400).json({ success: false, message: 'One or more referenced assets are missing or purged' });
      }
      for (const a of assets) {
        const isNewlyAttached = !previousAssetSet.has(a.assetId);
        if (isNewlyAttached && !isMediaKindAllowedForPlan(a.kind, entitlement.proActive)) {
          return res.status(403).json({
            success: false,
            code: 'PRO_REQUIRED',
            message: 'Active Pro subscription required to attach new audio/video media'
          });
        }
      }
    }

    const updateFields = {
      revision: baseRevision + 1,
      lastSaveId: saveId || null,
      manifest,
      manifestBytes: manifestCheck.manifestBytes,
      assetIds: manifestCheck.assetIds
    };
    if (title) updateFields.title = title;
    if (typeof hasLocalOnlyMedia === 'boolean') updateFields.hasLocalOnlyMedia = hasLocalOnlyMedia;
    if (req.body?.stageSummary) updateFields.stageSummary = sanitizeStageSummary(req.body.stageSummary);

    const updated = await LedStudioWorkspaceProject.findOneAndUpdate(
      { id: req.params.id, owner: req.user._id, revision: baseRevision },
      { $set: updateFields },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(409).json({
        success: false,
        code: 'REVISION_CONFLICT',
        message: 'Concurrent modification detected'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Project saved',
      data: { project: serializeProjectSummary(updated) }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    const rawRev = req.query?.revision ?? req.get('if-match') ?? req.body?.revision;
    const expectedRevision = Number(String(rawRev || '').replace(/^"|"$/g, ''));
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return res.status(400).json({ success: false, message: 'Valid revision query or If-Match header is required' });
    }

    const existing = await LedStudioWorkspaceProject.findOne({
      id: req.params.id,
      owner: req.user._id
    }).lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    if (existing.revision !== expectedRevision) {
      return res.status(409).json({
        success: false,
        code: 'REVISION_CONFLICT',
        message: 'Project revision mismatch',
        data: { currentRevision: existing.revision }
      });
    }

    const deleted = await LedStudioWorkspaceProject.findOneAndDelete({
      id: req.params.id,
      owner: req.user._id,
      revision: expectedRevision
    });
    if (!deleted) {
      return res.status(409).json({ success: false, code: 'REVISION_CONFLICT', message: 'Concurrent modification detected' });
    }

    await LedStudioWorkspaceQuota.updateOne(
      { owner: req.user._id, activeSlots: { $gt: 0 } },
      { $inc: { activeSlots: -1 } }
    );

    return res.json({
      success: true,
      message: 'Project deleted; B2 asset versions retained for admin management',
      data: { id: req.params.id }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/projects/:id/share', async (req, res) => {
  try {
    const { enabled = true, expiresInHours = FREE_SHARE_MAX_HOURS, untilPro = false, password } = req.body || {};
    const project = await LedStudioWorkspaceProject.findOne({
      id: req.params.id,
      owner: req.user._id
    });
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    if (!enabled) {
      project.shareEnabled = false;
      project.shareTokenHash = null;
      project.shareExpiresAt = null;
      project.shareUntilPro = false;
      project.sharePasswordProtected = false;
      project.sharePasswordHash = null;
      await project.save();
      return res.json({
        success: true,
        message: 'Share disabled',
        data: { shareEnabled: false, passwordProtected: false }
      });
    }
    const ownerSub = normalizeUserLumiState(req.user);
    if (untilPro && !ownerSub.proActive) {
      return res.status(403).json({
        success: false,
        code: 'PRO_REQUIRED',
        message: 'Chỉ tài khoản đang có gói Pro mới tạo được link hiệu lực theo thời hạn gói Pro.'
      });
    }
    const rawToken = crypto.randomBytes(24).toString('base64url');
    const hours = Math.min(FREE_SHARE_MAX_HOURS, Math.max(1, Number(expiresInHours) || FREE_SHARE_MAX_HOURS));
    project.shareEnabled = true;
    project.shareTokenHash = hashShareToken(rawToken);
    project.shareUntilPro = Boolean(untilPro);
    project.shareExpiresAt = untilPro ? null : new Date(Date.now() + hours * 3600_000);
    if (typeof password === 'string' && password.trim().length > 0) {
      project.sharePasswordProtected = true;
      project.sharePasswordHash = hashSharePassword(password.trim());
    } else if (password === '' || password === null) {
      project.sharePasswordProtected = false;
      project.sharePasswordHash = null;
    }
    await project.save();
    return res.json({
      success: true,
      message: 'Share link generated',
      data: {
        shareToken: rawToken,
        shareEnabled: true,
        shareExpiresAt: untilPro ? ownerSub.expiresAt : project.shareExpiresAt,
        shareUntilPro: project.shareUntilPro,
        passwordProtected: Boolean(project.sharePasswordProtected)
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/assets/prepare', async (req, res) => {
  let reservedForThisRequest = 0;
  try {
    const entitlement = resolveWorkspaceEntitlement(req.user);
    const sha256 = typeof req.body?.sha256 === 'string' ? req.body.sha256.trim().toLowerCase() : '';
    const sizeBytes = Number(req.body?.sizeBytes);
    const rawMime = typeof req.body?.mimeType === 'string' ? req.body.mimeType.trim().toLowerCase() : '';
    const mimeType = rawMime.split(';')[0].trim();
    const kind = typeof req.body?.kind === 'string' ? req.body.kind.trim() : '';

    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      return res.status(400).json({ success: false, message: 'Valid SHA-256 hex digest is required' });
    }
    if (!WORKSPACE_ASSET_KINDS.includes(kind)) {
      return res.status(400).json({ success: false, message: 'Invalid asset kind' });
    }
    const maxFileMb = Math.round(entitlement.maxFileBytes / (1024 * 1024));
    if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > entitlement.maxFileBytes) {
      return res.status(400).json({
        success: false,
        code: 'FILE_TOO_LARGE',
        message: `Asset size out of allowed bounds (1B - ${maxFileMb} MiB)`,
        data: { maxFileBytes: entitlement.maxFileBytes, proActive: entitlement.proActive }
      });
    }
    if (!isMediaKindAllowedForPlan(kind, entitlement.proActive)) {
      return res.status(403).json({
        success: false,
        code: 'PRO_REQUIRED',
        message: 'Active Pro subscription required for audio/video assets'
      });
    }
    if (kind === 'image' && mimeType !== 'image/webp') {
      return res.status(400).json({ success: false, message: 'Images must be converted to WebP before prepare' });
    }
    if (mimeType && !isDeclaredMimeAllowedForKind(kind, mimeType)) {
      return res.status(400).json({ success: false, message: 'MIME type is not allowed for this asset kind' });
    }

    // Reuse existing active asset for same owner + SHA-256 + kind + exact size
    const existing = await LedStudioWorkspaceAsset.findOne({
      owner: req.user._id,
      sha256,
      kind,
      sizeBytes,
      status: 'active'
    }).lean();

    if (existing) {
      return res.json({
        success: true,
        message: 'Asset reused',
        data: {
          reused: true,
          assetId: existing.assetId
        }
      });
    }

    if (!isLedWorkspaceB2Configured()) {
      return res.status(503).json({ success: false, message: 'LED Workspace private B2 storage is not configured' });
    }

    await reconcileOwnerExpiredUploads(req.user._id);
    const usage = await computeReferencedBytesForOwner(req.user._id);
    const maxUserBytes = entitlement.maxUserBytes;
    const quotaLabel = maxUserBytes >= 1024 * 1024 * 1024
      ? `${Math.round(maxUserBytes / (1024 * 1024 * 1024))} GiB`
      : `${Math.round(maxUserBytes / (1024 * 1024))} MiB`;
    const maxReservedAllowed = maxUserBytes - usage.referencedBytes;
    if (sizeBytes > maxReservedAllowed) {
      return res.status(409).json({
        success: false,
        code: 'STORAGE_QUOTA_EXCEEDED',
        message: `Account storage quota (${quotaLabel}) exceeded`,
        data: { usedBytes: usage.totalUsedBytes, maxBytes: maxUserBytes }
      });
    }

    await ensureWorkspaceQuotaDoc(req.user._id);
    const reservedQuota = await LedStudioWorkspaceQuota.findOneAndUpdate(
      { owner: req.user._id, reservedBytes: { $lte: maxReservedAllowed - sizeBytes } },
      { $inc: { reservedBytes: sizeBytes } },
      { new: true }
    );
    if (!reservedQuota) {
      return res.status(409).json({
        success: false,
        code: 'STORAGE_QUOTA_EXCEEDED',
        message: `Account storage quota (${quotaLabel}) exceeded`,
        data: { usedBytes: usage.referencedBytes + usage.reservedBytes, maxBytes: maxUserBytes }
      });
    }
    reservedForThisRequest = sizeBytes;

    const uploadId = `lswu_${crypto.randomUUID()}`;
    const mode = entitlement.proActive ? 'presigned_put' : 'proxy_stream';
    const objectKey = buildWorkspaceAssetKey(req.user._id, sha256);
    const bucketName = getLedWorkspaceBucketName();
    const expiresAt = new Date(Date.now() + WORKSPACE_UPLOAD_TTL_MS);

    await LedStudioWorkspaceUpload.create({
      uploadId,
      owner: req.user._id,
      sha256,
      sizeBytes,
      mimeType: mimeType || 'application/octet-stream',
      kind,
      mode,
      bucketName,
      objectKey,
      status: 'pending',
      expiresAt
    });

    if (mode === 'presigned_put') {
      const presigned = await generateWorkspacePresignedPutUrl(
        objectKey,
        mimeType || 'application/octet-stream',
        sizeBytes,
        900
      );
      return res.json({
        success: true,
        message: 'Upload prepared',
        data: {
          reused: false,
          uploadId,
          mode,
          uploadUrl: presigned.presignedUrl,
          expiresAt: expiresAt.toISOString()
        }
      });
    }

    return res.json({
      success: true,
      message: 'Upload prepared',
      data: {
        reused: false,
        uploadId,
        mode,
        uploadUrl: `/api/led-studio/workspace/assets/${uploadId}/content`,
        expiresAt: expiresAt.toISOString()
      }
    });
  } catch (err) {
    if (reservedForThisRequest > 0) {
      await releaseReservedBytes(req.user._id, reservedForThisRequest);
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/assets/:uploadId/content', async (req, res) => {
  const entitlement = resolveWorkspaceEntitlement(req.user);
  const upload = await LedStudioWorkspaceUpload.findOne({
    uploadId: req.params.uploadId,
    owner: req.user._id
  });
  if (!upload) {
    return res.status(404).json({ success: false, message: 'Upload session not found' });
  }
  if (upload.status === 'completed' && upload.assetId) {
    return res.json({ success: true, message: 'Upload already completed', data: { assetId: upload.assetId } });
  }
  if (upload.status !== 'pending' || upload.expiresAt.getTime() <= Date.now()) {
    return res.status(409).json({ success: false, message: 'Upload session expired or invalid' });
  }
  if (upload.mode !== 'proxy_stream') {
    return res.status(400).json({ success: false, message: 'Upload mode does not use proxy stream' });
  }
  if (activeProxyUploads >= MAX_CONCURRENT_PROXY_UPLOADS) {
    return res.status(503).json({ success: false, message: 'Too many concurrent uploads; please retry shortly' });
  }

  activeProxyUploads += 1;
  fs.mkdirSync(WORKSPACE_TEMP_DIR, { recursive: true });
  const tempPath = path.join(WORKSPACE_TEMP_DIR, `${upload.uploadId}-${crypto.randomUUID()}.tmp`);

  try {
    const hash = crypto.createHash('sha256');
    let receivedBytes = 0;
    const headChunks = [];
    let headBytes = 0;

    await new Promise((resolve, reject) => {
      let settled = false;
      const writeStream = fs.createWriteStream(tempPath);
      const fail = (err) => {
        if (settled) return;
        settled = true;
        writeStream.destroy();
        if (!req.destroyed) req.destroy();
        reject(err);
      };
      req.on('data', (chunk) => {
        if (settled) return;
        receivedBytes += chunk.length;
        if (receivedBytes > upload.sizeBytes || receivedBytes > entitlement.maxFileBytes) {
          fail(new Error('Uploaded stream exceeds declared size'));
          return;
        }
        hash.update(chunk);
        if (headBytes < 4096) {
          const slice = chunk.subarray(0, 4096 - headBytes);
          headChunks.push(slice);
          headBytes += slice.length;
        }
      });
      req.on('aborted', () => fail(new Error('Upload request aborted')));
      req.on('error', fail);
      writeStream.on('error', fail);
      writeStream.on('finish', () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      req.pipe(writeStream);
    });

    if (receivedBytes !== upload.sizeBytes) {
      return res.status(400).json({ success: false, message: 'Uploaded size does not match declared sizeBytes' });
    }
    const actualSha256 = hash.digest('hex').toLowerCase();
    if (actualSha256 !== upload.sha256) {
      return res.status(400).json({ success: false, message: 'Uploaded SHA-256 does not match declared digest' });
    }

    const headBuf = Buffer.concat(headChunks);
    const magic = detectMagicBytesMime(headBuf, upload.kind, upload.mimeType);
    if (!magic.ok) {
      return res.status(400).json({ success: false, message: magic.reason });
    }

    const fileStream = fs.createReadStream(tempPath);
    const b2Result = await putWorkspaceObject(
      upload.objectKey,
      fileStream,
      magic.detectedMime || upload.mimeType,
      receivedBytes
    );

    const existingAsset = await LedStudioWorkspaceAsset.findOne({
      owner: req.user._id,
      sha256: upload.sha256,
      kind: upload.kind,
      sizeBytes: receivedBytes,
      status: 'active'
    }).lean();

    const assetId = existingAsset?.assetId || `lswa_${crypto.randomUUID()}`;
    if (!existingAsset) {
      await LedStudioWorkspaceAsset.create({
        assetId,
        owner: req.user._id,
        sha256: upload.sha256,
        sizeBytes: receivedBytes,
        mimeType: magic.detectedMime || upload.mimeType,
        kind: upload.kind,
        bucketName: b2Result.bucketName,
        objectKey: b2Result.key,
        versionId: b2Result.versionId,
        status: 'active'
      });
    }

    const completedUpload = await LedStudioWorkspaceUpload.findOneAndUpdate(
      { uploadId: req.params.uploadId, owner: req.user._id, status: 'pending' },
      { $set: { status: 'completed', assetId, versionId: b2Result.versionId } },
      { new: true }
    );
    if (completedUpload) {
      await releaseReservedBytes(req.user._id, upload.sizeBytes);
      return res.json({
        success: true,
        message: 'Upload verified and stored',
        data: { assetId }
      });
    }

    const latest = await LedStudioWorkspaceUpload.findOne({
      uploadId: req.params.uploadId,
      owner: req.user._id
    }).lean();
    if (latest?.status === 'completed' && latest.assetId) {
      return res.json({
        success: true,
        message: 'Upload already completed',
        data: { assetId: latest.assetId }
      });
    }
    return res.status(409).json({ success: false, message: 'Upload session state changed concurrently' });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  } finally {
    activeProxyUploads = Math.max(0, activeProxyUploads - 1);
    fs.rmSync(tempPath, { force: true });
  }
});

router.post('/assets/:uploadId/complete', async (req, res) => {
  try {
    const entitlement = resolveWorkspaceEntitlement(req.user);
    const upload = await LedStudioWorkspaceUpload.findOne({
      uploadId: req.params.uploadId,
      owner: req.user._id
    });
    if (!upload) {
      return res.status(404).json({ success: false, message: 'Upload session not found' });
    }
    if (upload.status === 'completed' && upload.assetId) {
      return res.json({ success: true, message: 'Upload already completed', data: { assetId: upload.assetId } });
    }
    if (upload.status !== 'pending' || upload.expiresAt.getTime() <= Date.now()) {
      return res.status(409).json({ success: false, message: 'Upload session expired or invalid' });
    }
    if (upload.mode !== 'presigned_put') {
      return res.status(400).json({ success: false, message: 'Upload mode does not use presigned completion' });
    }
    if (!isMediaKindAllowedForPlan(upload.kind, entitlement.proActive)) {
      return res.status(403).json({
        success: false,
        code: 'PRO_REQUIRED',
        message: 'Active Pro subscription required to complete audio/video upload'
      });
    }

    const head = await headWorkspaceObject(upload.objectKey);
    if (!head.exists) {
      return res.status(409).json({ success: false, message: 'Uploaded object not found on B2 yet' });
    }
    if (head.size !== upload.sizeBytes) {
      return res.status(400).json({ success: false, message: 'B2 object size does not match declared sizeBytes' });
    }
    if (upload.kind === 'image' && head.contentType && head.contentType !== 'image/webp') {
      return res.status(400).json({ success: false, message: 'Uploaded image must be image/webp' });
    }

    const headBuf = await readWorkspaceObjectHeadBytes(upload.objectKey, head.versionId, 4096);
    const magic = detectMagicBytesMime(headBuf, upload.kind, head.contentType || upload.mimeType);
    if (!magic.ok) {
      await deleteWorkspaceObjectVersion(upload.objectKey, head.versionId).catch(() => {});
      const failedUpload = await LedStudioWorkspaceUpload.findOneAndUpdate(
        { uploadId: req.params.uploadId, owner: req.user._id, status: 'pending' },
        { $set: { status: 'failed' } }
      );
      if (failedUpload) {
        await releaseReservedBytes(req.user._id, upload.sizeBytes);
      }
      return res.status(400).json({ success: false, message: magic.reason });
    }

    const existingAsset = await LedStudioWorkspaceAsset.findOne({
      owner: req.user._id,
      sha256: upload.sha256,
      kind: upload.kind,
      sizeBytes: upload.sizeBytes,
      status: 'active'
    }).lean();

    const verifiedMime = magic.detectedMime || head.contentType || upload.mimeType;
    const assetId = existingAsset?.assetId || `lswa_${crypto.randomUUID()}`;
    if (!existingAsset) {
      await LedStudioWorkspaceAsset.create({
        assetId,
        owner: req.user._id,
        sha256: upload.sha256,
        sizeBytes: upload.sizeBytes,
        mimeType: verifiedMime,
        kind: upload.kind,
        bucketName: upload.bucketName,
        objectKey: upload.objectKey,
        versionId: head.versionId || 'null',
        status: 'active'
      });
    }

    const completedUpload = await LedStudioWorkspaceUpload.findOneAndUpdate(
      { uploadId: req.params.uploadId, owner: req.user._id, status: 'pending' },
      { $set: { status: 'completed', assetId, versionId: head.versionId || 'null' } },
      { new: true }
    );
    if (completedUpload) {
      await releaseReservedBytes(req.user._id, upload.sizeBytes);
      return res.json({
        success: true,
        message: 'Upload completed',
        data: { assetId }
      });
    }

    const latest = await LedStudioWorkspaceUpload.findOne({
      uploadId: req.params.uploadId,
      owner: req.user._id
    }).lean();
    if (latest?.status === 'completed' && latest.assetId) {
      return res.json({
        success: true,
        message: 'Upload already completed',
        data: { assetId: latest.assetId }
      });
    }
    return res.status(409).json({ success: false, message: 'Upload session state changed concurrently' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
