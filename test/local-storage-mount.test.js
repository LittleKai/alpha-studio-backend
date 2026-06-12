import test from 'node:test';
import assert from 'node:assert/strict';
import { localStorageMount } from '../server/storage/localStorageMount.js';

test('mounts local storage only for the local provider', () => {
    assert.deepEqual(localStorageMount({
        STORAGE_PROVIDER: 'local',
        LOCAL_STORAGE_ROOT: './tmp/files'
    }), {
        route: '/storage',
        root: './tmp/files'
    });
    assert.equal(localStorageMount({ STORAGE_PROVIDER: 'b2' }), null);
});
