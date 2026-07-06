import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import CrmChannelIntegration from '../models/CrmChannelIntegration.js';
import CrmDevice from '../models/CrmDevice.js';
import CrmConversation from '../models/CrmConversation.js';
import CrmMessage from '../models/CrmMessage.js';
import crmEventHub from '../utils/crmEventHub.js';
import webchatEventHub from '../utils/webchatEventHub.js';
import { setSseHeaders, writeEvent } from '../agent-runner/sse.js';
import { upsertConversationFromInbound, createAgentCommand } from './crm.js';

// Public, unauthenticated router for the embeddable Webchat widget (Phase L).
// Mounted BEFORE the app's global CORS whitelist in index.js, with its own
// permissive cors() — arbitrary customer domains embed this widget, and it
// carries no cookies/credentials, so reflecting any Origin is safe here.
const router = express.Router();
router.use(cors({ origin: true, credentials: false }));
router.use(express.json());

// Minimal in-memory sliding-window rate limiter (matches crmEventHub's
// single-Fly-instance assumption — would need Redis if that ever changes).
const RATE_LIMIT_WINDOW_MS = 60000;
const hitsByKey = new Map();
function isRateLimited(key, max) {
    const now = Date.now();
    const recent = (hitsByKey.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    recent.push(now);
    hitsByKey.set(key, recent);
    return recent.length > max;
}
setInterval(() => {
    const now = Date.now();
    for (const [key, arr] of hitsByKey) {
        const fresh = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
        if (fresh.length === 0) hitsByKey.delete(key);
        else hitsByKey.set(key, fresh);
    }
}, RATE_LIMIT_WINDOW_MS).unref?.();

async function findEnabledWidget(widgetId) {
    return CrmChannelIntegration.findOne({ channel: 'webchat', externalAccountId: widgetId, enabled: true });
}

router.get('/:widgetId/config', async (req, res) => {
    if (isRateLimited(`config:${req.ip}`, 60)) {
        return res.status(429).json({ success: false, message: 'Qua nhieu yeu cau.' });
    }
    const integration = await findEnabledWidget(req.params.widgetId);
    if (!integration) {
        return res.status(404).json({ success: false, message: 'Widget khong ton tai.' });
    }
    res.json({
        success: true,
        data: {
            widgetName: integration.widgetName || 'Ho tro truc tuyen',
            welcomeMessage: integration.welcomeMessage || '',
            primaryColorHex: integration.primaryColorHex || '#4F46E5'
        }
    });
});

router.get('/:widgetId/messages', async (req, res) => {
    if (isRateLimited(`history:${req.ip}`, 60)) {
        return res.status(429).json({ success: false, message: 'Qua nhieu yeu cau.' });
    }
    const { widgetId } = req.params;
    const sessionToken = String(req.query.sessionToken || '').trim();
    if (!sessionToken) {
        return res.status(400).json({ success: false, message: 'Thieu sessionToken.' });
    }
    const integration = await findEnabledWidget(widgetId);
    if (!integration) {
        return res.status(404).json({ success: false, message: 'Widget khong ton tai.' });
    }
    const conversation = await CrmConversation.findOne({
        userId: integration.userId,
        accountId: widgetId,
        threadId: sessionToken,
        threadType: 'user'
    });
    if (!conversation) {
        return res.json({ success: true, data: [] });
    }
    const messages = await CrmMessage.find({ userId: integration.userId, conversationId: conversation._id })
        .sort({ createdAt: 1 })
        .limit(200);
    res.json({ success: true, data: messages });
});

router.post('/:widgetId/messages', async (req, res) => {
    const { widgetId } = req.params;
    const sessionToken = String(req.body?.sessionToken || '').trim();
    const text = String(req.body?.text || '').trim();

    if (isRateLimited(`send-ip:${req.ip}`, 30) || (sessionToken && isRateLimited(`send-session:${sessionToken}`, 30))) {
        return res.status(429).json({ success: false, message: 'Qua nhieu yeu cau.' });
    }
    if (!sessionToken || !text) {
        return res.status(400).json({ success: false, message: 'Thieu sessionToken hoac noi dung.' });
    }

    const integration = await findEnabledWidget(widgetId);
    if (!integration) {
        return res.status(404).json({ success: false, message: 'Widget khong ton tai.' });
    }

    const device = await CrmDevice.findOne({ userId: integration.userId, status: 'active' });
    if (!device) {
        return res.status(200).json({ success: true, data: { ignored: true } });
    }

    try {
        const event = {
            channel: 'webchat',
            accountId: widgetId,
            threadId: sessionToken,
            threadType: 'user',
            senderId: sessionToken,
            senderName: 'Khach',
            displayName: 'Khach',
            content: text,
            messageType: 'text',
            providerMessageId: crypto.randomUUID(),
            timestamp: Date.now()
        };
        const result = await upsertConversationFromInbound({ userId: integration.userId, deviceId: device._id, event });

        if (!result.ignored) {
            if (result.message) {
                crmEventHub.publish(integration.userId, 'message.new', {
                    message: result.message,
                    conversation: result.conversation
                });
            }
            crmEventHub.publish(integration.userId, 'conversation.updated', result.conversation);

            await createAgentCommand({
                userId: integration.userId,
                subscriptionId: device.subscriptionId,
                deviceId: device._id,
                type: 'channel.message.relay',
                payload: { channel: 'webchat', event }
            });
        }

        res.json({ success: true, data: { ignored: !!result.ignored } });
    } catch (error) {
        console.error('Webchat public message error:', error);
        res.status(error.statusCode || 500).json({ success: false, message: 'Loi server.' });
    }
});

router.get('/:widgetId/events', async (req, res) => {
    const { widgetId } = req.params;
    const sessionToken = String(req.query.sessionToken || '').trim();
    if (!sessionToken) {
        return res.status(400).json({ success: false, message: 'Thieu sessionToken.' });
    }
    const integration = await findEnabledWidget(widgetId);
    if (!integration) {
        return res.status(404).json({ success: false, message: 'Widget khong ton tai.' });
    }

    setSseHeaders(res);
    writeEvent(res, 'connected', { widgetId });
    webchatEventHub.subscribe(`${widgetId}:${sessionToken}`, res);
});

export default router;
