import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import LedStudioWorkspaceProject from '../models/LedStudioWorkspaceProject.js';
import LedStudioWorkspaceAsset from '../models/LedStudioWorkspaceAsset.js';
import LedStudioWorkspaceUpload from '../models/LedStudioWorkspaceUpload.js';
import { normalizeUserLumiState } from '../routes/ledStudio.js';

export const WORKSPACE_FREE_MAX_SLOTS = 5;
export const WORKSPACE_PRO_MAX_SLOTS = 10;
export const WORKSPACE_MAX_FILE_BYTES = 256 * 1024 * 1024;
export const WORKSPACE_MAX_USER_BYTES = 1024 * 1024 * 1024;
export const WORKSPACE_MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
export const WORKSPACE_UPLOAD_TTL_MS = 30 * 60 * 1000;
export const WORKSPACE_TEMP_DIR = path.join(os.tmpdir(), 'alpha-led-workspace-uploads');

export function resolveWorkspaceEntitlement(userDoc) {
  const lumi = normalizeUserLumiState(userDoc);
  return {
    proActive: Boolean(lumi.proActive),
    plan: lumi.plan || 'free',
    maxSlots: lumi.proActive ? WORKSPACE_PRO_MAX_SLOTS : WORKSPACE_FREE_MAX_SLOTS,
    maxFileBytes: WORKSPACE_MAX_FILE_BYTES,
    maxUserBytes: WORKSPACE_MAX_USER_BYTES,
    maxManifestBytes: WORKSPACE_MAX_MANIFEST_BYTES
  };
}

export const ALLOWED_WORKSPACE_MIMES_BY_KIND = Object.freeze({
  image: ['image/webp'],
  texture: ['image/webp', 'image/ktx2'],
  model: [
    'model/gltf-binary',
    'model/gltf+json',
    'application/octet-stream',
    'text/plain',
    'model/obj',
    'model/vnd.collada+xml',
    'application/xml'
  ],
  audio: [
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/flac',
    'audio/mp4',
    'audio/webm',
    'application/octet-stream'
  ],
  video: ['video/mp4', 'video/webm', 'application/octet-stream'],
  binary: ['application/octet-stream', 'application/json', 'application/x-ilda']
});

export function isDeclaredMimeAllowedForKind(kind, mimeType = '') {
  const allowed = ALLOWED_WORKSPACE_MIMES_BY_KIND[kind];
  if (!allowed) return false;
  const normalized = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (!normalized) return kind !== 'image';
  return allowed.includes(normalized);
}

export function isMediaKindAllowedForPlan(kind, proActive) {
  if (kind === 'video' || kind === 'audio') {
    return Boolean(proActive);
  }
  return ['model', 'image', 'texture', 'binary'].includes(kind);
}

export function detectMagicBytesMime(buffer, kind, declaredMime = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, reason: 'Empty file buffer' };
  }

  // Block common executable / script headers regardless of declared kind
  const head4 = buffer.subarray(0, 4);
  if (
    (head4[0] === 0x4d && head4[1] === 0x5a) || // MZ (PE/EXE)
    (head4[0] === 0x7f && head4[1] === 0x45 && head4[2] === 0x4c && head4[3] === 0x46) || // ELF
    (head4[0] === 0x23 && head4[1] === 0x21) // #!
  ) {
    return { ok: false, reason: 'Executable files are not allowed' };
  }

  const isWebp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (kind === 'image') {
    if (!isWebp) {
      return { ok: false, reason: 'Images must be normalized to WebP before upload' };
    }
    return { ok: true, detectedMime: 'image/webp' };
  }

  if (kind === 'texture') {
    if (isWebp) return { ok: true, detectedMime: 'image/webp' };
    if (buffer.length >= 4 && head4.toString('hex') === 'ab4b5458') {
      return { ok: true, detectedMime: 'image/ktx2' };
    }
    return { ok: false, reason: 'Textures must be WebP or KTX2' };
  }

  if (kind === 'model') {
    if (head4.toString('ascii') === 'glTF') {
      return { ok: true, detectedMime: 'model/gltf-binary' };
    }
    const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8').trimStart();
    if (sample.startsWith('{') && (declaredMime.includes('gltf') || declaredMime.includes('json'))) {
      return { ok: true, detectedMime: 'model/gltf+json' };
    }
    if (sample.startsWith('<') && sample.includes('COLLADA')) {
      return { ok: true, detectedMime: 'model/vnd.collada+xml' };
    }
    if (/^(#|v |vn |vt |o |g |mtllib )/m.test(sample)) {
      return { ok: true, detectedMime: 'text/plain' };
    }
    return { ok: false, reason: 'Unsupported or spoofed 3D model content' };
  }

  if (kind === 'audio') {
    const isId3 = buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3';
    const isMp3Sync = buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
    const isWav =
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WAVE';
    const isOgg = buffer.length >= 4 && head4.toString('ascii') === 'OggS';
    const isFlac = buffer.length >= 4 && head4.toString('ascii') === 'fLaC';
    const isMp4 = buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
    const isWebm = buffer.length >= 4 && head4.toString('hex') === '1a45dfa3';
    if (isId3 || isMp3Sync) return { ok: true, detectedMime: 'audio/mpeg' };
    if (isWav) return { ok: true, detectedMime: 'audio/wav' };
    if (isOgg) return { ok: true, detectedMime: 'audio/ogg' };
    if (isFlac) return { ok: true, detectedMime: 'audio/flac' };
    if (isMp4) return { ok: true, detectedMime: 'audio/mp4' };
    if (isWebm) return { ok: true, detectedMime: 'audio/webm' };
    return { ok: false, reason: 'Unsupported or spoofed audio content' };
  }

  if (kind === 'video') {
    const isMp4 = buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
    const isWebm = buffer.length >= 4 && head4.toString('hex') === '1a45dfa3';
    if (isMp4) return { ok: true, detectedMime: 'video/mp4' };
    if (isWebm) return { ok: true, detectedMime: 'video/webm' };
    return { ok: false, reason: 'Unsupported or spoofed video content' };
  }

  if (kind === 'binary') {
    const isIlda = buffer.length >= 4 && head4.toString('ascii') === 'ILDA';
    if (isIlda) return { ok: true, detectedMime: 'application/x-ilda' };
    if (declaredMime === 'application/octet-stream' || declaredMime === 'application/json') {
      return { ok: true, detectedMime: declaredMime };
    }
    return { ok: false, reason: 'Unsupported binary asset type' };
  }

  return { ok: false, reason: 'Unknown asset kind' };
}

function hasDangerousKeys(value, depth = 0) {
  if (depth > 80) return true;
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (hasDangerousKeys(value[i], depth + 1)) return true;
    }
    return false;
  }
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return true;
    if (hasDangerousKeys(value[key], depth + 1)) return true;
  }
  return false;
}

export function validateWorkspaceManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, reason: 'Manifest must be a JSON object' };
  }
  if (hasDangerousKeys(manifest)) {
    return { ok: false, reason: 'Manifest contains forbidden keys or exceeds max depth' };
  }
  const serialized = JSON.stringify(manifest);
  const manifestBytes = Buffer.byteLength(serialized, 'utf8');
  if (manifestBytes > WORKSPACE_MAX_MANIFEST_BYTES) {
    return { ok: false, reason: 'Manifest exceeds 4 MiB limit' };
  }

  const rawAssets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const assetIds = [];
  const seen = new Set();
  for (const entry of rawAssets) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, reason: 'Invalid asset entry in manifest' };
    }
    const assetId = typeof entry.assetId === 'string' ? entry.assetId.trim() : '';
    const logicalPath = typeof entry.logicalPath === 'string' ? entry.logicalPath.trim() : '';
    if (!assetId || !logicalPath) {
      return { ok: false, reason: 'Each manifest asset requires assetId and logicalPath' };
    }
    if (!seen.has(assetId)) {
      seen.add(assetId);
      assetIds.push(assetId);
    }
  }

  return { ok: true, manifestBytes, assetIds };
}

export async function computeReferencedBytesForOwner(ownerId) {
  const projects = await LedStudioWorkspaceProject.find({ owner: ownerId })
    .select('assetIds')
    .lean();
  const referencedIds = new Set();
  for (const p of projects) {
    if (Array.isArray(p.assetIds)) {
      for (const id of p.assetIds) referencedIds.add(id);
    }
  }
  let referencedBytes = 0;
  if (referencedIds.size > 0) {
    const assets = await LedStudioWorkspaceAsset.find({
      owner: ownerId,
      assetId: { $in: Array.from(referencedIds) },
      status: 'active'
    })
      .select('sizeBytes')
      .lean();
    for (const a of assets) referencedBytes += Number(a.sizeBytes) || 0;
  }

  const now = new Date();
  const pendingUploads = await LedStudioWorkspaceUpload.find({
    owner: ownerId,
    status: 'pending',
    expiresAt: { $gt: now }
  })
    .select('sizeBytes')
    .lean();
  let reservedBytes = 0;
  for (const u of pendingUploads) reservedBytes += Number(u.sizeBytes) || 0;

  return { referencedBytes, reservedBytes, totalUsedBytes: referencedBytes + reservedBytes };
}

export function buildWorkspaceAssetKey(ownerId, sha256) {
  return `led-studio-workspace/${String(ownerId)}/${String(sha256).toLowerCase()}`;
}

export function hashSha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toLowerCase();
}

export function cleanupWorkspaceTempDir() {
  try {
    if (!fs.existsSync(WORKSPACE_TEMP_DIR)) return 0;
    const entries = fs.readdirSync(WORKSPACE_TEMP_DIR);
    let removed = 0;
    for (const entry of entries) {
      try {
        fs.rmSync(path.join(WORKSPACE_TEMP_DIR, entry), { force: true, recursive: true });
        removed += 1;
      } catch {
        // ignore individual temp cleanup error
      }
    }
    return removed;
  } catch {
    return 0;
  }
}
