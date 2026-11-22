#!/usr/bin/env node
/**
 * Admin CLI: Publish or unpublish a local StagePack (`tools/led-stage-studio/stagepacks/<slug>`)
 * to Backblaze B2 (`led-studio/stage-packs/<slug>/...`) + MongoDB `LedStudioPreset` (`category: 'stage_pack'`).
 *
 * Usage:
 *   node scripts/publish-stagepack.mjs publish --slug <slug> [--visibility private|public] [--access free|pro] [--distribution commercial-ok|internal_only] [--author-email admin@...] [--dry-run] [--confirm-prod]
 *   node scripts/publish-stagepack.mjs unpublish --slug <slug> [--dry-run] [--confirm-prod]
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import LedStudioPreset from '../server/models/LedStudioPreset.js';
import User from '../server/models/User.js';
import { deleteFile, headFile, uploadFile } from '../server/utils/b2Storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STAGEPACKS_DIR = path.resolve(__dirname, '../../tools/led-stage-studio/stagepacks');

const SLUG_RE = /^[a-z0-9][a-z0-9-_]{1,96}$/i;

export function assertValidSlug(slug) {
  const s = String(slug || '').trim();
  if (!s || !SLUG_RE.test(s)) {
    throw new Error(`Invalid --slug "${slug}"`);
  }
  return s;
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : '';
  const opts = {
    command,
    slug: '',
    visibility: 'private',
    access: 'free',
    distribution: '',
    authorEmail: '',
    stagepacksDir: DEFAULT_STAGEPACKS_DIR,
    dryRun: false,
    confirmProd: false
  };
  const takeValue = (flag, idx) => {
    const next = argv[idx + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    return next;
  };
  for (let i = command ? 1 : 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--confirm-prod') opts.confirmProd = true;
    else if (a === '--slug') opts.slug = String(takeValue(a, i++)).trim();
    else if (a === '--visibility') opts.visibility = String(takeValue(a, i++)).trim().toLowerCase();
    else if (a === '--access') opts.access = String(takeValue(a, i++)).trim().toLowerCase();
    else if (a === '--distribution') opts.distribution = String(takeValue(a, i++)).trim().toLowerCase();
    else if (a === '--author-email') opts.authorEmail = String(takeValue(a, i++)).trim().toLowerCase();
    else if (a === '--stagepacks-dir') opts.stagepacksDir = path.resolve(takeValue(a, i++));
    else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

export function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function isRemoteMongoUri(uri) {
  const s = String(uri || '').trim();
  if (!s) return false;
  const schemeMatch = /^(mongodb(?:\+srv)?):\/\/(.+)$/i.exec(s);
  if (!schemeMatch) return false;
  const scheme = schemeMatch[1].toLowerCase();
  const authorityAndRest = schemeMatch[2];
  const authority = authorityAndRest.split(/[/?#]/, 1)[0];
  const hostsPart = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
  const hosts = hostsPart.split(',').map(h => h.trim()).filter(Boolean);
  if (!hosts.length) return true;
  if (scheme === 'mongodb+srv') return true;
  const isLoopbackHost = (rawHost) => {
    const h = rawHost.toLowerCase();
    if (h.startsWith('[')) {
      const end = h.indexOf(']');
      const ipv6 = end > 0 ? h.slice(1, end) : h;
      return ipv6 === '::1';
    }
    const hostname = h.split(':', 1)[0];
    return hostname === 'localhost' || hostname === '127.0.0.1';
  };
  return !hosts.every(isLoopbackHost);
}

export function resolvePackRelPath(stagepacksDir, slug, rel) {
  const safeSlug = assertValidSlug(slug);
  const rawRel = String(rel || '').trim();
  if (!rawRel) return '';
  if (/^[a-z]:/i.test(rawRel)) {
    throw new Error(`Unsafe StagePack relative path "${rel}"`);
  }
  const cleanRel = rawRel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanRel) return '';
  const packRoot = path.resolve(stagepacksDir, safeSlug);
  const resolved = cleanRel.startsWith(`${safeSlug}/`)
    ? path.resolve(stagepacksDir, cleanRel)
    : path.resolve(packRoot, cleanRel);
  const relFromRoot = path.relative(packRoot, resolved);
  if (!relFromRoot || relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
    throw new Error(`Unsafe StagePack relative path "${rel}" escapes pack directory`);
  }
  return resolved;
}

export function validatePublishSafety({ visibility, access, distribution, packMeta }) {
  if (!['public', 'private'].includes(visibility)) {
    throw new Error(`Invalid --visibility "${visibility}" (expected public|private)`);
  }
  if (!['free', 'pro'].includes(access)) {
    throw new Error(`Invalid --access "${access}" (expected free|pro)`);
  }
  const effectiveDist = distribution || packMeta?.distribution || 'internal_only';
  if (!['commercial-ok', 'internal_only'].includes(effectiveDist)) {
    throw new Error(`Invalid distribution "${effectiveDist}" (expected commercial-ok|internal_only)`);
  }
  const prov = packMeta?.provenance || {};
  const provPaths = [prov.sourceStagePack, prov.sourceDir, prov.sourcePath]
    .filter(v => v !== undefined && v !== null)
    .map(v => String(v));
  const scratchPath = provPaths.find(p => /(?:^|[\\/])_scratch(?:[\\/]|$)/i.test(p)) || '';
  const isScratch =
    prov.status === 'scratch_draft' ||
    Boolean(prov.fromScratch) ||
    Boolean(scratchPath);
  if (visibility === 'public') {
    if (effectiveDist !== 'commercial-ok') {
      throw new Error(`Public publish blocked: distribution is "${effectiveDist}" (must be "commercial-ok")`);
    }
    if (isScratch) {
      throw new Error(`Public publish blocked: StagePack provenance references _scratch (${scratchPath || prov.status})`);
    }
  }
  return { visibility, access, distribution: effectiveDist, isScratch };
}

export function buildPublishPlan({ slug, stagepacksDir, visibility, access, distribution }) {
  const safeSlug = assertValidSlug(slug);
  const packDir = path.join(stagepacksDir, safeSlug);
  const metaPath = path.join(packDir, 'pack.meta.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Missing pack.meta.json at ${metaPath}`);
  }
  const packMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const safety = validatePublishSafety({ visibility, access, distribution, packMeta });

  const files = packMeta.files || {};
  const coreRel = files.core?.file || 'pack.core.json.gz';
  const corePath = resolvePackRelPath(stagepacksDir, safeSlug, coreRel);
  if (!corePath || !fs.existsSync(corePath)) {
    throw new Error(`Missing compressed core part: ${corePath}`);
  }
  const coreBuf = fs.readFileSync(corePath);
  const coreGzipSha256 = sha256Buffer(coreBuf);
  const keyPrefix = `led-studio/stage-packs/${safeSlug}`;

  const uploads = [
    {
      role: 'core',
      localPath: corePath,
      key: `${keyPrefix}/${coreGzipSha256.slice(0, 12)}/pack.core.json.gz`,
      contentType: 'application/json',
      extra: { ContentEncoding: 'gzip', CacheControl: 'public, max-age=31536000, immutable' },
      bytes: coreBuf.length,
      sha256: coreGzipSha256
    }
  ];

  const addOptionalBinary = (role, relPath, mime) => {
    const p = resolvePackRelPath(stagepacksDir, safeSlug, relPath);
    if (!p || !fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    const sha = sha256Buffer(buf);
    const uploadItem = {
      role,
      localPath: p,
      key: `${keyPrefix}/${sha.slice(0, 12)}/${path.basename(p)}`,
      contentType: mime || 'application/octet-stream',
      extra: { CacheControl: 'public, max-age=31536000, immutable' },
      bytes: buf.length,
      sha256: sha
    };
    uploads.push(uploadItem);
    return uploadItem;
  };

  const audioRel = files.audio?.file || (fs.existsSync(path.join(packDir, 'audio.mp3')) ? 'audio.mp3' : '');
  const audioItem = audioRel
    ? addOptionalBinary('audio', audioRel, files.audio?.mime || (audioRel.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'))
    : null;

  const videoRel = files.video?.file || (fs.existsSync(path.join(packDir, 'video.mp4')) ? 'video.mp4' : '');
  const videoItem = videoRel
    ? addOptionalBinary('video', videoRel, files.video?.mime || (videoRel.endsWith('.webm') ? 'video/webm' : 'video/mp4'))
    : null;

  const thumbRel = packMeta.preview?.file || (fs.existsSync(path.join(packDir, 'preview.webp')) ? 'preview.webp' : '');
  const thumbItem = thumbRel ? addOptionalBinary('thumbnail', thumbRel, 'image/webp') : null;

  const galleryList = Array.isArray(packMeta.gallery) ? packMeta.gallery : [];
  const galleryItems = galleryList
    .map(g => (typeof g === 'string' ? g : g?.file))
    .filter(rel => rel && rel !== thumbRel)
    .map((rel, i) => addOptionalBinary(`gallery_${i}`, rel, 'image/webp'))
    .filter(Boolean);

  return {
    slug: safeSlug,
    packDir,
    metaPath,
    packMeta,
    safety,
    uploads,
    coreItem: uploads[0],
    audioItem,
    videoItem,
    thumbItem,
    galleryItems
  };
}

function collectPresetB2Keys(preset) {
  if (!preset || typeof preset !== 'object') return [];
  const keys = new Set();
  if (preset.b2AssetKey) keys.add(String(preset.b2AssetKey));
  if (preset.b2Assets && typeof preset.b2Assets === 'object') {
    for (const k of [
      preset.b2Assets.coreKey,
      preset.b2Assets.audioKey,
      preset.b2Assets.videoKey,
      preset.b2Assets.thumbnailKey
    ]) {
      if (k) keys.add(String(k));
    }
    if (Array.isArray(preset.b2Assets.galleryKeys)) {
      for (const gk of preset.b2Assets.galleryKeys) {
        if (gk) keys.add(String(gk));
      }
    }
  }
  return [...keys];
}

function updateLocalStagePackCloudState(stagepacksDir, slug, cloudInfo) {
  const metaPath = path.join(stagepacksDir, slug, 'pack.meta.json');
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.cloud = cloudInfo || null;
    meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }
  const catalogPath = path.join(stagepacksDir, 'catalog.json');
  if (fs.existsSync(catalogPath)) {
    const cat = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    if (Array.isArray(cat.packs)) {
      for (const entry of cat.packs) {
        if (entry?.slug === slug) {
          entry.cloud = cloudInfo || null;
        }
      }
      cat.updatedAt = new Date().toISOString();
      fs.writeFileSync(catalogPath, `${JSON.stringify(cat, null, 2)}\n`, 'utf8');
    }
  }
}

async function resolveAuthorId(authorEmail) {
  if (authorEmail) {
    const u = await User.findOne({ email: authorEmail }).select('_id email role').lean();
    if (!u) throw new Error(`Author user not found for --author-email ${authorEmail}`);
    return u._id;
  }
  const adminUser = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 }).select('_id email role').lean();
  if (!adminUser) {
    throw new Error('No admin user found in MongoDB; pass --author-email explicitly');
  }
  return adminUser._id;
}

function ensureLiveEnvSafe(opts) {
  if (opts.dryRun) return;
  const requiredEnv = ['MONGODB_URI', 'B2_ENDPOINT', 'B2_BUCKET_NAME', 'B2_ACCESS_KEY_ID', 'B2_SECRET_ACCESS_KEY'];
  const missing = requiredEnv.filter(k => !String(process.env[k] || '').trim());
  if (missing.length) {
    throw new Error(`Missing required environment variables for live run: ${missing.join(', ')}`);
  }
  if (isRemoteMongoUri(process.env.MONGODB_URI) && !opts.confirmProd) {
    throw new Error('Refusing live write against remote MONGODB_URI without --confirm-prod');
  }
}

function buildPresetPayloadFromPlan(plan, authorId, existing = null) {
  const files = plan.packMeta.files || {};
  const galleryKeys = plan.galleryItems.map(g => g.key);
  const b2Assets = {
    coreKey: plan.coreItem.key,
    audioKey: plan.audioItem?.key || '',
    videoKey: plan.videoItem?.key || '',
    thumbnailKey: plan.thumbItem?.key || '',
    galleryKeys,
    coreBytes: Number(files.core?.rawBytes) || 0,
    coreGzipBytes: plan.coreItem.bytes,
    audioBytes: plan.audioItem?.bytes || 0,
    videoBytes: plan.videoItem?.bytes || 0,
    coreSha256: String(files.core?.sha256 || plan.coreItem.sha256 || ''),
    audioSha256: plan.audioItem?.sha256 || '',
    videoSha256: plan.videoItem?.sha256 || '',
    audioName: String(files.audio?.name || (plan.audioItem ? path.basename(plan.audioItem.localPath) : '')),
    audioMime: String(files.audio?.mime || plan.audioItem?.contentType || ''),
    videoName: String(files.video?.name || (plan.videoItem ? path.basename(plan.videoItem.localPath) : '')),
    videoMime: String(files.video?.mime || plan.videoItem?.contentType || ''),
    videoTargetRole: String(files.video?.targetRole || 'main'),
    videoFit: Number.isFinite(Number(files.video?.fit)) ? Number(files.video.fit) : 0
  };
  const stats = plan.packMeta.stats || {};
  const performers = Array.isArray(plan.packMeta.performers) ? plan.packMeta.performers : [];
  return {
    authorId,
    createdBy: existing?.createdBy || authorId,
    ownership: 'platform',
    visibility: plan.safety.visibility,
    isPublic: plan.safety.visibility === 'public',
    category: 'stage_pack',
    presetType: 'stage_pack',
    slug: plan.slug,
    tags: Array.isArray(plan.packMeta.tags) ? plan.packMeta.tags : [],
    title: {
      vi: String(plan.packMeta?.title?.vi || plan.slug).slice(0, 140),
      en: String(plan.packMeta?.title?.en || plan.packMeta?.title?.vi || plan.slug).slice(0, 140)
    },
    summary: String(plan.packMeta?.summary?.vi || '').slice(0, 1000),
    summaryEn: String(plan.packMeta?.summary?.en || '').slice(0, 1000),
    thumbnailUrl: '',
    galleryUrls: [],
    accessLevel: plan.safety.access,
    distribution: plan.safety.distribution,
    b2AssetKey: b2Assets.coreKey,
    b2Assets,
    payloadSummary: {
      format: plan.packMeta.format || 'ALPHA_STAGE_PACK/1.0',
      duration: Number(stats.duration) || 0,
      bpm: Number(stats.bpm) || 120,
      performerCount: Number(stats.performerCount) || performers.length,
      performers,
      hasAudio: Boolean(b2Assets.audioKey),
      hasVideo: Boolean(b2Assets.videoKey),
      hasLighting: Boolean(stats.hasLighting),
      hasCameras: Boolean(stats.hasCameras),
      cameraCount: Number(stats.cameraCount) || 0,
      distribution: plan.safety.distribution,
      sizes: {
        coreBytes: b2Assets.coreBytes,
        coreGzipBytes: b2Assets.coreGzipBytes,
        audioBytes: b2Assets.audioBytes,
        videoBytes: b2Assets.videoBytes
      }
    }
  };
}

async function runPublish(opts) {
  const plan = buildPublishPlan(opts);
  if (opts.dryRun) {
    const previewDoc = buildPresetPayloadFromPlan(plan, 'dry-run-admin');
    console.log(JSON.stringify({
      dryRun: true,
      action: 'publish',
      slug: plan.slug,
      visibility: plan.safety.visibility,
      accessLevel: plan.safety.access,
      distribution: plan.safety.distribution,
      fromScratch: plan.safety.isScratch,
      plannedUploads: plan.uploads.map(u => ({ role: u.role, key: u.key, bytes: u.bytes, contentType: u.contentType, extra: u.extra })),
      presetSummary: {
        category: 'stage_pack',
        title: previewDoc.title,
        tags: previewDoc.tags,
        b2Assets: previewDoc.b2Assets,
        payloadSummary: previewDoc.payloadSummary
      }
    }, null, 2));
    return 0;
  }

  ensureLiveEnvSafe(opts);
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const authorId = await resolveAuthorId(opts.authorEmail);
    const existing = await LedStudioPreset.findOne({ slug: plan.slug, category: 'stage_pack' }).lean();
    const oldKeys = collectPresetB2Keys(existing);

    const uploadResults = [];
    for (const item of plan.uploads) {
      const head = await headFile(item.key);
      if (head?.exists && (head.size == null || head.size === item.bytes)) {
        uploadResults.push({ role: item.role, key: item.key, status: 'reused-existing', bytes: item.bytes });
      } else {
        const body = fs.readFileSync(item.localPath);
        await uploadFile(item.key, body, item.contentType, item.extra);
        uploadResults.push({ role: item.role, key: item.key, status: 'uploaded', bytes: item.bytes });
      }
    }

    const docPayload = buildPresetPayloadFromPlan(plan, authorId, existing);
    const saved = existing
      ? await LedStudioPreset.findByIdAndUpdate(existing._id, { $set: docPayload }, { new: true, runValidators: true }).lean()
      : (await LedStudioPreset.create(docPayload)).toObject();

    const newKeys = new Set(collectPresetB2Keys(saved));
    const orphanKeys = oldKeys.filter(k => !newKeys.has(k));
    const deletedKeys = [];
    const failedDeleteKeys = [];
    for (const staleKey of orphanKeys) {
      const stillUsed = await LedStudioPreset.exists({
        _id: { $ne: saved._id },
        $or: [
          { b2AssetKey: staleKey },
          { 'b2Assets.coreKey': staleKey },
          { 'b2Assets.audioKey': staleKey },
          { 'b2Assets.videoKey': staleKey },
          { 'b2Assets.thumbnailKey': staleKey },
          { 'b2Assets.galleryKeys': staleKey }
        ]
      });
      if (!stillUsed) {
        try {
          await deleteFile(staleKey);
          deletedKeys.push(staleKey);
        } catch (err) {
          failedDeleteKeys.push({ key: staleKey, error: err?.message || String(err) });
        }
      }
    }

    const b2Assets = docPayload.b2Assets;
    updateLocalStagePackCloudState(opts.stagepacksDir, plan.slug, {
      presetId: String(saved._id),
      slug: plan.slug,
      visibility: saved.visibility,
      accessLevel: saved.accessLevel,
      distribution: saved.distribution,
      publishedAt: new Date().toISOString(),
      keys: {
        coreKey: b2Assets.coreKey,
        audioKey: b2Assets.audioKey,
        videoKey: b2Assets.videoKey,
        thumbnailKey: b2Assets.thumbnailKey,
        galleryKeys: b2Assets.galleryKeys
      }
    });

    console.log(JSON.stringify({
      ok: true,
      action: 'publish',
      presetId: String(saved._id),
      slug: plan.slug,
      uploads: uploadResults,
      deletedStaleKeys: deletedKeys,
      ...(failedDeleteKeys.length ? { failedDeleteKeys } : {})
    }, null, 2));
    return 0;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

async function runUnpublish(opts) {
  const slug = assertValidSlug(opts.slug);
  const metaPath = path.join(opts.stagepacksDir, slug, 'pack.meta.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null;
  if (opts.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      action: 'unpublish',
      slug,
      plannedDeletedPresetId: meta?.cloud?.presetId || null,
      plannedDeletedKeys: meta?.cloud?.keys ? collectPresetB2Keys({ b2Assets: meta.cloud.keys }) : []
    }, null, 2));
    return 0;
  }

  ensureLiveEnvSafe(opts);
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const existing = await LedStudioPreset.findOne({ slug, category: 'stage_pack' }).lean();
    if (!existing) {
      updateLocalStagePackCloudState(opts.stagepacksDir, slug, null);
      console.log(JSON.stringify({ ok: true, action: 'unpublish', slug, found: false }));
      return 0;
    }
    const keys = collectPresetB2Keys(existing);
    await LedStudioPreset.deleteOne({ _id: existing._id });
    const deletedKeys = [];
    const failedDeleteKeys = [];
    for (const k of keys) {
      const stillUsed = await LedStudioPreset.exists({
        $or: [
          { b2AssetKey: k },
          { 'b2Assets.coreKey': k },
          { 'b2Assets.audioKey': k },
          { 'b2Assets.videoKey': k },
          { 'b2Assets.thumbnailKey': k },
          { 'b2Assets.galleryKeys': k }
        ]
      });
      if (!stillUsed) {
        try {
          await deleteFile(k);
          deletedKeys.push(k);
        } catch (err) {
          failedDeleteKeys.push({ key: k, error: err?.message || String(err) });
        }
      }
    }
    updateLocalStagePackCloudState(opts.stagepacksDir, slug, null);
    console.log(JSON.stringify({
      ok: true,
      action: 'unpublish',
      slug,
      deletedKeys,
      ...(failedDeleteKeys.length ? { failedDeleteKeys } : {})
    }));
    return 0;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const opts = parseCliArgs(process.argv.slice(2));
  const runner = opts.command === 'publish'
    ? runPublish
    : opts.command === 'unpublish'
      ? runUnpublish
      : null;
  if (!runner) {
    console.error('Usage: node scripts/publish-stagepack.mjs <publish|unpublish> --slug <slug> [--visibility private|public] [--access free|pro] [--distribution commercial-ok|internal_only] [--dry-run] [--confirm-prod]');
    process.exit(1);
  }
  runner(opts).then(code => process.exit(code)).catch(err => {
    console.error('[publish-stagepack] ERROR:', err.message);
    process.exit(1);
  });
}
