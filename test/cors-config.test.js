import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAllowedOrigins, buildCorsOptions } from '../server/config/cors.js';

test('CORS defaults include current production domains', () => {
    const origins = buildAllowedOrigins({});

    assert.ok(origins.includes('https://giaiphapsangtao.com'));
    assert.ok(origins.includes('https://www.giaiphapsangtao.com'));
    assert.ok(origins.includes('https://alphastudio.vercel.app'));
});

test('CORS origin env values support comma-separated lists and trailing slashes', () => {
    const origins = buildAllowedOrigins({
        FRONTEND_URL: 'https://example.com/app/',
        FRONTEND_URLS: 'https://a.example.com, https://b.example.com/',
        CORS_ORIGINS: 'https://c.example.com https://d.example.com/path'
    });

    assert.ok(origins.includes('https://example.com'));
    assert.ok(origins.includes('https://a.example.com'));
    assert.ok(origins.includes('https://b.example.com'));
    assert.ok(origins.includes('https://c.example.com'));
    assert.ok(origins.includes('https://d.example.com'));
});

test('CORS options allow production preflight origin', async () => {
    const options = buildCorsOptions({});

    const allowed = await new Promise((resolve, reject) => {
        options.origin('https://giaiphapsangtao.com', (error, result) => {
            if (error) reject(error);
            else resolve(result);
        });
    });

    assert.equal(allowed, true);
});

test('CORS options deny unknown browser origins without throwing', async () => {
    const options = buildCorsOptions({});

    const allowed = await new Promise((resolve, reject) => {
        options.origin('https://evil.example.com', (error, result) => {
            if (error) reject(error);
            else resolve(result);
        });
    });

    assert.equal(allowed, false);
});
