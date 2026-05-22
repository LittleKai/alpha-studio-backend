import test from 'node:test';
import assert from 'node:assert/strict';
import moduleAdd from '../module-add.js';
import templateCreate from '../template-create.js';
import modelCommit from '../model-commit.js';
import modelAbort from '../model-abort.js';

test('module.add validates and adds a module', async () => {
    const ctx = { draftModel: { width: 100, height: 200, depth: 60, runs: [{ id: 'main', origin: { x: 0, z: 0 }, direction: 'east', modules: [] }] } };
    assert.equal(moduleAdd.validateArgs({ runId: 'main', x: 0, y: 0, z: 0, tpl: 'base-cabinet-2door' }).valid, true);
    assert.equal(moduleAdd.validateArgs({ runId: 'main', x: 0, y: 0, z: 0 }).valid, false);
    const result = await moduleAdd.handler({ runId: 'main', x: 0, y: 0, z: 0, tpl: 'base-cabinet-2door' }, ctx);
    assert.equal(result.ok, true);
    assert.equal(ctx.draftModel.runs[0].modules.length, 1);
    assert.equal(result.data.module.width, 80);
    assert.equal(result.data.module.height, 86);
    assert.equal(result.data.module.depth, 60);
});

test('module.add preserves supplied dimensions and fills missing template defaults', async () => {
    const ctx = { draftModel: { width: 500, height: 260, depth: 60, runs: [{ id: 'main', origin: { x: 0, z: 0 }, direction: 'east', modules: [] }] } };
    const result = await moduleAdd.handler({ runId: 'main', x: 0, y: 145, z: 25, width: 100, height: 95, tpl: 'wall-cabinet-2door' }, ctx);
    assert.equal(result.ok, true);
    assert.equal(result.data.module.width, 100);
    assert.equal(result.data.module.height, 95);
    assert.equal(result.data.module.depth, 35);
});

test('template.create stores valid DSL and rejects bad DSL', async () => {
    const ctx = { draftModel: { inlineTemplates: {} } };
    const bad = await templateCreate.handler({ id: 'bad-template', category: 'base-cabinet', params: {}, frontSvg: 'bad' }, ctx);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /SVG view fields no longer supported/);
    const good = await templateCreate.handler({
        id: 'good-template',
        category: 'base-cabinet',
        params: {},
        boxes: [{ x: 0, y: 0, z: 0, w: 1, h: 1, d: 1, faces: { front: '$woodFront' } }]
    }, ctx);
    assert.equal(good.ok, true);
    assert.ok(ctx.draftModel.inlineTemplates['good-template']);
    assert.deepEqual(ctx.draftModel.inlineTemplates['good-template'].boxes, [{ x: 0, y: 0, z: 0, w: 1, h: 1, d: 1, faces: { front: '$woodFront' } }]);
});

test('model.commit pushes valid version and rejects invalid model', async () => {
    const project = {
        currentVersionIndex: 0,
        versions: [{ index: 0, modelJson: {} }],
        async save() { this.saved = true; }
    };
    const validCtx = {
        project,
        userPrompt: 'make it',
        draftModel: { width: 100, height: 200, depth: 60, runs: [{ id: 'main', origin: { x: 0, z: 0 }, direction: 'east', modules: [{ id: 'm1', tpl: 'base-cabinet-2door', x: 0, y: 0, z: 0 }] }] }
    };
    const result = await modelCommit.handler({ reply: 'done' }, validCtx);
    assert.equal(result.ok, true);
    assert.equal(project.currentVersionIndex, 1);
    assert.equal(project.versions[1].modelJson.runs[0].modules[0].width, 80);
    assert.equal(project.versions[1].modelJson.runs[0].modules[0].height, 86);
    assert.equal(project.versions[1].modelJson.runs[0].modules[0].depth, 60);
    const invalid = await modelCommit.handler({ reply: 'bad' }, { project, draftModel: { width: 0 } });
    assert.equal(invalid.ok, false);
});

test('model.commit runs beforeCommit gate before saving', async () => {
    const project = {
        currentVersionIndex: 0,
        versions: [{ index: 0, modelJson: {} }],
        async save() { this.saved = true; }
    };
    const ctx = {
        project,
        draftModel: { width: 100, height: 200, depth: 60, runs: [{ id: 'main', origin: { x: 0, z: 0 }, direction: 'east', modules: [{ id: 'm1', tpl: 'base-cabinet-2door', x: 0, y: 0, z: 0 }] }] },
        beforeCommit: async () => ({ ok: false, error: 'no credit' })
    };
    const result = await modelCommit.handler({ reply: 'done' }, ctx);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'no credit');
    assert.equal(project.currentVersionIndex, 0);
    assert.equal(project.saved, undefined);
});

test('model.abort returns aborted data', async () => {
    const result = await modelAbort.handler({ reason: 'need more info' }, {});
    assert.equal(result.ok, true);
    assert.equal(result.data.aborted, true);
});
