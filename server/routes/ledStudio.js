import express from 'express';
import crypto from 'node:crypto';
import LedStudioProject from '../models/LedStudioProject.js';
import LedStudioPreset, { PRESET_CATEGORIES, PRESET_TYPES } from '../models/LedStudioPreset.js';
import { authMiddleware, getUserFromToken } from '../middleware/auth.js';
import {
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
  uploadFile,
  downloadFile,
  deleteFile
} from '../utils/b2Storage.js';

export const partnerOrAdmin = (req, res, next) => {
  if (!['admin', 'mod', 'partner'].includes(req.user?.role)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Partner or Admin only.'
    });
  }
  next();
};

const router = express.Router();

export function hashShareToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

export function validateShareAccess(projectDoc, rawToken) {
  if (!projectDoc || !projectDoc.shareEnabled || !projectDoc.shareTokenHash) {
    return { ok: false, reason: 'Share link is disabled' };
  }
  if (projectDoc.shareExpiresAt && new Date(projectDoc.shareExpiresAt).getTime() < Date.now()) {
    return { ok: false, reason: 'Share link has expired' };
  }
  const incomingHash = hashShareToken(rawToken);
  const a = Buffer.from(incomingHash, 'hex');
  const b = Buffer.from(String(projectDoc.shareTokenHash), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Invalid share token' };
  }
  return { ok: true };
}

export function sanitizeStageSummary(raw = {}) {
  const clamp = (v, max = 10000) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
  };
  return {
    widthM: clamp(raw.widthM, 500),
    depthM: clamp(raw.depthM, 500),
    heightM: clamp(raw.heightM, 200),
    ledCount: Math.round(clamp(raw.ledCount ?? raw.screenCount, 2048)),
    lightCount: Math.round(clamp(raw.lightCount ?? raw.fixtureCount, 512)),
    cueCount: Math.round(clamp(raw.cueCount ?? raw.fxCueCount, 5000))
  };
}

export function validateProjectPayload(rawPayload) {
  if (!rawPayload) {
    return { ok: false, reason: 'Project payload is required' };
  }
  let parsed = rawPayload;
  if (typeof rawPayload === 'string') {
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      return { ok: false, reason: 'Project payload is not valid JSON' };
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'Project payload must be a non-empty stage object' };
  }
  if (!parsed.model || typeof parsed.model !== 'object' || typeof parsed.model.name !== 'string' || !parsed.model.name.trim()) {
    return { ok: false, reason: 'Project payload is missing valid model metadata' };
  }
  const masterW = Number(parsed.master?.width);
  const masterH = Number(parsed.master?.height);
  if (!Number.isFinite(masterW) || masterW < 64 || !Number.isFinite(masterH) || masterH < 64) {
    return { ok: false, reason: 'Project payload is missing valid master canvas dimensions' };
  }
  if (!Array.isArray(parsed.screens) || !Array.isArray(parsed.lights)) {
    return { ok: false, reason: 'Project payload is missing screens or lights arrays' };
  }
  return { ok: true, payload: parsed };
}

export function isOwnedB2Key(key, kind, userId) {
  const uid = String(userId || '').trim();
  if (!uid || typeof key !== 'string') return false;
  const prefix = `led-studio/${kind}/${uid}/`;
  return key.startsWith(prefix) && !key.includes('..') && key.length > prefix.length;
}

export function generateServerOwnedB2Key(kind, userId, ext = '.ledstudio') {
  const uid = String(userId || '').trim();
  const nonce = crypto.randomBytes(6).toString('hex');
  return `led-studio/${kind}/${uid}/${Date.now()}-${nonce}${ext}`;
}

function isB2Configured() {
  return Boolean(process.env.B2_BUCKET_NAME && process.env.B2_ENDPOINT);
}

let presignDownloadFn = generatePresignedDownloadUrl;

export function setPresignedDownloadUrlGenerator(fn) {
  presignDownloadFn = typeof fn === 'function' ? fn : generatePresignedDownloadUrl;
}

async function resolveStorageDownloadUrl(objectKey, expiresIn = 3600) {
  if (!objectKey || !isB2Configured()) return null;
  try {
    return await presignDownloadFn(objectKey, expiresIn);
  } catch (err) {
    if (
      process.env.B2_ENDPOINT &&
      process.env.B2_BUCKET_NAME &&
      (!process.env.B2_ACCESS_KEY_ID || !process.env.B2_SECRET_ACCESS_KEY)
    ) {
      const endpoint = String(process.env.B2_ENDPOINT).replace(/\/+$/, '');
      const bucket = encodeURIComponent(String(process.env.B2_BUCKET_NAME));
      return `${endpoint}/${bucket}/${String(objectKey).replace(/^\/+/, '')}`;
    }
    throw err;
  }
}

async function resolveOptionalUser(req) {
  if (req.user) return req.user;
  const token = req.headers?.authorization?.replace('Bearer ', '') || req.cookies?.token;
  if (!token) return null;
  try {
    req.user = await getUserFromToken(token);
    return req.user;
  } catch {
    return null;
  }
}

router.get('/presets', async (req, res) => {
  try {
    const scope = String(req.query?.scope || 'public');
    const user = await resolveOptionalUser(req);
    let filter = { isPublic: true };

    if (scope === 'mine') {
      if (!user?._id) {
        return res.status(401).json({ success: false, message: 'Authentication required for scope=mine' });
      }
      filter = { $or: [{ createdBy: user._id }, { authorId: user._id }] };
    } else if (scope === 'all' && user?._id) {
      filter = { $or: [{ isPublic: true }, { visibility: 'public' }, { createdBy: user._id }, { authorId: user._id }] };
    }

    const cat = req.query?.category || req.query?.presetType;
    if (cat && PRESET_TYPES.includes(String(cat))) {
      filter.category = String(cat);
    }

    const presets = await LedStudioPreset.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    return res.json({ success: true, message: 'OK', data: presets });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

async function respondWithPresetDescriptor(req, res, preset) {
  if (!preset) {
    return res.status(404).json({ success: false, message: 'Preset not found' });
  }
  const user = await resolveOptionalUser(req);
  const isOwner = user?._id && (
    String(preset.authorId || '') === String(user._id) ||
    String(preset.createdBy || '') === String(user._id) ||
    user.role === 'admin'
  );
  const isPublicPreset = preset.isPublic !== false && preset.visibility !== 'private';
  if (!isPublicPreset && !isOwner) {
    return res.status(403).json({ success: false, message: 'Forbidden: private preset belongs to another user' });
  }
  let downloadUrl = null;
  if (preset.b2AssetKey && isB2Configured()) {
    downloadUrl = await resolveStorageDownloadUrl(preset.b2AssetKey, 3600);
  }
  return res.json({
    success: true,
    message: 'OK',
    data: {
      preset,
      payloadJson: preset.payloadJson ?? preset.payloadSummary ?? null,
      downloadUrl
    }
  });
}

router.get('/presets/asset', async (req, res) => {
  try {
    const key = String(req.query?.key || '').trim();
    if (!key) {
      return res.status(400).json({ success: false, message: 'Missing preset asset key' });
    }
    const preset = await LedStudioPreset.findOne({ b2AssetKey: key }).lean();
    return await respondWithPresetDescriptor(req, res, preset);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/presets/:id', async (req, res) => {
  try {
    const preset = await LedStudioPreset.findOne({ _id: req.params.id }).lean();
    return await respondWithPresetDescriptor(req, res, preset);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/presets', authMiddleware, async (req, res) => {
  try {
    const {
      title,
      titleEn,
      summary,
      summaryEn,
      presetType,
      category,
      thumbnailUrl,
      b2AssetKey,
      payloadJson,
      payloadSummary,
      visibility,
      isPublic,
      ownership
    } = req.body || {};

    const rawVi = typeof title === 'string' ? title.trim() : String(title?.vi || '').trim();
    const rawEn = typeof title === 'string' ? String(titleEn || '').trim() : String(title?.en || titleEn || '').trim();
    const resolvedCategory = category && PRESET_TYPES.includes(category)
      ? category
      : (presetType && PRESET_TYPES.includes(presetType) ? presetType : null);

    if (!rawVi || !resolvedCategory) {
      return res.status(400).json({ success: false, message: 'Preset Vietnamese title and valid category are required' });
    }
    if (typeof thumbnailUrl === 'string' && thumbnailUrl.startsWith('data:')) {
      return res.status(422).json({ success: false, message: 'Inline base64 thumbnailUrl is not allowed' });
    }
    if (b2AssetKey && !isOwnedB2Key(b2AssetKey, 'presets', req.user._id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: cannot reference a foreign B2 preset asset key' });
    }

    const isPrivileged = ['admin', 'mod', 'partner'].includes(req.user?.role);
    const resolvedOwnership = isPrivileged && ownership === 'platform' ? 'platform' : 'community';
    const resolvedPublic = visibility === 'private' ? false : (isPublic !== false);
    const resolvedVisibility = resolvedPublic ? 'public' : 'private';

    let finalAssetKey = b2AssetKey ? String(b2AssetKey).trim() : '';
    const effectivePayload = payloadJson ?? (payloadSummary && typeof payloadSummary === 'object' ? payloadSummary : null);
    if (effectivePayload && isB2Configured() && !finalAssetKey) {
      finalAssetKey = generateServerOwnedB2Key('presets', req.user._id, '.json');
      await uploadFile(finalAssetKey, Buffer.from(JSON.stringify(effectivePayload), 'utf8'), 'application/json');
    }

    const preset = await LedStudioPreset.create({
      authorId: req.user._id,
      createdBy: req.user._id,
      ownership: resolvedOwnership,
      visibility: resolvedVisibility,
      isPublic: resolvedPublic,
      category: resolvedCategory,
      presetType: resolvedCategory,
      title: { vi: rawVi.slice(0, 140), en: rawEn.slice(0, 140) },
      summary: String(summary || '').trim().slice(0, 1000),
      summaryEn: String(summaryEn || '').trim().slice(0, 1000),
      thumbnailUrl: String(thumbnailUrl || '').trim(),
      b2AssetKey: finalAssetKey,
      payloadJson: effectivePayload,
      payloadSummary: payloadSummary && typeof payloadSummary === 'object' ? payloadSummary : (effectivePayload || {})
    });
    return res.status(201).json({ success: true, message: 'Preset created', data: preset });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/projects', authMiddleware, async (req, res) => {
  try {
    const projects = await LedStudioProject.find({ owner: req.user._id })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    return res.json({ success: true, message: 'OK', data: projects });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

async function persistProjectWrite(req, res, existingId = null) {
  const {
    projectId,
    title,
    description,
    b2FileKey,
    fileSize,
    thumbnailUrl,
    stageSummary,
    requestUploadUrl,
    projectJson
  } = req.body || {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ success: false, message: 'Project title is required' });
  }
  if (typeof thumbnailUrl === 'string' && thumbnailUrl.startsWith('data:')) {
    return res.status(422).json({ success: false, message: 'Inline base64 thumbnailUrl is not allowed' });
  }

  // C1 Guard: Reject any caller-supplied foreign B2 key immediately
  if (b2FileKey !== undefined && b2FileKey !== null && b2FileKey !== '') {
    if (!isOwnedB2Key(String(b2FileKey), 'projects', req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: cannot register or overwrite a foreign B2 object key'
      });
    }
  }

  const targetId = existingId || projectId || null;
  let existingDoc = null;
  if (targetId) {
    existingDoc = await LedStudioProject.findOne({ _id: targetId, owner: req.user._id });
    if (!existingDoc) {
      return res.status(404).json({ success: false, message: 'Project not found or unauthorized' });
    }
    if (b2FileKey && String(b2FileKey) !== existingDoc.b2FileKey) {
      return res.status(403).json({ success: false, message: 'Forbidden: cannot rebind project B2 key' });
    }
  } else if (b2FileKey) {
    // New project creations must never accept caller-supplied B2 keys
    return res.status(403).json({
      success: false,
      message: 'Forbidden: new projects must use a server-generated B2 object key'
    });
  }

  const resolvedKey = existingDoc
    ? existingDoc.b2FileKey
    : generateServerOwnedB2Key('projects', req.user._id, '.ledstudio');

  let uploadInfo = null;
  let computedSize = Number(fileSize) || 0;
  let validatedPayload = null;

  if (projectJson !== undefined && projectJson !== null) {
    const check = validateProjectPayload(projectJson);
    if (!check.ok) {
      return res.status(400).json({ success: false, message: check.reason });
    }
    validatedPayload = check.payload;
    const jsonBytes = Buffer.from(JSON.stringify(validatedPayload), 'utf8');
    computedSize = jsonBytes.byteLength;
    if (isB2Configured()) {
      await uploadFile(resolvedKey, jsonBytes, 'application/json');
    }
  } else if (requestUploadUrl) {
    if (!isB2Configured()) {
      return res.status(503).json({ success: false, message: 'Cloud object storage is not configured for presigned uploads' });
    }
    uploadInfo = await generatePresignedUploadUrl(resolvedKey, 'application/json', 900);
  } else {
    return res.status(400).json({
      success: false,
      message: 'Either a valid projectJson payload or requestUploadUrl=true is required'
    });
  }

  const autoSummary = validatedPayload
    ? sanitizeStageSummary({
        widthM: stageSummary?.widthM ?? validatedPayload.model?.width ?? 0,
        depthM: stageSummary?.depthM ?? validatedPayload.model?.depth ?? 0,
        heightM: stageSummary?.heightM ?? validatedPayload.model?.height ?? 0,
        ledCount: stageSummary?.ledCount ?? stageSummary?.screenCount ?? validatedPayload.screens?.length ?? 0,
        lightCount: stageSummary?.lightCount ?? stageSummary?.fixtureCount ?? validatedPayload.lights?.length ?? 0,
        cueCount: stageSummary?.cueCount ?? stageSummary?.fxCueCount ?? validatedPayload.live?.show?.clips?.length ?? 0
      })
    : sanitizeStageSummary(stageSummary);

  if (existingDoc) {
    existingDoc.title = title.trim().slice(0, 140);
    existingDoc.description = String(description ?? existingDoc.description ?? '').trim().slice(0, 1000);
    existingDoc.fileSize = Math.max(0, computedSize);
    if (thumbnailUrl !== undefined) {
      existingDoc.thumbnailUrl = String(thumbnailUrl || '').trim();
    }
    existingDoc.stageSummary = autoSummary;
    if (validatedPayload) {
      existingDoc.projectPayload = validatedPayload;
    }
    await existingDoc.save();
    const outObj = existingDoc.toObject ? existingDoc.toObject() : { ...existingDoc };
    delete outObj.projectPayload;
    return res.status(200).json({
      success: true,
      message: 'Project updated',
      data: { project: outObj, uploadInfo }
    });
  }

  const created = await LedStudioProject.create({
    owner: req.user._id,
    title: title.trim().slice(0, 140),
    description: String(description || '').trim().slice(0, 1000),
    b2FileKey: resolvedKey,
    fileSize: Math.max(0, computedSize),
    thumbnailUrl: String(thumbnailUrl || '').trim(),
    stageSummary: autoSummary,
    projectPayload: validatedPayload
  });
  const outObj = created.toObject ? created.toObject() : { ...created };
  delete outObj.projectPayload;
  return res.status(201).json({
    success: true,
    message: 'Project saved',
    data: { project: outObj, uploadInfo }
  });
}

router.post('/projects', authMiddleware, async (req, res) => {
  try {
    return await persistProjectWrite(req, res, null);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/projects/:id', authMiddleware, async (req, res) => {
  try {
    return await persistProjectWrite(req, res, req.params.id);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/projects/:id', authMiddleware, async (req, res) => {
  try {
    const query = LedStudioProject.findOne({ _id: req.params.id, owner: req.user._id });
    const project = typeof query.select === 'function'
      ? await query.select('+projectPayload').lean()
      : await query.lean();
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    if (!isOwnedB2Key(project.b2FileKey, 'projects', req.user._id)) {
      return res.status(403).json({ success: false, message: 'Forbidden: project B2 key does not match owner namespace' });
    }
    let downloadUrl = null;
    let projectJson = project.projectPayload || null;
    if (isB2Configured() && project.b2FileKey) {
      downloadUrl = await resolveStorageDownloadUrl(project.b2FileKey, 3600).catch(() => null);
      if (!projectJson) {
        const rawBuf = await downloadFile(project.b2FileKey).catch(() => null);
        if (rawBuf && rawBuf.length > 0) {
          try {
            projectJson = JSON.parse(rawBuf.toString('utf8'));
          } catch {
            projectJson = null;
          }
        }
      }
    }
    const { projectPayload, ...projectMeta } = project;
    return res.json({ success: true, message: 'OK', data: { project: projectMeta, downloadUrl, projectJson } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/projects/:id', authMiddleware, async (req, res) => {
  try {
    const project = await LedStudioProject.findOneAndDelete({ _id: req.params.id, owner: req.user._id });
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    if (project.b2FileKey && isOwnedB2Key(project.b2FileKey, 'projects', req.user._id) && isB2Configured()) {
      await deleteFile(project.b2FileKey).catch(() => {});
    }
    return res.json({ success: true, message: 'Project deleted', data: { id: project._id } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/projects/:id/share', authMiddleware, async (req, res) => {
  try {
    const { enabled = true, expiresInHours = 168 } = req.body || {};
    const project = await LedStudioProject.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    if (!enabled) {
      project.shareEnabled = false;
      project.shareTokenHash = null;
      project.shareExpiresAt = null;
      await project.save();
      return res.json({ success: true, message: 'Share disabled', data: { shareEnabled: false } });
    }
    const rawToken = crypto.randomBytes(24).toString('base64url');
    project.shareEnabled = true;
    project.shareTokenHash = hashShareToken(rawToken);
    project.shareExpiresAt = new Date(Date.now() + Math.max(1, Number(expiresInHours) || 168) * 3600_000);
    await project.save();
    return res.json({
      success: true,
      message: 'Share link generated',
      data: {
        shareToken: rawToken,
        shareExpiresAt: project.shareExpiresAt
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/share/:shareToken', async (req, res) => {
  try {
    const rawToken = String(req.params.shareToken || '');
    const tokenHash = hashShareToken(rawToken);
    const query = LedStudioProject.findOne({ shareTokenHash: tokenHash, shareEnabled: true });
    const project = typeof query.select === 'function'
      ? await query.select('+projectPayload').lean()
      : await query.lean();
    const check = validateShareAccess(project, rawToken);
    if (!check.ok) {
      return res.status(403).json({ success: false, message: check.reason });
    }
    let downloadUrl = null;
    let projectJson = project.projectPayload || null;
    if (isB2Configured() && project.b2FileKey && isOwnedB2Key(project.b2FileKey, 'projects', project.owner)) {
      downloadUrl = await resolveStorageDownloadUrl(project.b2FileKey, 3600).catch(() => null);
      if (!projectJson) {
        const rawBuf = await downloadFile(project.b2FileKey).catch(() => null);
        if (rawBuf && rawBuf.length > 0) {
          try {
            projectJson = JSON.parse(rawBuf.toString('utf8'));
          } catch {
            projectJson = null;
          }
        }
      }
    }
    if (!projectJson && !downloadUrl) {
      return res.status(404).json({ success: false, message: 'Shared project stage payload is unavailable' });
    }
    return res.json({
      success: true,
      message: 'OK',
      data: {
        mode: 'client_review_readonly',
        projectId: project._id,
        title: project.title,
        description: project.description,
        stageSummary: project.stageSummary,
        downloadUrl,
        projectJson,
        updatedAt: project.updatedAt
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
