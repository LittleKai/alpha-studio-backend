import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStorageAdapter } from '../server/storage/localStorageAdapter.js';
import { B2StorageAdapter } from '../server/storage/b2StorageAdapter.js';

test('local adapter uploads, verifies, resolves, and deletes bytes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'alpha-storage-'));
    const adapter = new LocalStorageAdapter({
        root,
        publicBaseUrl: 'http://localhost/files'
    });

    const result = await adapter.put({
        key: 'migration/test.txt',
        body: Buffer.from('hello'),
        contentType: 'text/plain',
        filename: 'test.txt'
    });

    assert.equal(result.provider, 'local');
    assert.equal(result.url, 'http://localhost/files/migration/test.txt');
    assert.equal(result.checksum.length, 64);
    assert.equal(await adapter.exists(result.key), true);
    assert.equal((await adapter.get(result.key)).toString(), 'hello');
    assert.equal(await readFile(path.join(root, result.key), 'utf8'), 'hello');

    await adapter.delete(result.key);
    assert.equal(await adapter.exists(result.key), false);
    await rm(root, { recursive: true, force: true });
});

test('local adapter rejects keys outside its root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'alpha-storage-'));
    const adapter = new LocalStorageAdapter({
        root,
        publicBaseUrl: 'http://localhost/files'
    });

    await assert.rejects(() => adapter.put({
        key: '../escape.txt',
        body: Buffer.from('no'),
        contentType: 'text/plain',
        filename: 'escape.txt'
    }), /storage root/);

    await rm(root, { recursive: true, force: true });
});

test('B2 adapter delegates to injected object operations', async () => {
    const calls = [];
    const adapter = new B2StorageAdapter({
        putObject: async (input) => {
            calls.push(['put', input]);
            return { key: input.key, publicUrl: `https://cdn/${input.key}` };
        },
        headObject: async (key) => ({
            exists: key === 'a.txt',
            size: 5,
            contentType: 'text/plain'
        }),
        getObject: async () => Buffer.from('hello'),
        deleteObject: async (key) => calls.push(['delete', key])
    });

    const result = await adapter.put({
        key: 'a.txt',
        body: Buffer.from('hello'),
        contentType: 'text/plain',
        filename: 'a.txt'
    });

    assert.equal(result.provider, 'b2');
    assert.equal(result.url, 'https://cdn/a.txt');
    assert.equal(result.checksum.length, 64);
    assert.equal(await adapter.exists('a.txt'), true);
    assert.equal((await adapter.get('a.txt')).toString(), 'hello');

    await adapter.delete('a.txt');
    assert.equal(calls.at(-1)[0], 'delete');
});
