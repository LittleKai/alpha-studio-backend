import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import WebhookLog from '../models/WebhookLog.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// All routes require admin authentication
router.use(authMiddleware);
router.use(adminOnly);

/**
 * GET /api/admin/users
 * Get all users with pagination and search
 */
router.get('/users', async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '', role } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const query = {};

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        if (role) {
            query.role = role;
        }

        const [users, total] = await Promise.all([
            User.find(query)
                .select('-password')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            User.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: users,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Admin get users error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

/**
 * GET /api/admin/users/:id
 * Get user details by ID
 */
router.get('/users/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Get user's transaction summary
        const [totalTopup, totalSpent, transactionCount] = await Promise.all([
            Transaction.aggregate([
                { $match: { userId: user._id, type: { $in: ['topup', 'manual_topup'] }, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$credits' } } }
            ]),
            Transaction.aggregate([
                { $match: { userId: user._id, type: 'spend', status: 'completed' } },
                { $group: { _id: null, total: { $sum: { $abs: '$credits' } } } }
            ]),
            Transaction.countDocuments({ userId: user._id })
        ]);

        res.json({
            success: true,
            data: {
                user,
                stats: {
                    totalTopup: totalTopup[0]?.total || 0,
                    totalSpent: totalSpent[0]?.total || 0,
                    transactionCount
                }
            }
        });
    } catch (error) {
        console.error('Admin get user error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

/**
 * GET /api/admin/users/:id/transactions
 * Get user's transaction history
 */
router.get('/users/:id/transactions', async (req, res) => {
    try {
        const { page = 1, limit = 20, type, status } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const query = { userId: req.params.id };
        if (type) query.type = type;
        if (status) query.status = status;

        const [transactions, total] = await Promise.all([
            Transaction.find(query)
                .populate('processedBy', 'name email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Transaction.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: transactions,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Admin get user transactions error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

/**
 * POST /api/admin/users/:id/topup
 * Manual top-up for a user
 */
router.post('/users/:id/topup', async (req, res) => {
    try {
        const { credits, note } = req.body;
        const userId = req.params.id;

        if (!credits || credits <= 0) {
            return res.status(400).json({ success: false, message: 'Số credits không hợp lệ' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Generate transaction code
        const transactionCode = `MANUAL${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

        // Create transaction record
        const transaction = new Transaction({
            userId: user._id,
            type: 'manual_topup',
            amount: 0, // No money amount for manual topup
            credits: credits,
            status: 'completed',
            transactionCode,
            paymentMethod: 'manual',
            description: `Admin top-up: ${note || 'No note'}`,
            processedBy: req.user._id,
            adminNote: note || null,
            processedAt: new Date()
        });

        await transaction.save();

        // Update user balance
        user.balance = (user.balance || 0) + credits;
        await user.save();

        res.json({
            success: true,
            message: `Đã cộng ${credits} credits cho ${user.name}`,
            data: {
                transaction,
                newBalance: user.balance
            }
        });
    } catch (error) {
        console.error('Admin manual topup error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

/**
 * GET /api/admin/transactions
 * Get all transactions with filters
 */
router.get('/transactions', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            type,
            status,
            serviceType,
            userId,
            dateFrom,
            dateTo,
            search
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const query = {};

        if (type) query.type = type;
        if (status) query.status = status;
        if (serviceType) query.serviceType = serviceType;
        if (userId) query.userId = userId;

        if (search) {
            query.$or = [
                { transactionCode: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        if (dateFrom || dateTo) {
            query.createdAt = {};
            if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
            if (dateTo) query.createdAt.$lte = new Date(dateTo);
        }

        const [transactions, total, stats] = await Promise.all([
            Transaction.find(query)
                .populate('userId', 'name email')
                .populate('processedBy', 'name email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Transaction.countDocuments(query),
            Transaction.aggregate([
                { $match: query },
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                        totalCredits: { $sum: '$credits' },
                        totalAmount: { $sum: '$amount' }
                    }
                }
            ])
        ]);

        res.json({
            success: true,
            data: transactions,
            stats,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Admin get transactions error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

/**
 * POST /api/admin/transactions/:id/process
 * Manually process a pending transaction
 */
router.post('/transactions/:id/process', async (req, res) => {
    try {
        const { action, note } = req.body; // action: 'approve' or 'reject'

        const transaction = await Transaction.findById(req.params.id);
        if (!transaction) {
            return res.status(404).json({ success: false, message: 'Transaction not found' });
        }

        if (transaction.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Transaction is not pending' });
        }

        if (action === 'approve') {
            // Update transaction
            transaction.status = 'completed';
            transaction.processedBy = req.user._id;
            transaction.adminNote = note || 'Approved by admin';
            transaction.processedAt = new Date();
            await transaction.save();

            // Add credits to user
            if (transaction.userId) {
                await User.findByIdAndUpdate(transaction.userId, {
                    $inc: { balance: transaction.credits }
                });
            }

            res.json({
                success: true,
                message: 'Đã duyệt giao dịch',
                data: transaction
            });
        } else if (action === 'reject') {
            transaction.status = 'failed';
            transaction.processedBy = req.user._id;
            transaction.adminNote = note || 'Rejected by admin';
            transaction.failedReason = note || 'Rejected by admin';
            transaction.processedAt = new Date();
            await transaction.save();

            res.json({
                success: true,
                message: 'Đã từ chối giao dịch',
                data: transaction
            });
        } else {
            res.status(400).json({ success: false, message: 'Invalid action' });
        }
    } catch (error) {
        console.error('Admin process transaction error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

/**
 * GET /api/admin/webhook-logs
 * Get webhook logs
 */
router.get('/webhook-logs', async (req, res) => {
    try {
        const { page = 1, limit = 50, source, status } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const query = {};
        if (source) query.source = source;
        if (status) query.status = status;

        const [logs, total] = await Promise.all([
            WebhookLog.find(query)
                .populate('matchedTransactionId', 'transactionCode amount credits status')
                .populate('matchedUserId', 'name email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            WebhookLog.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: logs,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Admin get webhook logs error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

/**
 * GET /api/admin/webhook-logs/:id
 * Get webhook log detail
 */
router.get('/webhook-logs/:id', async (req, res) => {
    try {
        const log = await WebhookLog.findById(req.params.id)
            .populate('matchedTransactionId')
            .populate('matchedUserId', 'name email balance');

        if (!log) {
            return res.status(404).json({ success: false, message: 'Log not found' });
        }

        res.json({ success: true, data: log });
    } catch (error) {
        console.error('Admin get webhook log error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

/**
 * POST /api/admin/webhook-logs/:id/reprocess
 * Reprocess a webhook log
 */
router.post('/webhook-logs/:id/reprocess', async (req, res) => {
    try {
        const log = await WebhookLog.findById(req.params.id);
        if (!log) {
            return res.status(404).json({ success: false, message: 'Log not found' });
        }

        // Extract transaction code from description
        const description = log.parsedData?.description || '';
        const match = description.match(/ALPHA[A-Z0-9]{6}/i);

        if (!match) {
            log.status = 'unmatched';
            log.processingNotes = 'Reprocessed: No ALPHA code found in description';
            await log.save();
            return res.json({
                success: false,
                message: 'Không tìm thấy mã ALPHA trong nội dung',
                data: log
            });
        }

        const transactionCode = match[0].toUpperCase();
        const amount = log.parsedData?.amount || 0;

        // Find pending transaction
        const transaction = await Transaction.findOne({
            transactionCode,
            status: 'pending'
        });

        if (!transaction) {
            log.status = 'unmatched';
            log.processingNotes = `Reprocessed: No pending transaction found for ${transactionCode}`;
            await log.save();
            return res.json({
                success: false,
                message: `Không tìm thấy giao dịch pending với mã ${transactionCode}`,
                data: log
            });
        }

        // Verify amount
        if (amount < transaction.amount) {
            log.status = 'error';
            log.processingNotes = `Reprocessed: Amount mismatch. Expected ${transaction.amount}, got ${amount}`;
            await log.save();
            return res.json({
                success: false,
                message: `Số tiền không khớp. Cần ${transaction.amount}, nhận ${amount}`,
                data: log
            });
        }

        // Process the transaction
        transaction.status = 'completed';
        transaction.webhookData = log.payload;
        transaction.webhookLogId = log._id;
        transaction.bankTransactionId = log.parsedData?.bankTransactionId || null;
        transaction.processedAt = new Date();
        transaction.processedBy = req.user._id;
        transaction.adminNote = 'Reprocessed from webhook log by admin';
        await transaction.save();

        // Update user balance
        if (transaction.userId) {
            await User.findByIdAndUpdate(transaction.userId, {
                $inc: { balance: transaction.credits }
            });
        }

        // Update webhook log
        log.status = 'matched';
        log.matchedTransactionId = transaction._id;
        log.matchedUserId = transaction.userId;
        log.processingNotes = `Reprocessed successfully by admin at ${new Date().toISOString()}`;
        await log.save();

        res.json({
            success: true,
            message: `Đã xử lý thành công. Cộng ${transaction.credits} credits.`,
            data: { log, transaction }
        });
    } catch (error) {
        console.error('Admin reprocess webhook error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

/**
 * GET /api/admin/stats
 * Get dashboard statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [
            totalUsers,
            totalTransactions,
            pendingTransactions,
            todayTransactions,
            recentWebhooks,
            transactionsByType
        ] = await Promise.all([
            User.countDocuments(),
            Transaction.countDocuments(),
            Transaction.countDocuments({ status: 'pending' }),
            Transaction.countDocuments({ createdAt: { $gte: today } }),
            WebhookLog.countDocuments({ createdAt: { $gte: today } }),
            Transaction.aggregate([
                { $group: { _id: '$type', count: { $sum: 1 } } }
            ])
        ]);

        res.json({
            success: true,
            data: {
                totalUsers,
                totalTransactions,
                pendingTransactions,
                todayTransactions,
                recentWebhooks,
                transactionsByType
            }
        });
    } catch (error) {
        console.error('Admin get stats error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

export default router;
