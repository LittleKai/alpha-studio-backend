import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCollection } from '../server/migrations/m0/audit.js';
import { findRedundantIndexes } from '../server/migrations/m0/indexPlan.js';

test('classifies known, retained, archive, empty unknown, and overlapping collections', () => {
    assert.equal(classifyCollection({ name: 'users', documentCount: 10 }).classification, 'keep');
    assert.equal(classifyCollection({ name: 'webhooklogs', documentCount: 10 }).classification, 'keep-with-retention');
    assert.equal(classifyCollection({ name: 'interior_version_archives', documentCount: 10 }).classification, 'archive');
    assert.equal(classifyCollection({ name: 'mystery_empty', documentCount: 0 }).classification, 'remove-candidate');
    assert.equal(classifyCollection({ name: 'crmcustomers', documentCount: 10 }).classification, 'merge-candidate');
});

test('detects exact and safe prefix index redundancy', () => {
    const redundant = findRedundantIndexes([
        { name: '_id_', key: { _id: 1 } },
        { name: 'user_1', key: { userId: 1 } },
        { name: 'user_created', key: { userId: 1, createdAt: -1 } },
        { name: 'duplicate_a', key: { status: 1 } },
        { name: 'duplicate_b', key: { status: 1 } }
    ]);

    assert.deepEqual(redundant.map((item) => item.name).sort(), ['duplicate_b', 'user_1']);
});

test('never infers protected indexes as redundant prefixes', () => {
    const redundant = findRedundantIndexes([
        { name: 'unique_email', key: { email: 1 }, unique: true },
        { name: 'email_created', key: { email: 1, createdAt: -1 } },
        { name: 'partial_status', key: { status: 1 }, partialFilterExpression: { active: true } },
        { name: 'status_created', key: { status: 1, createdAt: -1 } },
        { name: 'ttl_created', key: { createdAt: 1 }, expireAfterSeconds: 60 },
        { name: 'created_status', key: { createdAt: 1, status: 1 } },
        { name: 'sparse_key', key: { key: 1 }, sparse: true },
        { name: 'key_created', key: { key: 1, createdAt: -1 } },
        { name: 'text_search', key: { _fts: 'text', _ftsx: 1 }, weights: { content: 1 } }
    ]);

    assert.deepEqual(redundant, []);
});
