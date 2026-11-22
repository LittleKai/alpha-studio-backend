import express from 'express';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import LedStudioProject from '../models/LedStudioProject.js';
import LedStudioPreset, { PRESET_CATEGORIES, PRESET_TYPES } from '../models/LedStudioPreset.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import { callGcliDirect, callExternalByokAi } from '../utils/aiProvider.js';
import {
  LUMI_BRAND,
  LUMI_FREE_AI_CREDITS,
  LUMI_TOKEN_PRICING,
  LUMI_EFFORT_MODELS,
  LUMI_PLANS,
  LUMI_CREDIT_ACTIONS,
  LUMI_DEFAULT_PRESET_PACK,
  getLumiProduct,
  calculateLumiTokenCredits,
  signLumiLicenseToken,
  verifyLumiLicenseToken,
  signLumiStudioTicket
} from '../utils/lumiCatalog.js';
import { authMiddleware, getUserFromToken } from '../middleware/auth.js';
import {
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
  uploadFile,
  downloadFile,
  deleteFile
} from '../utils/b2Storage.js';
import {
  generateStageDxf,
  exportLightingMvr18,
  buildGrandMaFixtureXml,
  computeEngineeringRider,
  generateCrewSplitDossier18,
  buildPrintableStageDocumentHtml18
} from '../utils/lumiProExporters.js';

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

export function hashSharePassword(rawPassword) {
  return hashShareToken('lumi_pwd:' + String(rawPassword || '').trim());
}

export function verifySharePassword(projectDoc, rawPassword) {
  if (!projectDoc?.sharePasswordProtected || !projectDoc?.sharePasswordHash) {
    return { ok: true, requiresPassword: false };
  }
  const trimmed = String(rawPassword || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      requiresPassword: true,
      invalidPassword: false,
      reason: 'Dự án này được bảo vệ bằng mật khẩu.'
    };
  }
  const incomingHash = hashSharePassword(trimmed);
  const a = Buffer.from(incomingHash, 'hex');
  const b = Buffer.from(String(projectDoc.sharePasswordHash), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return {
      ok: false,
      requiresPassword: false,
      invalidPassword: true,
      reason: 'Mật khẩu xem dự án không đúng.'
    };
  }
  return { ok: true, requiresPassword: false };
}

export const FREE_SHARE_MAX_HOURS = 168;

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

async function resolveShareProGate(project) {
  if (!project?.shareUntilPro) {
    return { ok: true, expiresAt: project?.shareExpiresAt || null };
  }
  let owner = null;
  if (typeof User.findById === 'function') {
    const q = User.findById(project.owner);
    owner = typeof q?.select === 'function'
      ? await q.select('role lumiStage').lean().catch(() => null)
      : await Promise.resolve(q).catch(() => null);
  }
  const sub = normalizeUserLumiState(owner);
  return sub.proActive ? { ok: true, expiresAt: sub.expiresAt } : { ok: false };
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

let customStageAiRunner = null;

export function setStageAiRunner(fn) {
  customStageAiRunner = typeof fn === 'function' ? fn : null;
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

export function normalizeUserLumiState(userDoc) {
  const raw = userDoc?.lumiStage || {};
  const expiresAt = raw.expiresAt ? new Date(raw.expiresAt) : null;
  const isRolePro = ['admin', 'partner'].includes(userDoc?.role);
  const isSubActive = Boolean(
    raw.plan &&
    raw.plan !== 'free' &&
    expiresAt &&
    expiresAt.getTime() > Date.now()
  );
  const proActive = isRolePro || isSubActive;
  const effectivePlan = isSubActive ? raw.plan : (isRolePro ? 'pro_partner' : 'free');
  return {
    plan: effectivePlan,
    proActive,
    expiresAt: isSubActive ? expiresAt.toISOString() : null,
    freeAiCreditsRemaining: Number(Number(raw.freeAiCreditsRemaining ?? LUMI_FREE_AI_CREDITS).toFixed(4)),
    singleExportCredits: Math.max(0, Math.floor(Number(raw.singleExportCredits ?? 0))),
    unlockedProjectKeys: Array.isArray(raw.unlockedProjectKeys) ? raw.unlockedProjectKeys.map(String) : []
  };
}

async function loadMutableUser(reqUser) {
  if (!reqUser?._id) return null;
  if (typeof User.findById === 'function') {
    const found = await User.findById(reqUser._id).catch(() => null);
    if (found) return found;
  }
  if (!reqUser.lumiStage) {
    reqUser.lumiStage = {
      plan: 'free',
      expiresAt: null,
      freeAiCreditsRemaining: LUMI_FREE_AI_CREDITS,
      singleExportCredits: 0,
      unlockedProjectKeys: []
    };
  }
  if (typeof reqUser.save !== 'function') {
    reqUser.save = async function saveStub() { return this; };
  }
  return reqUser;
}

const SESSION_TICKET_MAX_AGE_SEC = 900;
const TICKET_RATE_WINDOW_MS = 60_000;
const TICKET_RATE_LIMIT = 30;
const TICKET_PWD_FAIL_LIMIT = 10;
const TICKET_BUCKET_MAX = 5000;
const ticketRateBuckets = new Map();

function extractClientFirstHop(req) {
  const flyIp = String(req.headers?.['fly-client-ip'] || '').trim();
  if (flyIp) return flyIp;
  const fwdParts = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (fwdParts.length > 0) return fwdParts[fwdParts.length - 1];
  return String(req.ip || 'unknown').trim() || 'unknown';
}

function consumeRateBucket(map, key, limit, windowMs, maxKeys = TICKET_BUCKET_MAX) {
  const now = Date.now();
  let entry = map.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    entry = { windowStart: now, count: 0 };
  }
  entry.count += 1;
  map.set(key, entry);
  if (map.size > maxKeys) {
    for (const [k, v] of map) {
      if (now - v.windowStart >= windowMs) map.delete(k);
    }
    for (const k of map.keys()) {
      if (map.size <= maxKeys) break;
      map.delete(k);
    }
  }
  return entry.count <= limit;
}

function issueSessionTicketCookie(res, sub, mode) {
  const nowMs = Date.now();
  const ticket = signLumiStudioTicket({
    sub,
    mode,
    ttlSec: SESSION_TICKET_MAX_AGE_SEC,
    nowMs
  });
  const cookieStr = [
    `lumi_studio_ticket=${ticket}`,
    'Path=/led-studio',
    `Max-Age=${SESSION_TICKET_MAX_AGE_SEC}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict'
  ].join('; ');
  res.setHeader('Set-Cookie', cookieStr);
  return new Date(nowMs + SESSION_TICKET_MAX_AGE_SEC * 1000).toISOString();
}

router.post('/session-ticket', async (req, res) => {
  try {
    if (!String(process.env.LUMI_STUDIO_TICKET_SECRET || '').trim()) {
      return res.status(503).json({
        success: false,
        code: 'TICKET_SECRET_UNCONFIGURED',
        message: 'Dịch vụ vé phiên LumiStage chưa được cấu hình.'
      });
    }

    const rawShareToken = String(req.body?.shareToken || req.query?.shareToken || '').trim();
    if (rawShareToken) {
      const rateKey = `share:${hashShareToken(rawShareToken).slice(0, 16)}:${extractClientFirstHop(req)}`;
      if (!consumeRateBucket(ticketRateBuckets, rateKey, TICKET_RATE_LIMIT, TICKET_RATE_WINDOW_MS)) {
        return res.status(429).json({
          success: false,
          code: 'RATE_LIMITED',
          message: 'Quá nhiều yêu cầu xác thực link chia sẻ. Vui lòng thử lại sau 1 phút.'
        });
      }

      const tokenHash = hashShareToken(rawShareToken);
      const query = LedStudioProject.findOne({ shareTokenHash: tokenHash, shareEnabled: true });
      const project = typeof query?.select === 'function'
        ? await query.select('+sharePasswordHash').lean()
        : await query?.lean();
      const check = validateShareAccess(project, rawShareToken);
      if (!check.ok) {
        return res.status(403).json({
          success: false,
          code: 'INVALID_SHARE',
          message: check.reason
        });
      }
      const proGate = await resolveShareProGate(project);
      if (!proGate.ok) {
        return res.status(403).json({
          success: false,
          code: 'SHARE_PRO_EXPIRED',
          message: 'Link đã hết hiệu lực vì gói Pro của chủ dự án đã hết hạn.'
        });
      }

      const incomingPassword = req.headers?.['x-share-password'] || req.body?.password || '';
      const pwdFailKey = `share_pwd_fail:${tokenHash.slice(0, 16)}`;
      const existingPwdFail = ticketRateBuckets.get(pwdFailKey);
      if (
        project?.sharePasswordProtected &&
        existingPwdFail &&
        Date.now() - existingPwdFail.windowStart < TICKET_RATE_WINDOW_MS &&
        existingPwdFail.count >= TICKET_PWD_FAIL_LIMIT
      ) {
        return res.status(429).json({
          success: false,
          code: 'RATE_LIMITED',
          message: 'Quá nhiều lần nhập sai mật khẩu link chia sẻ. Vui lòng thử lại sau 1 phút.'
        });
      }
      const pwdCheck = verifySharePassword(project, incomingPassword);
      if (!pwdCheck.ok) {
        if (pwdCheck.requiresPassword) {
          return res.status(200).json({
            success: true,
            message: pwdCheck.reason,
            data: {
              issued: false,
              requiresPassword: true,
              passwordProtected: true,
              title: project.title || ''
            }
          });
        }
        if (!consumeRateBucket(ticketRateBuckets, pwdFailKey, TICKET_PWD_FAIL_LIMIT, TICKET_RATE_WINDOW_MS)) {
          return res.status(429).json({
            success: false,
            code: 'RATE_LIMITED',
            message: 'Quá nhiều lần nhập sai mật khẩu link chia sẻ. Vui lòng thử lại sau 1 phút.'
          });
        }
        return res.status(401).json({
          success: false,
          code: 'INVALID_SHARE_PASSWORD',
          message: pwdCheck.reason
        });
      }

      const expiresAt = issueSessionTicketCookie(res, `share:${project._id}`, 'share');
      return res.status(200).json({
        success: true,
        message: 'OK',
        data: {
          issued: true,
          requiresPassword: false,
          passwordProtected: Boolean(project.sharePasswordProtected),
          expiresAt,
          maxAge: SESSION_TICKET_MAX_AGE_SEC,
          mode: 'share'
        }
      });
    }

    const user = await resolveOptionalUser(req);
    if (!user?._id) {
      const anonKey = `anon:${extractClientFirstHop(req)}`;
      if (!consumeRateBucket(ticketRateBuckets, anonKey, TICKET_RATE_LIMIT, TICKET_RATE_WINDOW_MS)) {
        return res.status(429).json({
          success: false,
          code: 'RATE_LIMITED',
          message: 'Quá nhiều yêu cầu xác thực phiên. Vui lòng thử lại sau 1 phút.'
        });
      }
      return res.status(401).json({
        success: false,
        code: 'AUTH_REQUIRED',
        message: 'Vui lòng đăng nhập để mở LumiStage.'
      });
    }

    const userKey = `user:${String(user._id)}`;
    if (!consumeRateBucket(ticketRateBuckets, userKey, TICKET_RATE_LIMIT, TICKET_RATE_WINDOW_MS)) {
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        message: 'Quá nhiều yêu cầu gia hạn phiên. Vui lòng thử lại sau 1 phút.'
      });
    }

    const expiresAt = issueSessionTicketCookie(res, String(user._id), 'user');
    return res.status(200).json({
      success: true,
      message: 'OK',
      data: {
        issued: true,
        expiresAt,
        maxAge: SESSION_TICKET_MAX_AGE_SEC,
        mode: 'user'
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/presets/pack', async (req, res) => {
  const cat = req.query?.category || req.query?.presetType;
  const list = cat && PRESET_TYPES.includes(String(cat))
    ? LUMI_DEFAULT_PRESET_PACK.filter(p => p.category === String(cat))
    : LUMI_DEFAULT_PRESET_PACK;
  return res.json({ success: true, message: 'OK', data: list });
});

async function hydratePresetMediaUrls(preset) {
  if (!preset || typeof preset !== 'object' || !isB2Configured()) return preset;
  const thumbKey = preset.b2Assets?.thumbnailKey;
  const galleryKeys = Array.isArray(preset.b2Assets?.galleryKeys) ? preset.b2Assets.galleryKeys.filter(Boolean) : [];
  if (!thumbKey && !galleryKeys.length) return preset;
  const out = { ...preset };
  if (thumbKey) {
    const signedThumb = await resolveStorageDownloadUrl(thumbKey, 3600).catch(() => null);
    if (signedThumb) out.thumbnailUrl = signedThumb;
  }
  if (galleryKeys.length) {
    const signedGallery = (await Promise.all(
      galleryKeys.map(k => resolveStorageDownloadUrl(k, 3600).catch(() => null))
    )).filter(Boolean);
    if (signedGallery.length) out.galleryUrls = signedGallery;
  }
  return out;
}

router.get('/presets', async (req, res) => {
  try {
    const scope = String(req.query?.scope || 'public');
    const includePlatform = scope === 'platform' || req.query?.includePlatform === '1' || req.query?.includePlatform === 'true';
    const user = await resolveOptionalUser(req);
    let filter = { isPublic: true };

    if (scope === 'mine') {
      if (!user?._id) {
        return res.status(401).json({ success: false, message: 'Authentication required for scope=mine' });
      }
      filter = { $or: [{ createdBy: user._id }, { authorId: user._id }] };
    } else if (scope === 'all' && user?._id) {
      const orClauses = [{ isPublic: true }, { visibility: 'public' }, { createdBy: user._id }, { authorId: user._id }];
      if (['admin', 'partner'].includes(user.role)) {
        orClauses.push({ ownership: 'platform', visibility: 'private' });
      }
      filter = { $or: orClauses };
    }

    const cat = req.query?.category || req.query?.presetType;
    if (cat && PRESET_TYPES.includes(String(cat))) {
      filter.category = String(cat);
    }

    const q = String(req.query?.q || '').trim().slice(0, 100);
    let searchRx = null;
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      searchRx = new RegExp(escaped, 'i');
      const searchOr = [
        { 'title.vi': searchRx },
        { 'title.en': searchRx },
        { slug: searchRx },
        { tags: searchRx },
        { summary: searchRx },
        { summaryEn: searchRx }
      ];
      if (filter.$or) {
        const baseFilter = { ...filter };
        delete baseFilter.$or;
        filter = { ...baseFilter, $and: [{ $or: filter.$or }, { $or: searchOr }] };
      } else {
        filter.$or = searchOr;
      }
    }

    const rawPresets = scope === 'platform'
      ? []
      : await LedStudioPreset.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    const presets = isB2Configured()
      ? await Promise.all(rawPresets.map(hydratePresetMediaUrls))
      : rawPresets;

    if (includePlatform) {
      let pack = cat && PRESET_TYPES.includes(String(cat))
        ? LUMI_DEFAULT_PRESET_PACK.filter(p => p.category === String(cat))
        : LUMI_DEFAULT_PRESET_PACK;
      if (searchRx) {
        pack = pack.filter(p => (
          searchRx.test(String(p.title?.vi || '')) ||
          searchRx.test(String(p.title?.en || '')) ||
          searchRx.test(String(p.slug || '')) ||
          (Array.isArray(p.tags) && p.tags.some(t => searchRx.test(String(t || '')))) ||
          searchRx.test(String(p.summary || '')) ||
          searchRx.test(String(p.summaryEn || ''))
        ));
      }
      const existingIds = new Set(presets.map(p => String(p._id)));
      const merged = [...pack.filter(p => !existingIds.has(String(p._id))), ...presets];
      return res.json({ success: true, message: 'OK', data: merged });
    }

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
  const isPlatformStaff = user?._id && ['admin', 'partner'].includes(user.role) && preset.ownership === 'platform';
  const isOwner = user?._id && (
    String(preset.authorId || '') === String(user._id) ||
    String(preset.createdBy || '') === String(user._id) ||
    user.role === 'admin' ||
    isPlatformStaff
  );
  const isPublicPreset = preset.isPublic !== false && preset.visibility !== 'private';
  if (!isPublicPreset && !isOwner) {
    return res.status(403).json({ success: false, message: 'Forbidden: private preset belongs to another user' });
  }
  if (preset.accessLevel === 'pro' && !isOwner && !normalizeUserLumiState(user).proActive) {
    return res.status(403).json({
      success: false,
      code: 'PRO_REQUIRED',
      message: 'LumiStage Pro subscription required for this StagePack'
    });
  }
  const hydratedPreset = await hydratePresetMediaUrls(preset);
  let downloadUrl = null;
  let downloadUrls;
  if (preset.category === 'stage_pack') {
    const rawParts = String(req.query?.parts || 'core')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    const partsSet = new Set(rawParts.filter(p => p === 'core' || p === 'audio' || p === 'video'));
    if (!partsSet.size) partsSet.add('core');
    downloadUrls = {};
    if (isB2Configured()) {
      const coreKey = preset.b2Assets?.coreKey || preset.b2AssetKey;
      if (partsSet.has('core') && coreKey) {
        downloadUrls.core = await resolveStorageDownloadUrl(coreKey, 3600);
      }
      if (partsSet.has('audio') && preset.b2Assets?.audioKey) {
        downloadUrls.audio = await resolveStorageDownloadUrl(preset.b2Assets.audioKey, 3600);
      }
      if (partsSet.has('video') && preset.b2Assets?.videoKey) {
        downloadUrls.video = await resolveStorageDownloadUrl(preset.b2Assets.videoKey, 3600);
      }
    }
    downloadUrl = downloadUrls.core || null;
    if (partsSet.has('core') && mongoose.connection?.readyState === 1 && /^[0-9a-f]{24}$/i.test(String(preset._id || ''))) {
      LedStudioPreset.updateOne({ _id: preset._id }, { $inc: { downloadCount: 1 } }, { timestamps: false }).catch(() => {});
    }
  } else if (preset.b2AssetKey && isB2Configured()) {
    downloadUrl = await resolveStorageDownloadUrl(preset.b2AssetKey, 3600);
  }
  const responseData = {
    preset: hydratedPreset,
    payloadJson: hydratedPreset.payloadJson ?? hydratedPreset.payloadSummary ?? null,
    downloadUrl
  };
  if (downloadUrls !== undefined) responseData.downloadUrls = downloadUrls;
  return res.json({
    success: true,
    message: 'OK',
    data: responseData
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
    const rawId = String(req.params.id || '').trim();
    const isObjectId = /^[0-9a-f]{24}$/i.test(rawId);
    let preset = null;
    if (isObjectId) {
      preset = (await LedStudioPreset.findOne({ _id: rawId }).lean()) || null;
    } else if (rawId) {
      preset = (await LedStudioPreset.findOne({ slug: rawId }).lean()) || null;
    }
    if (!preset && rawId) {
      preset = LUMI_DEFAULT_PRESET_PACK.find(p => String(p._id) === rawId) || null;
    }
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
    // Presigned uploads replace the B2 object, so drop any stale inline copy.
    existingDoc.projectPayload = validatedPayload;
    await existingDoc.save();
    const outObj = existingDoc.toObject ? existingDoc.toObject() : { ...existingDoc };
    delete outObj.projectPayload;
    delete outObj.sharePasswordHash;
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
  delete outObj.sharePasswordHash;
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
      // Large snapshots go browser -> B2 directly; only proxy through the server when no URL can be signed.
      if (!projectJson && !downloadUrl) {
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
    const { projectPayload, sharePasswordHash, ...projectMeta } = project;
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
    const { enabled = true, expiresInHours = FREE_SHARE_MAX_HOURS, untilPro = false, password } = req.body || {};
    const project = await LedStudioProject.findOne({ _id: req.params.id, owner: req.user._id });
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
      return res.json({ success: true, message: 'Share disabled', data: { shareEnabled: false, passwordProtected: false } });
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
        shareExpiresAt: untilPro ? ownerSub.expiresAt : project.shareExpiresAt,
        shareUntilPro: project.shareUntilPro,
        passwordProtected: Boolean(project.sharePasswordProtected)
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
      ? await query.select('+projectPayload +sharePasswordHash').lean()
      : await query.lean();
    const check = validateShareAccess(project, rawToken);
    if (!check.ok) {
      return res.status(403).json({ success: false, message: check.reason });
    }
    const proGate = await resolveShareProGate(project);
    if (!proGate.ok) {
      return res.status(403).json({
        success: false,
        code: 'SHARE_PRO_EXPIRED',
        message: 'Link đã hết hiệu lực vì gói Pro của chủ dự án đã hết hạn.'
      });
    }

    const incomingPassword = req.headers?.['x-share-password'] || req.query?.password || '';
    const pwdCheck = verifySharePassword(project, incomingPassword);
    if (!pwdCheck.ok) {
      if (pwdCheck.requiresPassword) {
        return res.status(200).json({
          success: true,
          message: pwdCheck.reason,
          data: {
            mode: 'client_review_readonly',
            requiresPassword: true,
            passwordProtected: true,
            projectId: project._id,
            title: project.title,
            description: project.description,
            stageSummary: project.stageSummary,
            shareExpiresAt: proGate.expiresAt,
            shareUntilPro: Boolean(project.shareUntilPro)
          }
        });
      }
      return res.status(401).json({
        success: false,
        code: 'INVALID_SHARE_PASSWORD',
        message: pwdCheck.reason
      });
    }

    let downloadUrl = null;
    let projectJson = project.projectPayload || null;
    if (isB2Configured() && project.b2FileKey && isOwnedB2Key(project.b2FileKey, 'projects', project.owner)) {
      downloadUrl = await resolveStorageDownloadUrl(project.b2FileKey, 3600).catch(() => null);
      // Large snapshots go browser -> B2 directly; only proxy through the server when no URL can be signed.
      if (!projectJson && !downloadUrl) {
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
        requiresPassword: false,
        passwordProtected: Boolean(project.sharePasswordProtected),
        projectId: project._id,
        title: project.title,
        description: project.description,
        stageSummary: project.stageSummary,
        shareExpiresAt: proGate.expiresAt,
        shareUntilPro: Boolean(project.shareUntilPro),
        unlockedPro: Boolean(project.unlockedPro),
        reviewStatus: project.reviewStatus || 'pending',
        reviewBy: project.reviewBy || '',
        reviewNote: project.reviewNote || '',
        reviewUpdatedAt: project.reviewUpdatedAt || null,
        reviewComments: Array.isArray(project.reviewComments) ? project.reviewComments : [],
        downloadUrl,
        projectJson,
        updatedAt: project.updatedAt
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

async function loadSharedProjectForReview(rawToken, incomingPassword) {
  const tokenHash = hashShareToken(rawToken);
  const project = await LedStudioProject.findOne({ shareTokenHash: tokenHash, shareEnabled: true });
  const check = validateShareAccess(project, rawToken);
  if (!check.ok) {
    return { status: 403, error: check.reason };
  }
  const proGate = await resolveShareProGate(project);
  if (!proGate.ok) {
    return {
      status: 403,
      code: 'SHARE_PRO_EXPIRED',
      error: 'Link đã hết hiệu lực vì gói Pro của chủ dự án đã hết hạn.'
    };
  }
  if (project.sharePasswordProtected && !project.sharePasswordHash) {
    const q = LedStudioProject.findOne({ shareTokenHash: tokenHash, shareEnabled: true });
    const leanWithPwd = typeof q.select === 'function' ? await q.select('+sharePasswordHash').lean() : null;
    if (leanWithPwd?.sharePasswordHash) {
      project.sharePasswordHash = leanWithPwd.sharePasswordHash;
    }
  }
  const pwdCheck = verifySharePassword(project, incomingPassword);
  if (!pwdCheck.ok) {
    return { status: 401, code: 'INVALID_SHARE_PASSWORD', error: pwdCheck.reason };
  }
  return { status: 200, project };
}

router.post('/share/:shareToken/comments', async (req, res) => {
  try {
    const rawToken = String(req.params.shareToken || '');
    const incomingPassword = req.headers?.['x-share-password'] || req.body?.password || req.query?.password || '';
    const loaded = await loadSharedProjectForReview(rawToken, incomingPassword);
    if (loaded.error) {
      return res.status(loaded.status).json({ success: false, code: loaded.code, message: loaded.error });
    }
    const { project } = loaded;
    const { author, message, position, targetName } = req.body || {};
    const cleanMsg = String(message || '').trim().slice(0, 600);
    if (!cleanMsg) {
      return res.status(400).json({ success: false, message: 'Nội dung bình luận không được để trống.' });
    }
    const cleanAuthor = String(author || 'Khách hàng').trim().slice(0, 80) || 'Khách hàng';
    const rawPos = Array.isArray(position) ? position : [0, 1.5, 0];
    const clampCoord = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(-500, Math.min(500, Number(n.toFixed(3)))) : 0;
    };
    const comment = {
      id: 'cmt_' + crypto.randomBytes(6).toString('hex'),
      author: cleanAuthor,
      message: cleanMsg,
      position: [clampCoord(rawPos[0]), clampCoord(rawPos[1]), clampCoord(rawPos[2])],
      targetName: String(targetName || '').trim().slice(0, 120),
      resolved: false,
      createdAt: new Date()
    };
    if (!Array.isArray(project.reviewComments)) {
      project.reviewComments = [];
    }
    project.reviewComments.push(comment);
    if (project.reviewComments.length > 100) {
      project.reviewComments = project.reviewComments.slice(-100);
    }
    await project.save();
    return res.status(201).json({
      success: true,
      message: 'Đã ghim bình luận 3D',
      data: {
        comment,
        reviewComments: project.reviewComments
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/share/:shareToken/decision', async (req, res) => {
  try {
    const rawToken = String(req.params.shareToken || '');
    const incomingPassword = req.headers?.['x-share-password'] || req.body?.password || req.query?.password || '';
    const loaded = await loadSharedProjectForReview(rawToken, incomingPassword);
    if (loaded.error) {
      return res.status(loaded.status).json({ success: false, code: loaded.code, message: loaded.error });
    }
    const { project } = loaded;
    const { status, decision, reviewerName, author, note } = req.body || {};
    const resolvedStatus = status || decision;
    const resolvedReviewer = reviewerName || author;
    if (!['approved', 'changes_requested'].includes(resolvedStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Trạng thái duyệt không hợp lệ (chỉ nhận approved hoặc changes_requested).'
      });
    }
    project.reviewStatus = resolvedStatus;
    project.reviewBy = String(resolvedReviewer || 'Khách hàng').trim().slice(0, 100) || 'Khách hàng';
    project.reviewNote = String(note || '').trim().slice(0, 1000);
    project.reviewUpdatedAt = new Date();
    await project.save();
    return res.json({
      success: true,
      message: resolvedStatus === 'approved' ? 'Đã duyệt phương án sân khấu' : 'Đã gửi yêu cầu chỉnh sửa',
      data: {
        reviewStatus: project.reviewStatus,
        reviewBy: project.reviewBy,
        reviewNote: project.reviewNote,
        reviewUpdatedAt: project.reviewUpdatedAt
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

async function recordLumiSpendTransaction({ userId, amount, credits, serviceType, description, serviceDetails = null }) {
  if (typeof Transaction.create !== 'function') return null;
  const txCode = 'LUMI_' + Date.now().toString(36).toUpperCase() + '_' + crypto.randomBytes(3).toString('hex').toUpperCase();
  return await Transaction.create({
    userId,
    type: 'spend',
    amount: Math.max(0, Number(amount) || 0),
    credits: Number(credits) || 0,
    status: 'completed',
    transactionCode: txCode,
    paymentMethod: 'system',
    serviceType,
    description: String(description || ''),
    serviceDetails
  }).catch(() => null);
}

router.get('/billing/status', authMiddleware, async (req, res) => {
  try {
    const user = await loadMutableUser(req.user);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const subscription = normalizeUserLumiState(user);
    const balance = Number(user.balance || 0);
    const licenseToken = signLumiLicenseToken({
      userId: user._id,
      email: user.email || '',
      plan: subscription.plan,
      proActive: subscription.proActive,
      expiresAt: subscription.expiresAt,
      singleExportCredits: subscription.singleExportCredits,
      unlockedProjectKeys: subscription.unlockedProjectKeys
    });
    return res.json({
      success: true,
      message: 'OK',
      data: {
        brand: LUMI_BRAND,
        plans: LUMI_PLANS,
        actions: LUMI_CREDIT_ACTIONS,
        tokenPricing: LUMI_TOKEN_PRICING,
        effortModels: LUMI_EFFORT_MODELS,
        balance,
        balanceCredits: balance,
        tier: subscription.plan,
        isProActive: subscription.proActive,
        proExpiresAt: subscription.expiresAt,
        freeAiCreditsRemaining: subscription.freeAiCreditsRemaining,
        singleExportPasses: subscription.singleExportCredits,
        unlockedProjectKeys: subscription.unlockedProjectKeys,
        subscription,
        licenseToken
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/billing/checkout', authMiddleware, async (req, res) => {
  try {
    const { productId, productKey, projectKey, projectId } = req.body || {};
    const resolvedProductId = productId || productKey;
    const product = getLumiProduct(resolvedProductId);
    if (!product || !(product.priceCredits > 0)) {
      return res.status(400).json({ success: false, message: 'Gói hoặc dịch vụ LumiStage không hợp lệ.' });
    }
    const user = await loadMutableUser(req.user);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const currentBalance = Number(user.balance || 0);
    if (currentBalance < product.priceCredits) {
      return res.status(402).json({
        success: false,
        code: 'INSUFFICIENT_CREDITS',
        message: `Số dư Credit không đủ (cần ${product.priceCredits} Credits, hiện có ${currentBalance} Credits). Vui lòng nạp thêm qua VietQR.`,
        data: {
          requiredCredits: product.priceCredits,
          currentBalance
        }
      });
    }

    if (!user.lumiStage) {
      user.lumiStage = {
        plan: 'free',
        expiresAt: null,
        freeAiCreditsRemaining: LUMI_FREE_AI_CREDITS,
        singleExportCredits: 0,
        unlockedProjectKeys: []
      };
    }

    let serviceType = 'lumistage_subscription';
    const targetProjectKey = String(projectId || projectKey || '').trim();

    if (product.id === 'lumi_unlock_project') {
      if (!targetProjectKey) {
        return res.status(400).json({
          success: false,
          message: 'Cần truyền projectId hoặc projectKey để mở khóa vĩnh viễn dự án.'
        });
      }
      serviceType = 'lumistage_unlock';
      const keys = Array.isArray(user.lumiStage.unlockedProjectKeys)
        ? user.lumiStage.unlockedProjectKeys.map(String)
        : [];
      if (!keys.includes(targetProjectKey)) {
        keys.push(targetProjectKey);
      }
      user.lumiStage.unlockedProjectKeys = keys.slice(-500);
      if (projectId) {
        const proj = await LedStudioProject.findOne({ _id: projectId, owner: user._id }).catch(() => null);
        if (proj) {
          proj.unlockedPro = true;
          await proj.save();
        }
      }
    } else if (product.id === 'lumi_single_export') {
      serviceType = 'lumistage_single_export';
      user.lumiStage.singleExportCredits = Math.max(0, Number(user.lumiStage.singleExportCredits || 0)) + 1;
    } else {
      serviceType = 'lumistage_subscription';
      const nowMs = Date.now();
      const existingExpMs = user.lumiStage.expiresAt ? new Date(user.lumiStage.expiresAt).getTime() : 0;
      const baseMs = existingExpMs > nowMs ? existingExpMs : nowMs;
      user.lumiStage.plan = product.id;
      user.lumiStage.expiresAt = new Date(baseMs + Number(product.durationDays || 30) * 86400_000);
      user.lumiStage.freeAiCreditsRemaining = Number(
        (Number(user.lumiStage.freeAiCreditsRemaining || 0) + Number(product.bonusAiCredits || 0)).toFixed(4)
      );
    }

    user.balance = Number((currentBalance - product.priceCredits).toFixed(4));
    await user.save();

    await recordLumiSpendTransaction({
      userId: user._id,
      amount: product.priceVnd,
      credits: product.priceCredits,
      serviceType,
      description: `${LUMI_BRAND.name}: ${product.nameVi}`,
      serviceDetails: {
        productId: product.id,
        projectKey: targetProjectKey || null
      }
    });

    const subscription = normalizeUserLumiState(user);
    const licenseToken = signLumiLicenseToken({
      userId: user._id,
      email: user.email || '',
      plan: subscription.plan,
      proActive: subscription.proActive,
      expiresAt: subscription.expiresAt,
      singleExportCredits: subscription.singleExportCredits,
      unlockedProjectKeys: subscription.unlockedProjectKeys
    });

    return res.json({
      success: true,
      message: `Đã kích hoạt ${product.nameVi} thành công!`,
      data: {
        product,
        balance: user.balance,
        balanceCredits: user.balance,
        tier: subscription.plan,
        isProActive: subscription.proActive,
        proExpiresAt: subscription.expiresAt,
        freeAiCreditsRemaining: subscription.freeAiCreditsRemaining,
        singleExportPasses: subscription.singleExportCredits,
        unlockedProjectKeys: subscription.unlockedProjectKeys,
        subscription,
        licenseToken
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/billing/consume-export', authMiddleware, async (req, res) => {
  try {
    const { projectKey, projectId, exportType = '4k_png', autoDeductCredits = false } = req.body || {};
    const user = await loadMutableUser(req.user);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const sub = normalizeUserLumiState(user);
    const keyCandidates = [projectId, projectKey].filter(Boolean).map(String);
    const isProjectUnlocked = keyCandidates.some(k => sub.unlockedProjectKeys.includes(k));

    if (sub.proActive || isProjectUnlocked) {
      return res.json({
        success: true,
        message: 'OK',
        data: {
          allowed: true,
          watermark: false,
          source: sub.proActive ? 'pro_subscription' : 'unlocked_project',
          chargedCredits: 0,
          balance: Number(user.balance || 0),
          subscription: sub
        }
      });
    }

    if (sub.singleExportCredits > 0) {
      user.lumiStage.singleExportCredits = Math.max(0, sub.singleExportCredits - 1);
      await user.save();
      return res.json({
        success: true,
        message: 'Đã sử dụng 1 lượt xuất không watermark.',
        data: {
          allowed: true,
          watermark: false,
          source: 'single_export_credit',
          chargedCredits: 0,
          balance: Number(user.balance || 0),
          subscription: normalizeUserLumiState(user)
        }
      });
    }

    const singleExportCost = LUMI_CREDIT_ACTIONS.singleExport.priceCredits;
    if (autoDeductCredits && Number(user.balance || 0) >= singleExportCost) {
      user.balance = Number((Number(user.balance || 0) - singleExportCost).toFixed(4));
      await user.save();
      await recordLumiSpendTransaction({
        userId: user._id,
        amount: LUMI_CREDIT_ACTIONS.singleExport.priceVnd,
        credits: singleExportCost,
        serviceType: 'lumistage_single_export',
        description: `${LUMI_BRAND.name}: Xuất lẻ không watermark (${String(exportType).slice(0, 40)})`,
        serviceDetails: { exportType: String(exportType).slice(0, 40) }
      });
      return res.json({
        success: true,
        message: `Đã trừ ${singleExportCost} Credits để xuất file không watermark.`,
        data: {
          allowed: true,
          watermark: false,
          source: 'wallet_credit',
          chargedCredits: singleExportCost,
          balance: Number(user.balance || 0),
          subscription: normalizeUserLumiState(user)
        }
      });
    }

    return res.status(402).json({
      success: false,
      code: 'WATERMARK_REMOVAL_REQUIRED',
      message: 'Cần 50 Credits (5.000đ) để xuất lẻ không watermark hoặc 200 Credits để mở khóa vĩnh viễn dự án.',
      data: {
        allowed: false,
        watermark: true,
        requiredCredits: singleExportCost,
        balance: Number(user.balance || 0),
        subscription: sub
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

function buildStageAiSystemPrompt(mode = 'design', stageState = {}, budgetLimitVnd = null) {
  const summaryJson = JSON.stringify({
    width: stageState?.width ?? stageState?.stageSizeM?.width ?? 18,
    depth: stageState?.depth ?? stageState?.stageSizeM?.depth ?? 10,
    height: stageState?.height ?? stageState?.stageSizeM?.height ?? 8,
    screens: Array.isArray(stageState?.screens) ? stageState.screens.slice(0, 16) : [],
    lightsCount: Number(stageState?.lightsCount ?? stageState?.lightCount ?? (Array.isArray(stageState?.lights) ? stageState.lights.length : 0)),
    propsCount: Number(stageState?.propsCount ?? (Array.isArray(stageState?.props) ? stageState.props.length : 0)),
    budgetLimitVnd: budgetLimitVnd ? Number(budgetLimitVnd) : null
  });

  return [
    'Bạn là kiến trúc sư sân khấu 3D & kỹ sư AVL của LumiStage (CÔNG TY TNHH MTV GROUPLIFE).',
    `Chế độ yêu cầu hiện tại: "${mode}". Trạng thái sân khấu hiện tại: ${summaryJson}.`,
    'Hãy trả về DUY NHẤT một JSON object hợp lệ (không bọc giải thích ngoài JSON) theo cấu trúc sau:',
    '{',
    '  "reply": "Câu trả lời tiếng Việt ngắn gọn, chuyên nghiệp cho khách hàng/đạo diễn sân khấu",',
    '  "commands": [',
    '    // Danh sách lệnh điều khiển sân khấu 3D (có thể rỗng nếu chỉ tư vấn):',
    '    // 1. {"action":"load_template","templateId":"conference|wedding|concert|grand_opening|gala_dinner|outdoor_festival"}',
    '    // 2. {"action":"set_stage_size","width":18,"depth":10,"height":8}',
    '    // 3. {"action":"add_led","name":"MAIN LED","width":8,"height":4,"pitchMm":3.91,"x":0,"y":2.5,"z":-3.5,"curve":0}',
    '    // 4. {"action":"update_led","index":0,"width":10,"height":4.5,"pitchMm":2.97,"curve":5}',
    '    // 5. {"action":"remove_led","index":0}',
    '    // 6. {"action":"add_light","fixtureType":"beam_230_7r|beam_350_17r|par_led_54x3w|katana_bar_12x40w|cob_blinder_2x100w","count":8,"row":"front|back|floor","color":"#38bdf8","height":6.5}',
    '    // 7. {"action":"build_truss","width":14,"depth":8,"height":7}',
    '    // 8. {"action":"add_prop","assetId":"podium_vip|line_array_hang|stage_sub_stack|haze_machine_pro|co2_cannon_jet|cold_spark_fountain|backdrop_arch|gala_round_table|conference_ibm_table|foh_control_booth","count":2,"x":0,"z":0}',
    '    // 9. {"action":"move_led","index":0,"dx":0,"dy":0,"dz":-1.0}',
    '    // 10. {"action":"move_prop","kind":"dj_booth","dx":1.5,"dy":0,"dz":0}',
    '    // 11. {"action":"layout_seating","seatingType":"gala_round_table|conference_ibm_table|banquet_chair","guestCount":200}',
    '    // 12. {"action":"music_cues","bpm":128,"mood":"edm|gala|wedding|conference"}',
    '    // 13. {"action":"apply_brand","brandName":"GROUPLIFE","primaryColor":"#38bdf8","accentColor":"#f59e0b"}',
    '    // 14. {"action":"apply_style","mood":"corporate|wedding|edm|gala|festival","primaryColor":"#0ea5e9","secondaryColor":"#f59e0b","fogDensity":0.35,"bpm":128}',
    '    // 15. {"action":"optimize_budget","maxBudgetVnd":80000000}',
    '  ],',
    '  "audit": [',
    '    {"severity":"info|warn|error","title":"Tiêu đề kiểm tra","detail":"Chi tiết kỹ thuật điện 3 pha / tầm nhìn / tải trọng truss / TCVN"}',
    '  ],',
    '  "proposal": {',
    '    "title": "Tiêu đề thuyết minh phương án sân khấu",',
    '    "summary": "Tóm tắt ý tưởng thiết kế, bố cục LED và kịch bản ánh sáng để gửi chủ đầu tư",',
    '    "highlights": ["Điểm nhấn 1", "Điểm nhấn 2", "Điểm nhấn 3"]',
    '  },',
    '  "estimatedCostVnd": 65000000',
    '}'
  ].join('\n');
}

function parseStageAiJson(rawText) {
  const cleaned = String(rawText || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj === 'object') {
      return {
        reply: String(obj.reply || 'Đã cập nhật phương án sân khấu LumiStage.'),
        commands: Array.isArray(obj.commands) ? obj.commands.slice(0, 25) : [],
        audit: Array.isArray(obj.audit) ? obj.audit.slice(0, 12) : [],
        proposal: obj.proposal && typeof obj.proposal === 'object' ? obj.proposal : null,
        estimatedCostVnd: Number(obj.estimatedCostVnd) || 0
      };
    }
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        const sub = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
        return {
          reply: String(sub.reply || 'Đã phân tích phương án sân khấu.'),
          commands: Array.isArray(sub.commands) ? sub.commands.slice(0, 25) : [],
          audit: Array.isArray(sub.audit) ? sub.audit.slice(0, 12) : [],
          proposal: sub.proposal && typeof sub.proposal === 'object' ? sub.proposal : null,
          estimatedCostVnd: Number(sub.estimatedCostVnd) || 0
        };
      } catch {
        // Fallback to plain reply below
      }
    }
  }
  return {
    reply: cleaned || 'Đã hoàn tất phân tích sân khấu.',
    commands: [],
    audit: [],
    proposal: null,
    estimatedCostVnd: 0
  };
}

router.post('/ai/stage', authMiddleware, async (req, res) => {
  try {
    const {
      prompt,
      mode = 'design',
      effort = 'medium',
      stageState = {},
      stageContext = null,
      budgetLimitVnd = null,
      byok = null
    } = req.body || {};

    const cleanPrompt = String(prompt || '').trim().slice(0, 4000);
    if (!cleanPrompt) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập yêu cầu thiết kế sân khấu cho AI.' });
    }

    const user = await loadMutableUser(req.user);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!user.lumiStage) {
      user.lumiStage = {
        plan: 'free',
        expiresAt: null,
        freeAiCreditsRemaining: LUMI_FREE_AI_CREDITS,
        singleExportCredits: 0,
        unlockedProjectKeys: []
      };
    }

    const isByok = Boolean(
      byok &&
      typeof byok === 'object' &&
      typeof byok.apiKey === 'string' &&
      byok.apiKey.trim().length >= 8
    );

    const subBefore = normalizeUserLumiState(user);
    const totalAvailableCredits = Math.max(0, subBefore.freeAiCreditsRemaining) + Math.max(0, Number(user.balance || 0));
    if (!isByok && totalAvailableCredits < LUMI_TOKEN_PRICING.minChargeCredits && !['admin', 'partner'].includes(user.role)) {
      return res.status(402).json({
        success: false,
        code: 'INSUFFICIENT_AI_CREDITS',
        message: 'Đã hết ngân sách AI miễn phí và số dư Credit không đủ. Vui lòng nạp thêm Credit hoặc nhập API Key cá nhân (BYOK - 0 Credit).'
      });
    }

    const resolvedEffort = effort in LUMI_EFFORT_MODELS ? effort : 'medium';
    const effortConfig = LUMI_EFFORT_MODELS[resolvedEffort];
    const effectiveStageState =
      stageState && typeof stageState === 'object' && Object.keys(stageState).length > 0
        ? stageState
        : (stageContext && typeof stageContext === 'object' ? stageContext : {});
    const systemPrompt = buildStageAiSystemPrompt(mode, effectiveStageState, budgetLimitVnd);
    const fullPrompt = `${systemPrompt}\n\nYÊU CẦU CỦA NGƯỜI DÙNG:\n${cleanPrompt}`;

    let aiRes;
    if (customStageAiRunner) {
      aiRes = await customStageAiRunner({
        prompt: cleanPrompt,
        fullPrompt,
        mode,
        effort: resolvedEffort,
        byok,
        isByok
      });
    } else if (isByok) {
      aiRes = await callExternalByokAi(fullPrompt, {
        provider: byok.provider || 'gemini',
        apiKey: byok.apiKey.trim(),
        model: byok.model || '',
        baseUrl: byok.baseUrl || '',
        temperature: 0.35,
        maxTokens: 4096
      });
    } else {
      aiRes = await callGcliDirect(fullPrompt, {
        model: effortConfig.gcliModel,
        temperature: 0.35,
        maxTokens: 4096
      });
    }

    const parsed = parseStageAiJson(aiRes?.text || '');
    const tokenBill = calculateLumiTokenCredits(aiRes?.usage || {}, { byok: isByok });

    const postAiUser = (await loadMutableUser(req.user)) || user;
    if (!postAiUser.lumiStage) {
      postAiUser.lumiStage = user.lumiStage;
    }

    let usedFreeCredits = 0;
    let usedWalletCredits = 0;

    if (!isByok && tokenBill.totalCredits > 0) {
      const freeAvail = Math.max(0, Number(postAiUser.lumiStage.freeAiCreditsRemaining || 0));
      usedFreeCredits = Number(Math.min(freeAvail, tokenBill.totalCredits).toFixed(4));
      const remainder = Number(Math.max(0, tokenBill.totalCredits - usedFreeCredits).toFixed(4));
      postAiUser.lumiStage.freeAiCreditsRemaining = Number(Math.max(0, freeAvail - usedFreeCredits).toFixed(4));

      if (remainder > 0) {
        const currentWallet = Math.max(0, Number(postAiUser.balance || 0));
        usedWalletCredits = Number(Math.min(currentWallet, remainder).toFixed(4));
        postAiUser.balance = Number(Math.max(0, currentWallet - usedWalletCredits).toFixed(4));
        if (usedWalletCredits > 0) {
          await recordLumiSpendTransaction({
            userId: postAiUser._id,
            amount: Math.max(1, Math.round(usedWalletCredits * LUMI_BRAND.creditUnitVnd)),
            credits: usedWalletCredits,
            serviceType: 'lumistage_ai_token',
            description: `${LUMI_BRAND.name} AI (${effortConfig.id}, ${tokenBill.totalTokens} tokens)`,
            serviceDetails: {
              effort: resolvedEffort,
              model: aiRes?.model || effortConfig.model,
              promptTokens: tokenBill.promptTokens,
              completionTokens: tokenBill.completionTokens
            }
          });
        }
      }
      await postAiUser.save();
    }

    const actualCreditsCharged = Number((usedFreeCredits + usedWalletCredits).toFixed(4));
    const remainingFreeAiCredits = Number(postAiUser.lumiStage?.freeAiCreditsRemaining ?? 0);
    const remainingBalance = Number(postAiUser.balance || 0);

    return res.json({
      success: true,
      message: 'OK',
      data: {
        ...parsed,
        usage: {
          promptTokens: tokenBill.promptTokens,
          completionTokens: tokenBill.completionTokens,
          totalTokens: tokenBill.totalTokens
        },
        creditsCharged: actualCreditsCharged,
        balanceAfter: remainingBalance,
        freeAiCreditsRemaining: remainingFreeAiCredits,
        billing: {
          byok: isByok,
          provider: aiRes?.provider || (isByok ? byok.provider : 'gcli'),
          model: aiRes?.model || effortConfig.model,
          effort: isByok ? 'byok' : resolvedEffort,
          promptTokens: tokenBill.promptTokens,
          completionTokens: tokenBill.completionTokens,
          totalTokens: tokenBill.totalTokens,
          creditCharged: actualCreditsCharged,
          usedFreeCredits,
          usedWalletCredits,
          vndEquivalent: Math.round(actualCreditsCharged * LUMI_BRAND.creditUnitVnd),
          remainingFreeAiCredits,
          remainingBalance
        }
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

const ALLOWED_TELEMETRY_EVENTS = new Set([
  'template_applied',
  'ai_stage_prompt',
  'bom_opened',
  'quote_exported',
  'dxf_exported',
  'dxf_imported',
  'export_4k',
  'seating_auto_layout',
  'sightline_checked',
  'music_show_cues',
  'brand_identity_applied',
  'guide_opened',
  'preview_committed',
  'preview_reverted',
  'dmx_bridge_started',
  'live_led_output_opened',
  'show_cue_triggered',
  'show_lock_toggled'
]);

router.post('/telemetry', async (req, res) => {
  try {
    const { optIn, event, meta } = req.body || {};
    if (optIn !== true) {
      return res.json({ success: true, recorded: false, reason: 'opt_in_required' });
    }
    const cleanEvent = String(event || '').trim();
    if (!ALLOWED_TELEMETRY_EVENTS.has(cleanEvent)) {
      return res.status(400).json({ success: false, message: 'Sự kiện telemetry không hợp lệ.' });
    }
    const safeMeta = {};
    if (meta && typeof meta === 'object') {
      for (const [k, v] of Object.entries(meta).slice(0, 8)) {
        if (typeof v === 'number' || typeof v === 'boolean') {
          safeMeta[String(k).slice(0, 32)] = v;
        } else if (typeof v === 'string' && v.length <= 64) {
          safeMeta[String(k).slice(0, 32)] = v;
        }
      }
    }
    return res.json({
      success: true,
      recorded: true,
      data: {
        event: cleanEvent,
        meta: safeMeta,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

const PRO_EXPORT_RATE_LIMIT = 20;
const PRO_EXPORT_WINDOW_MS = 60_000;
const proExportRateBuckets = new Map();

function hasInlineDataUri(value, depth = 0) {
  if (depth > 5 || value == null) return false;
  if (typeof value === 'string') {
    return /^data:image\//i.test(value.trim());
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 512); i++) {
      if (hasInlineDataUri(value[i], depth + 1)) return true;
    }
    return false;
  }
  if (typeof value === 'object') {
    const entries = Object.values(value);
    for (let i = 0; i < Math.min(entries.length, 128); i++) {
      if (hasInlineDataUri(entries[i], depth + 1)) return true;
    }
  }
  return false;
}

const MAX_SURFACE_CAB_COLS = 64;
const MAX_SURFACE_CAB_ROWS = 48;
const MAX_SURFACE_PHYSICAL_W_M = 64;
const MAX_SURFACE_PHYSICAL_H_M = 48;

function validateProExportBounds(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Dữ liệu xuất hồ sơ PRO không hợp lệ.' };
  }
  if (body.surfaces !== undefined && (!Array.isArray(body.surfaces) || body.surfaces.length > 128)) {
    return { ok: false, message: 'Số lượng màn hình LED vượt giới hạn cho phép (tối đa 128).' };
  }
  if (body.lights !== undefined && (!Array.isArray(body.lights) || body.lights.length > 512)) {
    return { ok: false, message: 'Số lượng đèn DMX vượt giới hạn cho phép (tối đa 512).' };
  }
  if (body.sfxUnits !== undefined && (!Array.isArray(body.sfxUnits) || body.sfxUnits.length > 256)) {
    return { ok: false, message: 'Số lượng cụm Pyro/SFX vượt giới hạn cho phép (tối đa 256).' };
  }
  if (body.bomRows !== undefined && (!Array.isArray(body.bomRows) || body.bomRows.length > 400)) {
    return { ok: false, message: 'Số dòng vật tư BOM vượt giới hạn cho phép (tối đa 400).' };
  }
  if (Array.isArray(body.surfaces)) {
    for (const s of body.surfaces) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) {
        return { ok: false, message: 'Cấu hình màn hình LED không hợp lệ.' };
      }
      const spec = s.cabinetSpec && typeof s.cabinetSpec === 'object' ? s.cabinetSpec : {};
      const rawCols = s.cabCols ?? spec.cols;
      const rawRows = s.cabRows ?? spec.rows;
      if (rawCols !== undefined && (!Number.isFinite(Number(rawCols)) || Number(rawCols) < 1 || Number(rawCols) > MAX_SURFACE_CAB_COLS)) {
        return { ok: false, message: `Số cột cabinet LED vượt giới hạn cho phép (tối đa ${MAX_SURFACE_CAB_COLS}).` };
      }
      if (rawRows !== undefined && (!Number.isFinite(Number(rawRows)) || Number(rawRows) < 1 || Number(rawRows) > MAX_SURFACE_CAB_ROWS)) {
        return { ok: false, message: `Số hàng cabinet LED vượt giới hạn cho phép (tối đa ${MAX_SURFACE_CAB_ROWS}).` };
      }
      const rawW = s.physicalWidthM ?? s.widthM ?? (Array.isArray(s.physical) ? s.physical[0] : s.physical?.width);
      const rawH = s.physicalHeightM ?? s.heightM ?? (Array.isArray(s.physical) ? s.physical[1] : s.physical?.height);
      if (rawW !== undefined && (!Number.isFinite(Number(rawW)) || Number(rawW) <= 0 || Number(rawW) > MAX_SURFACE_PHYSICAL_W_M)) {
        return { ok: false, message: `Chiều rộng vật lý màn hình LED vượt giới hạn cho phép (tối đa ${MAX_SURFACE_PHYSICAL_W_M}m).` };
      }
      if (rawH !== undefined && (!Number.isFinite(Number(rawH)) || Number(rawH) <= 0 || Number(rawH) > MAX_SURFACE_PHYSICAL_H_M)) {
        return { ok: false, message: `Chiều cao vật lý màn hình LED vượt giới hạn cho phép (tối đa ${MAX_SURFACE_PHYSICAL_H_M}m).` };
      }
      if (s.virtualTiles !== undefined && (!Array.isArray(s.virtualTiles) || s.virtualTiles.length > MAX_SURFACE_CAB_COLS * MAX_SURFACE_CAB_ROWS)) {
        return { ok: false, message: 'Danh sách ô trống cabinet vượt giới hạn cho phép.' };
      }
    }
  }
  if (hasInlineDataUri(body)) {
    return { ok: false, message: 'Không được gửi ảnh base64 lên API xuất hồ sơ PRO; ảnh xem trước được ghép cục bộ trên trình duyệt.' };
  }
  return { ok: true };
}

function sanitizePrintableSummary(rawSummary, rider) {
  const src = rawSummary && typeof rawSummary === 'object' && !Array.isArray(rawSummary) ? rawSummary : {};
  const out = { engineeringRider: rider };
  const numericKeys = [
    'stageW',
    'stageD',
    'stageAreaM2',
    'totalLedAreaM2',
    'totalCabinets500',
    'totalPixels',
    'rj45PortsNeeded',
    'totalMaxKw',
    'currentPerPhaseAmps',
    'totalRiggingWeightKg'
  ];
  for (const k of numericKeys) {
    if (src[k] !== undefined && Number.isFinite(Number(src[k]))) {
      out[k] = Number(src[k]);
    }
  }
  return out;
}

export async function requireActivePro(req, res, next) {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập để xuất hồ sơ PRO.' });
    }
    const freshUser = (await loadMutableUser(req.user)) || req.user;
    const sub = normalizeUserLumiState(freshUser);
    if (!sub.proActive) {
      return res.status(403).json({
        success: false,
        code: 'PRO_REQUIRED',
        message: 'Tính năng xuất hồ sơ thương mại yêu cầu Gói LumiStage PRO đang hoạt động.'
      });
    }
    const rateKey = `pro_export:${String(freshUser._id)}`;
    if (!consumeRateBucket(proExportRateBuckets, rateKey, PRO_EXPORT_RATE_LIMIT, PRO_EXPORT_WINDOW_MS)) {
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        message: 'Bạn đang xuất hồ sơ quá nhanh (tối đa 20 lần/phút). Vui lòng thử lại sau ít giây.'
      });
    }
    req.lumiSub = sub;
    return next();
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

router.post('/exports/dxf', authMiddleware, requireActivePro, async (req, res) => {
  try {
    const check = validateProExportBounds(req.body);
    if (!check.ok) return res.status(400).json({ success: false, code: 'INVALID_EXPORT_INPUT', message: check.message });
    const stageW = Math.min(200, Math.max(2, Number(req.body?.stageW) || 16));
    const stageD = Math.min(200, Math.max(2, Number(req.body?.stageD) || 8));
    const viewMode = req.body?.viewMode === 'rear' ? 'rear' : 'front';
    const dxf = generateStageDxf({
      stageW,
      stageD,
      viewMode,
      watermark: false,
      surfaces: Array.isArray(req.body?.surfaces) ? req.body.surfaces : [],
      lights: Array.isArray(req.body?.lights) ? req.body.lights : [],
      sfxUnits: Array.isArray(req.body?.sfxUnits) ? req.body.sfxUnits : []
    });
    return res.json({
      success: true,
      message: 'OK',
      data: { dxf, unit: 'meters', viewMode }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/exports/mvr', authMiddleware, requireActivePro, async (req, res) => {
  try {
    const check = validateProExportBounds(req.body);
    if (!check.ok) return res.status(400).json({ success: false, code: 'INVALID_EXPORT_INPUT', message: check.message });
    const pkg = exportLightingMvr18({
      lights: Array.isArray(req.body?.lights) ? req.body.lights : [],
      surfaces: Array.isArray(req.body?.surfaces) ? req.body.surfaces : []
    });
    return res.json({
      success: true,
      message: 'OK',
      data: {
        zipBase64: Buffer.from(pkg.bytes).toString('base64'),
        fixtureCount: pkg.fixtureCount,
        screenCount: pkg.screenCount
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/exports/gma-xml', authMiddleware, requireActivePro, async (req, res) => {
  try {
    const check = validateProExportBounds(req.body);
    if (!check.ok) return res.status(400).json({ success: false, code: 'INVALID_EXPORT_INPUT', message: check.message });
    const version = String(req.body?.version || 'ma3').toLowerCase() === 'ma2' ? 'ma2' : 'ma3';
    const layerName = String(req.body?.layerName || 'ALPHA_Stage_Rig').slice(0, 120);
    const xml = buildGrandMaFixtureXml(
      Array.isArray(req.body?.lights) ? req.body.lights : [],
      { version, layerName }
    );
    return res.json({
      success: true,
      message: 'OK',
      data: { xml, version }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/exports/engineering-dossier', authMiddleware, requireActivePro, async (req, res) => {
  try {
    const check = validateProExportBounds(req.body);
    if (!check.ok) return res.status(400).json({ success: false, code: 'INVALID_EXPORT_INPUT', message: check.message });
    const kind = String(req.body?.kind || 'quote').toLowerCase();
    const surfaces = Array.isArray(req.body?.surfaces) ? req.body.surfaces : [];
    const lights = Array.isArray(req.body?.lights) ? req.body.lights : [];
    const rider = computeEngineeringRider({
      surfaces,
      lights,
      size: {
        width: Math.min(200, Math.max(2, Number(req.body?.summary?.stageW) || 16)),
        depth: Math.min(200, Math.max(2, Number(req.body?.summary?.stageD) || 8))
      }
    });

    if (kind === 'crew') {
      const role = String(req.body?.role || 'CREW_1_STAGE_RIGGING').slice(0, 64);
      const dossier = generateCrewSplitDossier18(role, {
        lang: req.body?.lang === 'en' ? 'en' : 'vi',
        companyProfile: req.body?.companyProfile && typeof req.body.companyProfile === 'object' ? req.body.companyProfile : {},
        struct: req.body?.struct && typeof req.body.struct === 'object' ? req.body.struct : undefined,
        rider,
        audioDiag: req.body?.audioDiag && typeof req.body.audioDiag === 'object' ? req.body.audioDiag : undefined,
        unifilar: req.body?.unifilar && typeof req.body.unifilar === 'object' ? req.body.unifilar : undefined,
        lights
      });
      return res.json({
        success: true,
        message: 'OK',
        data: {
          kind: 'crew',
          role: dossier.role,
          title: dossier.title,
          summary: dossier.summary,
          html: dossier.html,
          rider
        }
      });
    }

    const mode = kind === 'tech' ? 'tech' : 'quote';
    const html = buildPrintableStageDocumentHtml18({
      mode,
      watermark: false,
      modelName: String(req.body?.modelName || 'LumiStage').slice(0, 120),
      companyProfile: req.body?.companyProfile && typeof req.body.companyProfile === 'object' ? req.body.companyProfile : {},
      quoteConfig: req.body?.quoteConfig && typeof req.body.quoteConfig === 'object' ? req.body.quoteConfig : {},
      bomRows: Array.isArray(req.body?.bomRows) ? req.body.bomRows : [],
      summary: sanitizePrintableSummary(req.body?.summary, rider),
      surfaces,
      lights,
      proposalText: String(req.body?.proposalText || '').slice(0, 20_000)
    });

    return res.json({
      success: true,
      message: 'OK',
      data: {
        kind: mode,
        html,
        rider
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
