import express from 'express';
import crypto from 'crypto';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import CrmSubscription from '../models/CrmSubscription.js';
import CrmDevice from '../models/CrmDevice.js';
import CrmPairingSession from '../models/CrmPairingSession.js';
import CrmAgentCommand from '../models/CrmAgentCommand.js';
import CrmBillingOrder from '../models/CrmBillingOrder.js';
import CrmAiUsage from '../models/CrmAiUsage.js';
import CrmCustomer from '../models/CrmCustomer.js';
import CrmContact from '../models/CrmContact.js';
import CrmTemplate from '../models/CrmTemplate.js';
import CrmCampaign from '../models/CrmCampaign.js';
import CrmExecutionLog from '../models/CrmExecutionLog.js';
import CrmAuditLog from '../models/CrmAuditLog.js';
import SystemSetting from '../models/SystemSetting.js';

import { crmPairingLimiter, crmDeviceLimiter, crmAiLimiter } from '../middleware/crmRateLimit.js';

import { CRM_PLANS, CRM_AI_PACKS, getCrmProduct } from '../utils/crmCatalog.js';
import { hasQuota, consumeQuota, refundQuota } from '../utils/crmQuota.js';
import { fulfillCrmBillingOrder } from '../utils/crmBilling.js';
import { callConfiguredAiProvider } from '../utils/aiProvider.js';

const router = express.Router();

// Helper to generate a random 6-character uppercase string
const generateOrderContent = () => {
    const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const numbers = '123456789';
    const allChars = uppercase + numbers;
    let result = '';
    result += uppercase.charAt(Math.floor(Math.random() * uppercase.length));
    result += uppercase.charAt(Math.floor(Math.random() * uppercase.length));
    result += numbers.charAt(Math.floor(Math.random() * numbers.length));
    result += numbers.charAt(Math.floor(Math.random() * numbers.length));
    result += allChars.charAt(Math.floor(Math.random() * allChars.length));
    result += allChars.charAt(Math.floor(Math.random() * allChars.length));
    return result.split('').sort(() => 0.5 - Math.random()).join('');
};

// Helper: Ensure user has active CRM subscription for mutating actions
const requireActiveSubscription = async (req, res, next) => {
    try {
        const sub = await CrmSubscription.findOne({ userId: req.user._id, status: 'active' });
        if (!sub) {
            return res.status(403).json({
                success: false,
                message: 'YĂªu cáº§u gĂ³i Ä‘Äƒng kĂ½ Alpha CRM Ä‘ang hoáº¡t Ä‘á»™ng.'
            });
        }
        
        // Check periodEnd proactively
        if (new Date() > new Date(sub.periodEnd)) {
            sub.status = 'expired';
            await sub.save();
            return res.status(403).json({
                success: false,
                message: 'GĂ³i Ä‘Äƒng kĂ½ Alpha CRM cá»§a báº¡n Ä‘Ă£ háº¿t háº¡n.'
            });
        }
        
        req.crmSubscription = sub;
        next();
    } catch (error) {
        next(error);
    }
};

const agentAuthMiddleware = async (req, res, next) => {
    try {
        const deviceId = req.headers['x-agent-device-id'] || req.body.deviceId;
        const agentSecret = req.headers['x-agent-secret'] || req.body.agentSecret;

        if (!deviceId || !agentSecret) {
            return res.status(401).json({ success: false, message: 'Thiáº¿u deviceId hoáº·c agentSecret.' });
        }

        const device = await CrmDevice.findOne({ _id: deviceId, status: 'active' });
        if (!device) {
            return res.status(403).json({ success: false, message: 'Thiáº¿t bá»‹ khĂ´ng tá»“n táº¡i hoáº·c Ä‘Ă£ bá»‹ vĂ´ hiá»‡u hĂ³a.' });
        }

        const incomingSecretHash = crypto.createHash('sha256').update(agentSecret).digest('hex');
        if (device.agentSecretHash !== incomingSecretHash) {
            return res.status(403).json({ success: false, message: 'Sai máº­t kháº©u thiáº¿t bá»‹.' });
        }

        req.crmDevice = device;
        req.user = { _id: device.userId }; // Mock req.user for active subscription checks
        next();
    } catch (error) {
        next(error);
    }
};

const userOrAgentAuth = async (req, res, next) => {
    if ((req.headers['x-agent-device-id'] && req.headers['x-agent-secret']) || (req.body.deviceId && req.body.agentSecret)) {
        return agentAuthMiddleware(req, res, next);
    }
    return authMiddleware(req, res, next);
};

// ==========================================
// 1. CATALOG, SUBSCRIPTION, & QUOTA ROUTES
// ==========================================

// GET /api/crm/catalog
router.get('/catalog', (req, res) => {
    res.json({
        success: true,
        data: {
            plans: CRM_PLANS,
            packs: CRM_AI_PACKS
        }
    });
});

// GET /api/crm/subscription/me
router.get('/subscription/me', authMiddleware, async (req, res) => {
    try {
        // Find latest subscription (could be active, expired, cancelled, etc.)
        const sub = await CrmSubscription.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
        if (!sub) {
            return res.json({
                success: true,
                message: 'KhĂ´ng tĂ¬m tháº¥y gĂ³i Ä‘Äƒng kĂ½ CRM nĂ o.',
                data: { active: false, subscription: null }
            });
        }

        // Proactively check expiry and auto-expire if periodEnd has passed
        if (sub.status === 'active' && new Date() > new Date(sub.periodEnd)) {
            sub.status = 'expired';
            await sub.save();
        }

        res.json({
            success: true,
            data: {
                active: sub.status === 'active',
                subscription: sub
            }
        });
    } catch (error) {
        console.error('Error fetching CRM subscription:', error);
        res.status(500).json({ success: false, message: 'Lá»—i mĂ¡y chá»§.' });
    }
});

// GET /api/crm/quota
router.get('/quota', authMiddleware, async (req, res) => {
    try {
        const sub = await CrmSubscription.findOne({ userId: req.user._id, status: 'active' });
        if (!sub) {
            return res.json({
                success: true,
                data: {
                    active: false,
                    includedAiLimit: 0,
                    includedAiUsed: 0,
                    extraAiRemaining: 0,
                    totalRemaining: 0
                }
            });
        }

        // Proactively verify periodEnd of the active subscription
        if (new Date() > new Date(sub.periodEnd)) {
            sub.status = 'expired';
            await sub.save();
            return res.json({
                success: true,
                data: {
                    active: false,
                    includedAiLimit: sub.includedAiLimit,
                    includedAiUsed: sub.includedAiUsed,
                    extraAiRemaining: sub.extraAiRemaining,
                    totalRemaining: sub.extraAiRemaining // Extra AI requests are still kept but inactive
                }
            });
        }

        const includedRemaining = Math.max(0, sub.includedAiLimit - sub.includedAiUsed);
        res.json({
            success: true,
            data: {
                active: true,
                includedAiLimit: sub.includedAiLimit,
                includedAiUsed: sub.includedAiUsed,
                extraAiRemaining: sub.extraAiRemaining,
                totalRemaining: includedRemaining + sub.extraAiRemaining
            }
        });
    } catch (error) {
        console.error('Error fetching CRM quota:', error);
        res.status(500).json({ success: false, message: 'Lá»—i mĂ¡y chá»§.' });
    }
});

// ==========================================
// 2. CRM BILLING ROUTES
// ==========================================

// POST /api/crm/billing/checkout
router.post('/billing/checkout', authMiddleware, async (req, res) => {
    try {
        const { productId } = req.body;
        const paymentMethod = req.body.paymentMethod === 'credits' ? 'credit' : req.body.paymentMethod;

        if (!productId || !paymentMethod) {
            return res.status(400).json({ success: false, message: 'Thiáº¿u productId hoáº·c paymentMethod.' });
        }

        const product = getCrmProduct(productId);
        if (!product) {
            return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y sáº£n pháº©m nĂ y trong danh má»¥c.' });
        }

        const orderType = CRM_PLANS[productId] ? 'subscription' : 'ai_pack';

        // Check if active subscription exists for AI packs at checkout time
        if (orderType === 'ai_pack') {
            const activeSub = await CrmSubscription.findOne({ userId: req.user._id, status: 'active' });
            if (!activeSub) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Báº¡n pháº£i cĂ³ gĂ³i CRM Ä‘ang hoáº¡t Ä‘á»™ng Ä‘á»ƒ mua gĂ³i AI top-up.' 
                });
            }
            if (new Date() > new Date(activeSub.periodEnd)) {
                activeSub.status = 'expired';
                await activeSub.save();
                return res.status(400).json({ 
                    success: false, 
                    message: 'GĂ³i Ä‘Äƒng kĂ½ CRM cá»§a báº¡n Ä‘Ă£ háº¿t háº¡n. HĂ£y gia háº¡n trÆ°á»›c khi mua gĂ³i AI top-up.' 
                });
            }
        }

        // Method 1: Credit Balance Checkout (Fulfill immediately)
        if (paymentMethod === 'credit') {
            const priceCredits = product.priceCredits;

            // Deduct balance atomically
            const user = await User.findOneAndUpdate(
                { _id: req.user._id, balance: { $gte: priceCredits } },
                { $inc: { balance: -priceCredits } },
                { new: true }
            );

            if (!user) {
                return res.status(400).json({ success: false, message: 'Sá»‘ dÆ° credit cá»§a báº¡n khĂ´ng Ä‘á»§.' });
            }

            // Generate unique transaction code
            let transactionCode = 'CRM-' + generateOrderContent();

            try {
                // Create Transaction record for credits spent
                const transaction = new Transaction({
                    userId: user._id,
                    type: 'spend',
                    amount: product.priceVnd,
                    credits: priceCredits,
                    status: 'completed',
                    transactionCode,
                    paymentMethod: 'system',
                    description: `Mua ${product.name} qua Credits`,
                    serviceType: orderType === 'subscription' ? 'alpha_crm_subscription' : 'alpha_crm_ai_pack',
                    processedAt: new Date()
                });
                await transaction.save();

                // Fulfill the product
                let subscription;
                if (orderType === 'subscription') {
                    const now = new Date();
                    const oldActiveSub = await CrmSubscription.findOne({ userId: user._id, status: 'active' });

                    if (oldActiveSub) {
                        // Check proactively if it is expired by date
                        if (new Date() > new Date(oldActiveSub.periodEnd)) {
                            // Expire it
                            oldActiveSub.status = 'expired';
                            await oldActiveSub.save();

                            // Create new subscription starting from now
                            subscription = new CrmSubscription({
                                userId: user._id,
                                status: 'active',
                                plan: productId,
                                periodStart: now,
                                periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
                                includedAiLimit: product.includedAiLimit,
                                includedAiUsed: 0,
                                extraAiRemaining: oldActiveSub.extraAiRemaining,
                                deviceLimit: product.deviceLimit,
                                lastRenewedAt: now
                            });
                            await subscription.save();
                        } else {
                            // Extend the active subscription in-place
                            subscription = oldActiveSub;
                            subscription.periodEnd = new Date(new Date(oldActiveSub.periodEnd).getTime() + 30 * 24 * 60 * 60 * 1000);
                            subscription.plan = productId;
                            subscription.includedAiLimit = product.includedAiLimit;
                            subscription.includedAiUsed = 0; // Reset included AI quota for the new period
                            subscription.lastRenewedAt = now;
                            await subscription.save();
                        }
                    } else {
                        // No active subscription. Find latest regardless of status to preserve extraAiRemaining
                        const latestSub = await CrmSubscription.findOne({ userId: user._id }).sort({ createdAt: -1 });
                        const extraAiRemaining = latestSub ? latestSub.extraAiRemaining : 0;

                        subscription = new CrmSubscription({
                            userId: user._id,
                            status: 'active',
                            plan: productId,
                            periodStart: now,
                            periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
                            includedAiLimit: product.includedAiLimit,
                            includedAiUsed: 0,
                            extraAiRemaining,
                            deviceLimit: product.deviceLimit,
                            lastRenewedAt: now
                        });
                        await subscription.save();
                    }
                } else {
                    // AI pack purchase (subscription check already passed at checkout top)
                    subscription = await CrmSubscription.findOne({ userId: user._id, status: 'active' });
                    if (!subscription) {
                        throw new Error('Báº¡n pháº£i cĂ³ gĂ³i CRM Ä‘ang hoáº¡t Ä‘á»™ng Ä‘á»ƒ mua gĂ³i AI top-up.');
                    }
                    subscription.extraAiRemaining += product.extraAiLimit;
                    await subscription.save();
                }

                await CrmAuditLog.create({
                    userId: user._id,
                    subscriptionId: subscription ? subscription._id : null,
                    action: 'billing_checkout',
                    details: { productId, orderType, paymentMethod: 'credit' }
                });

                return res.json({
                    success: true,
                    message: `${product.name} Ä‘Ă£ Ä‘Æ°á»£c thanh toĂ¡n thĂ nh cĂ´ng qua Credits.`,
                    data: {
                        fulfilled: true,
                        subscription
                    }
                });

            } catch (err) {
                // Compensating rollback: refund credits AND mark any saved Transaction as failed
                await User.findByIdAndUpdate(user._id, { $inc: { balance: priceCredits } });
                // Mark the transaction as failed so billing history stays consistent
                await Transaction.findOneAndUpdate(
                    { transactionCode, userId: user._id, status: 'completed' },
                    { $set: { status: 'failed', failedReason: `Fulfillment failed: ${err.message}` } }
                );
                console.error(`[Compensating Rollback] Rolled back credit deduction of ${priceCredits} credits for user ${user._id} due to checkout fulfillment failure:`, err);
                
                return res.status(500).json({ 
                    success: false, 
                    message: `Lá»—i xá»­ lĂ½ Ä‘Æ¡n hĂ ng. ÄĂ£ hoĂ n tráº£ credit. Chi tiáº¿t: ${err.message}` 
                });
            }
        }

        // Method 2: Bank Transfer (Creates a CrmBillingOrder)
        if (paymentMethod === 'bank_transfer') {
            // Generate unique order code (starts with CRM)
            let orderCode;
            let attempts = 0;
            do {
                orderCode = 'CRM' + generateOrderContent();
                const exists = await CrmBillingOrder.findOne({ transactionCode: orderCode });
                if (!exists) break;
                attempts++;
            } while (attempts < 10);

            if (attempts >= 10) {
                return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ táº¡o mĂ£ Ä‘Æ¡n hĂ ng duy nháº¥t.' });
            }

            const billingOrder = new CrmBillingOrder({
                userId: req.user._id,
                productId,
                orderType,
                paymentMethod: 'bank_transfer',
                amountVnd: product.priceVnd,
                credits: product.priceCredits,
                transactionCode: orderCode,
                status: 'pending'
            });
            await billingOrder.save();

            const bankInfo = {
                bankId: 'OCB',
                bankName: 'OCB (PhÆ°Æ¡ng ÄĂ´ng)',
                accountNumber: 'CASS55252503',
                accountHolder: 'NGUYEN ANH DUC'
            };

            const qrCodeUrl = `https://img.vietqr.io/image/${bankInfo.bankId}-${bankInfo.accountNumber}-compact2.png?amount=${product.priceVnd}&addInfo=${orderCode}`;

            await CrmAuditLog.create({
                userId: req.user._id,
                action: 'billing_checkout',
                details: { productId, orderType, paymentMethod: 'bank_transfer', transactionCode: orderCode }
            });

            return res.json({
                success: true,
                data: {
                    fulfilled: false,
                    order: billingOrder,
                    bankInfo,
                    qrCodeUrl,
                    transferContent: orderCode
                }
            });
        }

        res.status(400).json({ success: false, message: 'PhÆ°Æ¡ng thá»©c thanh toĂ¡n khĂ´ng Ä‘Æ°á»£c há»— trá»£.' });
    } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json({ success: false, message: 'Lá»—i mĂ¡y chá»§ khi táº¡o Ä‘Æ¡n hĂ ng.' });
    }
});

// GET /api/crm/billing/orders
router.get('/billing/orders', authMiddleware, async (req, res) => {
    try {
        const orders = await CrmBillingOrder.find({ userId: req.user._id }).sort({ createdAt: -1 });
        res.json({ success: true, data: orders });
    } catch (error) {
        console.error('Error fetching billing orders:', error);
        res.status(500).json({ success: false, message: 'Lá»—i mĂ¡y chá»§.' });
    }
});

// ==========================================
// 3. DEVICE REGISTRATION & PAIRING ROUTES
// ==========================================

// GET /api/crm/devices
router.get('/devices', authMiddleware, async (req, res) => {
    try {
        const devices = await CrmDevice.find({ userId: req.user._id }).sort({ createdAt: -1 });
        res.json({ success: true, data: devices });
    } catch (error) {
        console.error('Error fetching devices:', error);
        res.status(500).json({ success: false, message: 'Lá»—i mĂ¡y chá»§.' });
    }
});

// POST /api/crm/devices/register
router.post('/devices/register', crmDeviceLimiter, authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const { machineFingerprint, displayName, platform, appVersion, agentVersion } = req.body;

        if (!machineFingerprint || !displayName) {
            return res.status(400).json({ success: false, message: 'Thiáº¿u vĂ¢n tay mĂ¡y (machineFingerprint) hoáº·c tĂªn hiá»ƒn thá»‹.' });
        }

        const sub = req.crmSubscription;

        // Hash the fingerprint hash to avoid exposing raw fingerprints
        const machineFingerprintHash = crypto.createHash('sha256').update(machineFingerprint).digest('hex');

        // Check if there are other active devices on this subscription
        const activeDevices = await CrmDevice.find({ subscriptionId: sub._id, status: 'active' });

        if (activeDevices.length >= sub.deviceLimit) {
            return res.status(400).json({
                success: false,
                message: `ÄĂ£ Ä‘áº¡t giá»›i háº¡n thiáº¿t bá»‹ hoáº¡t Ä‘á»™ng (${sub.deviceLimit}). Vui lĂ²ng vĂ´ hiá»‡u hĂ³a thiáº¿t bá»‹ cÅ© trÆ°á»›c.`
            });
        }

        // Generate a cryptographically strong secret for the agent
        const agentSecret = crypto.randomBytes(32).toString('hex');
        const agentSecretHash = crypto.createHash('sha256').update(agentSecret).digest('hex');

        const newDevice = new CrmDevice({
            userId: req.user._id,
            subscriptionId: sub._id,
            machineFingerprintHash,
            displayName,
            platform: platform || 'windows',
            appVersion: appVersion || '',
            agentVersion: agentVersion || '',
            status: 'active',
            agentSecretHash,
            lastIp: req.ip
        });

        await newDevice.save();

        await CrmAuditLog.create({
            userId: req.user._id,
            subscriptionId: sub._id,
            action: 'device_registered',
            details: { deviceId: newDevice._id, platform }
        });

        res.json({
            success: true,
            message: 'ÄÄƒng kĂ½ thiáº¿t bá»‹ thĂ nh cĂ´ng.',
            data: {
                deviceId: newDevice._id,
                agentSecret // Shared ONLY once during registration
            }
        });
    } catch (error) {
        if (error.code === 11000 || error.message.includes('E11000')) {
            const deviceLimit = req.crmSubscription ? req.crmSubscription.deviceLimit : 1;
            return res.status(400).json({
                success: false,
                message: `ÄĂ£ Ä‘áº¡t giá»›i háº¡n thiáº¿t bá»‹ hoáº¡t Ä‘á»™ng (${deviceLimit}). Vui lĂ²ng vĂ´ hiá»‡u hĂ³a thiáº¿t bá»‹ cÅ© trÆ°á»›c.`
            });
        }
        console.error('Device registration error:', error);
        res.status(500).json({ success: false, message: 'Lá»—i mĂ¡y chá»§ khi Ä‘Äƒng kĂ½ thiáº¿t bá»‹.' });
    }
});

// POST /api/crm/devices/:id/disable
router.post('/devices/:id/disable', authMiddleware, async (req, res) => {
    try {
        const device = await CrmDevice.findOne({ _id: req.params.id, userId: req.user._id });
        if (!device) {
            return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y thiáº¿t bá»‹ cá»§a báº¡n.' });
        }

        device.status = 'disabled';
        device.replacedAt = new Date();
        await device.save();

        res.json({
            success: true,
            message: 'ÄĂ£ vĂ´ hiá»‡u hĂ³a thiáº¿t bá»‹ thĂ nh cĂ´ng.',
            data: device
        });
    } catch (error) {
        console.error('Error disabling device:', error);
        res.status(500).json({ success: false, message: 'Lá»—i mĂ¡y chá»§.' });
    }
});

// POST /api/crm/pairing/start
router.post('/pairing/start', crmPairingLimiter, userOrAgentAuth, requireActiveSubscription, async (req, res) => {
    try {
        const { deviceId } = req.body;
        if (!deviceId) {
            return res.status(400).json({ success: false, message: 'Thiáº¿u deviceId.' });
        }

        const device = await CrmDevice.findOne({ _id: deviceId, userId: req.user._id, status: 'active' });
        if (!device) {
            return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y thiáº¿t bá»‹ hoáº¡t Ä‘á»™ng tÆ°Æ¡ng á»©ng.' });
        }

        // Generate 6-digit pairing code
        const pairingCode = Math.floor(100000 + Math.random() * 900000).toString();
        const pairingCodeHash = crypto.createHash('sha256').update(pairingCode).digest('hex');

        // Generate dynamic QR pairing token
        const qrToken = crypto.randomBytes(24).toString('hex');
        const qrTokenHash = crypto.createHash('sha256').update(qrToken).digest('hex');

        // 5-minute expiry
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        // Delete any existing pending sessions for this device
        await CrmPairingSession.deleteMany({ deviceId: device._id, status: 'pending' });

        const pairingSession = new CrmPairingSession({
            userId: req.user._id,
            subscriptionId: req.crmSubscription._id,
            deviceId: device._id,
            pairingCodeHash,
            qrTokenHash,
            status: 'pending',
            expiresAt
        });

        await pairingSession.save();

        res.json({
            success: true,
            data: {
                sessionId: pairingSession._id,
                pairingCode, // Displayed to user
                qrToken, // Embedded in VietQR/Pairing QR code
                expiresAt
            }
        });
    } catch (error) {
        console.error('Pairing start error:', error);
        res.status(500).json({ success: false, message: 'Lá»—i mĂ¡y chá»§ khi thiáº¿t láº­p ghĂ©p Ä‘Ă´i.' });
    }
});

// POST /api/crm/pairing/confirm
router.post('/pairing/confirm', crmPairingLimiter, authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const { pairingCode, qrToken } = req.body;

        if (!pairingCode && !qrToken) {
            return res.status(400).json({ success: false, message: 'Cáº§n mĂ£ ghĂ©p Ä‘Ă´i (pairingCode) hoáº·c mĂ£ QR (qrToken).' });
        }

        let query = { status: 'pending', expiresAt: { $gt: new Date() } };

        if (pairingCode) {
            const hash = crypto.createHash('sha256').update(pairingCode).digest('hex');
            query.pairingCodeHash = hash;
        } else {
            const hash = crypto.createHash('sha256').update(qrToken).digest('hex');
            query.qrTokenHash = hash;
        }

        const session = await CrmPairingSession.findOne(query);

        if (!session) {
            return res.status(404).json({ success: false, message: 'MĂ£ ghĂ©p Ä‘Ă´i khĂ´ng há»£p lá»‡ hoáº·c Ä‘Ă£ háº¿t háº¡n.' });
        }

        // Verify cross-account security: confirming user must match pairing owner
        if (session.userId.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'KhĂ´ng cĂ³ quyá»n xĂ¡c nháº­n ghĂ©p Ä‘Ă´i cho tĂ i khoáº£n khĂ¡c.'
            });
        }

        // Confirm session
        session.status = 'confirmed';
        session.confirmedAt = new Date();
        session.confirmedByUserId = req.user._id;
        await session.save();

        // Update the CrmDevice to record mobile user pairing
        const device = await CrmDevice.findById(session.deviceId);
        if (device) {
            if (!device.pairedMobileUserIds.includes(req.user._id)) {
                device.pairedMobileUserIds.push(req.user._id);
                await device.save();
            }
        }

        await CrmAuditLog.create({
            userId: req.user._id,
            subscriptionId: session.subscriptionId,
            action: 'device_paired',
            details: { deviceId: session.deviceId, sessionId: session._id }
        });

        res.json({
            success: true,
            message: 'ÄĂ£ xĂ¡c nháº­n ghĂ©p Ä‘Ă´i thiáº¿t bá»‹ thĂ nh cĂ´ng.',
            data: {
                deviceId: session.deviceId,
                confirmedAt: session.confirmedAt
            }
        });
    } catch (error) {
        console.error('Pairing confirmation error:', error);
        res.status(500).json({ success: false, message: 'Lá»—i mĂ¡y chá»§ khi xĂ¡c nháº­n ghĂ©p Ä‘Ă´i.' });
    }
});

// GET /api/crm/pairing/:id
router.get('/pairing/:id', authMiddleware, async (req, res) => {
    try {
        const session = await CrmPairingSession.findOne({ _id: req.params.id, userId: req.user._id });
        if (!session) {
            return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y phiĂªn ghĂ©p Ä‘Ă´i nĂ y.' });
        }
        res.json({ success: true, data: session });
    } catch (error) {
        console.error('Error fetching pairing session:', error);
        res.status(500).json({ success: false, message: 'Lá»—i mĂ¡y chá»§.' });
    }
});

// ==========================================
// 3.5. OUTBOUND AGENT ENDPOINTS (AGENT AUTHENTICATED)
// ==========================================


// POST /api/crm/agent/heartbeat
router.post('/agent/heartbeat', agentAuthMiddleware, async (req, res) => {
    try {
        const device = req.crmDevice;
        const { status, appVersion, agentVersion, lastError } = req.body;

        device.lastSeenAt = new Date();
        device.lastIp = req.ip;
        
        if (appVersion) device.appVersion = appVersion;
        if (agentVersion) device.agentVersion = agentVersion;
        
        await device.save();

        res.json({
            success: true,
            message: 'Nháº­n Heartbeat Agent thĂ nh cĂ´ng.'
        });
    } catch (error) {
        console.error('Agent heartbeat error:', error);
        res.status(500).json({ success: false, message: 'Lá»—i server khi ghi nháº­n heartbeat.' });
    }
});

// POST /api/crm/agent/commands/next
router.post('/agent/commands/next', agentAuthMiddleware, async (req, res) => {
    try {
        const device = req.crmDevice;
        const now = new Date();

        await CrmAgentCommand.updateMany(
            { deviceId: device._id, status: 'queued', expiresAt: { $exists: true, $lte: now } },
            { $set: { status: 'expired', finishedAt: now, errorMessage: 'Command TTL expired before agent claim.' } }
        );

        // Find the oldest queued command for this device
        const command = await CrmAgentCommand.findOneAndUpdate(
            {
                deviceId: device._id,
                status: 'queued',
                $or: [{ expiresAt: { $gt: now } }, { expiresAt: { $exists: false } }]
            },
            { $set: { status: 'sent', sentAt: now } },
            { sort: { createdAt: 1 }, new: true }
        );

        res.json({
            success: true,
            data: command || null
        });
    } catch (error) {
        console.error('Error fetching next agent command:', error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// POST /api/crm/agent/commands/:id/result
router.post('/agent/commands/:id/result', agentAuthMiddleware, async (req, res) => {
    try {
        const device = req.crmDevice;
        const { success, result, errorMessage } = req.body;

        const command = await CrmAgentCommand.findOne({ _id: req.params.id, deviceId: device._id });
        if (!command) {
            return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y lá»‡nh nĂ y.' });
        }

        if (['succeeded', 'failed', 'cancelled', 'expired'].includes(command.status)) {
            return res.status(409).json({
                success: false,
                message: 'Lệnh này đã ở trạng thái kết thúc và không thể ghi kết quả lại.'
            });
        }

        if (success && result && result.status === 'running') {
            command.status = 'running';
            command.result = result;
            command.startedAt = command.startedAt || new Date();
            await command.save();

            return res.json({
                success: true,
                message: 'Cap nhat trang thai lenh dang chay thanh cong.'
            });
        }

        command.status = success ? 'succeeded' : 'failed';
        if (result) command.result = result;
        if (errorMessage) command.errorMessage = errorMessage;
        command.finishedAt = new Date();
        await command.save();

        // Auto-update CrmCampaign status based on command result
        if (command.type === 'START_CAMPAIGN') {
            const campaignId = command.payload?.campaignId;
            if (campaignId) {
                const campaign = await CrmCampaign.findById(campaignId);
                if (campaign) {
                    const results = (result && Array.isArray(result.results)) ? result.results : [];
                    const wasCancelled = results.some(r => r.status === 'cancelled');
                    campaign.status = wasCancelled ? 'cancelled' : 'completed';
                    campaign.finishedAt = new Date();
                    await campaign.save();
                    console.log(`[crm-agent] Automatically updated Campaign ${campaignId} status to ${campaign.status}`);
                }
            }
        }

        res.json({
            success: true,
            message: 'Cáº­p nháº­t káº¿t quáº£ lá»‡nh thĂ nh cĂ´ng.'
        });
    } catch (error) {
        console.error('Error updating agent command result:', error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// ==========================================
// 4. CLOUD CRM CUSTOMER/CONTACT/TEMPLATE/CAMPAIGN CRUD
// ==========================================

// --- CUSTOMERS ---
router.get('/customers', authMiddleware, async (req, res) => {
    try {
        const customers = await CrmCustomer.find({ userId: req.user._id }).sort({ createdAt: -1 });
        res.json({ success: true, data: customers });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

router.post('/customers', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const newCust = new CrmCustomer({
            ...req.body,
            userId: req.user._id
        });
        await newCust.save();
        res.json({ success: true, data: newCust });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

router.get('/customers/:id', authMiddleware, async (req, res) => {
    try {
        const cust = await CrmCustomer.findOne({ _id: req.params.id, userId: req.user._id });
        if (!cust) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y khĂ¡ch hĂ ng.' });
        res.json({ success: true, data: cust });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

router.put('/customers/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const updateData = { ...req.body };
        delete updateData.userId;
        delete updateData._id;
        delete updateData.createdAt;
        delete updateData.updatedAt;

        const cust = await CrmCustomer.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { $set: updateData },
            { new: true }
        );
        if (!cust) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y khĂ¡ch hĂ ng.' });
        res.json({ success: true, data: cust });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

router.delete('/customers/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const result = await CrmCustomer.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!result) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y khĂ¡ch hĂ ng.' });
        res.json({ success: true, message: 'ÄĂ£ xĂ³a khĂ¡ch hĂ ng.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// --- CONTACTS ---
router.get('/contacts', authMiddleware, async (req, res) => {
    try {
        const contacts = await CrmContact.find({ userId: req.user._id }).sort({ createdAt: -1 });
        res.json({ success: true, data: contacts });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

router.post('/contacts', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const newContact = new CrmContact({
            ...req.body,
            userId: req.user._id
        });
        await newContact.save();
        res.json({ success: true, data: newContact });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

router.put('/contacts/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const updateData = { ...req.body };
        delete updateData.userId;
        delete updateData._id;
        delete updateData.createdAt;
        delete updateData.updatedAt;

        const contact = await CrmContact.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { $set: updateData },
            { new: true }
        );
        if (!contact) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y liĂªn há»‡.' });
        res.json({ success: true, data: contact });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

router.delete('/contacts/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const result = await CrmContact.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!result) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y liĂªn há»‡.' });
        res.json({ success: true, message: 'ÄĂ£ xĂ³a liĂªn há»‡.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// --- TEMPLATES ---
router.get('/templates', authMiddleware, async (req, res) => {
    try {
        const templates = await CrmTemplate.find({ userId: req.user._id }).sort({ createdAt: -1 });
        res.json({ success: true, data: templates });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

router.post('/templates', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const newTemplate = new CrmTemplate({
            ...req.body,
            userId: req.user._id
        });
        await newTemplate.save();
        res.json({ success: true, data: newTemplate });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

router.put('/templates/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const updateData = { ...req.body };
        delete updateData.userId;
        delete updateData._id;
        delete updateData.createdAt;
        delete updateData.updatedAt;

        const template = await CrmTemplate.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { $set: updateData },
            { new: true }
        );
        if (!template) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y biá»ƒu máº«u.' });
        res.json({ success: true, data: template });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

router.delete('/templates/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const result = await CrmTemplate.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!result) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y biá»ƒu máº«u.' });
        res.json({ success: true, message: 'ÄĂ£ xĂ³a biá»ƒu máº«u.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// --- CAMPAIGNS ---
router.get('/campaigns', authMiddleware, async (req, res) => {
    try {
        const campaigns = await CrmCampaign.find({ userId: req.user._id }).sort({ createdAt: -1 });
        res.json({ success: true, data: campaigns });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

router.post('/campaigns', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const newCampaign = new CrmCampaign({
            ...req.body,
            userId: req.user._id
        });
        await newCampaign.save();
        res.json({ success: true, data: newCampaign });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

router.put('/campaigns/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const updateData = { ...req.body };
        delete updateData.userId;
        delete updateData._id;
        delete updateData.createdAt;
        delete updateData.updatedAt;

        const campaign = await CrmCampaign.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { $set: updateData },
            { new: true }
        );
        if (!campaign) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y chiáº¿n dá»‹ch.' });
        res.json({ success: true, data: campaign });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// POST /api/crm/campaigns/:id/start
router.post('/campaigns/:id/start', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const campaign = await CrmCampaign.findOne({ _id: req.params.id, userId: req.user._id });
        if (!campaign) {
            return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y chiáº¿n dá»‹ch.' });
        }

        if (campaign.status === 'running' || campaign.status === 'completed') {
            return res.status(400).json({ success: false, message: 'Chiáº¿n dá»‹ch Ä‘Ă£/Ä‘ang cháº¡y.' });
        }

        // Find active device for enqueuing commands
        const activeDevice = await CrmDevice.findOne({ userId: req.user._id, status: 'active' });
        if (!activeDevice) {
            return res.status(400).json({ 
                success: false, 
                message: 'Báº¡n cáº§n ghĂ©p Ä‘Ă´i thiáº¿t bá»‹ Windows Ä‘ang hoáº¡t Ä‘á»™ng trÆ°á»›c khi báº¯t Ä‘áº§u chiáº¿n dá»‹ch.' 
            });
        }

        // Fetch template content
        const template = await CrmTemplate.findOne({ _id: campaign.templateId, userId: req.user._id });
        if (!template) {
            return res.status(400).json({
                success: false,
                message: 'Khong tim thay mau tin nhan cua chien dich.'
            });
        }
        const templateMessageText = template ? template.body : 'Tin nháº¯n chiáº¿n dá»‹ch';

        // Fetch recipients details (Zalo phone, name, ID)
        const customers = await CrmCustomer.find({ _id: { $in: campaign.targetCustomerIds }, userId: req.user._id });
        const targetRecipients = customers
            .map(c => ({
                customerId: c._id,
                phone: c.phone ? c.phone.trim() : '',
                name: c.name
            }))
            .filter(c => c.phone !== '');

        if (targetRecipients.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Chien dich khong co khach hang nao co so dien thoai/Zalo hop le.'
            });
        }

        campaign.status = 'running';
        campaign.startedAt = new Date();
        await campaign.save();

        // Enqueue command tasks to active Windows agent (rather than calling agent directly)
        const agentCommand = new CrmAgentCommand({
            userId: req.user._id,
            subscriptionId: req.crmSubscription._id,
            deviceId: activeDevice._id,
            type: 'START_CAMPAIGN',
            payload: {
                campaignId: campaign._id,
                templateId: campaign.templateId,
                message: templateMessageText,
                channel: campaign.channel,
                recipients: targetRecipients
            },
            status: 'queued',
            idempotencyKey: `campaign-start:${campaign._id}`,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        });
        await agentCommand.save();

        res.json({
            success: true,
            message: 'ÄĂ£ Ä‘Æ°a lá»‡nh báº¯t Ä‘áº§u chiáº¿n dá»‹ch vĂ o hĂ ng Ä‘á»£i lá»‡nh cá»§a thiáº¿t bá»‹.',
            data: { campaign, agentCommand }
        });
    } catch (error) {
        console.error('Campaign start error:', error);
        res.status(500).json({ success: false, message: 'Lá»—i mĂ¡y chá»§.' });
    }
});

// POST /api/crm/campaigns/:id/cancel
router.post('/campaigns/:id/cancel', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const campaign = await CrmCampaign.findOne({ _id: req.params.id, userId: req.user._id });
        if (!campaign) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y chiáº¿n dá»‹ch.' });

        campaign.status = 'cancelled';
        campaign.finishedAt = new Date();
        await campaign.save();

        // Send cancel command to agent
        const activeDevice = await CrmDevice.findOne({ userId: req.user._id, status: 'active' });
        if (activeDevice) {
            await CrmAgentCommand.create({
                userId: req.user._id,
                subscriptionId: req.crmSubscription._id,
                deviceId: activeDevice._id,
                type: 'CANCEL_CAMPAIGN',
                payload: { campaignId: campaign._id },
                status: 'queued',
                idempotencyKey: `campaign-cancel:${campaign._id}:${Date.now()}`,
                expiresAt: new Date(Date.now() + 60 * 60 * 1000)
            });
        }

        res.json({ success: true, message: 'ÄĂ£ há»§y chiáº¿n dá»‹ch thĂ nh cĂ´ng.', data: campaign });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// --- EXECUTION LOGS ---
router.get('/execution-logs', authMiddleware, async (req, res) => {
    try {
        const logs = await CrmExecutionLog.find({ userId: req.user._id }).sort({ createdAt: -1 });
        res.json({ success: true, data: logs });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// ==========================================
// 5. CRM AI ENDPOINT (QUOTA ENFORCED)
// ==========================================

// POST /api/crm/ai/chat
router.post('/ai/chat', crmAiLimiter, authMiddleware, requireActiveSubscription, async (req, res) => {
    const startTime = Date.now();
    let quotaBucket = 'none';
    const sub = req.crmSubscription;

    try {
        const { message, messages } = req.body;
        const promptContent = message || (messages && messages[messages.length - 1]?.content);

        if (!promptContent) {
            return res.status(400).json({ success: false, message: 'Ná»™i dung tin nháº¯n khĂ´ng Ä‘Æ°á»£c rá»—ng.' });
        }

        // Limit message length
        if (promptContent.length > 5000) {
            return res.status(400).json({ success: false, message: 'Tin nháº¯n quĂ¡ dĂ i (tá»‘i Ä‘a 5000 kĂ½ tá»±).' });
        }

        // 1. Quota check
        if (!hasQuota(sub)) {
            return res.status(403).json({
                success: false,
                message: 'Háº¿t háº¡n má»©c AI quota. Vui lĂ²ng mua thĂªm gĂ³i AI top-up.'
            });
        }

        // 2. Consume quota inline before the API call to avoid race conditions
        quotaBucket = consumeQuota(sub);
        await sub.save();

        // 3. Forward AI request
        const sessionId = `crm:${req.user._id}`;
        let aiResponse;
        try {
            aiResponse = await callConfiguredAiProvider(promptContent, sessionId, { messages });
        } catch (aiError) {
            // Refund consumed quota if calling upstream fails
            refundQuota(sub, quotaBucket);
            await sub.save();

            // Log failed usage
            await CrmAiUsage.create({
                userId: req.user._id,
                subscriptionId: sub._id,
                requestType: 'chat',
                provider: 'gcli',
                status: 'failed',
                quotaBucket,
                latencyMs: Date.now() - startTime,
                errorMessage: aiError.message
            });

            return res.status(500).json({
                success: false,
                message: `Lá»—i AI: ${aiError.message}`
            });
        }

        // 4. Save successful usage logs
        const promptTokens = aiResponse.usage?.promptTokens || 0;
        const completionTokens = aiResponse.usage?.completionTokens || 0;
        const totalTokens = aiResponse.usage?.totalTokens || 0;

        await CrmAiUsage.create({
            userId: req.user._id,
            subscriptionId: sub._id,
            requestType: 'chat',
            provider: 'gcli',
            model: aiResponse.model,
            status: 'succeeded',
            quotaBucket,
            tokens: { promptTokens, completionTokens, totalTokens },
            latencyMs: Date.now() - startTime
        });

        const includedRemaining = Math.max(0, sub.includedAiLimit - sub.includedAiUsed);

        res.json({
            success: true,
            data: {
                text: aiResponse.text,
                quota: {
                    bucketUsed: quotaBucket,
                    includedAiLimit: sub.includedAiLimit,
                    includedAiUsed: sub.includedAiUsed,
                    extraAiRemaining: sub.extraAiRemaining,
                    totalRemaining: includedRemaining + sub.extraAiRemaining
                }
            }
        });
    } catch (error) {
        console.error('CRM AI Chat Error:', error);
        res.status(500).json({ success: false, message: 'Lá»—i mĂ¡y chá»§ khi xá»­ lĂ½ AI Chat.' });
    }
});

// ==========================================
// 6. ADMIN CRM ENDPOINTS
// ==========================================

// GET /api/crm/admin/subscriptions
router.get('/admin/subscriptions', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { status, email } = req.query;
        const query = {};
        if (status) query.status = status;
        if (email) {
            const user = await User.findOne({ email });
            if (user) query.userId = user._id;
            else return res.json({ success: true, data: [] });
        }

        const subs = await CrmSubscription.find(query).populate('userId', 'name email').sort({ createdAt: -1 });
        res.json({ success: true, data: subs });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// GET /api/crm/admin/devices
router.get('/admin/devices', authMiddleware, adminOnly, async (req, res) => {
    try {
        const devices = await CrmDevice.find().populate('userId', 'name email').sort({ createdAt: -1 });
        res.json({ success: true, data: devices });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// PATCH /api/crm/admin/devices/:id/disable
router.patch('/admin/devices/:id/disable', authMiddleware, adminOnly, async (req, res) => {
    try {
        const device = await CrmDevice.findById(req.params.id);
        if (!device) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y thiáº¿t bá»‹.' });

        device.status = 'disabled';
        device.replacedAt = new Date();
        await device.save();

        await CrmAuditLog.create({
            userId: device.userId,
            deviceId: device._id,
            action: 'admin_device_disabled',
            details: { adminUserId: req.user._id }
        });

        res.json({ success: true, message: 'ÄĂ£ vĂ´ hiá»‡u hĂ³a thiáº¿t bá»‹.', data: device });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// GET /api/crm/admin/billing/orders
router.get('/admin/billing/orders', authMiddleware, adminOnly, async (req, res) => {
    try {
        const orders = await CrmBillingOrder.find().populate('userId', 'name email').sort({ createdAt: -1 });
        res.json({ success: true, data: orders });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// POST /api/crm/admin/billing/orders/:id/approve
router.post('/admin/billing/orders/:id/approve', authMiddleware, adminOnly, async (req, res) => {
    try {
        const fulfillment = await fulfillCrmBillingOrder({
            selector: { _id: req.params.id },
            source: 'admin',
            adminUserId: req.user._id
        });

        if (fulfillment.status === 'fulfilled') {
            return res.json({
                success: true,
                message: 'ÄÆ¡n hĂ ng Ä‘Ă£ Ä‘Æ°á»£c duyá»‡t thanh toĂ¡n vĂ  kĂ­ch hoáº¡t dá»‹ch vá»¥ thĂ nh cĂ´ng.'
            });
        }

        if (fulfillment.status === 'already_paid') {
            return res.status(400).json({ success: false, message: 'ÄÆ¡n hĂ ng nĂ y Ä‘Ă£ Ä‘Æ°á»£c xá»­ lĂ½.' });
        }

        if (fulfillment.status === 'already_fulfilling') {
            return res.status(409).json({
                success: false,
                message: 'ÄÆ¡n hĂ ng Ä‘ang á»Ÿ tráº¡ng thĂ¡i xá»­ lĂ½ cÅ© vĂ  cáº§n kiá»ƒm tra thá»§ cĂ´ng trÆ°á»›c khi duyá»‡t láº¡i.'
            });
        }

        if (fulfillment.status === 'not_found') {
            return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y Ä‘Æ¡n hĂ ng.' });
        }

        return res.status(400).json({ success: false, message: 'ÄÆ¡n hĂ ng nĂ y khĂ´ng cĂ²n á»Ÿ tráº¡ng thĂ¡i chá».' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// GET /api/crm/admin/ai/usage
router.get('/admin/ai/usage', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { userId } = req.query;
        const query = {};
        if (userId) query.userId = userId;

        const usage = await CrmAiUsage.find(query).populate('userId', 'name email').sort({ createdAt: -1 }).limit(100);
        res.json({ success: true, data: usage });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// GET /api/crm/admin/audit-logs
router.get('/admin/audit-logs', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { userId, subscriptionId, deviceId, action } = req.query;
        const query = {};
        if (userId) query.userId = userId;
        if (subscriptionId) query.subscriptionId = subscriptionId;
        if (deviceId) query.deviceId = deviceId;
        if (action) query.action = action;

        const logs = await CrmAuditLog.find(query)
            .populate('userId', 'name email')
            .populate('deviceId', 'displayName platform status')
            .sort({ createdAt: -1 })
            .limit(200);

        res.json({ success: true, data: logs });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lá»—i server.' });
    }
});

// GET /api/crm/releases/latest
router.get('/releases/latest', async (req, res) => {
    try {
        const setting = await SystemSetting.findOne({ key: 'crm_latest_release' });
        if (setting && setting.value) {
            return res.json({
                success: true,
                data: setting.value
            });
        }

        // Dynamic fallback to GitHub latest release if not specified in DB
        let githubData = null;
        try {
            const response = await fetch('https://api.github.com/repos/LittleKai/alpha-crm-app/releases/latest', {
                headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'alpha-studio-backend' }
            });
            if (response.ok) {
                const release = await response.json();
                const windowsAsset = release.assets?.find(a => a.name.endsWith('.exe') || a.name.endsWith('.msix'));
                const androidAsset = release.assets?.find(a => a.name.endsWith('.apk'));
                githubData = {
                    version: release.tag_name ? (release.tag_name.startsWith('v') ? release.tag_name.substring(1) : release.tag_name) : '1.0.0',
                    windowsInstallerUrl: windowsAsset ? windowsAsset.browser_download_url : 'https://github.com/LittleKai/alpha-crm-app/releases/download/v1.0.0/alpha-crm-setup.exe',
                    androidApkUrl: androidAsset ? androidAsset.browser_download_url : 'https://github.com/LittleKai/alpha-crm-app/releases/download/v1.0.0/alpha-crm-app.apk',
                    releaseNotes: release.body || 'Báº£n phĂ¡t hĂ nh chĂ­nh thá»©c Alpha CRM',
                    sha256: 'mock-sha256-hash-value',
                    publishedAt: release.published_at || new Date().toISOString()
                };
            }
        } catch (fetchError) {
            console.error('Failed to fetch from GitHub API:', fetchError.message);
        }

        // Return GitHub data or the hardcoded default
        const latestRelease = githubData || {
            version: '1.0.0',
            windowsInstallerUrl: 'https://github.com/LittleKai/alpha-crm-app/releases/download/v1.0.0/alpha-crm-setup.exe',
            androidApkUrl: 'https://github.com/LittleKai/alpha-crm-app/releases/download/v1.0.0/alpha-crm-app.apk',
            releaseNotes: 'Báº£n phĂ¡t hĂ nh chĂ­nh thá»©c Alpha CRM Production',
            sha256: 'mock-sha256-hash-value',
            publishedAt: new Date().toISOString()
        };

        res.json({
            success: true,
            data: latestRelease
        });
    } catch (error) {
        console.error('Error fetching latest CRM release:', error);
        res.status(500).json({ success: false, message: 'Lá»—i server khi láº¥y thĂ´ng tin báº£n phĂ¡t hĂ nh má»›i nháº¥t.' });
    }
});

export default router;

