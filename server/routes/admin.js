import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
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
 * POST /api/admin/transactions/check-timeout
 * Check and update timeout transactions (confirmed > 5 minutes without webhook match)
 */
router.post('/transactions/check-timeout', async (req, res) => {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

        // Find transactions that were confirmed but not matched within 5 minutes
        const result = await Transaction.updateMany(
            {
                status: 'pending',
                confirmedAt: { $ne: null, $lt: fiveMinutesAgo }
            },
            {
                $set: {
                    status: 'timeout',
                    failedReason: 'No webhook received within 5 minutes after confirmation'
                }
            }
        );

        res.json({
            success: true,
            message: `Updated ${result.modifiedCount} transactions to timeout`,
            data: { modifiedCount: result.modifiedCount }
        });
    } catch (error) {
        console.error('Admin check timeout error:', error);
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
 * POST /api/admin/webhook-logs/:id/assign-user
 * Assign a user to an unmatched webhook and credit their account
 */
router.post('/webhook-logs/:id/assign-user', async (req, res) => {
    try {
        const { userId, note } = req.body;

        if (!userId) {
            return res.status(400).json({ success: false, message: 'User ID is required' });
        }

        const log = await WebhookLog.findById(req.params.id);
        if (!log) {
            return res.status(404).json({ success: false, message: 'Log not found' });
        }

        if (log.status === 'matched') {
            return res.status(400).json({ success: false, message: 'Webhook already matched' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const amount = log.parsedData?.amount || 0;
        if (amount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid amount in webhook' });
        }

        // Calculate credits based on amount (using base rate: 1000 VND = 1 credit)
        // Or find matching package
        const CREDIT_PACKAGES = [
            { price: 10000, credits: 10 },
            { price: 100000, credits: 100 },
            { price: 200000, credits: 210 },
            { price: 500000, credits: 550 },
            { price: 1000000, credits: 1120 }
        ];
        const pkg = CREDIT_PACKAGES.find(p => p.price === amount);
        const credits = pkg ? pkg.credits : Math.floor(amount / 1000);

        // Create transaction record
        const transactionCode = `WEBHOOK${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const transaction = new Transaction({
            userId: user._id,
            type: 'topup',
            amount: amount,
            credits: credits,
            status: 'completed',
            transactionCode,
            paymentMethod: 'bank_transfer',
            description: `Admin assigned from webhook: ${note || 'Manual assignment'}`,
            webhookData: log.payload,
            webhookLogId: log._id,
            bankTransactionId: log.parsedData?.bankTransactionId || null,
            processedBy: req.user._id,
            adminNote: note || 'Assigned from unmatched webhook by admin',
            processedAt: new Date()
        });
        await transaction.save();

        // Update user balance
        user.balance = (user.balance || 0) + credits;
        await user.save();

        // Update webhook log
        log.status = 'matched';
        log.matchedTransactionId = transaction._id;
        log.matchedUserId = user._id;
        log.processingNotes = `Manually assigned to ${user.name} (${user.email}) by admin. Credits: ${credits}`;
        await log.save();

        res.json({
            success: true,
            message: `Đã cộng ${credits} credits cho ${user.name}`,
            data: { log, transaction, newBalance: user.balance }
        });
    } catch (error) {
        console.error('Admin assign webhook user error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

/**
 * POST /api/admin/webhook-logs/:id/ignore
 * Mark a webhook as ignored (cancelled)
 */
router.post('/webhook-logs/:id/ignore', async (req, res) => {
    try {
        const { note } = req.body;

        const log = await WebhookLog.findById(req.params.id);
        if (!log) {
            return res.status(404).json({ success: false, message: 'Log not found' });
        }

        if (log.status === 'matched') {
            return res.status(400).json({ success: false, message: 'Cannot ignore matched webhook' });
        }

        log.status = 'ignored';
        log.processingNotes = `Ignored by admin: ${note || 'No reason provided'}`;
        await log.save();

        res.json({
            success: true,
            message: 'Đã bỏ qua webhook này',
            data: log
        });
    } catch (error) {
        console.error('Admin ignore webhook error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

/**
 * POST /api/admin/users/:id/reset-password
 * Reset user's password to a random 8-digit number
 */
router.post('/users/:id/reset-password', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Generate random 8-digit password
        const newPassword = Math.floor(10000000 + Math.random() * 90000000).toString();

        // Hash and update
        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        await User.updateOne({ _id: user._id }, { password: hashedPassword });

        res.json({
            success: true,
            message: `Đã reset mật khẩu cho ${user.name}`,
            data: { newPassword }
        });
    } catch (error) {
        console.error('Admin reset password error:', error);
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
