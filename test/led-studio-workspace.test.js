import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import LedStudioWorkspacePurgePreview from '../server/models/LedStudioWorkspacePurgePreview.js';
import LedStudioWorkspaceQuota from '../server/models/LedStudioWorkspaceQuota.js';
import {
  WORKSPACE_FREE_MAX_SLOTS,
  WORKSPACE_PRO_MAX_SLOTS,
  WORKSPACE_FREE_MAX_FILE_BYTES,
  WORKSPACE_PRO_MAX_FILE_BYTES,
  WORKSPACE_FREE_MAX_USER_BYTES,
  WORKSPACE_PRO_MAX_USER_BYTES,
  WORKSPACE_MAX_MANIFEST_BYTES,
  resolveWorkspaceEntitlement,
  isMediaKindAllowedForPlan,
  isDeclaredMimeAllowedForKind,
  detectMagicBytesMime,
  validateWorkspaceManifest,
  buildWorkspaceAssetKey
} from '../server/utils/ledWorkspacePolicy.js';

test('resolveWorkspaceEntitlement separates slots and storage limits for free vs Pro or admin/partner', () => {
  const free = resolveWorkspaceEntitlement({ role: 'user', lumiStage: { plan: 'free' } });
  assert.equal(free.proActive, false);
  assert.equal(free.maxSlots, WORKSPACE_FREE_MAX_SLOTS);
  assert.equal(free.maxFileBytes, WORKSPACE_FREE_MAX_FILE_BYTES);
  assert.equal(free.maxUserBytes, WORKSPACE_FREE_MAX_USER_BYTES);
  assert.equal(free.maxFileBytes, 50 * 1024 * 1024);
  assert.equal(free.maxUserBytes, 200 * 1024 * 1024);

  const activePro = resolveWorkspaceEntitlement({
    role: 'user',
    lumiStage: { plan: 'pro_monthly', expiresAt: new Date(Date.now() + 60_000).toISOString() }
  });
  assert.equal(activePro.proActive, true);
  assert.equal(activePro.maxSlots, WORKSPACE_PRO_MAX_SLOTS);
  assert.equal(activePro.maxFileBytes, WORKSPACE_PRO_MAX_FILE_BYTES);
  assert.equal(activePro.maxUserBytes, WORKSPACE_PRO_MAX_USER_BYTES);
  assert.equal(activePro.maxFileBytes, 256 * 1024 * 1024);
  assert.equal(activePro.maxUserBytes, 1024 * 1024 * 1024);

  const expiredPro = resolveWorkspaceEntitlement({
    role: 'user',
    lumiStage: { plan: 'pro_monthly', expiresAt: new Date(Date.now() - 60_000).toISOString() }
  });
  assert.equal(expiredPro.proActive, false);
  assert.equal(expiredPro.maxSlots, WORKSPACE_FREE_MAX_SLOTS);
  assert.equal(expiredPro.maxFileBytes, WORKSPACE_FREE_MAX_FILE_BYTES);
  assert.equal(expiredPro.maxUserBytes, WORKSPACE_FREE_MAX_USER_BYTES);

  const admin = resolveWorkspaceEntitlement({ role: 'admin' });
  assert.equal(admin.proActive, true);
  assert.equal(admin.maxSlots, WORKSPACE_PRO_MAX_SLOTS);
  assert.equal(admin.maxFileBytes, WORKSPACE_PRO_MAX_FILE_BYTES);
  assert.equal(admin.maxUserBytes, WORKSPACE_PRO_MAX_USER_BYTES);
});

test('isMediaKindAllowedForPlan restricts audio and video to active Pro', () => {
  assert.equal(isMediaKindAllowedForPlan('model', false), true);
  assert.equal(isMediaKindAllowedForPlan('image', false), true);
  assert.equal(isMediaKindAllowedForPlan('texture', false), true);
  assert.equal(isMediaKindAllowedForPlan('binary', false), true);
  assert.equal(isMediaKindAllowedForPlan('audio', false), false);
  assert.equal(isMediaKindAllowedForPlan('video', false), false);
  assert.equal(isMediaKindAllowedForPlan('audio', true), true);
  assert.equal(isMediaKindAllowedForPlan('video', true), true);
});

test('detectMagicBytesMime enforces WebP for images and blocks executables/spoofed files', () => {
  const webpHeader = Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1');
  assert.deepEqual(detectMagicBytesMime(webpHeader, 'image', 'image/webp'), {
    ok: true,
    detectedMime: 'image/webp'
  });

  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(detectMagicBytesMime(pngHeader, 'image', 'image/png').ok, false);

  const exeHeader = Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1');
  assert.equal(detectMagicBytesMime(exeHeader, 'model', 'model/gltf-binary').ok, false);

  const elfHeader = Buffer.from('\x7fELF\x02\x01\x01\x00', 'latin1');
  assert.equal(detectMagicBytesMime(elfHeader, 'binary', 'application/octet-stream').ok, false);

  const shebangHeader = Buffer.from('#!/bin/sh\necho hi\n', 'utf8');
  assert.equal(detectMagicBytesMime(shebangHeader, 'model', 'model/gltf+json').ok, false);

  const glbHeader = Buffer.from('glTF\x02\x00\x00\x00', 'latin1');
  assert.deepEqual(detectMagicBytesMime(glbHeader, 'model', 'model/gltf-binary'), {
    ok: true,
    detectedMime: 'model/gltf-binary'
  });

  const gltfJson = Buffer.from('{"asset":{"version":"2.0"}}', 'utf8');
  assert.deepEqual(detectMagicBytesMime(gltfJson, 'model', 'model/gltf+json'), {
    ok: true,
    detectedMime: 'model/gltf+json'
  });
});

test('validateWorkspaceManifest checks asset entries, size limit, and prototype pollution', () => {
  const valid = validateWorkspaceManifest({
    schemaVersion: 1,
    catalogRefs: [{ catalogId: 'stage-dancer', assetVersion: '1.0.0' }],
    assets: [
      { assetId: 'lswa_1', logicalPath: 'textures/wall.webp', storedMime: 'image/webp', kind: 'image' },
      { assetId: 'lswa_1', logicalPath: 'textures/wall_copy.webp', storedMime: 'image/webp', kind: 'image' }
    ],
    scene: { model: { name: 'Demo' } }
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.assetIds, ['lswa_1']);

  const badAsset = validateWorkspaceManifest({
    schemaVersion: 1,
    assets: [{ assetId: 'lswa_1' }]
  });
  assert.equal(badAsset.ok, false);

  const polluted = JSON.parse('{"schemaVersion":1,"__proto__":{"polluted":true}}');
  assert.equal(validateWorkspaceManifest(polluted).ok, false);

  const oversized = validateWorkspaceManifest({
    schemaVersion: 1,
    assets: [],
    blob: 'x'.repeat(WORKSPACE_MAX_MANIFEST_BYTES + 10)
  });
  assert.equal(oversized.ok, false);
});

test('buildWorkspaceAssetKey namespaces by owner and sha256', () => {
  const key = buildWorkspaceAssetKey('user123', 'AABBCC'.padEnd(64, '0'));
  assert.equal(key, `led-studio-workspace/user123/${'aabbcc'.padEnd(64, '0')}`);
});

test('isDeclaredMimeAllowedForKind rejects active HTML/SVG/JS MIMEs and detectMagicBytesMime returns canonical types', () => {
  assert.equal(isDeclaredMimeAllowedForKind('image', 'image/webp'), true);
  assert.equal(isDeclaredMimeAllowedForKind('image', 'image/svg+xml'), false);
  assert.equal(isDeclaredMimeAllowedForKind('model', 'text/html'), false);
  assert.equal(isDeclaredMimeAllowedForKind('model', 'application/javascript'), false);
  assert.equal(isDeclaredMimeAllowedForKind('model', 'model/gltf-binary'), true);
  assert.equal(isDeclaredMimeAllowedForKind('audio', 'text/html'), false);

  const objSample = Buffer.from('v 0 0 0\nv 1 0 0\n', 'utf8');
  assert.deepEqual(detectMagicBytesMime(objSample, 'model', 'text/html'), {
    ok: true,
    detectedMime: 'text/plain'
  });

  const daeSample = Buffer.from('<COLLADA version="1.4.1"></COLLADA>', 'utf8');
  assert.deepEqual(detectMagicBytesMime(daeSample, 'model', 'text/html'), {
    ok: true,
    detectedMime: 'model/vnd.collada+xml'
  });

  assert.ok(LedStudioWorkspacePurgePreview.schema.path('status').enumValues.includes('failed'));
  assert.ok(LedStudioWorkspaceQuota.schema.path('reservedBytes'));
});

test('ledStudioWorkspace route uses per-plan entitlement limits instead of hardcoded global caps', () => {
  const routeSrc = fs.readFileSync(new URL('../server/routes/ledStudioWorkspace.js', import.meta.url), 'utf8');
  assert.equal(routeSrc.includes('WORKSPACE_MAX_USER_BYTES'), false);
  assert.equal(routeSrc.includes('WORKSPACE_MAX_FILE_BYTES'), false);
  assert.equal(routeSrc.includes('entitlement.maxFileBytes'), true);
  assert.equal(routeSrc.includes('entitlement.maxUserBytes'), true);
});
