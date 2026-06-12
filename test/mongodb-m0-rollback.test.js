import test from 'node:test';
import assert from 'node:assert/strict';
import { rollbackManifestEntries } from '../server/migrations/m0/rollback.js';

function entry(overrides = {}) {
    return {
        migration: 'mongodb-m0-v1',
        collection: 'users',
        documentId: 'user-1',
        fieldPath: 'avatar',
        beforeValue: 'data:text/plain;base64,aGVsbG8=',
        afterValue: 'https://cdn/avatar.txt',
        object: {
            provider: 'local',
            key: 'avatar.txt',
            url: 'https://cdn/avatar.txt',
            checksum: 'checksum',
            size: 5,
            migrationOwned: true
        },
        status: 'applied',
        ...overrides
    };
}

test('rollback processes entries in reverse and requires the migrated value', async () => {
    const calls = [];
    const entries = [
        entry({ fieldPath: 'avatar', afterValue: 'https://cdn/avatar.txt' }),
        entry({ fieldPath: 'backgroundImage', afterValue: 'https://cdn/background.txt' })
    ];

    const summary = await rollbackManifestEntries({
        entries,
        apply: true,
        getCollection: () => ({
            updateOne: async (filter, update) => {
                calls.push(['update', filter, update]);
                return { matchedCount: 1, modifiedCount: 1 };
            }
        }),
        storage: { delete: async (key) => calls.push(['delete', key]) },
        appendResult: async () => {}
    });

    assert.equal(summary.restored, 2);
    assert.deepEqual(calls.filter(([type]) => type === 'update').map(([, filter]) => (
        Object.keys(filter).find((key) => key !== '_id')
    )), ['backgroundImage', 'avatar']);
    assert.equal(calls[0][1].backgroundImage, 'https://cdn/background.txt');
    assert.equal(calls[1][0], 'delete');
});

test('dry-run performs no database or storage writes', async () => {
    const calls = [];
    const summary = await rollbackManifestEntries({
        entries: [entry()],
        apply: false,
        getCollection: () => ({ updateOne: async () => calls.push('update') }),
        storage: { delete: async () => calls.push('delete') }
    });

    assert.equal(summary.planned, 1);
    assert.deepEqual(calls, []);
});

test('rollback conflict leaves database and object unchanged', async () => {
    let deletes = 0;
    const results = [];
    const summary = await rollbackManifestEntries({
        entries: [entry()],
        apply: true,
        getCollection: () => ({
            updateOne: async () => ({ matchedCount: 0, modifiedCount: 0 })
        }),
        storage: { delete: async () => { deletes += 1; } },
        appendResult: async (result) => results.push(result)
    });

    assert.equal(summary.conflicts, 1);
    assert.equal(deletes, 0);
    assert.equal(results[0].status, 'conflict');
});

test('rollback never deletes objects not owned by the migration', async () => {
    let deletes = 0;
    const summary = await rollbackManifestEntries({
        entries: [entry({ object: { key: 'shared.txt', migrationOwned: false } })],
        apply: true,
        getCollection: () => ({
            updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 })
        }),
        storage: { delete: async () => { deletes += 1; } },
        appendResult: async () => {}
    });

    assert.equal(summary.restored, 1);
    assert.equal(deletes, 0);
});

test('rollback cleans migration-owned uploads from apply conflicts', async () => {
    const deleted = [];
    let updates = 0;
    const results = [];
    const summary = await rollbackManifestEntries({
        entries: [entry({ status: 'conflict' })],
        apply: true,
        getCollection: () => ({
            updateOne: async () => { updates += 1; }
        }),
        storage: { delete: async (key) => deleted.push(key) },
        appendResult: async (result) => results.push(result)
    });

    assert.equal(summary.cleaned, 1);
    assert.equal(updates, 0);
    assert.deepEqual(deleted, ['avatar.txt']);
    assert.equal(results[0].status, 'cleaned-conflict-object');
});
