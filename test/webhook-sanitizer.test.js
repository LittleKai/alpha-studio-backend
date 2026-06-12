import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeWebhook } from '../server/utils/webhookSanitizer.js';

test('redacts secrets and keeps required transaction metadata', () => {
    const result = sanitizeWebhook({
        headers: {
            authorization: 'Bearer secret',
            cookie: 'x=1',
            'secure-token': 'secret',
            'user-agent': 'Casso'
        },
        payload: {
            data: {
                reference: 'BANK1',
                amount: 100000,
                description: 'ALPHAABC123'
            },
            huge: 'x'.repeat(50_000)
        }
    });

    assert.equal(result.headers.authorization, '[REDACTED]');
    assert.equal(result.headers.cookie, '[REDACTED]');
    assert.equal(result.headers['secure-token'], '[REDACTED]');
    assert.equal(result.headers['user-agent'], 'Casso');
    assert.equal(result.payload.data.reference, 'BANK1');
    assert.ok(JSON.stringify(result.payload).length < 20_000);
});

test('bounds arrays, depth, and error-like strings', () => {
    const result = sanitizeWebhook({
        headers: {},
        payload: {
            items: Array.from({ length: 500 }, (_, index) => ({ index })),
            nested: { a: { b: { c: { d: { e: 'too deep' } } } } },
            password: 'never-store-this'
        }
    });

    assert.ok(result.payload.items.length <= 100);
    assert.equal(result.payload.password, '[REDACTED]');
    assert.match(JSON.stringify(result.payload.nested), /\[TRUNCATED\]/);
});
