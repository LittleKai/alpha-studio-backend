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

// --- Instagram -----------------------------------------------------------
// Instagram Direct Messaging rides the same Meta Graph API infrastructure as
// Facebook Messenger (same App/App Secret, same X-Hub-Signature-256 scheme,
// same entry[].messaging[] shape) — the only difference is Meta sends
// `object: "instagram"` instead of `"page"`, and entry[].id is the
// IG-linked professional account id rather than a Page id.

async function handleInstagramMessagingEvent(integration, device, messagingEvent) {
    const senderId = messagingEvent.sender?.id;
    const recipientId = messagingEvent.recipient?.id;
    if (!senderId || !recipientId) return;

    // Same self-echo caveat as Facebook: the IG account also receives its
    // own outbound messages back as echoes.
    const isEcho = messagingEvent.message?.is_echo === true;
    const customerId = isEcho ? recipientId : senderId;
    const attachments = messagingEvent.message?.attachments || null;
    const messageType = attachments && attachments.length > 0
        ? attachmentTypeToMessageType(attachments[0].type)
        : 'text';

    const event = {
        channel: 'instagram',
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
        payload: { channel: 'instagram', event }
    });
}

router.get('/instagram/webhook', async (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode !== 'subscribe' || !token) return res.sendStatus(403);
    const integration = await CrmChannelIntegration.findOne({ channel: 'instagram', verifyToken: token, enabled: true });
    if (!integration) return res.sendStatus(403);
    res.status(200).send(challenge);
});

router.post('/instagram/webhook', async (req, res) => {
    try {
        const payload = req.body;
        const igAccountId = payload?.entry?.[0]?.id;
        if (!igAccountId) return res.sendStatus(400);

        const integration = await CrmChannelIntegration.findOne({ channel: 'instagram', externalAccountId: String(igAccountId), enabled: true });
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
                    await handleInstagramMessagingEvent(integration, device, messagingEvent);
                }
            }
        }

        res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error('Instagram webhook error:', error);
        res.status(500).send('ERROR');
    }
});

// --- WhatsApp -------------------------------------------------------------
// WhatsApp Cloud API rides the same Meta Graph API infrastructure as
// Facebook/Instagram (same App/App Secret, same X-Hub-Signature-256 scheme),
// but the payload shape is the Business Platform "Cloud API" format
// (entry[].changes[].value.messages[]), not the Messenger Platform's
// entry[].messaging[]. externalAccountId is the WhatsApp phone_number_id
// (value.metadata), not the WABA id in entry[].id, since one WABA can host
// multiple phone numbers.

function whatsappMessageTypeToMessageType(type) {
    if (type === 'image' || type === 'sticker') return 'image';
    if (type === 'video') return 'video';
    if (type === 'audio') return 'audio';
    if (type === 'document') return 'file';
    return 'text';
}

async function handleWhatsappMessagingEvent(integration, device, value) {
    const message = (value.messages || [])[0];
    if (!message) return; // status/delivery-receipt-only callback, nothing to relay

    const senderId = message.from;
    if (!senderId) return;

    const messageType = whatsappMessageTypeToMessageType(message.type);
    const media = message.type !== 'text' ? message[message.type] : null;
    const attachments = media ? [{ type: message.type, payload: { mediaId: media.id, mimeType: media.mime_type } }] : null;
    const content = message.type === 'text' ? (message.text?.body || '') : (media?.caption || '');
    const senderName = value.contacts?.find((contact) => contact.wa_id === senderId)?.profile?.name || '';

    const event = {
        channel: 'whatsapp',
        accountId: integration.externalAccountId,
        threadId: senderId,
        threadType: 'user',
        senderId,
        senderName,
        content,
        messageType,
        attachments,
        providerMessageId: message.id || '',
        timestamp: message.timestamp
            ? new Date(Number(message.timestamp) * 1000).toISOString()
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
        payload: { channel: 'whatsapp', event }
    });
}

router.get('/whatsapp/webhook', async (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode !== 'subscribe' || !token) return res.sendStatus(403);
    const integration = await CrmChannelIntegration.findOne({ channel: 'whatsapp', verifyToken: token, enabled: true });
    if (!integration) return res.sendStatus(403);
    res.status(200).send(challenge);
});

router.post('/whatsapp/webhook', async (req, res) => {
    try {
        const payload = req.body;
        const value = payload?.entry?.[0]?.changes?.[0]?.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) return res.sendStatus(400);

        const integration = await CrmChannelIntegration.findOne({ channel: 'whatsapp', externalAccountId: String(phoneNumberId), enabled: true });
        if (!integration) return res.sendStatus(404);

        const signature = req.get('x-hub-signature-256') || '';
        const appSecret = decrypt(integration.appSecret);
        if (!verifyMetaSignature(req.rawBody, signature, appSecret)) {
            return res.sendStatus(403);
        }

        const device = await CrmDevice.findOne({ userId: integration.userId, status: 'active' });
        if (device) {
            for (const entry of payload.entry || []) {
                for (const change of entry.changes || []) {
                    await handleWhatsappMessagingEvent(integration, device, change.value || {});
                }
            }
        }

        res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error('WhatsApp webhook error:', error);
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

// --- Telegram -------------------------------------------------------------
// Telegram Bot API has no domain-verification GET handshake and no
// HMAC-signed body — instead Telegram calls setWebhook with a secret_token,
// which it echoes back on every update via the X-Telegram-Bot-Api-Secret-Token
// header. There is also no per-update account identifier in the payload, so
// the bot is identified by its numeric id in the URL path (the part of the
// bot token before ':', obtained via getMe when the local bridge registers
// the bot) and matched against externalAccountId.

async function handleTelegramMessagingEvent(integration, device, message) {
    const chat = message.chat;
    if (!chat) return;

    const event = {
        channel: 'telegram',
        accountId: integration.externalAccountId,
        threadId: String(chat.id),
        threadType: chat.type === 'private' ? 'user' : 'group',
        senderId: String(message.from?.id || chat.id),
        senderName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || message.from?.username || '',
        content: message.text || message.caption || '',
        messageType: 'text',
        attachments: null,
        providerMessageId: String(message.message_id || ''),
        timestamp: message.date
            ? new Date(Number(message.date) * 1000).toISOString()
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
        payload: { channel: 'telegram', event }
    });
}

router.post('/telegram/webhook/:botId', async (req, res) => {
    try {
        const integration = await CrmChannelIntegration.findOne({
            channel: 'telegram',
            externalAccountId: String(req.params.botId),
            enabled: true
        });
        if (!integration) return res.sendStatus(404);

        const secretHeader = req.get('x-telegram-bot-api-secret-token') || '';
        if (!integration.verifyToken || secretHeader !== integration.verifyToken) {
            return res.sendStatus(403);
        }

        const device = await CrmDevice.findOne({ userId: integration.userId, status: 'active' });
        const message = req.body?.message;
        if (device && message) {
            await handleTelegramMessagingEvent(integration, device, message);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Telegram webhook error:', error);
        res.status(500).send('ERROR');
    }
});

export default router;
