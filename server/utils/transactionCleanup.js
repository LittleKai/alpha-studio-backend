import Transaction from '../models/Transaction.js';

/**
 * Builds the MongoDB query to identify expired pending transactions.
 * Transactions with status 'pending' that have either:
 * - An explicit expiresAt date in the past
 * - A createdAt timestamp older than the cutoff (default: 30 minutes)
 *
 * @param {Object} [options]
 * @param {Date} [options.now=new Date()]
 * @param {number} [options.olderThanMinutes=30]
 * @returns {Object} MongoDB query object
 */
export function buildExpiredPendingTransactionQuery(options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const minutes = typeof options.olderThanMinutes === 'number' ? options.olderThanMinutes : 30;
    const cutoffDate = new Date(now.getTime() - minutes * 60 * 1000);

    return {
        status: 'pending',
        $or: [
            { expiresAt: { $ne: null, $lte: now } },
            { createdAt: { $lte: cutoffDate } }
        ]
    };
}

/**
 * Permanently deletes expired pending transactions from MongoDB.
 *
 * @param {Object} [options]
 * @param {Object} [options.TransactionModel=Transaction]
 * @param {Date} [options.now=new Date()]
 * @param {number} [options.olderThanMinutes=30]
 * @returns {Promise<{ deletedCount?: number }>}
 */
export async function purgeExpiredPendingTransactions(options = {}) {
    const TransactionModel = options.TransactionModel || Transaction;
    const query = buildExpiredPendingTransactionQuery(options);
    return await TransactionModel.deleteMany(query);
}
