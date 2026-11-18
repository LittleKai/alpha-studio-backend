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
  FREE_SHARE_MAX_HOURS,
  hashShareToken,
  normalizeUserLumiState,
  validateShareAccess,
  sanitizeStageSummary,
  validateProjectPayload,
  isOwnedB2Key,
  setPresignedDownloadUrlGenerator,
  setStageAiRunner
} from '../server/routes/ledStudio.js';
import {
  LUMI_BRAND,
  LUMI_FREE_AI_CREDITS,
  LUMI_PLANS,
  LUMI_DEFAULT_PRESET_PACK,
  LUMI_TOKEN_PRICING,
  calculateLumiTokenCredits,
  signLumiLicenseToken,
  verifyLumiLicenseToken,
  signLumiStudioTicket,
  verifyLumiStudioTicket
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
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    getHeader(name) {
      return this.headers[String(name).toLowerCase()];
    },
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

test('LumiStage catalog calculates token credits at 1/2 official Gemini price and 0 credit for BYOK', () => {
  assert.equal(LUMI_BRAND.name, 'LumiStage');
  assert.equal(LUMI_BRAND.legalEntity, 'CÔNG TY TNHH MTV GROUPLIFE');
  assert.equal(LUMI_FREE_AI_CREDITS, 100);
  assert.equal(LUMI_TOKEN_PRICING.inputCreditsPerMillion, 38);
  assert.equal(LUMI_TOKEN_PRICING.outputCreditsPerMillion, 318);
  assert.equal(LUMI_TOKEN_PRICING.officialReference.discountRatio, '1/2');

  // 1,000,000 input + 1,000,000 output = 38 + 318 = 356 Credits
  const fullMillion = calculateLumiTokenCredits({ promptTokens: 1_000_000, completionTokens: 1_000_000 });
  assert.equal(fullMillion.totalCredits, 356);

  // Typical medium Stage AI call: 1,500 input + 1,500 output = 0.057 + 0.477 = 0.534 Credits
  const mediumCall = calculateLumiTokenCredits({ promptTokens: 1500, completionTokens: 1500 });
  assert.equal(mediumCall.totalCredits, 0.534);

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

    // 2000 input * 38/1M = 0.076 Cr; 2000 output * 318/1M = 0.636 Cr -> Total = 0.712 Cr (1/2 official pricing)
    // User has 0.20 freeAiCreditsRemaining -> uses 0.20 free + 0.512 from wallet balance (1800 -> 1799.488)
    const resAiWeb = makeRes();
    await postStageAi({
      user: mockUser,
      body: { prompt: 'Dựng sân khấu hội nghị 500 khách', effort: 'medium' }
    }, resAiWeb);
    assert.equal(resAiWeb.statusCode, 200);
    assert.equal(resAiWeb.body.data.billing.creditCharged, 0.712);
    assert.equal(resAiWeb.body.data.billing.usedFreeCredits, 0.2);
    assert.equal(resAiWeb.body.data.billing.usedWalletCredits, 0.512);
    assert.equal(mockUser.lumiStage.freeAiCreditsRemaining, 0);
    assert.equal(mockUser.balance, 1799.488);

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
    assert.equal(mockUser.balance, 1799.488);

    // 6. Upgrade to LumiStage Pro Monthly (1490 Credits) grants +300 bonus AI Credits
    const resPro = makeRes();
    await postCheckout({
      user: mockUser,
      body: { productId: 'lumi_pro_monthly' }
    }, resPro);
    assert.equal(resPro.statusCode, 200);
    assert.equal(resPro.body.data.subscription.proActive, true);
    assert.equal(mockUser.lumiStage.freeAiCreditsRemaining, 300);
    assert.equal(mockUser.balance, 309.488);
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

  // 2. Mongoose User schema enum includes every LUMI_PLANS key (Object.keys(LUMI_PLANS) ⊆ enum) plus legacy/short plan IDs
  const allowedPlanEnum = User.schema.path('lumiStage.plan').enumValues;
  for (const planId of [...Object.keys(LUMI_PLANS), 'free', 'pro_monthly', 'pro_quarterly', 'pro_yearly', 'show_pro_plus', 'pro_partner']) {
    assert.ok(allowedPlanEnum.includes(planId), `User.lumiStage.plan enum must include ${planId}`);
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

test('C4 & Phase 4: Curated Default Preset Pack, platform preset fallback, lumi_show_pro_plus plan, and Phase 4 telemetry events', async () => {
  assert.ok(Array.isArray(LUMI_DEFAULT_PRESET_PACK) && LUMI_DEFAULT_PRESET_PACK.length >= 6);
  assert.ok(LUMI_PLANS.lumi_show_pro_plus, 'lumi_show_pro_plus plan must exist in LUMI_PLANS');
  assert.equal(LUMI_PLANS.lumi_show_pro_plus.priceCredits, 2990);

    const u = new User({ email: 'showpro@grouplife.vn', name: 'Show Director', password: 'Password123!', lumiStage: { plan: 'lumi_show_pro_plus' } });
  assert.equal(u.validateSync(), undefined, 'User.lumiStage.plan=lumi_show_pro_plus must pass Mongoose validation');

  const origTxCreate = Transaction.create;
  Transaction.create = async () => null;
  try {
    const postCheckout = getRouteHandler('post', '/billing/checkout');
    const showProUser = {
      _id: '507f1f77bcf86cd799439088',
      email: 'showpro@grouplife.vn',
      role: 'user',
      balance: 6000,
      lumiStage: {
        plan: 'free',
        expiresAt: null,
        freeAiCreditsRemaining: 0,
        singleExportCredits: 0,
        unlockedProjectKeys: []
      },
      async save() { return this; }
    };
    const resShowPro = makeRes();
    await postCheckout({ user: showProUser, body: { productId: 'lumi_show_pro_plus' } }, resShowPro);
    assert.equal(resShowPro.statusCode, 200);
    assert.equal(showProUser.lumiStage.plan, 'lumi_show_pro_plus');
    assert.equal(showProUser.lumiStage.freeAiCreditsRemaining, 800);
    assert.equal(showProUser.balance, 3010);

    const resShortAlias = makeRes();
    await postCheckout({ user: showProUser, body: { productId: 'show_pro_plus' } }, resShortAlias);
    assert.equal(resShortAlias.statusCode, 200);
    assert.equal(showProUser.lumiStage.plan, 'lumi_show_pro_plus');
    assert.equal(showProUser.lumiStage.freeAiCreditsRemaining, 1600);
    assert.equal(showProUser.balance, 20);
  } finally {
    Transaction.create = origTxCreate;
  }

  const origFind = LedStudioPreset.find;
  const origFindOne = LedStudioPreset.findOne;
  LedStudioPreset.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) });
  LedStudioPreset.findOne = () => ({ lean: async () => null });
  try {
    const getPresetPack = getRouteHandler('get', '/presets/pack');
    const getPresets = getRouteHandler('get', '/presets');
    const getPresetById = getRouteHandler('get', '/presets/:id');
    const postTelemetry = getRouteHandler('post', '/telemetry');

    const resPack = makeRes();
    await getPresetPack({ query: {}, headers: {} }, resPack);
    assert.equal(resPack.statusCode, 200);
    assert.equal(resPack.body.data.length, LUMI_DEFAULT_PRESET_PACK.length);

    const resStagePack = makeRes();
    await getPresetPack({ query: { category: 'stage_template' }, headers: {} }, resStagePack);
    assert.equal(resStagePack.statusCode, 200);
    assert.ok(resStagePack.body.data.every(p => p.category === 'stage_template'));

    const resMerged = makeRes();
    await getPresets({ query: { includePlatform: '1' }, headers: {} }, resMerged);
    assert.equal(resMerged.statusCode, 200);
    assert.equal(resMerged.body.data.length, LUMI_DEFAULT_PRESET_PACK.length);

    const resPackItem = makeRes();
    await getPresetById({ params: { id: 'lumi_pack_stage_edm_2026' }, headers: {} }, resPackItem);
    assert.equal(resPackItem.statusCode, 200);
    assert.equal(resPackItem.body.data.preset.ownership, 'platform');
    assert.equal(resPackItem.body.data.payloadJson.templateId, 'concert');

    for (const evt of ['guide_opened', 'preview_committed', 'preview_reverted', 'dmx_bridge_started', 'live_led_output_opened', 'show_cue_triggered', 'show_lock_toggled']) {
      const resTel = makeRes();
      await postTelemetry({ body: { optIn: true, event: evt, meta: { ok: true } } }, resTel);
      assert.equal(resTel.statusCode, 200);
      assert.equal(resTel.body.recorded, true, `Telemetry event ${evt} must be accepted`);
    }
  } finally {
    LedStudioPreset.find = origFind;
    LedStudioPreset.findOne = origFindOne;
  }
});

test('Free AI credits default to 100 and share links enforce 7-day cap for fixed expiry + active Pro gate for untilPro links', async () => {
  assert.equal(LUMI_FREE_AI_CREDITS, 100);
  assert.equal(FREE_SHARE_MAX_HOURS, 168);
  assert.equal(normalizeUserLumiState({}).freeAiCreditsRemaining, 100);
  const freshUser = new User({ email: 'fresh100@grouplife.vn', name: 'Fresh User', password: 'Password123!' });
  assert.equal(freshUser.lumiStage.freeAiCreditsRemaining, 100);

  const { restore } = mockProjectStore();
  const origUserFindById = User.findById;
  const usersById = new Map();
  User.findById = (id) => {
    const found = usersById.get(String(id)) || null;
    return {
      select() {
        return { lean: async () => (found ? { ...found } : null) };
      },
      then(resolve, reject) {
        return Promise.resolve(found).then(resolve, reject);
      },
      catch(onRejected) {
        return Promise.resolve(found).catch(onRejected);
      }
    };
  };

  try {
    const postProjects = getRouteHandler('post', '/projects');
    const postShare = getRouteHandler('post', '/projects/:id/share');
    const getShare = getRouteHandler('get', '/share/:shareToken');
    const postComments = getRouteHandler('post', '/share/:shareToken/comments');

    const freeUser = {
      _id: 'user-free-share',
      role: 'user',
      lumiStage: { plan: 'free', expiresAt: null, freeAiCreditsRemaining: 50 }
    };
    const proExpiry = new Date(Date.now() + 25 * 86400_000);
    const proUser = {
      _id: 'user-pro-share',
      role: 'user',
      lumiStage: { plan: 'lumi_pro_monthly', expiresAt: proExpiry, freeAiCreditsRemaining: 350 }
    };
    usersById.set(freeUser._id, freeUser);
    usersById.set(proUser._id, proUser);

    // Create projects for Free and Pro users
    const resCreateFree = makeRes();
    await postProjects({
      user: freeUser,
      body: { title: 'Free Stage', projectJson: makeValidStagePayload('Free.glb') }
    }, resCreateFree);
    const freeProjId = resCreateFree.body.data.project._id;

    const resCreatePro = makeRes();
    await postProjects({
      user: proUser,
      body: { title: 'Pro Stage', projectJson: makeValidStagePayload('Pro.glb') }
    }, resCreatePro);
    const proProjId = resCreatePro.body.data.project._id;

    // 1. Free user requesting 720h is clamped to 168h (7 days)
    const beforeShareMs = Date.now();
    const resFreeClamp = makeRes();
    await postShare({
      user: freeUser,
      params: { id: freeProjId },
      body: { enabled: true, expiresInHours: 720 }
    }, resFreeClamp);
    assert.equal(resFreeClamp.statusCode, 200);
    assert.equal(resFreeClamp.body.data.shareUntilPro, false);
    const expMs = new Date(resFreeClamp.body.data.shareExpiresAt).getTime();
    assert.ok(expMs <= Date.now() + 168 * 3600_000 + 2000, 'Fixed share expiry must be capped at 168h');
    assert.ok(expMs >= beforeShareMs + 167 * 3600_000, 'Fixed share expiry should be ~168h');

    // 2. Free user requesting untilPro: true is rejected with 403 PRO_REQUIRED
    const resFreeUntilPro = makeRes();
    await postShare({
      user: freeUser,
      params: { id: freeProjId },
      body: { enabled: true, untilPro: true }
    }, resFreeUntilPro);
    assert.equal(resFreeUntilPro.statusCode, 403);
    assert.equal(resFreeUntilPro.body.code, 'PRO_REQUIRED');

    // 3. Pro user requesting untilPro: true succeeds and links expiry to Pro subscription
    const resProShare = makeRes();
    await postShare({
      user: proUser,
      params: { id: proProjId },
      body: { enabled: true, untilPro: true }
    }, resProShare);
    assert.equal(resProShare.statusCode, 200);
    assert.equal(resProShare.body.data.shareUntilPro, true);
    assert.equal(resProShare.body.data.shareExpiresAt, proExpiry.toISOString());
    const proShareToken = resProShare.body.data.shareToken;

    // 4. Public GET /share/:shareToken succeeds while owner is Pro
    const resGetActive = makeRes();
    await getShare({ params: { shareToken: proShareToken } }, resGetActive);
    assert.equal(resGetActive.statusCode, 200);
    assert.equal(resGetActive.body.data.shareUntilPro, true);
    assert.equal(resGetActive.body.data.shareExpiresAt, proExpiry.toISOString());

    // 5. When owner's Pro expires, GET /share and POST /comments reject with 403 SHARE_PRO_EXPIRED
    proUser.lumiStage.expiresAt = new Date(Date.now() - 60_000);
    const resGetExpired = makeRes();
    await getShare({ params: { shareToken: proShareToken } }, resGetExpired);
    assert.equal(resGetExpired.statusCode, 403);
    assert.equal(resGetExpired.body.code, 'SHARE_PRO_EXPIRED');

    const resCommentExpired = makeRes();
    await postComments({
      params: { shareToken: proShareToken },
      body: { author: 'Client', message: 'Late comment' }
    }, resCommentExpired);
    assert.equal(resCommentExpired.statusCode, 403);
    assert.equal(resCommentExpired.body.code, 'SHARE_PRO_EXPIRED');

    // 6. Renewing Pro revives the existing untilPro link without creating a new link
    const renewedExpiry = new Date(Date.now() + 30 * 86400_000);
    proUser.lumiStage.expiresAt = renewedExpiry;
    const resGetRenewed = makeRes();
    await getShare({ params: { shareToken: proShareToken } }, resGetRenewed);
    assert.equal(resGetRenewed.statusCode, 200);
    assert.equal(resGetRenewed.body.data.shareExpiresAt, renewedExpiry.toISOString());
  } finally {
    User.findById = origUserFindById;
    restore();
  }
});

test('Tier 1: signLumiStudioTicket / verifyLumiStudioTicket enforce secret, ms expiry, and deterministic cross-repo test vector', () => {
  const secret = 'test-only-lumi-ticket-secret-32b!!';
  assert.throws(() => signLumiStudioTicket({ sub: 'u1', mode: 'user', secret: '' }), /LUMI_STUDIO_TICKET_SECRET/);
  assert.equal(verifyLumiStudioTicket('abc.def', '').valid, false);

  const fixedTicket = signLumiStudioTicket({
    sub: 'user_vector_1',
    mode: 'user',
    ttlSec: 900,
    nowMs: 4102444800000, // 2100-01-01T00:00:00.000Z
    secret
  });
  const checked = verifyLumiStudioTicket(fixedTicket, secret, 4102444800000 + 1000);
  assert.equal(checked.valid, true);
  assert.equal(checked.payload.sub, 'user_vector_1');
  assert.equal(checked.payload.mode, 'user');
  assert.equal(checked.payload.exp, 4102444800000 + 900_000);

  // Expired check
  const expired = verifyLumiStudioTicket(fixedTicket, secret, 4102444800000 + 900_001);
  assert.equal(expired.valid, false);
  assert.equal(expired.reason, 'expired');

  // Tampered signature check
  const tampered = fixedTicket.slice(0, -2) + (fixedTicket.endsWith('aa') ? 'bb' : 'aa');
  assert.equal(verifyLumiStudioTicket(tampered, secret, 4102444800000).valid, false);
});

test('Tier 1: POST /session-ticket issues HttpOnly SameSite=Strict cookie for JWT or valid shareToken (with password & proxy-safe rate limit)', async () => {
  const { restore } = mockProjectStore();
  const origSecret = process.env.LUMI_STUDIO_TICKET_SECRET;
  const origUserFindById = User.findById;
  process.env.LUMI_STUDIO_TICKET_SECRET = 'test-only-lumi-ticket-secret-32b!!';

  const owner = {
    _id: 'u_owner_t1',
    role: 'student',
    lumiStage: {
      plan: 'lumi_pro_monthly',
      expiresAt: new Date(Date.now() + 10 * 86400_000),
      freeAiCreditsRemaining: 50
    }
  };
  User.findById = () => ({ select: () => ({ lean: async () => owner }) });

  try {
    const postProjects = getRouteHandler('post', '/projects');
    const postShare = getRouteHandler('post', '/projects/:id/share');
    const postTicket = getRouteHandler('post', '/session-ticket');

    // 1. Unauthenticated without shareToken -> 401, no Set-Cookie
    const resUnauth = makeRes();
    await postTicket({ headers: {}, body: {}, ip: '10.0.0.1' }, resUnauth);
    assert.equal(resUnauth.statusCode, 401);
    assert.equal(resUnauth.getHeader('set-cookie'), undefined);

    // 2. Authenticated user -> 200, Set-Cookie HttpOnly; Secure; SameSite=Strict; Path=/led-studio; Max-Age=900, no raw ticket in JSON
    const resAuth = makeRes();
    await postTicket({ user: owner, headers: {}, body: {}, ip: '10.0.0.1' }, resAuth);
    assert.equal(resAuth.statusCode, 200);
    assert.equal(resAuth.body.data.issued, true);
    assert.equal(resAuth.body.data.ticket, undefined, 'Must not echo raw ticket in JSON body');
    const cookieHeader = String(resAuth.getHeader('set-cookie') || '');
    assert.match(cookieHeader, /^lumi_studio_ticket=[^;]+;/);
    assert.match(cookieHeader, /Path=\/led-studio/);
    assert.match(cookieHeader, /Max-Age=900/);
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /Secure/);
    assert.match(cookieHeader, /SameSite=Strict/);
    const rawCookieVal = cookieHeader.split(';')[0].split('=')[1];
    assert.equal(verifyLumiStudioTicket(rawCookieVal, process.env.LUMI_STUDIO_TICKET_SECRET).valid, true);

    // 3. Invalid shareToken -> 403, no Set-Cookie
    const resBadShare = makeRes();
    await postTicket({ headers: {}, body: { shareToken: 'fake_share_token' }, ip: '10.0.0.1' }, resBadShare);
    assert.equal(resBadShare.statusCode, 403);
    assert.equal(resBadShare.getHeader('set-cookie'), undefined);

    // 4. Password-protected shareToken requires password BEFORE issuing cookie
    const resProj = makeRes();
    await postProjects({ user: owner, body: { title: 'Protected Share', projectJson: makeValidStagePayload('Sec.glb') } }, resProj);
    const projId = resProj.body.data.project._id;

    const resSharePwd = makeRes();
    await postShare({ user: owner, params: { id: projId }, body: { enabled: true, untilPro: true, password: 'vip-2026' } }, resSharePwd);
    const pwdShareToken = resSharePwd.body.data.shareToken;

    const resMissingPwd = makeRes();
    await postTicket({ headers: {}, body: { shareToken: pwdShareToken }, ip: '10.0.0.1' }, resMissingPwd);
    assert.equal(resMissingPwd.statusCode, 200);
    assert.equal(resMissingPwd.body.data.issued, false);
    assert.equal(resMissingPwd.body.data.requiresPassword, true);
    assert.equal(resMissingPwd.getHeader('set-cookie'), undefined);

    const resWrongPwd = makeRes();
    await postTicket({ headers: {}, body: { shareToken: pwdShareToken, password: 'wrong' }, ip: '10.0.0.1' }, resWrongPwd);
    assert.equal(resWrongPwd.statusCode, 401);
    assert.equal(resWrongPwd.body.code, 'INVALID_SHARE_PASSWORD');
    assert.equal(resWrongPwd.getHeader('set-cookie'), undefined);

    const resRightPwd = makeRes();
    await postTicket({ headers: {}, body: { shareToken: pwdShareToken, password: 'vip-2026' }, ip: '10.0.0.1' }, resRightPwd);
    assert.equal(resRightPwd.statusCode, 200);
    assert.equal(resRightPwd.body.data.issued, true);
    assert.match(String(resRightPwd.getHeader('set-cookie') || ''), /^lumi_studio_ticket=/);

    // 5. Expired owner Pro rejects share ticket with SHARE_PRO_EXPIRED
    owner.lumiStage.expiresAt = new Date(Date.now() - 5000);
    const resProExp = makeRes();
    await postTicket({ headers: {}, body: { shareToken: pwdShareToken, password: 'vip-2026' }, ip: '10.0.0.1' }, resProExp);
    assert.equal(resProExp.statusCode, 403);
    assert.equal(resProExp.body.code, 'SHARE_PRO_EXPIRED');
    assert.equal(resProExp.getHeader('set-cookie'), undefined);

    // 6. Proxy-safe rate limiter: exhausting user A behind shared proxy IP 10.0.0.99 does NOT block user B on same req.ip
    for (let i = 0; i < 31; i++) {
      const r = makeRes();
      await postTicket({ user: { _id: 'flood_user_a', role: 'student' }, headers: { 'x-forwarded-for': '203.0.113.10' }, body: {}, ip: '10.0.0.99' }, r);
      if (i === 30) assert.equal(r.statusCode, 429);
    }
    const resUserB = makeRes();
    await postTicket({ user: { _id: 'clean_user_b', role: 'student' }, headers: { 'x-forwarded-for': '203.0.113.11' }, body: {}, ip: '10.0.0.99' }, resUserB);
    assert.equal(resUserB.statusCode, 200, 'Second user behind same proxy req.ip must not be rate-limited');
  } finally {
    if (origSecret === undefined) delete process.env.LUMI_STUDIO_TICKET_SECRET;
    else process.env.LUMI_STUDIO_TICKET_SECRET = origSecret;
    User.findById = origUserFindById;
    restore();
  }
});

async function runRouteMiddlewareChain(method, routePath, req, res) {
  const layer = ledStudioRouter.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method.toLowerCase()]
  );
  assert.ok(layer, `Expected route ${method.toUpperCase()} ${routePath}`);
  const handlers = layer.route.stack.map((s) => s.handle);
  let idx = 0;
  const next = async (err) => {
    if (err) throw err;
    const fn = handlers[idx++];
    if (!fn) return;
    await fn(req, res, next);
  };
  await next();
}

test('Tier 3: Single-source byte parity between lumiProExporters.cjs and v18-pro-exporters-local.js', (t) => {
  const bePath = new URL('../server/utils/lumiProExporters.cjs', import.meta.url);
  const fePath = new URL('../../tools/led-stage-studio/js/modules/v18-pro-exporters-local.js', import.meta.url);
  const beBytes = fs.readFileSync(bePath);
  assert.ok(beBytes.length > 0);
  if (!fs.existsSync(fePath)) {
    t.skip('Sibling tools/led-stage-studio repo not present in standalone checkout');
    return;
  }
  const feBytes = fs.readFileSync(fePath);
  const beSha = crypto.createHash('sha256').update(beBytes).digest('hex');
  const feSha = crypto.createHash('sha256').update(feBytes).digest('hex');
  assert.equal(beSha, feSha, 'Backend lumiProExporters.cjs must remain byte-for-byte identical to tools/led-stage-studio/js/modules/v18-pro-exporters-local.js');
});

test('Tier 3: POST /exports/{dxf,mvr,gma-xml,engineering-dossier} enforce auth + active PRO, validate bounds/no-base64, and render valid artifacts', async () => {
  const origUserFindById = User.findById;
  const freeUser = {
    _id: 'u_free_t3',
    role: 'student',
    lumiStage: { plan: 'free', expiresAt: null, freeAiCreditsRemaining: 50 }
  };
  const expiredProUser = {
    _id: 'u_exp_t3',
    role: 'student',
    lumiStage: { plan: 'lumi_pro_monthly', expiresAt: new Date(Date.now() - 60_000), freeAiCreditsRemaining: 50 }
  };
  const activeProUser = {
    _id: 'u_pro_t3',
    role: 'student',
    lumiStage: { plan: 'lumi_pro_monthly', expiresAt: new Date(Date.now() + 15 * 86400_000), freeAiCreditsRemaining: 50 }
  };
  const partnerUser = {
    _id: 'u_partner_t3',
    role: 'partner',
    lumiStage: { plan: 'free', expiresAt: null, freeAiCreditsRemaining: 50 }
  };
  const usersById = new Map([
    [freeUser._id, freeUser],
    [expiredProUser._id, expiredProUser],
    [activeProUser._id, activeProUser],
    [partnerUser._id, partnerUser]
  ]);
  User.findById = (id) => Promise.resolve(usersById.get(String(id)) || null);

  const sampleSurface = {
    id: 's1',
    name: 'LED_MAIN',
    w: 1920,
    h: 1080,
    pitchMm: 3.91,
    physicalWidthM: 6,
    physicalHeightM: 3,
    cabCols: 12,
    cabRows: 6,
    pos: [0, 2.8, -2]
  };
  const sampleLight = {
    id: 'l1',
    fixId: 101,
    name: 'Beam #01',
    type: 'beam',
    oflModel: 'Robe Pointe 280W',
    dmxChannels: 16,
    dmxUniverse: 1,
    dmxAddress: 1,
    pos: [-2, 6, -1],
    target: [-2, 0, 2]
  };

  try {
    // 1. Unauthenticated -> 401 across all 4 routes
    for (const p of ['/exports/dxf', '/exports/mvr', '/exports/gma-xml', '/exports/engineering-dossier']) {
      const r = makeRes();
      await runRouteMiddlewareChain('post', p, { headers: {}, cookies: {}, body: {} }, r);
      assert.equal(r.statusCode, 401, `${p} must reject unauthenticated requests with 401`);
    }

    // 2. Free user & Expired PRO user -> 403 PRO_REQUIRED across all 4 routes
    for (const u of [freeUser, expiredProUser]) {
      for (const p of ['/exports/dxf', '/exports/mvr', '/exports/gma-xml', '/exports/engineering-dossier']) {
        const handlers = ledStudioRouter.stack.find((l) => l.route?.path === p && l.route.methods.post).route.stack.map((s) => s.handle);
        const r = makeRes();
        let idx = 1; // skip authMiddleware stub to supply pre-authenticated req.user
        const next = async () => {
          const fn = handlers[idx++];
          if (fn) await fn({ user: u, body: { surfaces: [sampleSurface], lights: [sampleLight] } }, r, next);
        };
        await next();
        assert.equal(r.statusCode, 403, `${p} must reject ${u._id} with 403`);
        assert.equal(r.body.code, 'PRO_REQUIRED');
      }
    }

    const callAsUser = async (routePath, userObj, body) => {
      const handlers = ledStudioRouter.stack.find((l) => l.route?.path === routePath && l.route.methods.post).route.stack.map((s) => s.handle);
      const r = makeRes();
      let idx = 1;
      const next = async () => {
        const fn = handlers[idx++];
        if (fn) await fn({ user: userObj, body }, r, next);
      };
      await next();
      return r;
    };

    // 3. Input bounds validation: > 128 surfaces -> 400; base64 data URI injection -> 400
    const resTooManySurfaces = await callAsUser('/exports/dxf', activeProUser, {
      surfaces: Array.from({ length: 129 }, (_, i) => ({ ...sampleSurface, id: `s_${i}` })),
      lights: [sampleLight]
    });
    assert.equal(resTooManySurfaces.statusCode, 400);

    const resBase64Blob = await callAsUser('/exports/engineering-dossier', activeProUser, {
      kind: 'quote',
      previewDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
      surfaces: [sampleSurface]
    });
    assert.equal(resBase64Blob.statusCode, 400, 'Must reject base64 image blobs on server export route');

    // 4. Active PRO user -> 200 on all 4 routes with valid CAD/MVR/GMA/HTML payloads & zero watermark
    const resDxf = await callAsUser('/exports/dxf', activeProUser, {
      stageW: 16,
      stageD: 8,
      surfaces: [sampleSurface],
      lights: [sampleLight],
      sfxUnits: [{ id: 'sfx1', type: 'cold_spark_fountain', pos: [-2, 0.8, 1.8] }]
    });
    assert.equal(resDxf.statusCode, 200);
    assert.match(resDxf.body.data.dxf, /WIRING_DATA/);
    assert.match(resDxf.body.data.dxf, /PANEL_OUTLINE/);
    assert.match(resDxf.body.data.dxf, /SAFETY_CLEARANCE/);
    assert.doesNotMatch(resDxf.body.data.dxf, /WATERMARK/, 'PRO DXF must not contain Free watermark layer');

    const resMvr = await callAsUser('/exports/mvr', activeProUser, {
      surfaces: [sampleSurface],
      lights: [sampleLight]
    });
    assert.equal(resMvr.statusCode, 200);
    const mvrBuf = Buffer.from(resMvr.body.data.zipBase64, 'base64');
    assert.equal(mvrBuf[0], 0x50);
    assert.equal(mvrBuf[1], 0x4b);
    assert.ok(mvrBuf.includes(Buffer.from('GeneralSceneDescription.xml')), 'MVR PKZIP must embed GeneralSceneDescription.xml');

    const resGma = await callAsUser('/exports/gma-xml', partnerUser, {
      version: 'ma3',
      layerName: 'Festival_Main',
      lights: [sampleLight]
    });
    assert.equal(resGma.statusCode, 200, 'Partner role must also pass PRO gate');
    assert.match(resGma.body.data.xml, /<GMA3 DataVersion="1\.9\.7\.0">/);
    assert.match(resGma.body.data.xml, /FixId="101"/);

    const resQuoteHtml = await callAsUser('/exports/engineering-dossier', activeProUser, {
      kind: 'tech',
      modelName: 'Arena_2026',
      companyProfile: { companyName: 'ALPHA PRO EVENT', clientName: 'ACME CORP' },
      quoteConfig: { clientName: 'ACME CORP', rentalDays: 2, vatMode: '10' },
      bomRows: [{ category: 'LED', name: 'ROE BP2V2', spec: '500x500', unit: 'm2', qty: 18, unitPriceVnd: 950000 }],
      summary: { stageW: 16, stageD: 8, stageAreaM2: 128, totalLedAreaM2: 18, totalPixels: 2073600 },
      surfaces: [sampleSurface],
      lights: [sampleLight],
      proposalText: 'Phương án kỹ thuật đạt chuẩn TCVN.'
    });
    assert.equal(resQuoteHtml.statusCode, 200);
    assert.match(resQuoteHtml.body.data.html, /ALPHA PRO EVENT/);
    assert.match(resQuoteHtml.body.data.html, /<!--LUMI_STAGE_PREVIEW_SLOT-->/);
    assert.doesNotMatch(resQuoteHtml.body.data.html, /LUMISTAGE FREE/);

    const resCrewHtml = await callAsUser('/exports/engineering-dossier', activeProUser, {
      kind: 'crew',
      role: 'CREW_2_LED_POWER',
      lang: 'vi',
      companyProfile: { companyName: 'ALPHA PRO EVENT', clientName: 'ACME CORP' },
      surfaces: [sampleSurface],
      lights: [sampleLight]
    });
    assert.equal(resCrewHtml.statusCode, 200);
    assert.match(resCrewHtml.body.data.html, /CREW 2: LED &amp; POWER/);

    // 5. Security regressions: reject unbounded cabCols/cabRows DoS, reject base64 past index 32, and strip summary.structureSvg XSS
    const resHugeCabGrid = await callAsUser('/exports/dxf', activeProUser, {
      surfaces: [{ ...sampleSurface, cabCols: 1_000_000, cabRows: 10 }],
      lights: [sampleLight]
    });
    assert.equal(resHugeCabGrid.statusCode, 400, 'Must reject unbounded cabCols/cabRows before O(cols*rows) loop');

    const resHugePhysical = await callAsUser('/exports/engineering-dossier', activeProUser, {
      kind: 'tech',
      surfaces: [{ id: 's_huge', physicalWidthM: 5000, physicalHeightM: 2000 }],
      lights: []
    });
    assert.equal(resHugePhysical.statusCode, 400, 'Must reject unbounded physical dimensions');

    const bomWithLateBase64 = Array.from({ length: 40 }, (_, i) => ({
      category: 'LED',
      name: i === 38 ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA' : `Item_${i}`,
      spec: '500x500',
      unit: 'm2',
      qty: 1,
      unitPriceVnd: 1000
    }));
    const resLateBase64 = await callAsUser('/exports/engineering-dossier', activeProUser, {
      kind: 'quote',
      bomRows: bomWithLateBase64,
      surfaces: [sampleSurface]
    });
    assert.equal(resLateBase64.statusCode, 400, 'Must detect base64 data URI past element 32');

    const resXssSvg = await callAsUser('/exports/engineering-dossier', activeProUser, {
      kind: 'tech',
      summary: { stageW: 16, stageD: 8, structureSvg: '<svg onload="alert(1)"><script>evil()</script></svg>' },
      surfaces: [sampleSurface],
      lights: [sampleLight]
    });
    assert.equal(resXssSvg.statusCode, 200);
    assert.doesNotMatch(resXssSvg.body.data.html, /onload=|evil\(\)/, 'Must never inject raw req.body.summary.structureSvg');
    assert.match(resXssSvg.body.data.html, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, 'Must render safe server-built SVG');

    const { computeEngineeringRider, exportLightingMvr18 } = await import('../server/utils/lumiProExporters.js');
    const clampedRider = computeEngineeringRider({
      surfaces: [{ id: 's_clamp', cabCols: 500_000, cabRows: 500_000 }],
      lights: []
    });
    assert.ok(clampedRider.totalActiveCabs <= 64 * 48, 'Direct wrapper call must also clamp cabCols/cabRows');
    const clampedMvr = exportLightingMvr18({
      lights: [{ name: 'BadDmx', dmxChannels: Infinity, dmxUniverse: -5, dmxAddress: -10 }],
      surfaces: []
    });
    assert.doesNotMatch(clampedMvr.xml, /Infinity|-\d+<\/Address>/);
  } finally {
    User.findById = origUserFindById;
  }
});

test('Security: POST /session-ticket blocks X-Forwarded-For spoofing and caps per-shareToken password failures', async () => {
  const { restore } = mockProjectStore();
  const origSecret = process.env.LUMI_STUDIO_TICKET_SECRET;
  const origUserFindById = User.findById;
  process.env.LUMI_STUDIO_TICKET_SECRET = 'test-only-lumi-ticket-secret-32b!!';

  const owner = {
    _id: 'u_owner_sec_pwd',
    role: 'student',
    lumiStage: {
      plan: 'lumi_pro_monthly',
      expiresAt: new Date(Date.now() + 10 * 86400_000),
      freeAiCreditsRemaining: 50
    }
  };
  User.findById = () => ({ select: () => ({ lean: async () => owner }) });

  try {
    const postProjects = getRouteHandler('post', '/projects');
    const postShare = getRouteHandler('post', '/projects/:id/share');
    const postTicket = getRouteHandler('post', '/session-ticket');

    const resProj = makeRes();
    await postProjects({ user: owner, body: { title: 'BruteForce Guard', projectJson: makeValidStagePayload('Guard.glb') } }, resProj);
    const projId = resProj.body.data.project._id;

    const resShare = makeRes();
    await postShare({ user: owner, params: { id: projId }, body: { enabled: true, untilPro: true, password: 'correct-horse-battery' } }, resShare);
    const shareToken = resShare.body.data.shareToken;

    let hit429 = false;
    for (let i = 0; i < 15; i++) {
      const r = makeRes();
      await postTicket(
        {
          headers: { 'x-forwarded-for': `198.51.100.${i}, 203.0.113.55` },
          body: { shareToken, password: `wrong-guess-${i}` },
          ip: '10.0.0.5'
        },
        r
      );
      if (r.statusCode === 429) {
        hit429 = true;
        break;
      }
    }
    assert.equal(hit429, true, 'Must rate-limit repeated wrong passwords on a shareToken despite spoofed leftmost X-Forwarded-For');
  } finally {
    if (origSecret === undefined) delete process.env.LUMI_STUDIO_TICKET_SECRET;
    else process.env.LUMI_STUDIO_TICKET_SECRET = origSecret;
    User.findById = origUserFindById;
    restore();
  }
});
