import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import WebhookLog from '../models/WebhookLog.js';
import WorkflowDocument from '../models/WorkflowDocument.js';
import WorkflowProject from '../models/WorkflowProject.js';
import EventLibraryItem from '../models/EventLibraryItem.js';
import Course from '../models/Course.js';
import Prompt from '../models/Prompt.js';
import StudioGeneration from '../models/StudioGeneration.js';
import InteriorAnalysis from '../models/InteriorAnalysis.js';
import InteriorRender from '../models/InteriorRender.js';
import InteriorTemplate from '../models/InteriorTemplate.js';
import ToolDownload from '../models/ToolDownload.js';
import { KNOWN_TOOLS, getOrCreateToolDownload } from './toolDownloads.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { listAllFiles, deleteFile as deleteB2File } from '../utils/b2Storage.js';
import { validateTemplateStructure, extractDsl } from '../utils/templateValidator.js';
import { purgeExpiredPendingTransactions } from '../utils/transactionCleanup.js';

const router = express.Router();

// All routes require admin authentication
router.use(authMiddleware);
router.use(adminOnly);

/**
 * GET /api/admin/users
 * Get all users with pagination, search, filters, sorting, and stats
 */
router.get('/users', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            search = '',
            role,
            isActive,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;
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

        if (isActive !== undefined && isActive !== '' && isActive !== 'all') {
            query.isActive = isActive === 'true';
        }

        const sort = {};
        const direction = sortOrder === 'asc' ? 1 : -1;
        if (sortBy === 'lastActiveAt' || sortBy === 'lastActive') {
            sort.lastActiveAt = direction;
            sort.lastLogin = direction;
            sort.updatedAt = direction;
        } else if (sortBy === 'lastLogin') {
            sort.lastLogin = direction;
        } else if (sortBy === 'balance') {
            sort.balance = direction;
        } else if (sortBy === 'name') {
            sort.name = direction;
        } else {
            sort.createdAt = direction;
        }

        const [users, total, statsAggregation] = await Promise.all([
            User.find(query)
                .select('-password')
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit)),
            User.countDocuments(query),
            User.aggregate([
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        student: { $sum: { $cond: [{ $eq: ['$role', 'student'] }, 1, 0] } },
                        partner: { $sum: { $cond: [{ $eq: ['$role', 'partner'] }, 1, 0] } },
                        mod: { $sum: { $cond: [{ $eq: ['$role', 'mod'] }, 1, 0] } },
                        admin: { $sum: { $cond: [{ $eq: ['$role', 'admin'] }, 1, 0] } },
                        active: { $sum: { $cond: [{ $ne: ['$isActive', false] }, 1, 0] } },
                        deactivated: { $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] } }
                    }
                }
            ])
        ]);

        const rawStats = statsAggregation[0] || {};
        const stats = {
            total: rawStats.total || 0,
            student: rawStats.student || 0,
            partner: rawStats.partner || 0,
            mod: rawStats.mod || 0,
            admin: rawStats.admin || 0,
            active: rawStats.active || 0,
            deactivated: rawStats.deactivated || 0
        };

        res.json({
            success: true,
            data: users,
            stats,
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
        await purgeExpiredPendingTransactions().catch(() => {});
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
 * Check and purge expired pending transactions (> 30 minutes)
 */
router.post('/transactions/check-timeout', async (req, res) => {
    try {
        const result = await purgeExpiredPendingTransactions();

        res.json({
            success: true,
            message: `Đã tự động xóa ${result.deletedCount || 0} giao dịch pending quá hạn (> 30 phút)`,
            data: { deletedCount: result.deletedCount || 0 }
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

        // Calculate credits based on amount (using base rate: 100 VND = 1 credit)
        // Or find matching package
        const CREDIT_PACKAGES = [
            { price: 10000, credits: 1000 },
            { price: 20000, credits: 2000 },
            { price: 50000, credits: 5000 },
            { price: 100000, credits: 10000 },
            { price: 200000, credits: 21000 },
            { price: 500000, credits: 55000 },
            { price: 1000000, credits: 112000 }
        ];
        const pkg = CREDIT_PACKAGES.find(p => p.price === amount);
        const credits = pkg ? pkg.credits : Math.floor(amount / 100);

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
        // Only super admin (aduc5525@gmail.com) can reset passwords
        if (req.user.role !== 'admin' || req.user.email !== 'aduc5525@gmail.com') {
            return res.status(403).json({ success: false, message: 'Không có quyền thực hiện' });
        }

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
        await purgeExpiredPendingTransactions().catch(() => {});
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

// ─── STORAGE CLEANUP (super admin only) ─────────────────────────────────────

const SUPER_ADMIN_EMAIL = 'aduc5525@gmail.com';

/** Extract B2 object key from a CDN or direct B2 URL */
export function extractB2Key(url) {
    if (!url) return null;
    const cdnBase = process.env.CDN_BASE_URL;
    if (cdnBase && url.startsWith(cdnBase)) {
        const base = cdnBase.endsWith('/') ? cdnBase : cdnBase + '/';
        return url.slice(base.length);
    }
    const bucket = process.env.B2_BUCKET_NAME;
    const pattern = `.backblazeb2.com/file/${bucket}/`;
    const idx = url.indexOf(pattern);
    if (idx !== -1) return url.slice(idx + pattern.length);
    return null;
}

/**
 * Đọc mọi B2 key nhúng trong một chuỗi HTML.
 *
 * Ảnh chèn bằng TinyMCE trong `WorkflowProject.description` đi thẳng lên B2
 * (prefix `project-descriptions/`) nhưng URL chỉ nằm trong chuỗi HTML — không
 * có field B2 riêng nào trỏ tới. Không quét ở đây thì checker xếp chúng vào
 * orphaned và `DELETE /storage/orphaned` sẽ xoá ảnh đang dùng.
 *
 * Quét mọi URL trong chuỗi chứ không riêng `<img src>`: link tải, ảnh nền
 * trong `style`, `srcset`… đều là tham chiếu thật, bỏ sót là mất dữ liệu.
 */
export function extractB2KeysFromHtml(html) {
    if (!html || typeof html !== 'string') return [];
    const keys = new Set();
    for (const raw of html.match(/https?:\/\/[^\s"'<>)]+/gi) || []) {
        const url = raw.replace(/&amp;/gi, '&').replace(/[.,;]+$/, '');
        const key = extractB2Key(url);
        if (key) keys.add(key);
    }
    return [...keys];
}

// Desktop app releases (VocabFlip, VietYaku) live on B2 but are never referenced
// from MongoDB — their `version.json` manifest is the source of truth, published
// by each app's build-and-release skill. Treat them as referenced so they are
// never listed as orphaned and deleted, which would 404 the /studio download links.
const APP_RELEASE_PREFIXES = ['vocabflip-app/', 'vietyaku-app/'];
const isAppReleaseKey = (key) => APP_RELEASE_PREFIXES.some(prefix => key.startsWith(prefix));

/**
 * Quét mọi collection để dựng tập key B2 đang được tham chiếu.
 *
 * Dùng chung cho cả GET (liệt kê orphan) và DELETE (chặn xoá nhầm). Đây phải là
 * NGUỒN DUY NHẤT: tách đôi logic ra hai chỗ là kiểu gì cũng lệch, và lệch ở đây
 * nghĩa là xoá mất file đang dùng.
 *
 * Trả về `docKeyMap` để GET còn hiển thị ai upload; DELETE chỉ cần `usedKeys`.
 */
export async function collectReferencedKeys() {
        // Build map: key → { uploader, uploadedAt } from WorkflowDocument
        const docKeyMap = new Map(); // key → { uploader, uploadedAt, id }
        const wfDocs = await WorkflowDocument.find({}, 'fileKey url uploader uploadDate createdAt').lean();
        for (const doc of wfDocs) {
            const key = doc.fileKey || extractB2Key(doc.url);
            if (key) {
                docKeyMap.set(key, {
                    uploader: doc.uploader || 'Unknown',
                    uploadedAt: doc.createdAt || doc.uploadDate,
                    source: 'workflow'
                });
            }
        }

        const usedKeys = new Set(docKeyMap.keys());

        // Prompts: example images + tệp đính kèm B2 (admin/mod gắn)
        const prompts = await Prompt.find({}, 'exampleImages attachments author')
            .populate('author', 'name')
            .lean();
        for (const p of prompts) {
            for (const img of (p.exampleImages || [])) {
                const imgKey = img.publicId || extractB2Key(img.url);
                if (imgKey) usedKeys.add(imgKey);
            }
            for (const att of (p.attachments || [])) {
                const attKey = att.fileKey || extractB2Key(att.url);
                if (!attKey) continue;
                usedKeys.add(attKey);
                if (!docKeyMap.has(attKey)) {
                    docKeyMap.set(attKey, {
                        uploader: p.author?.name || 'Unknown',
                        uploadedAt: null,
                        source: 'prompt'
                    });
                }
            }
        }

        // Studio generations — saved items (items[].b2Key)
        const studioGens = await StudioGeneration.find({ 'items.saved': true }, 'items').lean();
        for (const gen of studioGens) {
            for (const item of (gen.items || [])) {
                if (item.saved && item.b2Key) usedKeys.add(item.b2Key);
            }
        }

        // Interior analysis cache: uploaded reference image
        const interiorAnalyses = await InteriorAnalysis.find({}, 'imageUrl').lean();
        for (const a of interiorAnalyses) {
            const key = extractB2Key(a.imageUrl);
            if (key) usedKeys.add(key);
        }

        // Interior renders: 3D view conditioning + AI render output
        const interiorRenders = await InteriorRender.find({}, 'viewUrl renderUrl').lean();
        for (const r of interiorRenders) {
            const viewKey = extractB2Key(r.viewUrl);
            if (viewKey) usedKeys.add(viewKey);
            const renderKey = extractB2Key(r.renderUrl);
            if (renderKey) usedKeys.add(renderKey);
        }

        // Course lesson videos + documents
        const courses = await Course.find({}, 'modules').lean();
        for (const course of courses) {
            for (const mod of (course.modules || [])) {
                for (const lesson of (mod.lessons || [])) {
                    // Video URL
                    const videoKey = extractB2Key(lesson.videoUrl);
                    if (videoKey) usedKeys.add(videoKey);
                    // Lesson documents (PDF, etc.)
                    for (const doc of (lesson.documents || [])) {
                        const key = extractB2Key(doc.url);
                        if (key) usedKeys.add(key);
                    }
                }
            }
        }

        // Ảnh TinyMCE nhúng trong mô tả dự án (prefix `project-descriptions/`).
        // URL chỉ nằm trong chuỗi HTML nên phải parse ra, không có field để đọc.
        const wfProjects = await WorkflowProject.find({ description: /https?:\/\// }, 'description name').lean();
        for (const project of wfProjects) {
            for (const key of extractB2KeysFromHtml(project.description)) {
                usedKeys.add(key);
                if (!docKeyMap.has(key)) {
                    docKeyMap.set(key, {
                        uploader: project.name || 'Unknown',
                        uploadedAt: null,
                        source: 'project-description'
                    });
                }
            }
        }

        // Event library attachments (tài liệu đính kèm case study / template)
        const libraryItems = await EventLibraryItem.find({}, 'attachments owner')
            .populate('owner', 'name')
            .lean();
        for (const item of libraryItems) {
            for (const att of (item.attachments || [])) {
                const key = att.fileKey || extractB2Key(att.url);
                if (!key) continue;
                usedKeys.add(key);
                if (!docKeyMap.has(key)) {
                    docKeyMap.set(key, {
                        uploader: item.owner?.name || 'Unknown',
                        uploadedAt: null,
                        source: 'event-library'
                    });
                }
            }
        }

    return { usedKeys, docKeyMap };
}

/**
 * Cache ngắn cho `collectReferencedKeys()`.
 *
 * Trang admin xoá hàng loạt bằng vòng lặp tuần tự (`CloudAdminTab.tsx`), nên nếu
 * mỗi lần DELETE đều quét lại 8 collection thì xoá 200 file = 1600 lượt quét.
 * TTL ngắn để một đợt xoá chỉ trả giá một lần, mà cửa sổ dữ liệu cũ vẫn nhỏ.
 *
 * GET luôn tính mới (`maxAgeMs: 0`) vì đó là danh sách admin nhìn và tin theo.
 */
let referencedCache = null; // { at: number, usedKeys: Set }

export async function getReferencedKeys({ maxAgeMs = 0 } = {}) {
    if (referencedCache && Date.now() - referencedCache.at < maxAgeMs) {
        return referencedCache.usedKeys;
    }
    const { usedKeys } = await collectReferencedKeys();
    referencedCache = { at: Date.now(), usedKeys };
    return usedKeys;
}

/** Cửa sổ dùng lại kết quả quét khi xoá hàng loạt. */
export const DELETE_GUARD_TTL_MS = 10_000;

/**
 * Lý do một key KHÔNG được xoá, hoặc `null` nếu xoá được.
 * Tách riêng để test được mà không cần MongoDB.
 */
export function blockedDeleteReason(key, usedKeys) {
    if (!key) return 'key là bắt buộc';
    if (isAppReleaseKey(key)) {
        return 'Không thể xóa bản phát hành ứng dụng qua đây — xóa trực tiếp trên Backblaze B2';
    }
    if (usedKeys && usedKeys.has(key)) {
        return 'File này đang được tham chiếu trong cơ sở dữ liệu — tải lại danh sách trước khi xóa';
    }
    return null;
}

/**
 * GET /api/admin/storage/orphaned
 * List B2 files that have no reference in any MongoDB collection.
 * Enriched with uploader info where a WorkflowDocument record exists.
 * Super-admin only (aduc5525@gmail.com).
 */
router.get('/storage/orphaned', async (req, res) => {
    if (req.user.email !== SUPER_ADMIN_EMAIL) {
        return res.status(403).json({ success: false, message: 'Không có quyền' });
    }
    try {
        const b2Files = await listAllFiles();
        const { usedKeys, docKeyMap } = await collectReferencedKeys();
        referencedCache = { at: Date.now(), usedKeys };

        // Build orphaned + referenced lists
        const toFileObj = (f, referenced) => ({
            key: f.key,
            filename: f.key.split('/').pop(),
            folder: f.key.includes('/') ? f.key.split('/')[0] : '',
            size: f.size,
            lastModified: f.lastModified,
            uploader: docKeyMap.get(f.key)?.uploader || 'Unknown',
            uploadedAt: docKeyMap.get(f.key)?.uploadedAt || null,
            source: docKeyMap.get(f.key)?.source || null,
            referenced,
        });

        const orphaned = b2Files
            .filter(f => !usedKeys.has(f.key) && !isAppReleaseKey(f.key))
            .map(f => toFileObj(f, false));
        const referenced = b2Files
            .filter(f => usedKeys.has(f.key) || isAppReleaseKey(f.key))
            .map(f => toFileObj(f, true));

        res.json({
            success: true,
            data: orphaned,
            referencedFiles: referenced,
            meta: { orphaned: orphaned.length, totalB2: b2Files.length, referenced: referenced.length }
        });
    } catch (error) {
        console.error('List orphaned files error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + error.message });
    }
});

/**
 * DELETE /api/admin/storage/orphaned
 * Delete a specific orphaned file from B2 by its key.
 * Super-admin only.
 */
router.delete('/storage/orphaned', async (req, res) => {
    if (req.user.email !== SUPER_ADMIN_EMAIL) {
        return res.status(403).json({ success: false, message: 'Không có quyền' });
    }
    const { key } = req.body;
    if (!key) {
        return res.status(400).json({ success: false, message: 'key là bắt buộc' });
    }
    try {
        // Danh sách trên trang admin có thể đã cũ — ai đó chèn ảnh vào mô tả dự án
        // sau lúc admin bấm tải danh sách là dòng đó thành xoá nhầm. Đối chiếu lại
        // ngay trước khi xoá; đây là thao tác không hoàn tác được.
        const usedKeys = await getReferencedKeys({ maxAgeMs: DELETE_GUARD_TTL_MS });
        const blocked = blockedDeleteReason(key, usedKeys);
        if (blocked) {
            return res.status(409).json({ success: false, message: blocked });
        }

        await deleteB2File(key);
        res.json({ success: true, message: 'Đã xóa file khỏi B2' });
    } catch (error) {
        console.error('Delete orphaned file error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ─── Interior template review (Phase 12) ─────────────────────────────────────
//
// All endpoints already protected by router.use(authMiddleware) + adminOnly above.
// Admin reviews user-committed pending templates; can approve, edit, deprecate
// (soft hide from AI catalog), or reject (hard delete unless status='seed').

router.get('/interior-templates', async (req, res) => {
    try {
        const { status, category, search, page = 1, limit = 50 } = req.query;
        const query = {};
        if (status) query.status = status;
        if (category) query.category = category;
        if (search) {
            const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            query.$or = [
                { templateId: { $regex: safe, $options: 'i' } },
                { tags: { $regex: safe, $options: 'i' } },
                { 'description.vi': { $regex: safe, $options: 'i' } },
                { 'description.en': { $regex: safe, $options: 'i' } }
            ];
        }

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
        const skip = (pageNum - 1) * limitNum;

        const [items, total] = await Promise.all([
            InteriorTemplate.find(query)
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .populate('authorId', 'email name')
                .lean(),
            InteriorTemplate.countDocuments(query)
        ]);

        return res.json({
            success: true,
            data: { items, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) }
        });
    } catch (error) {
        console.error('Admin interior-templates list error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi tải danh sách template.' });
    }
});

router.get('/interior-templates/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
        }
        const tpl = await InteriorTemplate.findById(req.params.id).populate('authorId', 'email name').lean();
        if (!tpl) return res.status(404).json({ success: false, message: 'Không tìm thấy template.' });
        return res.json({ success: true, data: tpl });
    } catch (error) {
        console.error('Admin interior-template get error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi tải template.' });
    }
});

router.post('/interior-templates/:id/approve', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
        }
        const tpl = await InteriorTemplate.findByIdAndUpdate(
            req.params.id,
            { $set: { status: 'approved' } },
            { new: true }
        );
        if (!tpl) return res.status(404).json({ success: false, message: 'Không tìm thấy template.' });
        return res.json({ success: true, message: 'Đã duyệt template.', data: tpl });
    } catch (error) {
        console.error('Admin interior-template approve error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi duyệt template.' });
    }
});

router.post('/interior-templates/:id/reject', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
        }
        const tpl = await InteriorTemplate.findById(req.params.id);
        if (!tpl) return res.status(404).json({ success: false, message: 'Không tìm thấy template.' });
        if (tpl.status === 'seed') {
            return res.status(400).json({ success: false, message: 'Không thể xoá seed template.' });
        }
        await InteriorTemplate.deleteOne({ _id: req.params.id });
        return res.json({ success: true, message: 'Đã từ chối và xoá template.' });
    } catch (error) {
        console.error('Admin interior-template reject error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi xoá template.' });
    }
});

router.post('/interior-templates/:id/edit', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
        }
        const tpl = await InteriorTemplate.findById(req.params.id);
        if (!tpl) return res.status(404).json({ success: false, message: 'Không tìm thấy template.' });

        const { name, description, category, tags, params, styleOptions, dsl, previewDims, bumpVersion } = req.body || {};

        if (dsl !== undefined) {
            const candidate = {
                id: tpl.templateId,
                category: category || tpl.category,
                params: params || tpl.params || {},
                dsl: extractDsl({ dsl })
            };
            const validation = validateTemplateStructure(candidate);
            if (!validation.valid) {
                return res.status(400).json({ success: false, message: `DSL không hợp lệ: ${validation.message}` });
            }
            tpl.dsl = candidate.dsl;
        }
        if (name !== undefined) tpl.name = name;
        if (description !== undefined) tpl.description = description;
        if (category !== undefined) tpl.category = category;
        if (tags !== undefined && Array.isArray(tags)) tpl.tags = tags.slice(0, 20);
        if (params !== undefined) tpl.params = params;
        if (styleOptions !== undefined) tpl.styleOptions = styleOptions;
        if (previewDims !== undefined) tpl.previewDims = previewDims;
        if (bumpVersion) tpl.version += 1;

        await tpl.save();
        return res.json({ success: true, message: 'Đã cập nhật template.', data: tpl });
    } catch (error) {
        console.error('Admin interior-template edit error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi cập nhật template.' });
    }
});

router.post('/interior-templates/:id/deprecate', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
        }
        const tpl = await InteriorTemplate.findByIdAndUpdate(
            req.params.id,
            { $set: { status: 'deprecated' } },
            { new: true }
        );
        if (!tpl) return res.status(404).json({ success: false, message: 'Không tìm thấy template.' });
        return res.json({ success: true, message: 'Đã đánh dấu deprecated.', data: tpl });
    } catch (error) {
        console.error('Admin interior-template deprecate error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi cập nhật template.' });
    }
});

// ─── Tool Downloads Management ───────────────────────────────────────────────

/**
 * GET /api/admin/tool-downloads
 * Get download statistics for all tools
 */
router.get('/tool-downloads', async (_req, res) => {
    try {
        for (const [toolId, toolName] of Object.entries(KNOWN_TOOLS)) {
            const existing = await ToolDownload.findOne({ toolId });
            if (!existing) {
                await ToolDownload.create({
                    toolId,
                    toolName,
                    totalDownloads: 0,
                    platforms: { windows: 0, android: 0, mac: 0, linux: 0, other: 0 },
                    versions: new Map(),
                    lastDownloadedAt: null,
                    recentDownloads: [],
                });
            }
        }

        const allTools = await ToolDownload.find({}).sort({ totalDownloads: -1 });

        let totalDownloads = 0;
        let windowsDownloads = 0;
        let androidDownloads = 0;
        let otherDownloads = 0;
        let topTool = null;
        let maxCount = -1;

        const recentActivities = [];

        const toolsData = allTools.map((t) => {
            const toolTotal = t.totalDownloads || 0;
            const win = t.platforms?.windows || 0;
            const apk = t.platforms?.android || 0;
            const mac = t.platforms?.mac || 0;
            const linux = t.platforms?.linux || 0;
            const other = t.platforms?.other || 0;

            totalDownloads += toolTotal;
            windowsDownloads += win;
            androidDownloads += apk;
            otherDownloads += (mac + linux + other);

            if (toolTotal > maxCount && toolTotal > 0) {
                maxCount = toolTotal;
                topTool = { toolId: t.toolId, toolName: t.toolName, count: toolTotal };
            }

            if (Array.isArray(t.recentDownloads)) {
                for (const r of t.recentDownloads) {
                    recentActivities.push({
                        toolId: t.toolId,
                        toolName: t.toolName,
                        platform: r.platform,
                        version: r.version,
                        downloadedAt: r.downloadedAt,
                    });
                }
            }

            const versionsObj = {};
            if (t.versions instanceof Map) {
                for (const [k, v] of t.versions.entries()) {
                    versionsObj[k] = v;
                }
            } else if (t.versions && typeof t.versions === 'object') {
                Object.assign(versionsObj, t.versions);
            }

            return {
                toolId: t.toolId,
                toolName: t.toolName,
                totalDownloads: toolTotal,
                platforms: {
                    windows: win,
                    android: apk,
                    mac,
                    linux,
                    other,
                },
                versions: versionsObj,
                lastDownloadedAt: t.lastDownloadedAt,
                updatedAt: t.updatedAt,
            };
        });

        recentActivities.sort((a, b) => new Date(b.downloadedAt).getTime() - new Date(a.downloadedAt).getTime());

        return res.json({
            success: true,
            data: {
                summary: {
                    totalDownloads,
                    windowsDownloads,
                    androidDownloads,
                    otherDownloads,
                    topTool,
                },
                tools: toolsData,
                recentActivities: recentActivities.slice(0, 30),
            },
        });
    } catch (error) {
        console.error('Admin get tool downloads error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi server khi lấy thống kê tải tool' });
    }
});

/**
 * PUT /api/admin/tool-downloads/:toolId
 * Update/calibrate download counts for a tool
 */
router.put('/tool-downloads/:toolId', async (req, res) => {
    try {
        const toolId = String(req.params.toolId || '').toLowerCase().trim();
        const { totalDownloads, platforms, toolName } = req.body || {};

        const doc = await getOrCreateToolDownload(toolId);

        if (toolName && typeof toolName === 'string') {
            doc.toolName = toolName.trim();
        }

        if (typeof totalDownloads === 'number' && totalDownloads >= 0) {
            doc.totalDownloads = totalDownloads;
        }

        if (platforms && typeof platforms === 'object') {
            const VALID_PLATFORMS = ['windows', 'android', 'mac', 'linux', 'other'];
            for (const p of VALID_PLATFORMS) {
                if (typeof platforms[p] === 'number' && platforms[p] >= 0) {
                    doc.platforms[p] = platforms[p];
                }
            }
            if (typeof totalDownloads !== 'number') {
                doc.totalDownloads = Object.values(doc.platforms).reduce((acc, val) => acc + (val || 0), 0);
            }
        }

        await doc.save();

        return res.json({
            success: true,
            message: `Đã cập nhật số lượt tải cho ${doc.toolName}`,
            data: {
                toolId: doc.toolId,
                toolName: doc.toolName,
                totalDownloads: doc.totalDownloads,
                platforms: doc.platforms,
                lastDownloadedAt: doc.lastDownloadedAt,
                updatedAt: doc.updatedAt,
            },
        });
    } catch (error) {
        console.error('Admin update tool download count error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi server khi cập nhật lượt tải' });
    }
});

/**
 * POST /api/admin/tool-downloads/:toolId/reset
 * Reset download counts for a tool
 */
router.post('/tool-downloads/:toolId/reset', async (req, res) => {
    try {
        const toolId = String(req.params.toolId || '').toLowerCase().trim();
        const doc = await getOrCreateToolDownload(toolId);

        doc.totalDownloads = 0;
        doc.platforms = { windows: 0, android: 0, mac: 0, linux: 0, other: 0 };
        doc.versions = new Map();
        doc.recentDownloads = [];
        await doc.save();

        return res.json({
            success: true,
            message: `Đã đặt lại số lượt tải cho ${doc.toolName} về 0`,
            data: {
                toolId: doc.toolId,
                toolName: doc.toolName,
                totalDownloads: 0,
                platforms: doc.platforms,
                lastDownloadedAt: doc.lastDownloadedAt,
            },
        });
    } catch (error) {
        console.error('Admin reset tool download count error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi server khi đặt lại lượt tải' });
    }
});

export default router;
