import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createDatabaseLifecycle,
    shutdown
} from '../server/db/lifecycle.js';

test('deduplicates concurrent connect calls', async () => {
    let calls = 0;
    const fakeMongoose = {
        connection: { readyState: 0 },
        connect: async () => {
            calls += 1;
            await new Promise((resolve) => setTimeout(resolve, 5));
            fakeMongoose.connection.readyState = 1;
        },
        disconnect: async () => {
            fakeMongoose.connection.readyState = 0;
        }
    };
    const lifecycle = createDatabaseLifecycle({
        mongoose: fakeMongoose,
        uri: 'mongodb://test',
        options: {}
    });

    await Promise.all([lifecycle.connect(), lifecycle.connect()]);
    assert.equal(calls, 1);
    assert.equal(lifecycle.isReady(), true);
});

test('allows retry after a failed connection', async () => {
    let calls = 0;
    const fakeMongoose = {
        connection: { readyState: 0 },
        connect: async () => {
            calls += 1;
            if (calls === 1) throw new Error('temporary');
            fakeMongoose.connection.readyState = 1;
        },
        disconnect: async () => {}
    };
    const lifecycle = createDatabaseLifecycle({
        mongoose: fakeMongoose,
        uri: 'mongodb://test',
        options: {}
    });

    await assert.rejects(() => lifecycle.connect(), /temporary/);
    await lifecycle.connect();
    assert.equal(calls, 2);
});

test('shutdown closes HTTP server before MongoDB', async () => {
    const order = [];
    await shutdown({
        server: {
            close: (done) => {
                order.push('http');
                done();
            }
        },
        disconnect: async () => order.push('mongo')
    });
    assert.deepEqual(order, ['http', 'mongo']);
});
