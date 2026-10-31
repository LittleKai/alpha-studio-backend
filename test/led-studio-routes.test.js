import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import LedStudioProject from '../server/models/LedStudioProject.js';
import LedStudioPreset from '../server/models/LedStudioPreset.js';
import ledStudioRouter, {
  hashShareToken,
  validateShareAccess,
  sanitizeStageSummary,
  validateProjectPayload,
  isOwnedB2Key
} from '../server/routes/ledStudio.js';

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

test('POST/PUT/GET/DELETE /projects enforce B2 key ownership (C1), reject empty payloads (C2), and support save -> update -> reopen -> share round-trip (I2, I7)', async () => {
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
    LedStudioProject.create = origCreate;
    LedStudioProject.findOne = origFindOne;
    LedStudioProject.find = origFind;
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
