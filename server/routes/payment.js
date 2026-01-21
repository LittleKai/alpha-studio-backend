import express from 'express';
import crypto from 'crypto';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// Webhook secret key from payment gateway (store in .env)
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'your-webhook-secret-key';

// Bank account info for display
const BANK_INFO = {
    bankName: process.env.BANK_NAME || 'MB Bank',
    accountNumber: process.env.BANK_ACCOUNT_NUMBER || '0123456789',
    accountHolder: process.env.BANK_ACCOUNT_HOLDER || 'ALPHA STUDIO',
    branch: process.env.BANK_BRANCH || 'Ho Chi Minh City'
};

/**
 * Verify webhook signature
 * Different payment gateways use different signature methods
 */
const verifyWebhookSignature = (payload, signature, secret) => {
    // Common signature verification methods:
    // 1. HMAC-SHA256
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(signature || ''),
        Buffer.from(expectedSignature)
    );
};

/**
 * Generate unique transaction code for user
 * Format: AS + userId (last 4 chars) + timestamp + random
 */
const generateTransactionCode = (userId) => {
    const userPart = userId.toString().slice(-4).toUpperCase();
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `AS${userPart}${timestamp}${random}`;
};

/**
 * POST /api/payment/webhook
 * Receive webhook from payment gateway
 * NO AUTH REQUIRED - payment gateway calls this from outside
 */
router.post('/webhook', async (req, res) => {
    // Always return 200 to prevent payment gateway from retrying
    // Log everything for debugging
    console.log('=== PAYMENT WEBHOOK RECEIVED ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('================================');

    try {
        const webhookData = req.body;
        const signature = req.headers['x-webhook-signature'] ||
                         req.headers['x-signature'] ||
                         req.headers['authorization'];

        // Verify signature (if provided)
        // Note: Skip verification in development or if signature not provided
        const skipVerification = process.env.NODE_ENV === 'development' || !signature;

        if (!skipVerification) {
            const isValid = verifyWebhookSignature(webhookData, signature, WEBHOOK_SECRET);
            if (!isValid) {
                console.error('Invalid webhook signature');
                // Still return 200 but don't process
                return res.status(200).json({
                    success: false,
                    message: 'Invalid signature'
                });
            }
        }

        // Parse webhook data based on payment gateway format
        // Common fields: transactionCode, amount, status, description
        const {
            transactionCode,
            code,           // Alternative field name
            transferCode,   // Alternative field name
            amount,
            transferAmount, // Alternative field name
            content,        // Transfer content/description
            description,
            status,
            gateway
        } = webhookData;

        const txCode = transactionCode || code || transferCode;
        const txAmount = parseInt(amount || transferAmount, 10);
        const txDescription = content || description || '';

        if (!txCode) {
            console.error('No transaction code in webhook');
            return res.status(200).json({
                success: false,
                message: 'Missing transaction code'
            });
        }

        // Extract user transaction code from description
        // Expected format: "AS[userId][timestamp][random] ..." or content contains the code
        const codeMatch = txDescription.match(/AS[A-Z0-9]{10,}/i) ||
                         txCode.match(/AS[A-Z0-9]{10,}/i);
        const userTxCode = codeMatch ? codeMatch[0].toUpperCase() : txCode;

        // Find existing pending transaction or create new one
        let transaction = await Transaction.findOne({
            transactionCode: userTxCode,
            status: 'pending'
        });

        if (transaction) {
            // Update existing transaction
            transaction.status = 'completed';
            transaction.webhookData = webhookData;
            transaction.processedAt = new Date();

            // Verify amount matches (allow small variance for fees)
            if (Math.abs(transaction.amount - txAmount) > 1000) {
                transaction.status = 'failed';
                transaction.failedReason = `Amount mismatch: expected ${transaction.amount}, got ${txAmount}`;
                await transaction.save();
                console.error('Amount mismatch for transaction:', userTxCode);
                return res.status(200).json({
                    success: false,
                    message: 'Amount mismatch'
                });
            }

            await transaction.save();

            // Update user balance
            await User.findByIdAndUpdate(
                transaction.userId,
                { $inc: { balance: txAmount } },
                { new: true }
            );

            console.log(`Transaction ${userTxCode} completed. User balance updated by ${txAmount}`);
        } else {
            // Log unmatched webhook (might be manual transfer without prior request)
            console.log(`No pending transaction found for code: ${userTxCode}`);

            // Create transaction record anyway for tracking
            const newTransaction = new Transaction({
                userId: null, // Unknown user
                amount: txAmount,
                status: 'pending', // Needs manual verification
                transactionCode: userTxCode,
                paymentMethod: gateway || 'bank_transfer',
                webhookData: webhookData,
                description: `Unmatched webhook: ${txDescription}`
            });
            await newTransaction.save();
        }

        return res.status(200).json({
            success: true,
            message: 'Webhook processed'
        });

    } catch (error) {
        console.error('Webhook processing error:', error);
        // Still return 200 to prevent retries
        return res.status(200).json({
            success: false,
            message: 'Processing error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
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

        if (status && ['pending', 'completed', 'failed'].includes(status)) {
            query.status = status;
        }

        const transactions = await Transaction.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .select('-webhookData'); // Don't expose raw webhook data to users

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
        console.error('Get payment history error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get payment history'
        });
    }
});

/**
 * POST /api/payment/create
 * Create a new payment request (generate transaction code)
 * AUTH REQUIRED
 */
router.post('/create', authMiddleware, async (req, res) => {
    try {
        const { amount, paymentMethod = 'bank_transfer' } = req.body;

        if (!amount || amount < 10000) {
            return res.status(400).json({
                success: false,
                message: 'Minimum top-up amount is 10,000 VND'
            });
        }

        if (amount > 100000000) {
            return res.status(400).json({
                success: false,
                message: 'Maximum top-up amount is 100,000,000 VND'
            });
        }

        // Generate unique transaction code
        const transactionCode = generateTransactionCode(req.user._id);

        // Create pending transaction
        const transaction = new Transaction({
            userId: req.user._id,
            amount,
            status: 'pending',
            transactionCode,
            paymentMethod,
            description: `Top-up ${amount} VND`
        });

        await transaction.save();

        // Return bank transfer info
        res.json({
            success: true,
            data: {
                transaction: {
                    _id: transaction._id,
                    transactionCode: transaction.transactionCode,
                    amount: transaction.amount,
                    status: transaction.status,
                    paymentMethod: transaction.paymentMethod,
                    createdAt: transaction.createdAt
                },
                bankInfo: BANK_INFO,
                transferContent: transactionCode, // Content user should include in transfer
                expiresIn: '24 hours' // Transaction will expire if not completed
            }
        });
    } catch (error) {
        console.error('Create payment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create payment request'
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

            // Update user balance
            if (transaction.userId) {
                await User.findByIdAndUpdate(
                    transaction.userId,
                    { $inc: { balance: transaction.amount } },
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

        if (status && ['pending', 'completed', 'failed'].includes(status)) {
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

/**
 * GET /api/payment/bank-info
 * Get bank account information for transfer
 * AUTH REQUIRED
 */
router.get('/bank-info', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: BANK_INFO
    });
});

export default router;
