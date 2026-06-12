import test from 'node:test';
import assert from 'node:assert/strict';
import { scanDocument } from '../server/migrations/m0/scan.js';
import { applyMigrationAction, runMigrationActions } from '../server/migrations/m0/apply.js';

const fieldDefinitions = [
    { collection: 'users', field: 'avatar', filenameHint: 'avatar' },
    { collection: 'users', field: 'attachments.*.data', filenameHint: 'attachment' }
];

test('scanner finds nested data URLs and Buffer fields', () => {
    const document = {
        _id: 'user-1',
        avatar: 'data:image/png;base64,aGVsbG8=',
        attachments: [{ data: Buffer.from('file') }]
    };
    const actions = scanDocument({
        collection: 'users',
        document,
        fieldDefinitions
    });

    assert.equal(actions.length, 2);
    assert.deepEqual(actions.map((action) => action.fieldPath), ['avatar', 'attachments.0.data']);
    assert.equal(actions[0].mimeType, 'image/png');
    assert.equal(actions[0].byteSize, 5);
    assert.equal(actions[0].checksum.length, 64);
    assert.match(actions[0].key, /migrations\/mongodb-m0\/users\/user-1\/avatar-/);
    assert.equal(actions[1].mimeType, 'application/octet-stream');
});

test('dry-run plans actions without uploads or MongoDB updates', async () => {
    const calls = [];
    const action = scanDocument({
        collection: 'users',
        document: { _id: 'user-1', avatar: 'data:text/plain;base64,aGVsbG8=' },
        fieldDefinitions
    })[0];

    const result = await runMigrationActions({
        actions: [action],
        apply: false,
        storage: { put: async () => calls.push('put') },
        getCollection: () => ({ updateOne: async () => calls.push('update') })
    });

    assert.equal(result.planned, 1);
    assert.equal(result.applied, 0);
    assert.deepEqual(calls, []);
});

test('scanner skips URL metadata after a successful migration', () => {
    const actions = scanDocument({
        collection: 'users',
        document: { _id: 'user-1', avatar: 'https://cdn.example/avatar.png' },
        fieldDefinitions
    });
    assert.deepEqual(actions, []);
});

test('apply uploads, verifies, conditionally updates, and writes one manifest entry', async () => {
    const objects = new Map();
    const manifest = [];
    let currentValue = 'data:text/plain;base64,aGVsbG8=';
    const action = scanDocument({
        collection: 'users',
        document: { _id: 'user-1', avatar: currentValue },
        fieldDefinitions
    })[0];
    const collection = {
        updateOne: async (filter, update) => {
            assert.equal(filter.avatar, currentValue);
            currentValue = update.$set.avatar;
            return { matchedCount: 1, modifiedCount: 1 };
        }
    };
    const storage = {
        put: async ({ key, body }) => {
            objects.set(key, Buffer.from(body));
            return {
                provider: 'local',
                key,
                url: `http://files/${key}`,
                checksum: action.checksum,
                size: body.byteLength
            };
        },
        exists: async (key) => objects.has(key),
        get: async (key) => objects.get(key)
    };

    const result = await applyMigrationAction({
        action,
        collection,
        storage,
        appendManifest: async (entry) => manifest.push(entry)
    });

    assert.equal(result.status, 'applied');
    assert.equal(currentValue, `http://files/${action.key}`);
    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].beforeValue, action.beforeValue);
    assert.equal(manifest[0].object.migrationOwned, true);
});

test('upload failure leaves MongoDB unchanged', async () => {
    let updates = 0;
    const action = scanDocument({
        collection: 'users',
        document: { _id: 'user-1', avatar: 'data:text/plain;base64,aGVsbG8=' },
        fieldDefinitions
    })[0];

    await assert.rejects(() => applyMigrationAction({
        action,
        collection: { updateOne: async () => { updates += 1; } },
        storage: { put: async () => { throw new Error('upload failed'); } },
        appendManifest: async () => {}
    }), /upload failed/);
    assert.equal(updates, 0);
});

test('conditional update conflicts leave uploaded object for rollback cleanup', async () => {
    let deletes = 0;
    const manifest = [];
    const action = scanDocument({
        collection: 'users',
        document: { _id: 'user-1', avatar: 'data:text/plain;base64,aGVsbG8=' },
        fieldDefinitions
    })[0];
    const body = Buffer.from('hello');

    const result = await applyMigrationAction({
        action,
        collection: { updateOne: async () => ({ matchedCount: 0, modifiedCount: 0 }) },
        storage: {
            put: async () => ({
                provider: 'local',
                key: action.key,
                url: `http://files/${action.key}`,
                checksum: action.checksum,
                size: body.byteLength
            }),
            exists: async () => true,
            get: async () => body,
            delete: async () => { deletes += 1; }
        },
        appendManifest: async (entry) => manifest.push(entry)
    });

    assert.equal(result.status, 'conflict');
    assert.equal(deletes, 0);
    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].status, 'conflict');
});
