import express from 'express';
import crypto from 'crypto';
import CrmChannelIntegration from '../models/CrmChannelIntegration.js';
import CrmDevice from '../models/CrmDevice.js';
import { decrypt } from '../utils/encryption.js';
import { upsertConversationFromInbound, createAgentCommand } from './crm.js';
import crmEventHub from '../utils/crmEventHub.js';

const router = express.Router();

function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
    if (!signatureHeader || !rawBody) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const provided = Buffer.from(signatureHeader);
    const computed = Buffer.from(expected);
    if (provided.length !== computed.length) return false;
    return crypto.timingSafeEqual(provided, computed);
}

function attachmentTypeToMessageType(type) {
    if (type === 'image') return 'image';
    if (type === 'video') return 'video';
    if (type === 'audio') return 'audio';
    if (type === 'file') return 'file';
    return 'text';
}

async function handleFacebookMessagingEvent(integration, device, messagingEvent) {
    const senderId = messagingEvent.sender?.id;
    const recipientId = messagingEvent.recipient?.id;
    if (!senderId || !recipientId) return;

    // A Page also receives its own outbound messages back as echoes
    // (message.is_echo) — the customer's PSID is always the thread id,
    // regardless of which side actually sent this particular event.
    const isEcho = messagingEvent.message?.is_echo === true;
    const customerId = isEcho ? recipientId : senderId;
    const attachments = messagingEvent.message?.attachments || null;
    const messageType = attachments && attachments.length > 0
        ? attachmentTypeToMessageType(attachments[0].type)
        : 'text';

    const event = {
        channel: 'facebook_page',
        accountId: integration.externalAccountId,
        threadId: customerId,
        threadType: 'user',
        senderId: isEcho ? integration.externalAccountId : senderId,
        senderName: '',
        content: messagingEvent.message?.text || '',
        messageType,
        attachments,
        providerMessageId: messagingEvent.message?.mid || '',
        timestamp: messagingEvent.timestamp
            ? new Date(messagingEvent.timestamp).toISOString()
            : new Date().toISOString()
    };

    const result = await upsertConversationFromInbound({
        userId: integration.userId,
        deviceId: device._id,
        event
    });

    if (!result.ignored) {
        if (result.message) {
            crmEventHub.publish(integration.userId, 'message.new', {
                message: result.message,
                conversation: result.conversation
            });
        }
        crmEventHub.publish(integration.userId, 'conversation.updated', result.conversation);
    }

    await createAgentCommand({
        userId: integration.userId,
        subscriptionId: device.subscriptionId,
        deviceId: device._id,
        type: 'channel.message.relay',
        payload: { channel: 'facebook_page', event }
    });
}

// Meta calls this to verify webhook ownership when the integration is first
// configured in the Meta developer console (no signature available yet, so
// the shared verifyToken is the only thing to check against).
router.get('/facebook/webhook', async (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode !== 'subscribe' || !token) return res.sendStatus(403);
    const integration = await CrmChannelIntegration.findOne({ channel: 'facebook_page', verifyToken: token, enabled: true });
    if (!integration) return res.sendStatus(403);
    res.status(200).send(challenge);
});

router.post('/facebook/webhook', async (req, res) => {
    try {
        const payload = req.body;
        const pageId = payload?.entry?.[0]?.id;
        if (!pageId) return res.sendStatus(400);

        const integration = await CrmChannelIntegration.findOne({ channel: 'facebook_page', externalAccountId: String(pageId), enabled: true });
        if (!integration) return res.sendStatus(404);

        const signature = req.get('x-hub-signature-256') || '';
        const appSecret = decrypt(integration.appSecret);
        if (!verifyMetaSignature(req.rawBody, signature, appSecret)) {
            return res.sendStatus(403);
        }

        const device = await CrmDevice.findOne({ userId: integration.userId, status: 'active' });
        if (device) {
            for (const entry of payload.entry || []) {
                for (const messagingEvent of entry.messaging || []) {
                    await handleFacebookMessagingEvent(integration, device, messagingEvent);
                }
            }
        }

        // Meta retries aggressively on non-200 responses, including when we
        // simply have no active device to relay to right now.
        res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error('Facebook webhook error:', error);
        res.status(500).send('ERROR');
    }
});

// --- TikTok -------------------------------------------------------------
// NOTE: TikTok Business Messaging API webhook shape, header names, and
// payload field names below are a placeholder mirroring the Facebook
// Messenger structure (challenge verify + HMAC-SHA256 body signature).
// They are NOT yet verified against real TikTok API docs/credentials —
// re-check `x-tiktok-signature`, `account_id`, and the `messages` payload
// shape once real TikTok Business Messaging API access is available.

function verifyTiktokSignature(rawBody, signatureHeader, appSecret) {
    if (!signatureHeader || !rawBody) return false;
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const provided = Buffer.from(signatureHeader);
    const computed = Buffer.from(expected);
    if (provided.length !== computed.length) return false;
    return crypto.timingSafeEqual(provided, computed);
}

async function handleTiktokMessagingEvent(integration, device, messagingEvent) {
    const senderId = messagingEvent.sender_id;
    const recipientId = messagingEvent.recipient_id;
    if (!senderId || !recipientId) return;

    const isEcho = messagingEvent.is_echo === true;
    const customerId = isEcho ? recipientId : senderId;
    const attachments = messagingEvent.attachments || null;
    const messageType = attachments && attachments.length > 0
        ? attachmentTypeToMessageType(attachments[0].type)
        : 'text';

    const event = {
        channel: 'tiktok',
        accountId: integration.externalAccountId,
        threadId: customerId,
        threadType: 'user',
        senderId: isEcho ? integration.externalAccountId : senderId,
        senderName: '',
        content: messagingEvent.text || '',
        messageType,
        attachments,
        providerMessageId: messagingEvent.message_id || '',
        timestamp: messagingEvent.create_time
            ? new Date(messagingEvent.create_time * 1000).toISOString()
            : new Date().toISOString()
    };

    const result = await upsertConversationFromInbound({
        userId: integration.userId,
        deviceId: device._id,
        event
    });

    if (!result.ignored) {
        if (result.message) {
            crmEventHub.publish(integration.userId, 'message.new', {
                message: result.message,
                conversation: result.conversation
            });
        }
        crmEventHub.publish(integration.userId, 'conversation.updated', result.conversation);
    }

    await createAgentCommand({
        userId: integration.userId,
        subscriptionId: device.subscriptionId,
        deviceId: device._id,
        type: 'channel.message.relay',
        payload: { channel: 'tiktok', event }
    });
}

// Placeholder verification handshake, mirroring Facebook's hub.challenge
// pattern — re-verify against real TikTok webhook setup docs.
router.get('/tiktok/webhook', async (req, res) => {
    const token = req.query['hub.verify_token'] || req.query.verify_token;
    const challenge = req.query['hub.challenge'] || req.query.challenge;
    if (!token) return res.sendStatus(403);
    const integration = await CrmChannelIntegration.findOne({ channel: 'tiktok', verifyToken: token, enabled: true });
    if (!integration) return res.sendStatus(403);
    res.status(200).send(challenge || 'OK');
});

router.post('/tiktok/webhook', async (req, res) => {
    try {
        const payload = req.body;
        const accountId = payload?.account_id;
        if (!accountId) return res.sendStatus(400);

        const integration = await CrmChannelIntegration.findOne({ channel: 'tiktok', externalAccountId: String(accountId), enabled: true });
        if (!integration) return res.sendStatus(404);

        const signature = req.get('x-tiktok-signature') || '';
        const appSecret = decrypt(integration.appSecret);
        if (!verifyTiktokSignature(req.rawBody, signature, appSecret)) {
            return res.sendStatus(403);
        }

        const device = await CrmDevice.findOne({ userId: integration.userId, status: 'active' });
        if (device) {
            for (const messagingEvent of payload.messages || []) {
                await handleTiktokMessagingEvent(integration, device, messagingEvent);
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('TikTok webhook error:', error);
        res.status(500).send('ERROR');
    }
});

export default router;
