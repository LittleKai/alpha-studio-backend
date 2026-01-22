import express from 'express';
import crypto from 'crypto';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import WebhookLog from '../models/WebhookLog.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// Casso Webhook Secret (get from Casso dashboard)
const CASSO_WEBHOOK_SECRET = process.env.CASSO_WEBHOOK_SECRET || '';

// Bank account info for display
const BANK_INFO = {
    bankId: 'OCB',
    bankName: 'OCB (Phương Đông)',
    accountNumber: 'CASS55252503',
    accountHolder: 'NGUYEN ANH DUC'
};

// Credit packages configuration
const CREDIT_PACKAGES = [
    { id: 'pkg0', credits: 10, price: 10000, label: '10 Credits' },
    { id: 'pkg1', credits: 100, price: 100000, label: '100 Credits' },
    { id: 'pkg2', credits: 210, price: 200000, label: '210 Credits', bonus: '+10%' },
    { id: 'pkg3', credits: 550, price: 500000, label: '550 Credits', bonus: '+10%', popular: true },
    { id: 'pkg4', credits: 1200, price: 1000000, label: '1.200 Credits', bonus: '+20%' }
];

/**
 * Generate random transfer content: alphaXXXXXX (6 random chars)
 * Uses only non-confusing characters (no I, O, 0, l)
 */
const generateTransferContent = () => {
    const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // removed I and O
    const numbers = '123456789'; // removed 0
    const allChars = uppercase + numbers;

    let result = '';
    // Ensure mix of letters and numbers
    result += uppercase.charAt(Math.floor(Math.random() * uppercase.length));
    result += uppercase.charAt(Math.floor(Math.random() * uppercase.length));
    result += numbers.charAt(Math.floor(Math.random() * numbers.length));
    result += numbers.charAt(Math.floor(Math.random() * numbers.length));
    result += allChars.charAt(Math.floor(Math.random() * allChars.length));
    result += allChars.charAt(Math.floor(Math.random() * allChars.length));

    // Shuffle
    result = result.split('').sort(() => 0.5 - Math.random()).join('');

    return `ALPHA${result}`;
};

/**
 * Verify Casso webhook signature
 * Casso uses: secure_token in header or query param
 */
const verifyCassoWebhook = (req) => {
    if (!CASSO_WEBHOOK_SECRET) {
        console.warn('CASSO_WEBHOOK_SECRET not set, skipping verification');
        return true;
    }

    const secureToken = req.headers['secure-token'] ||
                        req.headers['x-secure-token'] ||
                        req.query.secure_token;

    return secureToken === CASSO_WEBHOOK_SECRET;
};

/**
 * Find credits for a given amount from packages
 */
const getCreditsForAmount = (amount) => {
    const pkg = CREDIT_PACKAGES.find(p => p.price === amount);
    if (pkg) return pkg.credits;

    // If exact match not found, calculate based on base rate (1000 VND = 1 credit)
    // with no bonus
    return Math.floor(amount / 1000);
};

/**
 * POST /api/payment/webhook
 * Receive webhook from Casso
 * NO AUTH REQUIRED
 *
 * Casso Webhook V2 format:
 * {
 *   "error": 0,
 *   "data": {
 *     "id": 0,
 *     "reference": "BANK_REF_ID",
 *     "description": "ALPHA123ABC giao dich",
 *     "amount": 100000,
 *     "runningBalance": 25000000,
 *     "transactionDateTime": "2025-02-12 15:36:21",
 *     "accountNumber": "CASS55252503",
 *     "bankName": "OCB",
 *     "bankAbbreviation": "OCB",
 *     "counterAccountName": "NGUYEN VAN A",
 *     "counterAccountNumber": "1234567890",
 *     "counterAccountBankId": ""
 *   }
 * }
 */
router.post('/webhook', async (req, res) => {
    console.log('=== CASSO WEBHOOK RECEIVED ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('==============================');

    // Always return 200 to Casso
    try {
        // Verify webhook
        if (!verifyCassoWebhook(req)) {
            console.error('Invalid Casso webhook signature');
            // Log invalid webhook
            await WebhookLog.create({
                source: 'casso',
                payload: req.body,
                status: 'error',
                errorMessage: 'Invalid webhook signature',
                ipAddress: req.ip,
                headers: req.headers
            });
            return res.status(200).json({ success: false, message: 'Invalid signature' });
        }

        const webhookData = req.body;

        // Check for error
        if (webhookData.error !== 0) {
            console.error('Casso webhook error:', webhookData.error);
            await WebhookLog.create({
                source: 'casso',
                payload: webhookData,
                status: 'error',
                errorMessage: `Casso error code: ${webhookData.error}`,
                ipAddress: req.ip,
                headers: req.headers
            });
            return res.status(200).json({ success: false, message: 'Webhook error' });
        }

        // Casso V2: data is an object, not array
        const txData = webhookData.data;
        if (!txData) {
            console.error('No transaction data in webhook');
            await WebhookLog.create({
                source: 'casso',
                payload: webhookData,
                status: 'error',
                errorMessage: 'No transaction data in webhook',
                ipAddress: req.ip,
                headers: req.headers
            });
            return res.status(200).json({ success: false, message: 'No data' });
        }

        // Extract fields from Casso V2 format
        const {
            id: cassoId,
            reference: bankTxId,
            description,
            amount,
            transactionDateTime: txTime,
            counterAccountName,
            counterAccountNumber,
            accountNumber,
            bankName
        } = txData;

        console.log(`Processing transaction: ${bankTxId}, amount: ${amount}, desc: ${description}`);

        // Create webhook log entry
        const webhookLog = new WebhookLog({
            source: 'casso',
            payload: txData,
            parsedData: {
                transactionCode: null,
                amount: amount,
                description: description,
                bankTransactionId: bankTxId,
                when: txTime ? new Date(txTime) : new Date()
            },
            status: 'processing',
            ipAddress: req.ip,
            headers: req.headers
        });

        // Extract transfer content from description (format: ALPHAXXXXXX)
        const contentMatch = description?.toUpperCase().match(/ALPHA[A-Z0-9]{6}/);

        if (!contentMatch) {
            console.log(`No ALPHA code found in description: ${description}`);
            webhookLog.status = 'unmatched';
            webhookLog.processingNotes = `No ALPHA code found. Description: ${description}`;
            await webhookLog.save();
            return res.status(200).json({ success: true, message: 'No matching code found' });
        }

        const transferContent = contentMatch[0];
        webhookLog.parsedData.transactionCode = transferContent;
        console.log(`Found transfer content: ${transferContent}`);

        // Find pending transaction with this transfer content
        const transaction = await Transaction.findOne({
            transactionCode: transferContent,
            status: 'pending'
        });

        if (!transaction) {
            console.log(`No pending transaction found for: ${transferContent}`);
            webhookLog.status = 'unmatched';
            webhookLog.processingNotes = `No pending transaction found for code: ${transferContent}`;
            await webhookLog.save();
            return res.status(200).json({ success: true, message: 'No pending transaction found' });
        }

        // Verify amount matches
        if (transaction.amount !== amount) {
            console.error(`Amount mismatch: expected ${transaction.amount}, got ${amount}`);
            transaction.status = 'failed';
            transaction.failedReason = `Amount mismatch: expected ${transaction.amount}, got ${amount}`;
            transaction.webhookData = txData;
            transaction.webhookLogId = webhookLog._id;
            await transaction.save();

            webhookLog.status = 'error';
            webhookLog.errorMessage = `Amount mismatch: expected ${transaction.amount}, got ${amount}`;
            webhookLog.matchedTransactionId = transaction._id;
            webhookLog.matchedUserId = transaction.userId;
            await webhookLog.save();
            return res.status(200).json({ success: true, message: 'Amount mismatch' });
        }

        // Update transaction to completed
        transaction.status = 'completed';
        transaction.webhookData = txData;
        transaction.webhookLogId = webhookLog._id;
        transaction.bankTransactionId = bankTxId;
        transaction.processedAt = new Date();
        transaction.description = `Nạp ${transaction.credits} credits từ ${counterAccountName || 'Bank Transfer'}`;
        await transaction.save();

        // Update webhook log
        webhookLog.status = 'matched';
        webhookLog.matchedTransactionId = transaction._id;
        webhookLog.matchedUserId = transaction.userId;
        webhookLog.processingNotes = `Successfully matched and processed. Credits: ${transaction.credits}`;
        await webhookLog.save();

        // Add credits to user balance
        if (transaction.userId) {
            const updatedUser = await User.findByIdAndUpdate(
                transaction.userId,
                { $inc: { balance: transaction.credits } },
                { new: true }
            );
            console.log(`User ${transaction.userId} balance updated: +${transaction.credits} credits. New balance: ${updatedUser?.balance}`);
        }

        console.log(`Transaction ${transferContent} completed successfully`);
        return res.status(200).json({ success: true, message: 'Webhook processed successfully' });

    } catch (error) {
        console.error('Webhook processing error:', error);
        // Log error
        await WebhookLog.create({
            source: 'casso',
            payload: req.body,
            status: 'error',
            errorMessage: error.message,
            ipAddress: req.ip,
            headers: req.headers
        });
        return res.status(200).json({ success: false, message: 'Processing error' });
    }
});

/**
 * GET /api/payment/pricing
 * Get available credit packages
 * PUBLIC
 */
router.get('/pricing', (req, res) => {
    res.json({
        success: true,
        data: CREDIT_PACKAGES
    });
});

/**
 * POST /api/payment/create
 * Create a new topup request
 * AUTH REQUIRED
 */
router.post('/create', authMiddleware, async (req, res) => {
    try {
        const { packageId } = req.body;

        // Find package
        const pkg = CREDIT_PACKAGES.find(p => p.id === packageId);
        if (!pkg) {
            return res.status(400).json({
                success: false,
                message: 'Invalid package selected'
            });
        }

        // Check for existing pending transactions (limit to 3)
        const pendingCount = await Transaction.countDocuments({
            userId: req.user._id,
            status: 'pending'
        });

        if (pendingCount >= 3) {
            return res.status(400).json({
                success: false,
                message: 'Bạn có quá nhiều giao dịch đang chờ. Vui lòng hoàn thành hoặc hủy trước khi tạo mới.'
            });
        }

        // Generate unique transfer content
        let transactionCode;
        let attempts = 0;
        do {
            transactionCode = generateTransferContent();
            const exists = await Transaction.findOne({ transactionCode });
            if (!exists) break;
            attempts++;
        } while (attempts < 10);

        if (attempts >= 10) {
            return res.status(500).json({
                success: false,
                message: 'Unable to generate unique transaction code'
            });
        }

        // Create transaction with 30 minute expiry
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

        const transaction = new Transaction({
            userId: req.user._id,
            type: 'topup',
            amount: pkg.price,
            credits: pkg.credits,
            status: 'pending',
            transactionCode,
            paymentMethod: 'bank_transfer',
            description: `Nạp ${pkg.credits} credits - ${pkg.label}`,
            expiresAt
        });

        await transaction.save();

        // Generate VietQR URL
        const qrCodeUrl = `https://img.vietqr.io/image/${BANK_INFO.bankId}-${BANK_INFO.accountNumber}-compact2.png?amount=${pkg.price}&addInfo=${transactionCode}`;

        res.json({
            success: true,
            data: {
                transaction: {
                    _id: transaction._id,
                    transactionCode: transaction.transactionCode,
                    amount: transaction.amount,
                    credits: transaction.credits,
                    status: transaction.status,
                    expiresAt: transaction.expiresAt,
                    createdAt: transaction.createdAt
                },
                bankInfo: BANK_INFO,
                qrCodeUrl,
                transferContent: transactionCode
            }
        });

    } catch (error) {
        console.error('Create payment error:', error);
        res.status(500).json({
            success: false,
            message: 'Không thể tạo yêu cầu nạp tiền'
        });
    }
});

/**
 * DELETE /api/payment/cancel/:transactionId
 * Cancel and delete a pending transaction (not saved in history)
 * AUTH REQUIRED
 */
router.delete('/cancel/:transactionId', authMiddleware, async (req, res) => {
    try {
        const result = await Transaction.findOneAndDelete({
            _id: req.params.transactionId,
            userId: req.user._id,
            status: 'pending'
        });

        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy giao dịch hoặc giao dịch đã được xử lý'
            });
        }

        res.json({
            success: true,
            message: 'Đã hủy giao dịch thành công'
        });

    } catch (error) {
        console.error('Cancel transaction error:', error);
        res.status(500).json({
            success: false,
            message: 'Không thể hủy giao dịch'
        });
    }
});

/**
 * GET /api/payment/history
 * Get transaction history for current user
 * AUTH REQUIRED
 */
router.get('/history', authMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;
        const query = { userId: req.user._id };

        if (status && ['pending', 'completed', 'failed', 'cancelled'].includes(status)) {
            query.status = status;
        }

        const transactions = await Transaction.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .select('-webhookData');

        const total = await Transaction.countDocuments(query);

        // Get pending count separately
        const pendingCount = await Transaction.countDocuments({
            userId: req.user._id,
            status: 'pending'
        });

        res.json({
            success: true,
            data: transactions,
            pendingCount,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get payment history error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get payment history'
        });
    }
});

/**
 * GET /api/payment/pending
 * Get pending transactions for current user
 * AUTH REQUIRED
 */
router.get('/pending', authMiddleware, async (req, res) => {
    try {
        const transactions = await Transaction.find({
            userId: req.user._id,
            status: 'pending'
        })
        .sort({ createdAt: -1 })
        .select('-webhookData');

        res.json({
            success: true,
            data: transactions
        });
    } catch (error) {
        console.error('Get pending transactions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get pending transactions'
        });
    }
});

/**
 * GET /api/payment/status/:transactionId
 * Check transaction status
 * AUTH REQUIRED
 */
router.get('/status/:transactionId', authMiddleware, async (req, res) => {
    try {
        const transaction = await Transaction.findOne({
            _id: req.params.transactionId,
            userId: req.user._id
        }).select('-webhookData');

        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }

        res.json({
            success: true,
            data: transaction
        });
    } catch (error) {
        console.error('Check transaction status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check transaction status'
        });
    }
});

/**
 * GET /api/payment/bank-info
 * Get bank account information
 * PUBLIC
 */
router.get('/bank-info', (req, res) => {
    res.json({
        success: true,
        data: BANK_INFO
    });
});

/**
 * POST /api/payment/verify
 * Manually verify a transaction (Admin only)
 * AUTH REQUIRED + ADMIN ONLY
 */
router.post('/verify', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { transactionId, action, reason } = req.body;

        if (!transactionId || !action) {
            return res.status(400).json({
                success: false,
                message: 'Transaction ID and action are required'
            });
        }

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({
                success: false,
                message: 'Action must be "approve" or "reject"'
            });
        }

        const transaction = await Transaction.findById(transactionId);

        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }

        if (transaction.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Transaction is already ${transaction.status}`
            });
        }

        if (action === 'approve') {
            transaction.status = 'completed';
            transaction.processedAt = new Date();

            // Update user balance with credits
            if (transaction.userId) {
                await User.findByIdAndUpdate(
                    transaction.userId,
                    { $inc: { balance: transaction.credits } },
                    { new: true }
                );
            }
        } else {
            transaction.status = 'failed';
            transaction.failedReason = reason || 'Rejected by admin';
        }

        await transaction.save();

        res.json({
            success: true,
            message: `Transaction ${action}d successfully`,
            data: transaction
        });
    } catch (error) {
        console.error('Verify transaction error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to verify transaction'
        });
    }
});

/**
 * GET /api/payment/admin/transactions
 * Get all transactions (Admin only)
 * AUTH REQUIRED + ADMIN ONLY
 */
router.get('/admin/transactions', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { page = 1, limit = 50, status, userId } = req.query;
        const query = {};

        if (status && ['pending', 'completed', 'failed', 'cancelled'].includes(status)) {
            query.status = status;
        }
        if (userId) {
            query.userId = userId;
        }

        const transactions = await Transaction.find(query)
            .populate('userId', 'name email')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await Transaction.countDocuments(query);

        res.json({
            success: true,
            data: transactions,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get admin transactions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get transactions'
        });
    }
});

export default router;
