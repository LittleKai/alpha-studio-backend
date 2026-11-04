import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import LedStudioProject from '../server/models/LedStudioProject.js';
import LedStudioPreset from '../server/models/LedStudioPreset.js';
import User from '../server/models/User.js';
import Transaction from '../server/models/Transaction.js';
import { validateUrlSafety } from '../server/utils/aiProvider.js';
import ledStudioRouter, {
  hashShareToken,
  validateShareAccess,
  sanitizeStageSummary,
  validateProjectPayload,
  isOwnedB2Key,
  setPresignedDownloadUrlGenerator,
  setStageAiRunner
} from '../server/routes/ledStudio.js';
import {
  LUMI_BRAND,
  LUMI_TOKEN_PRICING,
  calculateLumiTokenCredits,
  signLumiLicenseToken,
  verifyLumiLicenseToken
} from '../server/utils/lumiCatalog.js';

function getRouteHandler(method, path) {
  const layer = ledStudioRouter.stack.find(
    l => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]
  );
  assert.ok(layer, `Expected route ${method.toUpperCase()} ${path}`);
  const handlers = layer.route.stack.map(s => s.handle);
  return handlers[handlers.length - 1];
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function makeValidStagePayload(modelName = 'Main Stage V16.glb') {
  return {
    appVersion: '15.1.0',
    model: { name: modelName, width: 18, depth: 10, height: 8 },
    master: { width: 3840, height: 2160 },
    screens: [{ id: 'scr_1', name: 'CENTER LED', w: 12, h: 6 }],
    lights: [{ id: 'l_1', name: 'Beam 1', pos: [0, 5, 0], target: [0, 0, 0] }],
    live: { show: { tracks: [], clips: [] } }
  };
}

test('hashShareToken produces deterministic SHA-256 hex digest and never stores raw token', () => {
  const token = 'secret-share-token-123';
  const digest = hashShareToken(token);
  assert.equal(digest, crypto.createHash('sha256').update(token).digest('hex'));
  assert.notEqual(digest, token);
});

test('validateShareAccess rejects disabled, expired, or mismatched share tokens', () => {
  const token = 'valid-token-abc';
  const doc = {
    shareEnabled: true,
    shareTokenHash: hashShareToken(token),
    shareExpiresAt: new Date(Date.now() + 60_000)
  };
  assert.equal(validateShareAccess(doc, token).ok, true);
  assert.equal(validateShareAccess({ ...doc, shareEnabled: false }, token).ok, false);
  assert.equal(validateShareAccess({ ...doc, shareExpiresAt: new Date(Date.now() - 1000) }, token).ok, false);
  assert.equal(validateShareAccess(doc, 'wrong-token').ok, false);
});

test('sanitizeStageSummary bounds numeric stage dimensions and strips unknown fields', () => {
  const summary = sanitizeStageSummary({
    widthM: 24.5,
    depthM: 12,
    heightM: 9,
    ledCount: 14,
    lightCount: 16,
    cueCount: 22,
    malicious: '<script>'
  });
  assert.deepEqual(summary, {
    widthM: 24.5,
    depthM: 12,
    heightM: 9,
    ledCount: 14,
    lightCount: 16,
    cueCount: 22
  });
});

test('validateProjectPayload rejects empty {} Promise serialization and accepts valid stage payloads (C2)', () => {
  assert.equal(validateProjectPayload({}).ok, false);
  assert.equal(validateProjectPayload(null).ok, false);
  assert.equal(validateProjectPayload({ model: { name: 'A' }, master: { width: 10, height: 10 } }).ok, false);
  const valid = validateProjectPayload(makeValidStagePayload());
  assert.equal(valid.ok, true);
});

function mockProjectStore() {
  const store = new Map();
  const origCreate = LedStudioProject.create;
  const origFindOne = LedStudioProject.findOne;
  const origFind = LedStudioProject.find;

  LedStudioProject.create = async (doc) => {
    const id = 'proj_' + (store.size + 1);
    const saved = {
      ...doc,
      _id: id,
      updatedAt: new Date(),
      async save() {
        store.set(id, this);
        return this;
      },
      toObject() {
        const copy = { ...this };
        delete copy.save;
        delete copy.toObject;
        return copy;
      }
    };
    store.set(id, saved);
    return saved;
  };
  LedStudioProject.findOne = (filter) => {
    const match = Array.from(store.values()).find(item => {
      if (filter._id && String(item._id) !== String(filter._id)) return false;
      if (filter.owner && String(item.owner) !== String(filter.owner)) return false;
      if (filter.shareTokenHash && item.shareTokenHash !== filter.shareTokenHash) return false;
      if (filter.shareEnabled !== undefined && item.shareEnabled !== filter.shareEnabled) return false;
      return true;
    }) || null;
    return {
      select() {
        return { lean: async () => (match ? { ...match } : null) };
      },
      lean: async () => (match ? { ...match } : null),
      then(resolve, reject) {
        return Promise.resolve(match).then(resolve, reject);
      }
    };
  };
  LedStudioProject.find = (filter) => ({
    sort: () => ({
      limit: () => ({
        lean: async () => Array.from(store.values()).filter(x => String(x.owner) === String(filter.owner))
      })
    })
  });

  return {
    store,
    restore() {
      LedStudioProject.create = origCreate;
      LedStudioProject.findOne = origFindOne;
      LedStudioProject.find = origFind;
    }
  };
}

test('POST/PUT/GET/DELETE /projects enforce B2 key ownership (C1), reject empty payloads (C2), and support save -> update -> reopen -> share round-trip (I2, I7)', async () => {
  const { store, restore } = mockProjectStore();

  try {
    const postProjects = getRouteHandler('post', '/projects');
    const putProject = getRouteHandler('put', '/projects/:id');
    const getProject = getRouteHandler('get', '/projects/:id');
    const postShare = getRouteHandler('post', '/projects/:id/share');
    const getShare = getRouteHandler('get', '/share/:shareToken');

    // 1. C1: Reject foreign B2 key on POST /projects
    const resForeign = makeRes();
    await postProjects({
      user: { _id: 'user-A', role: 'user' },
      body: {
        title: 'Attack Project',
        b2FileKey: 'led-studio/projects/user-B/victim.ledstudio',
        projectJson: makeValidStagePayload()
      }
    }, resForeign);
    assert.equal(resForeign.statusCode, 403);
    assert.equal(store.size, 0);

    // 2. C1: Reject any caller-supplied B2 key on new project creation
    const resCallerKey = makeRes();
    await postProjects({
      user: { _id: 'user-A', role: 'user' },
      body: {
        title: 'Caller Key Project',
        b2FileKey: 'led-studio/projects/user-A/custom.ledstudio',
        projectJson: makeValidStagePayload()
      }
    }, resCallerKey);
    assert.equal(resCallerKey.statusCode, 403);

    // 3. C2: Reject empty {} projectJson (un-awaited Promise serialization)
    const resEmpty = makeRes();
    await postProjects({
      user: { _id: 'user-A', role: 'user' },
      body: { title: 'Empty Stage', projectJson: {} }
    }, resEmpty);
    assert.equal(resEmpty.statusCode, 400);

    // 4. C2: Reject missing payload when B2 is unconfigured
    const resNoPayload = makeRes();
    await postProjects({
      user: { _id: 'user-A', role: 'user' },
      body: { title: 'Metadata Only' }
    }, resNoPayload);
    assert.equal(resNoPayload.statusCode, 400);

    // 5. Valid Cloud Save creates server-owned B2 key under user-A namespace
    const resCreate = makeRes();
    await postProjects({
      user: { _id: 'user-A', role: 'user' },
      body: {
        title: 'Show Stage V1',
        projectJson: makeValidStagePayload('StageV1.glb')
      }
    }, resCreate);
    assert.equal(resCreate.statusCode, 201);
    const createdProj = resCreate.body.data.project;
    assert.ok(isOwnedB2Key(createdProj.b2FileKey, 'projects', 'user-A'));
    assert.equal(store.size, 1);

    // 6. I7: Repeated save / update updates the same project without duplicating records or changing B2 key
    const resUpdate = makeRes();
    await putProject({
      user: { _id: 'user-A', role: 'user' },
      params: { id: createdProj._id },
      body: {
        title: 'Show Stage V2 Updated',
        projectJson: makeValidStagePayload('StageV2.glb')
      }
    }, resUpdate);
    assert.equal(resUpdate.statusCode, 200);
    assert.equal(store.size, 1, 'Updating an owned project must not duplicate records');
    assert.equal(resUpdate.body.data.project.b2FileKey, createdProj.b2FileKey);

    // 7. I7: Owner reopen via GET /projects/:id returns latest validated stage payload
    const resGet = makeRes();
    await getProject({
      user: { _id: 'user-A', role: 'user' },
      params: { id: createdProj._id }
    }, resGet);
    assert.equal(resGet.statusCode, 200);
    assert.equal(resGet.body.data.project.title, 'Show Stage V2 Updated');
    assert.equal(resGet.body.data.projectJson.model.name, 'StageV2.glb');

    // 8. I2: Create share link and resolve via public GET /share/:shareToken with full projectJson
    const resShareCreate = makeRes();
    await postShare({
      user: { _id: 'user-A', role: 'user' },
      params: { id: createdProj._id },
      body: { enabled: true, expiresInHours: 24 }
    }, resShareCreate);
    assert.equal(resShareCreate.statusCode, 200);
    const rawShareToken = resShareCreate.body.data.shareToken;
    assert.ok(rawShareToken);

    const resShareResolve = makeRes();
    await getShare({
      params: { shareToken: rawShareToken }
    }, resShareResolve);
    assert.equal(resShareResolve.statusCode, 200);
    assert.equal(resShareResolve.body.data.mode, 'client_review_readonly');
    assert.equal(resShareResolve.body.data.projectJson.model.name, 'StageV2.glb');
  } finally {
    restore();
  }
});

test('share snapshot via requestUploadUrl returns a presigned PUT, drops stale inline payload, and share resolves to downloadUrl without proxying the file', async () => {
  const B2_ENV = ['B2_BUCKET_NAME', 'B2_ENDPOINT', 'B2_ACCESS_KEY_ID', 'B2_SECRET_ACCESS_KEY'];
  const savedEnv = Object.fromEntries(B2_ENV.map(k => [k, process.env[k]]));
  Object.assign(process.env, {
    B2_BUCKET_NAME: 'test-bucket',
    B2_ENDPOINT: 'https://s3.b2.test',
    B2_ACCESS_KEY_ID: 'test-key-id',
    B2_SECRET_ACCESS_KEY: 'test-secret'
  });
  setPresignedDownloadUrlGenerator(async key => `https://s3.b2.test/test-bucket/${key}?signed=1`);
  const { store, restore } = mockProjectStore();
  try {
    const user = { _id: 'user-S', role: 'user' };
    const summary = { widthM: 18, depthM: 10, heightM: 8, ledCount: 3, lightCount: 4, cueCount: 0 };

    const resCreate = makeRes();
    await getRouteHandler('post', '/projects')({
      user,
      body: { title: 'Gala Snapshot', fileSize: 1234, stageSummary: summary, requestUploadUrl: true }
    }, resCreate);
    assert.equal(resCreate.statusCode, 201);
    const proj = resCreate.body.data.project;
    assert.ok(isOwnedB2Key(proj.b2FileKey, 'projects', 'user-S'));
    assert.ok(resCreate.body.data.uploadInfo.presignedUrl.includes(encodeURI(proj.b2FileKey)));

    // A stale inline payload from the old save path must not shadow the new B2 object.
    store.get(proj._id).projectPayload = makeValidStagePayload('Stale.glb');
    const resUpdate = makeRes();
    await getRouteHandler('put', '/projects/:id')({
      user,
      params: { id: proj._id },
      body: { title: 'Gala Snapshot', fileSize: 2048, stageSummary: summary, requestUploadUrl: true }
    }, resUpdate);
    assert.equal(resUpdate.statusCode, 200);
    assert.equal(store.get(proj._id).projectPayload, null);
    assert.equal(store.get(proj._id).fileSize, 2048);

    const resShare = makeRes();
    await getRouteHandler('post', '/projects/:id/share')({ user, params: { id: proj._id }, body: {} }, resShare);
    const resResolve = makeRes();
    await getRouteHandler('get', '/share/:shareToken')({ params: { shareToken: resShare.body.data.shareToken } }, resResolve);
    assert.equal(resResolve.statusCode, 200);
    assert.equal(resResolve.body.data.projectJson, null);
    assert.equal(resResolve.body.data.downloadUrl, `https://s3.b2.test/test-bucket/${proj.b2FileKey}?signed=1`);
  } finally {
    restore();
    setPresignedDownloadUrlGenerator(null);
    for (const k of B2_ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  }
});

test('POST/GET /presets allow ordinary users to publish Vietnamese personal presets and list scope=mine (I6)', async () => {
  const presetStore = [];
  const origCreate = LedStudioPreset.create;
  const origFind = LedStudioPreset.find;
  const origFindOne = LedStudioPreset.findOne;

  LedStudioPreset.create = async (doc) => {
    const saved = { ...doc, _id: 'preset_' + (presetStore.length + 1), createdAt: new Date() };
    presetStore.push(saved);
    return saved;
  };
  LedStudioPreset.findOne = (filter) => ({
    lean: async () => presetStore.find(p => {
      if (filter._id && String(p._id) !== String(filter._id)) return false;
      if (filter.b2AssetKey && String(p.b2AssetKey) !== String(filter.b2AssetKey)) return false;
      return true;
    }) || null
  });
  LedStudioPreset.find = (filter) => ({
    sort: () => ({
      limit: () => ({
        lean: async () => presetStore.filter(p => {
          if (filter.isPublic === true) return p.isPublic === true;
          if (filter.$or) {
            return filter.$or.some(cond =>
              (cond.createdBy && String(p.createdBy) === String(cond.createdBy)) ||
              (cond.authorId && String(p.authorId) === String(cond.authorId)) ||
              (cond.isPublic === true && p.isPublic === true)
            );
          }
          return true;
        })
      })
    })
  });

  try {
    const postPresets = getRouteHandler('post', '/presets');
    const getPresets = getRouteHandler('get', '/presets');

    // Ordinary user creates a private personal preset with Vietnamese-only title
    const resCreatePrivate = makeRes();
    await postPresets({
      user: { _id: 'user-ordinary', role: 'user' },
      body: {
        title: 'Màn LED Matrix Sân Khấu Chính',
        category: 'matrix_fx_preset',
        visibility: 'private',
        payloadJson: { effect: 'rainbowChase', brightness: 0.9 }
      }
    }, resCreatePrivate);
    assert.equal(resCreatePrivate.statusCode, 201);
    assert.equal(resCreatePrivate.body.data.ownership, 'community');
    assert.equal(resCreatePrivate.body.data.visibility, 'private');
    assert.equal(resCreatePrivate.body.data.isPublic, false);

    // Reject foreign b2AssetKey
    const resForeignAsset = makeRes();
    await postPresets({
      user: { _id: 'user-ordinary', role: 'user' },
      body: {
        title: 'Preset Lỗi',
        category: 'ofl_fixture',
        b2AssetKey: 'led-studio/presets/other-user/hack.json'
      }
    }, resForeignAsset);
    assert.equal(resForeignAsset.statusCode, 403);

    // Public list excludes private preset
    const resPublic = makeRes();
    await getPresets({ query: { scope: 'public' }, headers: {} }, resPublic);
    assert.equal(resPublic.statusCode, 200);
    assert.equal(resPublic.body.data.length, 0);

    // Authenticated scope=mine returns the ordinary user's private preset
    const resMine = makeRes();
    await getPresets({
      user: { _id: 'user-ordinary', role: 'user' },
      query: { scope: 'mine' },
      headers: {}
    }, resMine);
    assert.equal(resMine.statusCode, 200);
    assert.equal(resMine.body.data.length, 1);
    assert.equal(resMine.body.data[0].title.vi, 'Màn LED Matrix Sân Khấu Chính');

    // GET /presets/:id enforces private preset ownership and allows owner access
    const getPresetById = getRouteHandler('get', '/presets/:id');
    const getPresetAsset = getRouteHandler('get', '/presets/asset');
    const resPrivateOther = makeRes();
    await getPresetById({
      user: { _id: 'user-stranger', role: 'user' },
      params: { id: 'preset_1' }
    }, resPrivateOther);
    assert.equal(resPrivateOther.statusCode, 403);

    const resPrivateOwner = makeRes();
    await getPresetById({
      user: { _id: 'user-ordinary', role: 'user' },
      params: { id: 'preset_1' }
    }, resPrivateOwner);
    assert.equal(resPrivateOwner.statusCode, 200);
    assert.equal(resPrivateOwner.body.data.payloadJson.effect, 'rainbowChase');

    // B2-backed public and private presets resolve downloadUrl on both /presets/:id and /presets/asset (I6)
    const publicB2Preset = {
      _id: 'preset_b2_pub',
      authorId: 'user-ordinary',
      createdBy: 'user-ordinary',
      ownership: 'community',
      visibility: 'public',
      isPublic: true,
      category: 'glb_prop',
      presetType: 'glb_prop',
      title: { vi: 'Cụm Truss GLB Công Khai', en: 'Public Truss GLB' },
      b2AssetKey: 'led-studio/presets/user-ordinary/truss-public.glb',
      payloadJson: null
    };
    const privateB2Preset = {
      _id: 'preset_b2_priv',
      authorId: 'user-ordinary',
      createdBy: 'user-ordinary',
      ownership: 'community',
      visibility: 'private',
      isPublic: false,
      category: 'stage_template',
      presetType: 'stage_template',
      title: { vi: 'Sân Khấu Cá Nhân B2', en: 'Private Stage B2' },
      b2AssetKey: 'led-studio/presets/user-ordinary/stage-private.json',
      payloadJson: null
    };
    presetStore.push(publicB2Preset, privateB2Preset);

    const prevBucket = process.env.B2_BUCKET_NAME;
    const prevEndpoint = process.env.B2_ENDPOINT;
    const prevKeyId = process.env.B2_ACCESS_KEY_ID;
    const prevSecret = process.env.B2_SECRET_ACCESS_KEY;
    try {
      process.env.B2_BUCKET_NAME = 'alpha-studio-test-bucket';
      process.env.B2_ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';
      process.env.B2_ACCESS_KEY_ID = 'test-key-id';
      process.env.B2_SECRET_ACCESS_KEY = 'test-secret-key';

      const resPubById = makeRes();
      await getPresetById({ params: { id: 'preset_b2_pub' }, headers: {} }, resPubById);
      assert.equal(resPubById.statusCode, 200);
      assert.ok(
        typeof resPubById.body?.data?.downloadUrl === 'string' &&
        resPubById.body.data.downloadUrl.includes('led-studio/presets/user-ordinary/truss-public.glb'),
        'Public B2 preset GET /presets/:id must return signed downloadUrl'
      );

      const resPubByAsset = makeRes();
      await getPresetAsset({
        query: { key: 'led-studio/presets/user-ordinary/truss-public.glb' },
        headers: {}
      }, resPubByAsset);
      assert.equal(resPubByAsset.statusCode, 200);
      assert.ok(
        typeof resPubByAsset.body?.data?.downloadUrl === 'string' &&
        resPubByAsset.body.data.downloadUrl.includes('led-studio/presets/user-ordinary/truss-public.glb'),
        'Public B2 preset GET /presets/asset must return signed downloadUrl'
      );

      const resPrivOwnerById = makeRes();
      await getPresetById({
        user: { _id: 'user-ordinary', role: 'user' },
        params: { id: 'preset_b2_priv' },
        headers: {}
      }, resPrivOwnerById);
      assert.equal(resPrivOwnerById.statusCode, 200);
      assert.ok(
        typeof resPrivOwnerById.body?.data?.downloadUrl === 'string' &&
        resPrivOwnerById.body.data.downloadUrl.includes('led-studio/presets/user-ordinary/stage-private.json'),
        'Owner private B2 preset GET /presets/:id must return signed downloadUrl'
      );

      const resPrivOwnerByAsset = makeRes();
      await getPresetAsset({
        user: { _id: 'user-ordinary', role: 'user' },
        query: { key: 'led-studio/presets/user-ordinary/stage-private.json' },
        headers: {}
      }, resPrivOwnerByAsset);
      assert.equal(resPrivOwnerByAsset.statusCode, 200);
      assert.ok(
        typeof resPrivOwnerByAsset.body?.data?.downloadUrl === 'string' &&
        resPrivOwnerByAsset.body.data.downloadUrl.includes('led-studio/presets/user-ordinary/stage-private.json'),
        'Owner private B2 preset GET /presets/asset must return signed downloadUrl'
      );

      const resPrivDeniedByAsset = makeRes();
      await getPresetAsset({
        user: { _id: 'user-stranger', role: 'user' },
        query: { key: 'led-studio/presets/user-ordinary/stage-private.json' },
        headers: {}
      }, resPrivDeniedByAsset);
      assert.equal(resPrivDeniedByAsset.statusCode, 403);
    } finally {
      if (prevBucket === undefined) delete process.env.B2_BUCKET_NAME; else process.env.B2_BUCKET_NAME = prevBucket;
      if (prevEndpoint === undefined) delete process.env.B2_ENDPOINT; else process.env.B2_ENDPOINT = prevEndpoint;
      if (prevKeyId === undefined) delete process.env.B2_ACCESS_KEY_ID; else process.env.B2_ACCESS_KEY_ID = prevKeyId;
      if (prevSecret === undefined) delete process.env.B2_SECRET_ACCESS_KEY; else process.env.B2_SECRET_ACCESS_KEY = prevSecret;
    }
  } finally {
    LedStudioPreset.create = origCreate;
    LedStudioPreset.find = origFind;
    LedStudioPreset.findOne = origFindOne;
  }
});

test('admin.js collectReferencedKeys includes LedStudioProject.b2FileKey and LedStudioPreset.b2AssetKey', () => {
  const adminSrc = fs.readFileSync(new URL('../server/routes/admin.js', import.meta.url), 'utf8');
  assert.ok(adminSrc.includes('LedStudioProject'), 'admin.js must reference LedStudioProject');
  assert.ok(adminSrc.includes('LedStudioPreset'), 'admin.js must reference LedStudioPreset');
  assert.ok(adminSrc.includes('b2FileKey'), 'admin.js must collect b2FileKey');
  assert.ok(adminSrc.includes('b2AssetKey'), 'admin.js must collect b2AssetKey');
});

test('LumiStage catalog calculates token credits at 1/3 official Gemini price and 0 credit for BYOK', () => {
  assert.equal(LUMI_BRAND.name, 'LumiStage');
  assert.equal(LUMI_BRAND.legalEntity, 'CÔNG TY TNHH MTV GROUPLIFE');
  assert.equal(LUMI_TOKEN_PRICING.inputCreditsPerMillion, 25);
  assert.equal(LUMI_TOKEN_PRICING.outputCreditsPerMillion, 210);

  // 1,000,000 input + 1,000,000 output = 25 + 210 = 235 Credits
  const fullMillion = calculateLumiTokenCredits({ promptTokens: 1_000_000, completionTokens: 1_000_000 });
  assert.equal(fullMillion.totalCredits, 235);

  // Typical medium Stage AI call: 1,500 input + 1,500 output = 0.0375 + 0.315 = 0.3525 Credits (~35 VND)
  const mediumCall = calculateLumiTokenCredits({ promptTokens: 1500, completionTokens: 1500 });
  assert.equal(mediumCall.totalCredits, 0.3525);

  // BYOK is always 0 Credit
  const byokCall = calculateLumiTokenCredits({ promptTokens: 50_000, completionTokens: 20_000 }, { byok: true });
  assert.equal(byokCall.totalCredits, 0);

  // License token sign & verify
  const token = signLumiLicenseToken({
    userId: 'user_lumi_1',
    email: 'director@grouplife.vn',
    plan: 'pro_monthly',
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    unlockedProjectKeys: ['proj_1']
  });
  const verified = verifyLumiLicenseToken(token);
  assert.equal(verified.valid, true);
  assert.equal(verified.payload.brand, 'LumiStage');
  assert.equal(verified.payload.plan, 'pro_monthly');
});

test('B4 & B5: Password-protected share link, 3D pin comments, and client approval decision', async () => {
  const { restore } = mockProjectStore();
  try {
    const postProjects = getRouteHandler('post', '/projects');
    const postShare = getRouteHandler('post', '/projects/:id/share');
    const getShare = getRouteHandler('get', '/share/:shareToken');
    const postComments = getRouteHandler('post', '/share/:shareToken/comments');
    const postDecision = getRouteHandler('post', '/share/:shareToken/decision');

    const resCreate = makeRes();
    await postProjects({
      user: { _id: 'user-owner', role: 'user' },
      body: { title: 'Gala GroupLife 2026', projectJson: makeValidStagePayload('Gala.glb') }
    }, resCreate);
    const projId = resCreate.body.data.project._id;

    // Enable share with password
    const resShare = makeRes();
    await postShare({
      user: { _id: 'user-owner', role: 'user' },
      params: { id: projId },
      body: { enabled: true, expiresInHours: 72, password: 'vip2026' }
    }, resShare);
    assert.equal(resShare.statusCode, 200);
    assert.equal(resShare.body.data.passwordProtected, true);
    const shareToken = resShare.body.data.shareToken;

    // 1. Access without password returns requiresPassword: true without leaking projectJson
    const resNoPwd = makeRes();
    await getShare({ params: { shareToken }, headers: {}, query: {} }, resNoPwd);
    assert.equal(resNoPwd.statusCode, 200);
    assert.equal(resNoPwd.body.data.requiresPassword, true);
    assert.equal(resNoPwd.body.data.projectJson, undefined);

    // 2. Access with wrong password returns 401
    const resWrongPwd = makeRes();
    await getShare({
      params: { shareToken },
      headers: { 'x-share-password': 'wrong' },
      query: {}
    }, resWrongPwd);
    assert.equal(resWrongPwd.statusCode, 401);

    // 3. Access with valid password returns stage payload
    const resValidPwd = makeRes();
    await getShare({
      params: { shareToken },
      headers: { 'x-share-password': 'vip2026' },
      query: {}
    }, resValidPwd);
    assert.equal(resValidPwd.statusCode, 200);
    assert.equal(resValidPwd.body.data.requiresPassword, false);
    assert.equal(resValidPwd.body.data.projectJson.model.name, 'Gala.glb');

    // 4. Pin a 3D comment on stage coordinates
    const resComment = makeRes();
    await postComments({
      params: { shareToken },
      headers: { 'x-share-password': 'vip2026' },
      body: {
        author: 'Giám đốc Sự kiện',
        message: 'Nâng màn LED chính cao thêm 0.5m để không vướng bàn VIP',
        position: [0, 3.2, -4.5],
        targetName: 'CENTER LED'
      }
    }, resComment);
    assert.equal(resComment.statusCode, 201);
    assert.equal(resComment.body.data.reviewComments.length, 1);
    assert.deepEqual(resComment.body.data.comment.position, [0, 3.2, -4.5]);

    // 5. Client approves the stage design
    const resApprove = makeRes();
    await postDecision({
      params: { shareToken },
      headers: { 'x-share-password': 'vip2026' },
      body: {
        status: 'approved',
        reviewerName: 'Chủ đầu tư GroupLife',
        note: 'Chốt phương án này để xuất bản vẽ DXF & báo giá.'
      }
    }, resApprove);
    assert.equal(resApprove.statusCode, 200);
    assert.equal(resApprove.body.data.reviewStatus, 'approved');
  } finally {
    restore();
  }
});

test('LumiStage credit billing, project unlock, Pro upgrade, and Stage AI token deduction + BYOK', async () => {
  const { restore } = mockProjectStore();
  const origTxCreate = Transaction.create;
  Transaction.create = async () => null;
  try {
    const getBillingStatus = getRouteHandler('get', '/billing/status');
    const postCheckout = getRouteHandler('post', '/billing/checkout');
    const postConsumeExport = getRouteHandler('post', '/billing/consume-export');
    const postStageAi = getRouteHandler('post', '/ai/stage');

    const mockUser = {
      _id: 'user-credit-test',
      email: 'agency@grouplife.vn',
      role: 'user',
      balance: 2000,
      lumiStage: {
        plan: 'free',
        expiresAt: null,
        freeAiCreditsRemaining: 0.2,
        singleExportCredits: 0,
        unlockedProjectKeys: []
      },
      async save() { return this; }
    };

    // 1. Initial billing status
    const resStatus = makeRes();
    await getBillingStatus({ user: mockUser }, resStatus);
    assert.equal(resStatus.statusCode, 200);
    assert.equal(resStatus.body.data.balance, 2000);
    assert.equal(resStatus.body.data.subscription.proActive, false);

    // 2. Free user export without autoDeductCredits requires watermark removal (402)
    const resBlockedExport = makeRes();
    await postConsumeExport({
      user: mockUser,
      body: { projectKey: 'proj_abc', autoDeductCredits: false }
    }, resBlockedExport);
    assert.equal(resBlockedExport.statusCode, 402);

    // 3. Unlock single project permanently for 200 Credits
    const resUnlock = makeRes();
    await postCheckout({
      user: mockUser,
      body: { productId: 'lumi_unlock_project', projectKey: 'proj_abc' }
    }, resUnlock);
    assert.equal(resUnlock.statusCode, 200);
    assert.equal(mockUser.balance, 1800);
    assert.ok(mockUser.lumiStage.unlockedProjectKeys.includes('proj_abc'));

    // Now export on unlocked project is free and unwatermarked
    const resUnlockedExport = makeRes();
    await postConsumeExport({
      user: mockUser,
      body: { projectKey: 'proj_abc' }
    }, resUnlockedExport);
    assert.equal(resUnlockedExport.statusCode, 200);
    assert.equal(resUnlockedExport.body.data.watermark, false);
    assert.equal(resUnlockedExport.body.data.chargedCredits, 0);

    // 4. Stage AI call via Web model deducts from freeAiCreditsRemaining first, then wallet balance
    setStageAiRunner(async ({ effort, isByok }) => ({
      text: JSON.stringify({
        reply: `Đã dựng sân khấu hội nghị (${effort})`,
        commands: [{ action: 'load_template', templateId: 'conference' }],
        audit: [{ severity: 'info', title: 'Điện 3 pha ổn định', detail: 'Tổng tải 18 kVA' }],
        proposal: { title: 'Phương án Hội nghị', summary: 'LED P3.91', highlights: ['Rõ nét'] },
        estimatedCostVnd: 45000000
      }),
      model: isByok ? 'custom-model' : 'gemini-3.8-flash',
      provider: isByok ? 'openai' : 'gcli',
      usage: { promptTokens: 2000, completionTokens: 2000, totalTokens: 4000 }
    }));

    // 2000 input * 25/1M = 0.05 Cr; 2000 output * 210/1M = 0.42 Cr -> Total = 0.47 Cr
    // User has 0.20 freeAiCreditsRemaining -> uses 0.20 free + 0.27 from wallet balance (1800 -> 1799.73)
    const resAiWeb = makeRes();
    await postStageAi({
      user: mockUser,
      body: { prompt: 'Dựng sân khấu hội nghị 500 khách', effort: 'medium' }
    }, resAiWeb);
    assert.equal(resAiWeb.statusCode, 200);
    assert.equal(resAiWeb.body.data.billing.creditCharged, 0.47);
    assert.equal(resAiWeb.body.data.billing.usedFreeCredits, 0.2);
    assert.equal(resAiWeb.body.data.billing.usedWalletCredits, 0.27);
    assert.equal(mockUser.lumiStage.freeAiCreditsRemaining, 0);
    assert.equal(mockUser.balance, 1799.73);

    // 5. Stage AI call with BYOK charges 0 Credits
    const resAiByok = makeRes();
    await postStageAi({
      user: mockUser,
      body: {
        prompt: 'Thêm 8 đèn Beam 230',
        byok: { provider: 'openai', apiKey: 'sk-user-own-key-123456', model: 'gpt-4o-mini' }
      }
    }, resAiByok);
    assert.equal(resAiByok.statusCode, 200);
    assert.equal(resAiByok.body.data.billing.byok, true);
    assert.equal(resAiByok.body.data.billing.creditCharged, 0);
    assert.equal(mockUser.balance, 1799.73);

    // 6. Upgrade to LumiStage Pro Monthly (1490 Credits) grants +300 bonus AI Credits
    const resPro = makeRes();
    await postCheckout({
      user: mockUser,
      body: { productId: 'lumi_pro_monthly' }
    }, resPro);
    assert.equal(resPro.statusCode, 200);
    assert.equal(resPro.body.data.subscription.proActive, true);
    assert.equal(mockUser.lumiStage.freeAiCreditsRemaining, 300);
    assert.equal(mockUser.balance, 309.73);
  } finally {
    // 7. Phase 2 Opt-in Telemetry (Nghị định 13/2023): ignored when optIn !== true, recorded when optIn === true
    const postTelemetry = getRouteHandler('post', '/telemetry');
    const resTelOff = makeRes();
    await postTelemetry({
      body: { optIn: false, event: 'template_applied', meta: { templateId: 'vn_wedding_luxury' } }
    }, resTelOff);
    assert.equal(resTelOff.statusCode, 200);
    assert.equal(resTelOff.body.recorded, false);

    const resTelOn = makeRes();
    await postTelemetry({
      body: { optIn: true, event: 'seating_auto_layout', meta: { guestCount: 300, type: 'gala_round_table' } }
    }, resTelOn);
    assert.equal(resTelOn.statusCode, 200);
    assert.equal(resTelOn.body.recorded, true);
    assert.equal(resTelOn.body.data.event, 'seating_auto_layout');

    setStageAiRunner(null);
    Transaction.create = origTxCreate;
    restore();
  }
});

test('Pre-commit review regressions: IPv6/loopback SSRF guard, Mongoose User/Transaction validation, and frontend contract aliases', async () => {
  // 1. SSRF guard blocks bracketed IPv6 loopback, 0.0.0.0, IPv4-mapped IPv6, Unique Local IPv6, CGNAT metadata, and unresolvable/internal hosts
  for (const unsafeUrl of [
    'http://[::1]:18791/v1',
    'http://[0:0:0:0:0:0:0:1]:8080/v1',
    'http://0.0.0.0:11434/v1',
    'http://[::ffff:127.0.0.1]:8000/v1',
    'http://[fd00::1]:8000/v1',
    'http://100.100.100.200/latest/meta-data',
    'http://mongodb:27017/v1',
    'http://redis.internal:6379/v1',
    'http://nonexistent-ssrf-test-host.invalid/v1'
  ]) {
    await assert.rejects(() => validateUrlSafety(unsafeUrl), /Blocked|không hợp lệ|nội bộ/i, `Expected ${unsafeUrl} to be blocked`);
  }

  // 2. Mongoose User schema accepts both catalog plan IDs and short plan IDs
  for (const planId of ['free', 'pro_monthly', 'lumi_pro_monthly', 'lumi_pro_quarterly', 'lumi_pro_yearly']) {
    const u = new User({ email: 'test@grouplife.vn', name: 'Tester', password: 'Password123!', lumiStage: { plan: planId } });
    const err = u.validateSync();
    assert.equal(err, undefined, `User.lumiStage.plan=${planId} must pass Mongoose validation`);
  }

  // 3. Transaction creation during checkout/AI spend passes Mongoose validation (userId + transactionCode)
  const capturedTxs = [];
  const origTxCreate = Transaction.create;
  Transaction.create = async (doc) => {
    const txDoc = new Transaction(doc);
    const validationErr = txDoc.validateSync();
    assert.equal(validationErr, undefined, 'Transaction document must pass Mongoose schema validation');
    capturedTxs.push(doc);
    return txDoc;
  };

  const { restore } = mockProjectStore();
  try {
    const postCheckout = getRouteHandler('post', '/billing/checkout');
    const postDecision = getRouteHandler('post', '/share/:shareToken/decision');
    const postProjects = getRouteHandler('post', '/projects');
    const postShare = getRouteHandler('post', '/projects/:id/share');

    const mockUser = {
      _id: '507f1f77bcf86cd799439011',
      email: 'client@grouplife.vn',
      role: 'user',
      balance: 500,
      lumiStage: {
        plan: 'free',
        expiresAt: null,
        freeAiCreditsRemaining: 20,
        singleExportCredits: 0,
        unlockedProjectKeys: []
      },
      async save() { return this; }
    };

    // Checkout using frontend `productKey` field returns both nested and flat billing fields
    const resCheckout = makeRes();
    await postCheckout({
      user: mockUser,
      body: { productKey: 'lumi_single_export' }
    }, resCheckout);
    assert.equal(resCheckout.statusCode, 200);
    assert.equal(resCheckout.body.data.singleExportPasses, 1);
    assert.equal(resCheckout.body.data.balanceCredits, 450);
    assert.equal(capturedTxs.length, 1);
    assert.match(capturedTxs[0].transactionCode, /^LUMI_/);

    // Share decision using frontend `{ decision, author, note }` fields succeeds
    const resProj = makeRes();
    await postProjects({
      user: { _id: '507f1f77bcf86cd799439011', role: 'user' },
      body: { title: 'Alias Share Test', projectJson: makeValidStagePayload('Alias.glb') }
    }, resProj);
    const resShare = makeRes();
    await postShare({
      user: { _id: '507f1f77bcf86cd799439011', role: 'user' },
      params: { id: resProj.body.data.project._id },
      body: { enabled: true }
    }, resShare);
    const shareToken = resShare.body.data.shareToken;

    const resDec = makeRes();
    await postDecision({
      params: { shareToken },
      headers: {},
      body: { decision: 'changes_requested', author: 'Đạo diễn Sân khấu', note: 'Tăng thêm 4 đèn Blinder' }
    }, resDec);
    assert.equal(resDec.statusCode, 200);
    assert.equal(resDec.body.data.reviewStatus, 'changes_requested');
    assert.equal(resDec.body.data.reviewBy, 'Đạo diễn Sân khấu');

    // Partial credit deduction reports actual charged credits (usedFreeCredits + usedWalletCredits)
    const postStageAi = getRouteHandler('post', '/ai/stage');
    setStageAiRunner(async () => ({
      text: JSON.stringify({ reply: 'OK', commands: [], audit: [], proposal: null, estimatedCostVnd: 0 }),
      model: 'gemini-3.8-flash',
      provider: 'gcli',
      usage: { promptTokens: 2000, completionTokens: 2000, totalTokens: 4000 }
    }));
    const lowCreditUser = {
      _id: '507f1f77bcf86cd799439099',
      email: 'low@grouplife.vn',
      role: 'user',
      balance: 0,
      lumiStage: {
        plan: 'free',
        expiresAt: null,
        freeAiCreditsRemaining: 0.01,
        singleExportCredits: 0,
        unlockedProjectKeys: []
      },
      async save() { return this; }
    };
    const resLowAi = makeRes();
    await postStageAi({ user: lowCreditUser, body: { prompt: 'Test partial credit', effort: 'low' } }, resLowAi);
    assert.equal(resLowAi.statusCode, 200);
    assert.equal(resLowAi.body.data.billing.usedFreeCredits, 0.01);
    assert.equal(resLowAi.body.data.billing.usedWalletCredits, 0);
    assert.equal(resLowAi.body.data.billing.creditCharged, 0.01);
    assert.equal(resLowAi.body.data.creditsCharged, 0.01);
  } finally {
    setStageAiRunner(null);
    Transaction.create = origTxCreate;
    restore();
  }
});
