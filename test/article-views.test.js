import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import Article from '../server/models/Article.js';
import articlesRouter from '../server/routes/articles.js';
import {
    VIEW_COOLDOWN_MS,
    viewerKey,
    shouldCountView,
} from '../server/utils/viewCooldown.js';
import {
    SERVICE_VIEWS_BACKFILL_KEY,
    extractServiceSlugFromPath,
    backfillServiceArticleViewsFromPageVisits,
} from '../server/utils/articleViews.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

function mockArticleQuery(result) {
    return {
        populate() { return this; },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    };
}

test('Article schema exposes public viewCount defaulting to 0', () => {
    const path = Article.schema.path('viewCount');
    assert.ok(path);
    assert.equal(path.options.default, 0);
    assert.equal(path.options.min, 0);
    assert.notEqual(path.options.select, false);

    const doc = new Article({ title: { vi: 'Dịch vụ 3D' }, category: 'services' });
    assert.equal(doc.viewCount, 0);
});

test('extractServiceSlugFromPath extracts /services/<slug> and ignores other paths', () => {
    assert.equal(extractServiceSlugFromPath('/services/duong-hoa-abc'), 'duong-hoa-abc');
    assert.equal(extractServiceSlugFromPath('/services/nh%C3%A0-th%C3%A1i'), 'nhà-thái');
    assert.equal(extractServiceSlugFromPath('/services'), null);
    assert.equal(extractServiceSlugFromPath('/services/'), null);
    assert.equal(extractServiceSlugFromPath('/services/a/b'), null);
    assert.equal(extractServiceSlugFromPath('/news/tin-tuc'), null);
    assert.equal(extractServiceSlugFromPath(null), null);
});

test('backfillServiceArticleViewsFromPageVisits seeds viewCount once from PageVisit', async () => {
    let settingRow = null;
    let bulkOps = null;
    let aggregatedPipeline = null;
    const session = { withTransaction: async (work) => work(), async endSession() {} };
    const mongooseClient = { startSession: async () => session };

    const FakeSystemSetting = {
        async findOneAndUpdate({ key }, update, options) {
            assert.equal(options.session, session);
            if (settingRow) return settingRow;
            settingRow = { key, value: update.$setOnInsert.value };
            return null;
        },
        async deleteOne() {
            settingRow = null;
        },
    };

    const FakePageVisit = {
        async aggregate(pipeline, options) {
            assert.equal(options.session, session);
            aggregatedPipeline = pipeline;
            return [
                { _id: '/services/duong-hoa', views: 42 },
                { _id: '/services/nha-anh-thai', views: 17 },
                { _id: '/services', views: 99 },
                { _id: '/services/empty-zero', views: 0 },
            ];
        },
    };

    const FakeArticle = {
        async bulkWrite(ops, options) {
            assert.equal(options.session, session);
            assert.equal(options.timestamps, false, 'historical views must not change article edit dates');
            bulkOps = ops;
            return { modifiedCount: ops.length };
        },
    };

    const first = await backfillServiceArticleViewsFromPageVisits({
        mongooseClient,
        ArticleModel: FakeArticle,
        PageVisitModel: FakePageVisit,
        SystemSettingModel: FakeSystemSetting,
        logger: { log() {} },
    });

    assert.deepEqual(first, { skipped: false, updated: 2 });
    assert.equal(settingRow.key, SERVICE_VIEWS_BACKFILL_KEY);
    assert.ok(aggregatedPipeline[0].$match.createdAt.$lt instanceof Date);
    assert.deepEqual(bulkOps, [
        {
            updateOne: {
                filter: { category: 'services', slug: 'duong-hoa' },
                update: { $inc: { viewCount: 42 } },
            },
        },
        {
            updateOne: {
                filter: { category: 'services', slug: 'nha-anh-thai' },
                update: { $inc: { viewCount: 17 } },
            },
        },
    ]);

    const second = await backfillServiceArticleViewsFromPageVisits({
        mongooseClient,
        ArticleModel: FakeArticle,
        PageVisitModel: FakePageVisit,
        SystemSettingModel: FakeSystemSetting,
        logger: { log() {} },
    });
    assert.deepEqual(second, { skipped: true, updated: 0 });
});

test('backfillServiceArticleViewsFromPageVisits releases marker if bulkWrite fails', async () => {
    let settingRow = null;
    const mongooseClient = {
        async startSession() {
            return {
                async withTransaction(work) {
                    try { return await work(); }
                    catch (error) { settingRow = null; throw error; }
                },
                async endSession() {},
            };
        },
    };

    const FakeSystemSetting = {
        async findOneAndUpdate({ key }, update) {
            if (settingRow) return settingRow;
            settingRow = { key, value: update.$setOnInsert.value };
            return null;
        },
        async deleteOne() {
            settingRow = null;
        },
    };

    await assert.rejects(
        backfillServiceArticleViewsFromPageVisits({
            mongooseClient,
            ArticleModel: { async bulkWrite() { throw new Error('atlas transient error'); } },
            PageVisitModel: { async aggregate() { return [{ _id: '/services/s1', views: 5 }]; } },
            SystemSettingModel: FakeSystemSetting,
            logger: { log() {} },
        }),
        /atlas transient error/
    );
    assert.equal(settingRow, null);
});

test('GET /api/articles/:slug increments viewCount only with trackView=1, non-bot UA, and cooldown', async (t) => {
    let incrementCalls = 0;
    let findOneCalls = 0;

    t.mock.method(Article, 'findOneAndUpdate', (filter, update) => {
        incrementCalls += 1;
        assert.deepEqual(filter, { slug: 'svc-cooldown-test', status: 'published', category: 'services' });
        assert.deepEqual(update, { $inc: { viewCount: 1 } });
        return mockArticleQuery({ _id: '1', slug: 'svc-cooldown-test', category: 'services', viewCount: 11 });
    });

    t.mock.method(Article, 'findOne', () => {
        findOneCalls += 1;
        return mockArticleQuery({ _id: '1', slug: 'svc-cooldown-test', category: 'services', viewCount: 11 });
    });

    const app = express().use('/api/articles', articlesRouter);
    const server = app.listen(0);
    t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}/api/articles`;

    // 1. Without trackView=1 (e.g. middleware.js): must NOT increment
    const middlewareRes = await fetch(`${base}/svc-cooldown-test`, {
        headers: { 'user-agent': BROWSER_UA, 'x-forwarded-for': '198.51.100.10' },
    });
    assert.equal(middlewareRes.status, 200);
    assert.equal(incrementCalls, 0);
    assert.equal(findOneCalls, 1);

    // 2. Bot UA with trackView=1 (e.g. HeadlessChrome prerender / Googlebot): must NOT increment
    const botRes = await fetch(`${base}/svc-cooldown-test?trackView=1`, {
        headers: { 'user-agent': 'HeadlessChrome/120.0.0.0', 'x-forwarded-for': '198.51.100.10' },
    });
    assert.equal(botRes.status, 200);
    assert.equal(incrementCalls, 0);
    assert.equal(findOneCalls, 2);

    // 3. Real browser UA with trackView=1: increments once
    const realRes = await fetch(`${base}/svc-cooldown-test?trackView=1`, {
        headers: { 'user-agent': BROWSER_UA, 'x-forwarded-for': '198.51.100.10' },
    });
    const realJson = await realRes.json();
    assert.equal(realRes.status, 200);
    assert.equal(realJson.data.viewCount, 11);
    assert.equal(incrementCalls, 1);
    assert.equal(findOneCalls, 2);

    // 4. Repeat request from same IP within cooldown: must NOT increment again
    const repeatRes = await fetch(`${base}/svc-cooldown-test?trackView=1`, {
        headers: { 'user-agent': BROWSER_UA, 'x-forwarded-for': '198.51.100.10' },
    });
    assert.equal(repeatRes.status, 200);
    assert.equal(incrementCalls, 1);
    assert.equal(findOneCalls, 3);

    // 5. Different visitor IP: increments again
    const secondVisitorRes = await fetch(`${base}/svc-cooldown-test?trackView=1`, {
        headers: { 'user-agent': BROWSER_UA, 'x-forwarded-for': '198.51.100.11' },
    });
    assert.equal(secondVisitorRes.status, 200);
    assert.equal(incrementCalls, 2);
});

test('viewCooldown helper scopes keys and enforces 6h cooldown window', () => {
    const store = new Map();
    const key = viewerKey({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } }, 'article:demo');
    assert.equal(key, '203.0.113.5:article:demo');

    const t0 = 1_700_000_000_000;
    assert.equal(shouldCountView(key, t0, store), true);
    assert.equal(shouldCountView(key, t0 + VIEW_COOLDOWN_MS - 1, store), false);
    assert.equal(shouldCountView(key, t0 + VIEW_COOLDOWN_MS, store), true);
});

test('backfill retry after a partial write adds historical views exactly once', async () => {
    let settingRow = null;
    let viewCount = 7;
    let failOnce = true;
    let sessionsEnded = 0;
    const mongooseClient = {
        async startSession() {
            const before = { settingRow, viewCount };
            return {
                async withTransaction(work) {
                    try { return await work(); }
                    catch (error) {
                        ({ settingRow, viewCount } = before);
                        throw error;
                    }
                },
                async endSession() { sessionsEnded += 1; },
            };
        },
    };
    const options = {
        mongooseClient,
        SystemSettingModel: {
            async findOneAndUpdate({ key }, update) {
                if (settingRow) return settingRow;
                settingRow = { key, value: update.$setOnInsert.value };
                return null;
            },
            async deleteOne() { settingRow = null; },
        },
        PageVisitModel: { async aggregate() { return [{ _id: '/services/retry', views: 5 }]; } },
        ArticleModel: {
            async bulkWrite(ops) {
                viewCount += ops[0].updateOne.update.$inc.viewCount;
                if (failOnce) {
                    failOnce = false;
                    throw new Error('partial bulk write');
                }
            },
        },
        logger: { log() {} },
    };
    await assert.rejects(backfillServiceArticleViewsFromPageVisits(options), /partial bulk write/);
    await backfillServiceArticleViewsFromPageVisits(options);
    assert.equal(viewCount, 12, 'a retry must preserve live views and add history only once');
    await backfillServiceArticleViewsFromPageVisits(options);
    assert.equal(viewCount, 12);
    assert.equal(sessionsEnded, 3);
});

test('tracking a view preserves the article edit timestamp', async (t) => {
    let writtenUpdate;
    t.mock.method(Article.collection, 'findOneAndUpdate', async (_filter, update) => {
        writtenUpdate = update;
        return null;
    });
    t.mock.method(Article, 'findOne', () => mockArticleQuery({ slug: 'timestamp-test' }));
    const handler = articlesRouter.stack.find(layer => layer.route?.path === '/:slug').route.stack[0].handle;
    const res = { json() {}, status() { return this; } };
    await handler({
        params: { slug: 'timestamp-test' },
        query: { trackView: '1' },
        headers: { 'user-agent': BROWSER_UA },
        ip: '198.51.100.80',
    }, res);
    assert.ok(writtenUpdate);
    assert.equal(Object.hasOwn(writtenUpdate.$set || {}, 'updatedAt'), false);
    assert.equal(Object.hasOwn(writtenUpdate.$setOnInsert || {}, 'createdAt'), false);
});
