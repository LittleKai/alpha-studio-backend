import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMongoOptions } from '../server/config/database.js';

test('uses Atlas M0-friendly pool defaults', () => {
    assert.deepEqual(buildMongoOptions({}), {
        maxPoolSize: 5,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        maxIdleTimeMS: 60000
    });
});

test('accepts explicit pool settings', () => {
    assert.deepEqual(buildMongoOptions({
        MONGODB_MAX_POOL_SIZE: '4',
        MONGODB_MIN_POOL_SIZE: '1',
        MONGODB_SERVER_SELECTION_TIMEOUT_MS: '6000',
        MONGODB_SOCKET_TIMEOUT_MS: '30000',
        MONGODB_MAX_IDLE_TIME_MS: '45000'
    }), {
        maxPoolSize: 4,
        minPoolSize: 1,
        serverSelectionTimeoutMS: 6000,
        socketTimeoutMS: 30000,
        maxIdleTimeMS: 45000
    });
});

test('rejects a minimum pool larger than maximum pool', () => {
    assert.throws(
        () => buildMongoOptions({
            MONGODB_MAX_POOL_SIZE: '2',
            MONGODB_MIN_POOL_SIZE: '3'
        }),
        /MONGODB_MIN_POOL_SIZE/
    );
});
