import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { resolveTrustProxy } from '../server/config/trustProxy.js';

test('resolveTrustProxy chooses safe hop count for Fly/production and honors TRUST_PROXY overrides', () => {
    assert.equal(resolveTrustProxy({}), false);
    assert.equal(resolveTrustProxy({ FLY_APP_NAME: 'alpha-studio-backend' }), 1);
    assert.equal(resolveTrustProxy({ NODE_ENV: 'production' }), 1);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: '2' }), 2);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: '0', FLY_APP_NAME: 'alpha-studio-backend' }), false);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'false', NODE_ENV: 'production' }), false);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'true' }), 1);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'loopback' }), 'loopback');
});

test('express-rate-limit uses client X-Forwarded-For without ERR_ERL validation errors when trust proxy is 1', async () => {
    const app = express();
    app.set('trust proxy', resolveTrustProxy({ FLY_APP_NAME: 'alpha-studio-backend' }));
    app.use('/limited', rateLimit({
        windowMs: 60_000,
        max: 1,
        standardHeaders: true,
        legacyHeaders: false
    }));
    app.get('/limited', (req, res) => {
        res.json({ ok: true, ip: req.ip });
    });

    const loggedErrors = [];
    const origConsoleError = console.error;
    const onWarning = (w) => loggedErrors.push(String(w?.code || w?.message || w));
    console.error = (...args) => {
        loggedErrors.push(args.map((a) => String(a?.code || a?.message || a)).join(' '));
        origConsoleError(...args);
    };
    process.on('warning', onWarning);

    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
        const { port } = server.address();
        const base = `http://127.0.0.1:${port}/limited`;

        const res1 = await fetch(base, { headers: { 'X-Forwarded-For': '203.0.113.10' } });
        assert.equal(res1.status, 200);
        const body1 = await res1.json();
        assert.equal(body1.ip, '203.0.113.10');

        const res2 = await fetch(base, { headers: { 'X-Forwarded-For': '203.0.113.10' } });
        assert.equal(res2.status, 429);

        const res3 = await fetch(base, { headers: { 'X-Forwarded-For': '203.0.113.11' } });
        assert.equal(res3.status, 200);
        const body3 = await res3.json();
        assert.equal(body3.ip, '203.0.113.11');

        const joined = loggedErrors.join('\n');
        assert.equal(joined.includes('ERR_ERL_UNEXPECTED_X_FORWARDED_FOR'), false);
        assert.equal(joined.includes('ERR_ERL_PERMISSIVE_TRUST_PROXY'), false);
    } finally {
        console.error = origConsoleError;
        process.off('warning', onWarning);
        await new Promise((resolve) => server.close(resolve));
    }
});
