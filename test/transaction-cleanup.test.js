import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildExpiredPendingTransactionQuery,
    purgeExpiredPendingTransactions
} from '../server/utils/transactionCleanup.js';

test('buildExpiredPendingTransactionQuery constructs exact query for 30 minute cutoff', () => {
    const fixedNow = new Date('2026-08-31T12:00:00.000Z');
    const query = buildExpiredPendingTransactionQuery({ now: fixedNow, olderThanMinutes: 30 });

    assert.equal(query.status, 'pending');
    assert.equal(Array.isArray(query.$or), true);
    assert.equal(query.$or.length, 2);

    // Check expiresAt clause
    assert.deepEqual(query.$or[0], {
        expiresAt: { $ne: null, $lte: fixedNow }
    });

    // Check createdAt clause (30 minutes before 12:00:00 is 11:30:00)
    const expectedCutoff = new Date('2026-08-31T11:30:00.000Z');
    assert.deepEqual(query.$or[1], {
        createdAt: { $lte: expectedCutoff }
    });
});

test('buildExpiredPendingTransactionQuery supports custom duration', () => {
    const fixedNow = new Date('2026-08-31T12:00:00.000Z');
    const query = buildExpiredPendingTransactionQuery({ now: fixedNow, olderThanMinutes: 15 });

    const expectedCutoff = new Date('2026-08-31T11:45:00.000Z');
    assert.deepEqual(query.$or[1], {
        createdAt: { $lte: expectedCutoff }
    });
});

test('purgeExpiredPendingTransactions calls deleteMany with generated query', async () => {
    const fixedNow = new Date('2026-08-31T12:00:00.000Z');
    let capturedQuery = null;

    const mockModel = {
        deleteMany: async (query) => {
            capturedQuery = query;
            return { deletedCount: 5 };
        }
    };

    const result = await purgeExpiredPendingTransactions({
        TransactionModel: mockModel,
        now: fixedNow,
        olderThanMinutes: 30
    });

    assert.equal(result.deletedCount, 5);
    assert.equal(capturedQuery.status, 'pending');
    assert.equal(capturedQuery.$or.length, 2);
});
