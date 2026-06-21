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
import CrmConversation from '../models/CrmConversation.js';
import CrmMessage from '../models/CrmMessage.js';
import CrmChatbotRule from '../models/CrmChatbotRule.js';
import CrmChatbotLog from '../models/CrmChatbotLog.js';
import CrmZaloGroup from '../models/CrmZaloGroup.js';
import CrmGroupMessage from '../models/CrmGroupMessage.js';
import CrmGroupCheckpoint from '../models/CrmGroupCheckpoint.js';
import CrmGroupSummary from '../models/CrmGroupSummary.js';
import CrmGroupInsight from '../models/CrmGroupInsight.js';
import CrmSegment from '../models/CrmSegment.js';
import CrmTask from '../models/CrmTask.js';
import SystemSetting from '../models/SystemSetting.js';

import { crmPairingLimiter, crmDeviceLimiter, crmAiLimiter } from '../middleware/crmRateLimit.js';

import { CRM_PLANS, CRM_AI_PACKS, getCrmProduct } from '../utils/crmCatalog.js';
import { applySubscriptionEntitlement } from '../utils/crmBilling.js';
import {
    consumeQuota,
    consumeQuotaUnits,
    hasQuota,
    refundQuota,
    refundQuotaUnits
} from '../utils/crmQuota.js';
import { fulfillCrmBillingOrder } from '../utils/crmBilling.js';
import { callConfiguredAiProvider } from '../utils/aiProvider.js';
import { calculateCrmLeadScore } from '../utils/crmLeadScoring.js';
import { buildGroupSummaryPrompt, buildGroupSummaryPromptV2, parseGroupSummaryJson, dedupKeyForItem, extractSimpleInsights, redactPhoneLikeStrings } from '../utils/crmGroupSummary.js';
import {
    buildConversationMessageQuery,
    normalizeCrmMessageType,
    normalizeQueryLimit,
    withManagedConversationVisibility,
    isLocalFirstLiveChatEnabled
} from '../utils/crmLiveChat.js';
import {
    buildActiveDeviceConflict,
    createAgentSecret,
    replaceActiveDevice
} from '../utils/crmDeviceSessions.js';
import {
    buildChatbotConfigSnapshot,
    hasHandoffKeyword,
    matchChatbotRule,
    normalizeChatbotDebounceSeconds,
    normalizeChatbotHistoryLimit
} from '../utils/crmChatbot.js';
import { buildTerminalCommandUpdate } from '../retention/terminalUpdates.js';

const router = express.Router();

const mapAgentExecutionStatus = (status) => {
    if (status === 'succeeded' || status === 'success') return 'success';
    if (status === 'cancelled') return 'cancelled';
    if (status === 'failed') return 'failed';
    if (status === 'running') return 'running';
    return 'queued';
};

const buildCampaignMessagePreview = (templateText, recipientName) => {
    const text = (templateText || 'Tin nhan chien dich')
        .replace(/\{\{name\}\}/g, recipientName || 'Anh/Chi');
    return text.length > 240 ? `${text.slice(0, 237)}...` : text;
};

const previewText = (value = '', max = 240) => {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
};

const sanitizeUpdate = (body, allowedFields) => {
    const data = {};
    for (const field of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
            data[field] = body[field];
        }
    }
    return data;
};

const getChatbotSettingsKey = (userId) => `crmChatbotSettings:${userId}`;
const CHATBOT_ALLOWED_AI_MODELS = ['gemini-2.5-flash', 'gemini-3-flash'];
const CHATBOT_DEFAULT_AI_MODEL = 'gemini-2.5-flash';
// Group AI summary supports a richer model choice than the chatbot.
const SUMMARY_ALLOWED_AI_MODELS = ['gemini-3.1-pro', 'gemini-2.5-pro', 'gemini-3-flash'];
const SUMMARY_DEFAULT_AI_MODEL = 'gemini-3.1-pro';
function normalizeSummaryAiModel(value) {
    return SUMMARY_ALLOWED_AI_MODELS.includes(value) ? value : SUMMARY_DEFAULT_AI_MODEL;
}
// Không còn model pro trong danh sách CRM → giữ giá trị cho getChatbotModelQuotaUnits;
// không khớp model nào trong allowed list nên mọi model CRM tính 1 quota unit.
const CHATBOT_PRO_AI_MODEL = 'gemini-3.1-pro';

const defaultChatbotSettings = {
    enabled: true,
    aiEnabled: false,
    keywordRulesEnabled: true,
    aiModel: CHATBOT_DEFAULT_AI_MODEL,
    systemPrompt: 'Bạn là một người hỗ trợ tư vấn khách hàng Zalo. Hãy phản hồi tự nhiên, ngắn gọn và đời thường như một người thật, tránh viết quá dài (dưới 40 từ). Đặc biệt: CHỈ gửi lời chào (như Chào bạn, Dạ chào anh/chị) ở câu đầu tiên của cuộc hội thoại, từ các câu tiếp theo tuyệt đối không lặp lại câu chào hỏi nữa mà trả lời thẳng vào vấn đề.',
    soulPrompt: 'Bạn là nhân viên tư vấn Zalo của doanh nghiệp: chuyên nghiệp, gần gũi, hiểu sản phẩm/dịch vụ, không tiết lộ mình là AI, không nói về hệ thống nội bộ.',
    responseRules: '- Trả lời bằng tiếng Việt theo ngôn ngữ của khách.\n- Không bịa thông tin ngoài kho kiến thức; nếu thiếu dữ liệu thì đề nghị chuyển nhân viên.\n- Không gửi mật khẩu, token, cookie hoặc dữ liệu nhạy cảm.\n- Khi cần gửi file/ảnh, chỉ nêu đúng tài liệu phù hợp trong kho kiến thức để agent Zalo gửi.',
    temperature: 0.7,
    debounceSeconds: 20,
    aiHistoryLimit: 5,
    personalAudience: 'all',
    groupAudience: 'tagOnly',
    selectedGroupKeys: [],
    handoffKeywords: ['nhan vien', 'nguoi that', 'tu van vien', 'gap admin', 'human'],
    knowledgeSnippets: [
        'Báo giá dịch vụ Alpha CRM phiên bản 2026:\n- Gói Startup: 199.000đ/tháng (tối đa 3 tài khoản Zalo).\n- Gói Business: 499.000đ/tháng (không giới hạn tài khoản Zalo, tích hợp n8n).\n- Gói Enterprise: Liên hệ để nhận ưu đãi thiết kế riêng.\n[File] Tên: Bao_Gia_Alpha_CRM_2026.pdf | ID: 2b8c4d5e6f7a8b9c0d1e2f3a4b5c6d7e | Mô tả: Bảng báo giá dịch vụ Alpha CRM.',
        'Catalogue và hướng dẫn sử dụng sản phẩm Alpha Studio:\n- Bộ giải pháp marketing Zalo tự động hóa toàn diện.\n- Hỗ trợ gửi tin nhắn hàng loạt, quản lý nhóm, phân nhóm khách hàng, tích hợp AI chatbot.\n- Hướng dẫn cài đặt nhanh cho hệ điều hành Windows và Android.\n[File] Tên: Catalogue_Alpha_Studio_2026.pdf | ID: 9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d | Mô tả: Catalogue sản phẩm và hướng dẫn cài đặt.'
    ]
};

function normalizeChatbotAiModel(value) {
    return CHATBOT_ALLOWED_AI_MODELS.includes(value) ? value : CHATBOT_DEFAULT_AI_MODEL;
}

function getChatbotModelQuotaUnits(model) {
    return model === CHATBOT_PRO_AI_MODEL ? 2 : 1;
}

async function getChatbotSettings(userId) {
    const setting = await SystemSetting.findOne({ key: getChatbotSettingsKey(userId) }).lean();
    const settings = { ...defaultChatbotSettings, ...(setting?.value || {}) };
    return {
        ...settings,
        aiModel: normalizeChatbotAiModel(settings.aiModel || settings.model),
        debounceSeconds: normalizeChatbotDebounceSeconds(
            settings.debounceSeconds
        ),
        aiHistoryLimit: normalizeChatbotHistoryLimit(settings.aiHistoryLimit),
        keywordRulesEnabled: settings.keywordRulesEnabled !== false
    };
}

async function saveChatbotSettings(userId, value) {
    const safeValue = {
        ...defaultChatbotSettings,
        aiEnabled: value.aiEnabled !== false,
        aiModel: normalizeChatbotAiModel(value.aiModel || value.model || defaultChatbotSettings.aiModel),
        systemPrompt: String(value.systemPrompt || defaultChatbotSettings.systemPrompt).slice(0, 8000),
        soulPrompt: String(value.soulPrompt || defaultChatbotSettings.soulPrompt).slice(0, 8000),
        responseRules: String(value.responseRules || defaultChatbotSettings.responseRules).slice(0, 8000),
        temperature: Number.isFinite(Number(value.temperature)) ? Number(value.temperature) : defaultChatbotSettings.temperature,
        debounceSeconds: normalizeChatbotDebounceSeconds(value.debounceSeconds),
        aiHistoryLimit: normalizeChatbotHistoryLimit(value.aiHistoryLimit),
        keywordRulesEnabled: value.keywordRulesEnabled !== false,
        personalAudience: ['all', 'crmOnly'].includes(value.personalAudience) ? value.personalAudience : defaultChatbotSettings.personalAudience,
        groupAudience: ['none', 'tagOnly', 'selected'].includes(value.groupAudience) ? value.groupAudience : defaultChatbotSettings.groupAudience,
        selectedGroupKeys: Array.isArray(value.selectedGroupKeys)
            ? value.selectedGroupKeys.map((item) => String(item).trim()).filter(Boolean).slice(0, 500)
            : [],
        handoffKeywords: Array.isArray(value.handoffKeywords)
            ? value.handoffKeywords.map((item) => String(item).trim()).filter(Boolean).slice(0, 50)
            : defaultChatbotSettings.handoffKeywords,
        knowledgeSnippets: Array.isArray(value.knowledgeSnippets)
            ? value.knowledgeSnippets.map((item) => String(item).slice(0, 4000)).slice(0, 20)
            : []
    };
    await SystemSetting.findOneAndUpdate(
        { key: getChatbotSettingsKey(userId) },
        { $set: { key: getChatbotSettingsKey(userId), value: safeValue, description: 'Per-user Alpha CRM chatbot settings' } },
        { upsert: true, new: true }
    );
    return safeValue;
}

function getQuotaPayload(subscription, quotaBucket = 'none', quotaUnits = 0) {
    const includedRemaining = Math.max(0, subscription.includedAiLimit - subscription.includedAiUsed);
    return {
        bucketUsed: quotaBucket,
        unitsUsed: quotaUnits,
        includedAiLimit: subscription.includedAiLimit,
        includedAiUsed: subscription.includedAiUsed,
        extraAiRemaining: subscription.extraAiRemaining,
        totalRemaining: includedRemaining + subscription.extraAiRemaining
    };
}

async function runCrmAiWithQuota(req, {
    promptContent,
    sessionId,
    requestType,
    messages,
    systemPrompt,
    model,
    temperature,
    forceGcliDirect = false,
    quotaUnits = 1
}) {
    const startTime = Date.now();
    const sub = req.crmSubscription;
    let quotaConsumption = { bucket: 'none', units: 0, included: 0, extra: 0 };

    if (!hasQuota(sub, quotaUnits)) {
        const error = new Error('Het han muc AI quota. Vui long mua them goi AI top-up.');
        error.statusCode = 403;
        throw error;
    }

    quotaConsumption = consumeQuotaUnits(sub, quotaUnits);
    await sub.save();

    try {
        const aiResponse = await callConfiguredAiProvider(promptContent, sessionId, {
            messages,
            systemPrompt,
            model,
            temperature,
            forceGcliDirect
        });
        const usageDoc = await CrmAiUsage.create({
            userId: req.user._id,
            subscriptionId: sub._id,
            requestType,
            provider: 'gcli',
            model: aiResponse.model,
            status: 'succeeded',
            quotaBucket: quotaConsumption.bucket,
            quotaUnits: quotaConsumption.units,
            tokens: {
                promptTokens: aiResponse.usage?.promptTokens || 0,
                completionTokens: aiResponse.usage?.completionTokens || 0,
                totalTokens: aiResponse.usage?.totalTokens || 0
            },
            latencyMs: Date.now() - startTime
        });

        return {
            aiResponse,
            usageDoc,
            quota: getQuotaPayload(sub, quotaConsumption.bucket, quotaConsumption.units)
        };
    } catch (aiError) {
        refundQuotaUnits(sub, quotaConsumption);
        await sub.save();
        await CrmAiUsage.create({
            userId: req.user._id,
            subscriptionId: sub._id,
            requestType,
            provider: 'gcli',
            status: 'failed',
            quotaBucket: quotaConsumption.bucket,
            quotaUnits: quotaConsumption.units || quotaUnits,
            latencyMs: Date.now() - startTime,
            errorMessage: aiError.message
        });
        throw aiError;
    }
}

function normalizeThreadType(value) {
    return value === 'group' ? 'group' : 'user';
}

async function upsertConversationFromInbound({ userId, deviceId, event, enforceManagedGroup = false }) {
    const accountId = String(event.accountId || '').trim();
    const threadId = String(event.threadId || '').trim();
    const threadType = normalizeThreadType(event.threadType);
    const isMetadataOnly = event.localFirst === true;
    const content = String(
        isMetadataOnly ? event.lastMessagePreview || '' : event.content || ''
    ).trim();
    const providerMessageId = String(event.providerMessageId || '').trim();
    const receivedAt = (event.lastMessageAt || event.timestamp)
        ? new Date(event.lastMessageAt || event.timestamp)
        : new Date();
    const messageType = normalizeCrmMessageType(event.messageType);

    if (!accountId || !threadId || (!isMetadataOnly && !content)) {
        const error = new Error('accountId, threadId va content la bat buoc.');
        error.statusCode = 400;
        throw error;
    }

    let managedGroup = null;
    if (threadType === 'group') {
        managedGroup = await CrmZaloGroup.findOne({ userId, accountId, groupId: threadId });
        if (enforceManagedGroup && (!managedGroup || !managedGroup.isManaged)) {
            return { ignored: true, reason: 'group_not_managed' };
        }
    }

    if (isMetadataOnly) {
        const existingConversation = await CrmConversation.findOne({
            userId, accountId, threadId, threadType
        });
        const metadataCustomer = threadType === 'user'
            ? await CrmCustomer.findOne({
                userId,
                $or: [
                    { zaloThreadId: threadId },
                    { zaloUserId: event.senderId || threadId }
                ]
            })
            : null;
        const conversation = await CrmConversation.findOneAndUpdate(
            { userId, accountId, threadId, threadType },
            {
                $set: {
                    userId,
                    deviceId,
                    accountId,
                    threadId,
                    threadType,
                    customerId: metadataCustomer?._id || existingConversation?.customerId || null,
                    displayName: event.displayName || existingConversation?.displayName || threadId,
                    avatarUrl: event.avatarUrl || existingConversation?.avatarUrl || '',
                    lastMessagePreview: previewText(content),
                    lastMessageAt: receivedAt,
                    lastInboundAt: receivedAt
                },
                $inc: { unreadCount: Number(event.unreadCountDelta) || 1 },
                $setOnInsert: { tags: [], notes: '', assignedStatus: 'open' }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        return { conversation, message: null, ignored: false, metadataOnly: true };
    }

    let customer = null;
    if (threadType === 'user') {
        customer = await CrmCustomer.findOne({
            userId,
            $or: [
                { zaloThreadId: threadId },
                { zaloUserId: event.senderId || threadId }
            ]
        });
    }

    const existingConversation = await CrmConversation.findOne({ userId, accountId, threadId, threadType });
    let displayName = existingConversation?.displayName;
    let avatarUrl = existingConversation?.avatarUrl;

    if (threadType === 'group') {
        displayName = managedGroup?.name || event.displayName || displayName || threadId;
        avatarUrl = managedGroup?.avatarUrl || event.avatarUrl || avatarUrl || '';
    } else {
        if (event.senderId === threadId) {
            // Inbound from customer
            displayName = event.senderName || event.displayName || displayName || threadId;
            avatarUrl = event.avatarUrl || avatarUrl || '';
        } else {
            // Outbound from operator
            displayName = displayName || event.displayName || threadId;
            avatarUrl = avatarUrl || '';
        }
    }

    const conversation = await CrmConversation.findOneAndUpdate(
        { userId, accountId, threadId, threadType },
        {
            $set: {
                userId,
                deviceId,
                accountId,
                threadId,
                threadType,
                customerId: customer?._id || null,
                displayName,
                avatarUrl,
                lastMessagePreview: previewText(content),
                lastMessageAt: receivedAt,
                lastInboundAt: receivedAt
            },
            $inc: { unreadCount: 1 },
            $setOnInsert: { tags: [], notes: '', assignedStatus: 'open' }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const IS_LOCAL_FIRST_LIVE_CHAT = isLocalFirstLiveChatEnabled();
    let message = null;

    if (!IS_LOCAL_FIRST_LIVE_CHAT) {
        if (providerMessageId) {
            message = await CrmMessage.findOne({ userId, accountId, providerMessageId });
        }
        if (!message) {
            message = await CrmMessage.create({
                userId,
                conversationId: conversation._id,
                deviceId,
                accountId,
                threadId,
                threadType,
                direction: 'inbound',
                senderId: event.senderId || '',
                senderName: event.senderName || '',
                content,
                messageType,
                attachments: event.attachments || null,
                providerMessageId,
                status: 'received',
                receivedAt
            });
        }
    }

    if (customer) {
        customer.lastMessageAt = receivedAt;
        customer.lastInteractionAt = receivedAt;
        await customer.save();
    }

    if (managedGroup?.isManaged) {
        // Privacy: backend does NOT persist group message content. Summaries read
        // messages from the operator's local store at summarize time. Only the
        // lightweight lastMessageAt timestamp is tracked here.
        managedGroup.lastMessageAt = receivedAt;
        await managedGroup.save();
    }

    return { conversation, message, ignored: false };
}

function buildSegmentQuery(userId, filters = {}) {
    const query = { userId };
    const tags = Array.isArray(filters.tags) ? filters.tags.filter(Boolean) : [];
    if (tags.length > 0) query.tags = { $in: tags };
    if (filters.lifecycleStage) query.lifecycleStage = filters.lifecycleStage;
    if (filters.consentStatus) query.consentStatus = filters.consentStatus;
    if (filters.source) query.source = filters.source;
    if (filters.lastInteractionFrom || filters.lastInteractionTo) {
        query.lastInteractionAt = {};
        if (filters.lastInteractionFrom) query.lastInteractionAt.$gte = new Date(filters.lastInteractionFrom);
        if (filters.lastInteractionTo) query.lastInteractionAt.$lte = new Date(filters.lastInteractionTo);
    }
    if (filters.search) {
        query.$or = [
            { name: { $regex: filters.search, $options: 'i' } },
            { phone: { $regex: filters.search, $options: 'i' } },
            { email: { $regex: filters.search, $options: 'i' } },
            { company: { $regex: filters.search, $options: 'i' } }
        ];
    }
    return query;
}

function parseCsvRows(csvText = '') {
    const lines = String(csvText).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    const headers = lines[0].split(',').map((item) => item.trim());
    return lines.slice(1).map((line) => {
        const values = line.split(',').map((item) => item.trim());
        return headers.reduce((row, header, index) => {
            row[header] = values[index] || '';
            return row;
        }, {});
    });
}

function csvEscape(value) {
    const text = value === null || value === undefined
        ? ''
        : value instanceof Date
            ? value.toISOString()
            : String(value);
    const escaped = text.replace(/"/g, '""');
    return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function serializeCsv(headers, rows) {
    const headerLine = headers.map((header) => csvEscape(header.label)).join(',');
    const bodyLines = rows.map((row) => headers.map((header) => csvEscape(row[header.key])).join(','));
    return [headerLine, ...bodyLines].join('\n');
}

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
                message: 'Yêu cầu gói đăng ký Alpha CRM đang hoạt động.'
            });
        }
        
        // Check periodEnd proactively
        if (new Date() > new Date(sub.periodEnd)) {
            sub.status = 'expired';
            await sub.save();
            return res.status(403).json({
                success: false,
                message: 'Gói đăng ký Alpha CRM của bạn đã hết hạn.'
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

        if (!deviceId) {
            return res.status(403).json({
                success: false,
                code: 'DEVICE_REVOKED',
                message: 'Thiết bị không tồn tại hoặc đã bị vô hiệu hóa.'
            });
        }

        if (!agentSecret) {
            return res.status(403).json({
                success: false,
                code: 'INVALID_AGENT_CREDENTIALS',
                message: 'Sai mật khẩu thiết bị.'
            });
        }

        const device = await CrmDevice.findOne({ _id: deviceId, status: 'active' });
        if (!device) {
            return res.status(403).json({
                success: false,
                code: 'DEVICE_REVOKED',
                message: 'Thiết bị không tồn tại hoặc đã bị vô hiệu hóa.'
            });
        }

        const incomingSecretHash = crypto.createHash('sha256').update(agentSecret).digest('hex');
        if (device.revokedAgentSecretHashes?.includes(incomingSecretHash)) {
            return res.status(403).json({
                success: false,
                code: 'DEVICE_REVOKED',
                message: 'Phiên đăng nhập trên thiết bị này đã được thay thế.'
            });
        }

        if (device.agentSecretHash !== incomingSecretHash) {
            return res.status(403).json({
                success: false,
                code: 'INVALID_AGENT_CREDENTIALS',
                message: 'Sai mật khẩu thiết bị.'
            });
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
        res.status(500).json({ success: false, message: 'Lỗi máy chủ.' });
    }
});

// ==========================================
// 1.5. CRM DASHBOARD & METRICS ROUTES
// ==========================================

// GET /api/crm/dashboard/overview
router.get('/dashboard/overview', authMiddleware, async (req, res) => {
    try {
        const sub = await CrmSubscription.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
        
        let subSummary = { active: false, plan: 'none', periodEnd: null };
        let totalAiRemaining = 0;
        let includedAiLimit = 0;
        let includedAiUsed = 0;
        let extraAiRemaining = 0;

        if (sub) {
            if (sub.status === 'active' && new Date() > new Date(sub.periodEnd)) {
                sub.status = 'expired';
                await sub.save();
            }

            subSummary = {
                active: sub.status === 'active',
                plan: sub.plan,
                periodEnd: sub.periodEnd
            };

            includedAiLimit = sub.includedAiLimit;
            includedAiUsed = sub.includedAiUsed;
            extraAiRemaining = sub.extraAiRemaining;
            totalAiRemaining = Math.max(0, includedAiLimit - includedAiUsed) + extraAiRemaining;
        }

        const activeDevices = await CrmDevice.countDocuments({ userId: req.user._id, status: 'active' });
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);
        const taskStats = {
            dueToday: await CrmTask.countDocuments({ userId: req.user._id, status: 'open', dueAt: { $gte: todayStart, $lt: todayEnd } }),
            overdue: await CrmTask.countDocuments({ userId: req.user._id, status: 'open', dueAt: { $lt: todayStart } }),
            highPriority: await CrmTask.countDocuments({ userId: req.user._id, status: 'open', priority: 'high' })
        };

        // Aggregate customer stats by lifecycleStage
        const customerLifecycleStats = await CrmCustomer.aggregate([
            { $match: { userId: req.user._id } },
            { $group: { _id: "$lifecycleStage", count: { $sum: 1 } } }
        ]);

        const customerStatusStats = await CrmCustomer.aggregate([
            { $match: { userId: req.user._id } },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);

        const customerStats = {
            total: await CrmCustomer.countDocuments({ userId: req.user._id }),
            byLifecycle: {},
            byStatus: {}
        };
        
        customerLifecycleStats.forEach(item => {
            customerStats.byLifecycle[item._id || 'lead'] = item.count;
        });
        customerStatusStats.forEach(item => {
            customerStats.byStatus[item._id || 'lead'] = item.count;
        });

        // Campaign stats
        const campaignStatsRaw = await CrmCampaign.aggregate([
            { $match: { userId: req.user._id } },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);
        const campaignStats = {
            total: await CrmCampaign.countDocuments({ userId: req.user._id }),
            byStatus: {}
        };
        campaignStatsRaw.forEach(item => {
            campaignStats.byStatus[item._id || 'draft'] = item.count;
        });

        // Last 7/30 days execution totals
        const date30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const date7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const sendStats30d = await CrmExecutionLog.aggregate([
            { $match: { userId: req.user._id, createdAt: { $gte: date30d } } },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);

        const sendStats7d = await CrmExecutionLog.aggregate([
            { $match: { userId: req.user._id, createdAt: { $gte: date7d } } },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);

        const processStats = (rawStats) => {
            let success = 0;
            let failed = 0;
            let queued = 0;
            rawStats.forEach(item => {
                if (item._id === 'success') success = item.count;
                else if (['failed', 'cancelled'].includes(item._id)) failed += item.count;
                else if (['queued', 'running'].includes(item._id)) queued = item.count;
            });
            const total = success + failed + queued;
            return { total, success, failed, queued };
        };

        const totals30d = processStats(sendStats30d);
        const totals7d = processStats(sendStats7d);

        const failedSendRate30d = totals30d.total > 0 ? (totals30d.failed / totals30d.total) : 0;
        const failedSendRate7d = totals7d.total > 0 ? (totals7d.failed / totals7d.total) : 0;

        res.json({
            success: true,
            data: {
                subscription: subSummary,
                aiQuota: {
                    includedAiLimit,
                    includedAiUsed,
                    extraAiRemaining,
                    totalRemaining: totalAiRemaining
                },
                activeDevices,
                connectedAccounts: activeDevices, // Fallback/approximation
                customerStats,
                campaignStats,
                taskStats,
                sendHistoryStats: {
                    last7Days: {
                        ...totals7d,
                        failedSendRate: failedSendRate7d
                    },
                    last30Days: {
                        ...totals30d,
                        failedSendRate: failedSendRate30d
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error fetching CRM overview:', error);
        res.status(500).json({ success: false, message: 'Lỗi server khi lấy dữ liệu tổng quan.' });
    }
});

// GET /api/crm/dashboard/campaign-performance
router.get('/dashboard/campaign-performance', authMiddleware, async (req, res) => {
    try {
        const range = req.query.range === '30d' ? 30 : 7;
        const startDate = new Date();
        startDate.setHours(0,0,0,0);
        startDate.setDate(startDate.getDate() - range + 1);

        const dailyPerformance = await CrmExecutionLog.aggregate([
            {
                $match: {
                    userId: req.user._id,
                    createdAt: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
                    },
                    success: {
                        $sum: { $cond: [ { $eq: ["$status", "success"] }, 1, 0 ] }
                    },
                    failure: {
                        $sum: { $cond: [ { $in: ["$status", ["failed", "cancelled"]] }, 1, 0 ] }
                    }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Create map from performance
        const perfMap = {};
        dailyPerformance.forEach(item => {
            perfMap[item._id] = {
                success: item.success,
                failure: item.failure
            };
        });

        // Fill in missing days
        const chartData = [];
        for (let i = 0; i < range; i++) {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];
            const friendlyLabel = `${d.getDate()}/${d.getMonth() + 1}`;

            const dayData = perfMap[dateStr] || { success: 0, failure: 0 };
            chartData.push({
                date: dateStr,
                label: friendlyLabel,
                success: dayData.success,
                failure: dayData.failure
            });
        }

        res.json({
            success: true,
            data: chartData
        });
    } catch (error) {
        console.error('Error fetching campaign performance:', error);
        res.status(500).json({ success: false, message: 'Lỗi server khi lấy hiệu suất chiến dịch.' });
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
                    message: 'Bạn phải có gói CRM đang hoạt động để mua gói AI top-up.' 
                });
            }
            if (new Date() > new Date(activeSub.periodEnd)) {
                activeSub.status = 'expired';
                await activeSub.save();
                return res.status(400).json({ 
                    success: false, 
                    message: 'Gói đăng ký CRM của bạn đã hết hạn. Hãy gia hạn trước khi mua gói AI top-up.' 
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
                return res.status(400).json({ success: false, message: 'Số dư credit của bạn không đủ.' });
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
                    subscription = await applySubscriptionEntitlement({
                        order: {
                            userId: user._id,
                            productId
                        },
                        product,
                        models: { CrmSubscription }
                    });
                } else {
                    // AI pack purchase (subscription check already passed at checkout top)
                    subscription = await CrmSubscription.findOne({ userId: user._id, status: 'active' });
                    if (!subscription) {
                        throw new Error('Bạn phải có gói CRM đang hoạt động để mua gói AI top-up.');
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
                    message: `${product.name} đã được thanh toán thành công qua Credits.`,
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
                return res.status(500).json({ success: false, message: 'Không thể tạo mã đơn hàng duy nhất.' });
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

        res.status(400).json({ success: false, message: 'Phương thức thanh toán không được hỗ trợ.' });
    } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tạo đơn hàng.' });
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
        const activeDevice = await CrmDevice.findOne({ subscriptionId: sub._id, status: 'active' });

        // Hash the fingerprint hash to avoid exposing raw fingerprints
        const machineFingerprintHash = crypto.createHash('sha256').update(machineFingerprint).digest('hex');

        if (activeDevice) {
            return res.status(409).json({
                success: false,
                code: 'DEVICE_ALREADY_ACTIVE',
                message: `ÄĂ£ Ä‘áº¡t giá»›i háº¡n thiáº¿t bá»‹ hoáº¡t Ä‘á»™ng (${sub.deviceLimit}). Vui lĂ²ng vĂ´ hiá»‡u hĂ³a thiáº¿t bá»‹ cÅ© trÆ°á»›c.`,
                data: {
                    device: buildActiveDeviceConflict(activeDevice)
                }
            });
        }

        const { agentSecret, agentSecretHash } = createAgentSecret();

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
            const activeDevice = req.crmSubscription
                ? await CrmDevice.findOne({ subscriptionId: req.crmSubscription._id, status: 'active' })
                : null;

            if (activeDevice) {
                return res.status(409).json({
                    success: false,
                    code: 'DEVICE_ALREADY_ACTIVE',
                    message: 'An active device is already registered. Use force replacement to continue.',
                    data: {
                        device: buildActiveDeviceConflict(activeDevice)
                    }
                });
            }
        }
        console.error('Device registration error:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi đăng ký thiết bị.' });
    }
});

// POST /api/crm/devices/force-logout-old
router.post('/devices/force-logout-old', crmDeviceLimiter, authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const { machineFingerprint, displayName, platform, appVersion, agentVersion } = req.body;

        if (!machineFingerprint || !displayName) {
            return res.status(400).json({ success: false, message: 'Thiếu vân tay máy (machineFingerprint) hoặc tên hiển thị.' });
        }

        const sub = req.crmSubscription;
        const machineFingerprintHash = crypto.createHash('sha256').update(machineFingerprint).digest('hex');
        const { agentSecret, agentSecretHash } = createAgentSecret();
        const { device } = await replaceActiveDevice({
            userId: req.user._id,
            subscriptionId: sub._id,
            deviceInput: {
                machineFingerprintHash,
                displayName,
                platform: platform || 'windows',
                appVersion: appVersion || '',
                agentVersion: agentVersion || '',
                agentSecretHash,
                lastIp: req.ip
            }
        });

        res.json({
            success: true,
            message: 'Đã thay thế thiết bị hoạt động thành công.',
            data: {
                deviceId: device._id,
                agentSecret
            }
        });
    } catch (error) {
        console.error('Device force replacement error:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi thay thế thiết bị.' });
    }
});

// POST /api/crm/devices/:id/disable
router.post('/devices/:id/disable', authMiddleware, async (req, res) => {
    try {
        const device = await CrmDevice.findOne({ _id: req.params.id, userId: req.user._id });
        if (!device) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị của bạn.' });
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
            return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị hoạt động tương ứng.' });
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
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi thiết lập ghép đôi.' });
    }
});

// POST /api/crm/pairing/confirm
router.post('/pairing/confirm', crmPairingLimiter, authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const {
            pairingCode,
            qrToken,
            platform = 'Mobile',
            displayName = 'Thiết bị di động'
        } = req.body;

        if (!pairingCode && !qrToken) {
            return res.status(400).json({ success: false, message: 'Cần mã ghép đôi (pairingCode) hoặc mã QR (qrToken).' });
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
            return res.status(404).json({ success: false, message: 'Mã ghép đôi không hợp lệ hoặc đã hết hạn.' });
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
            }
            const hasMobileDetails = device.pairedMobileDevices.some(
                (mobile) => mobile.userId?.toString() === req.user._id.toString()
            );
            if (!hasMobileDetails) {
                device.pairedMobileDevices.push({
                    userId: req.user._id,
                    platform,
                    displayName,
                    pairedAt: new Date()
                });
            }
            await device.save();
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

// POST /api/crm/pairing/revoke
router.post('/pairing/revoke', authMiddleware, async (req, res) => {
    try {
        const requestedMobileUserId = req.body.mobileUserId || req.user._id;
        const device = await CrmDevice.findOneAndUpdate(
            {
                userId: req.user._id,
                status: 'active',
                pairedMobileUserIds: requestedMobileUserId
            },
            {
                $pull: {
                    pairedMobileUserIds: requestedMobileUserId,
                    pairedMobileDevices: { userId: requestedMobileUserId }
                }
            },
            { new: true }
        );

        if (!device) {
            return res.status(404).json({
                success: false,
                code: 'REMOTE_PAIRING_NOT_FOUND',
                message: 'Khong tim thay ket noi Remote dang hoat dong.'
            });
        }

        await CrmAuditLog.create({
            userId: req.user._id,
            subscriptionId: device.subscriptionId,
            action: 'mobile_remote_revoked',
            details: {
                deviceId: device._id,
                mobileUserId: requestedMobileUserId
            }
        });

        return res.json({
            success: true,
            data: { device }
        });
    } catch (error) {
        console.error('Pairing revoke error:', error);
        return res.status(500).json({
            success: false,
            message: 'Loi may chu khi ngat ket noi Remote.'
        });
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
            {
                $set: buildTerminalCommandUpdate('expired', now, {
                    errorMessage: 'Command TTL expired before agent claim.'
                })
            }
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

            // Merge intermediate progress into execution logs for START_CAMPAIGN
            if (command.type === 'START_CAMPAIGN' && result.campaignId) {
                const campaignId = result.campaignId;
                const campaign = await CrmCampaign.findById(campaignId);
                if (campaign) {
                    const latestResult = result.latestResult;
                    const processed = result.processed || 0;
                    const total = result.total || 0;

                    // Update the specific recipient's execution log if we have a latest result
                    if (latestResult && latestResult.phone) {
                        const executionStatus = mapAgentExecutionStatus(latestResult.status);
                        const now = new Date();
                        await CrmExecutionLog.findOneAndUpdate(
                            {
                                campaignId,
                                recipientPhone: latestResult.phone,
                                status: { $in: ['queued', 'running'] }
                            },
                            {
                                $set: {
                                    status: executionStatus,
                                    details: latestResult,
                                    errorMessage: latestResult.error || '',
                                    providerMessageId: latestResult.messageId || '',
                                    attemptedAt: now,
                                    sentAt: executionStatus === 'success' ? now : null,
                                    failedAt: executionStatus === 'failed' ? now : null
                                }
                            }
                        );
                    }

                    // Update campaign metrics from aggregate counts
                    campaign.metrics.totalSent = processed;
                    campaign.metrics.successCount = result.successCount || 0;
                    campaign.metrics.failedCount = result.failedCount || 0;
                    campaign.metrics.cancelledCount = result.cancelledCount || 0;
                    campaign.lastProgressAt = new Date();
                    await campaign.save();
                }
            }

            return res.json({
                success: true,
                message: 'Cập nhật trạng thái lệnh đang chạy thành công.'
            });
        }

        Object.assign(
            command,
            buildTerminalCommandUpdate(success ? 'succeeded' : 'failed')
        );
        if (result) command.result = result;
        if (errorMessage) command.errorMessage = errorMessage;
        await command.save();

        if (command.type === 'zalo.message.send' && command.payload?.crmMessageId) {
            const messageStatus = success && result?.success !== false ? 'sent' : 'failed';
            const message = await CrmMessage.findOneAndUpdate(
                { _id: command.payload.crmMessageId, userId: command.userId },
                {
                    $set: {
                        status: messageStatus,
                        providerMessageId: result?.messageId || '',
                        errorMessage: result?.error || errorMessage || '',
                        sentAt: messageStatus === 'sent' ? new Date() : null
                    }
                },
                { new: true }
            );
            if (message) {
                await CrmConversation.findOneAndUpdate(
                    { _id: message.conversationId, userId: command.userId },
                    {
                        $set: {
                            lastMessagePreview: previewText(message.content),
                            lastMessageAt: message.sentAt || new Date()
                        }
                    }
                );
            }
        }

        if (command.type === 'zalo.groups.sync') {
            const groups = Array.isArray(result) ? result : (Array.isArray(result?.groups) ? result.groups : []);
            const now = new Date();
            for (const group of groups) {
                const groupId = String(group.id || group.groupId || '').trim();
                const accountId = String(group.accountId || command.payload?.accountId || 'default').trim();
                if (!groupId || !accountId) continue;
                await CrmZaloGroup.findOneAndUpdate(
                    { userId: command.userId, accountId, groupId },
                    {
                        $set: {
                            userId: command.userId,
                            deviceId: command.deviceId,
                            accountId,
                            groupId,
                            name: group.name || group.displayName || groupId,
                            avatarUrl: group.avatar || group.avatarUrl || '',
                            memberCount: Number(group.memberCount || group.totalMember || 0),
                            role: group.role || 'member',
                            lastSyncedAt: now
                        },
                        $setOnInsert: {
                            isManaged: false,
                            tags: [],
                            notes: '',
                            summaryCadence: 'manual'
                        }
                    },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                );
            }
        }

        // Persist execution logs and auto-update CrmCampaign status based on command result.
        if (command.type === 'START_CAMPAIGN') {
            const campaignId = command.payload?.campaignId;
            if (campaignId) {
                const campaign = await CrmCampaign.findById(campaignId);
                if (campaign) {
                    const results = (result && Array.isArray(result.results)) ? result.results : [];
                    const wasCancelled = results.some(r => r.status === 'cancelled');
                    const recipients = Array.isArray(command.payload?.recipients) ? command.payload.recipients : [];
                    const recipientMap = new Map(
                        recipients.map((recipient) => [String(recipient.customerId), recipient])
                    );
                    const messageText = command.payload?.message || '';
                    const now = new Date();
                    let successCount = 0;
                    let failedCount = 0;
                    let cancelledCount = 0;

                    if (results.length > 0) {
                        for (const item of results) {
                            const customerId = String(item.customerId || '');
                            const recipient = recipientMap.get(customerId) || {};
                            const executionStatus = mapAgentExecutionStatus(item.status);

                            if (executionStatus === 'success') successCount += 1;
                            if (executionStatus === 'failed') failedCount += 1;
                            if (executionStatus === 'cancelled') cancelledCount += 1;

                            const logUpdate = {
                                status: executionStatus,
                                details: item,
                                errorMessage: item.error || item.message || '',
                                providerMessageId: item.messageId || '',
                                attemptedAt: now,
                                sentAt: executionStatus === 'success' ? now : null,
                                failedAt: (executionStatus === 'failed' || executionStatus === 'cancelled') ? now : null
                            };

                            // Try to update pre-created log by recipientPhone, fallback to insert
                            const phone = item.phone || recipient.phone || '';
                            const updated = phone ? await CrmExecutionLog.findOneAndUpdate(
                                { campaignId: campaign._id, recipientPhone: phone },
                                { $set: logUpdate }
                            ) : null;

                            if (!updated) {
                                await CrmExecutionLog.create({
                                    userId: command.userId,
                                    campaignId: campaign._id,
                                    customerId: item.customerId || undefined,
                                    channel: campaign.channel,
                                    ...logUpdate,
                                    deviceId: command.deviceId,
                                    accountId: campaign.selectedAccountId,
                                    templateId: campaign.templateId,
                                    recipientId: item.customerId || undefined,
                                    recipientPhone: phone,
                                    recipientName: recipient.name || '',
                                    threadType: campaign.channel,
                                    messagePreview: buildCampaignMessagePreview(messageText, recipient.name),
                                    campaignSnapshot: {
                                        id: campaign._id,
                                        name: campaign.name,
                                        channel: campaign.channel,
                                        templateId: campaign.templateId
                                    }
                                });
                            }
                        }

                        // Update lastInteractionAt for successfully contacted customers
                        const successfulCustomerIds = results
                            .filter(r => mapAgentExecutionStatus(r.status) === 'success' && r.customerId)
                            .map(r => r.customerId);
                        if (successfulCustomerIds.length > 0) {
                            await CrmCustomer.updateMany(
                                { _id: { $in: successfulCustomerIds }, userId: command.userId },
                                { $set: { lastInteractionAt: now, lastMessageAt: now } }
                            );
                        }
                    }

                    // Mark any remaining queued/running logs as cancelled if campaign was cancelled or command failed
                    if (!success) {
                        await CrmExecutionLog.updateMany(
                            { campaignId: campaign._id, status: { $in: ['queued', 'running'] } },
                            { $set: { status: 'cancelled', failedAt: now, errorMessage: errorMessage || 'Chiến dịch bị hủy do lỗi lệnh gửi.' } }
                        );
                    } else if (wasCancelled) {
                        await CrmExecutionLog.updateMany(
                            { campaignId: campaign._id, status: { $in: ['queued', 'running'] } },
                            { $set: { status: 'cancelled', failedAt: now } }
                        );
                    }

                    // Finalize campaign metrics and status
                    if (!success) {
                        const totalTargets = campaign.metrics.totalTargets || recipients.length || 0;
                        campaign.metrics = {
                            totalSent: 0,
                            totalTargets: totalTargets,
                            successCount: 0,
                            failedCount: 0,
                            cancelledCount: totalTargets
                        };
                    } else {
                        campaign.metrics = {
                            totalSent: results.length,
                            totalTargets: campaign.metrics.totalTargets || results.length,
                            successCount,
                            failedCount,
                            cancelledCount
                        };
                    }
                    campaign.status = !success ? 'cancelled' : (wasCancelled ? 'cancelled' : 'completed');
                    campaign.finishedAt = new Date();
                    campaign.lastProgressAt = new Date();
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
        const { search, status, tag, lifecycleStage, segmentId } = req.query;
        
        // Pagination handling
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        let query = { userId: req.user._id };

        if (segmentId) {
            const segment = await CrmSegment.findOne({ _id: segmentId, userId: req.user._id });
            if (!segment) return res.status(404).json({ success: false, message: 'Khong tim thay segment.' });
            query = buildSegmentQuery(req.user._id, segment.filters || {});
        }

        if (status && status !== 'Tất cả') {
            query.status = status;
        }

        if (tag && tag !== 'Tất cả') {
            query.tags = tag;
        }

        if (lifecycleStage && lifecycleStage !== 'Tất cả') {
            query.lifecycleStage = lifecycleStage;
        }

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { company: { $regex: search, $options: 'i' } }
            ];
        }

        const total = await CrmCustomer.countDocuments(query);
        const customers = await CrmCustomer.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({
            success: true,
            data: customers,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lỗi server.' });
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
        const { search, type, category, isQuick } = req.query;
        const query = { userId: req.user._id };

        if (type) {
            query.type = type;
        }
        if (category) {
            query.category = category;
        }
        if (isQuick !== undefined) {
            query.isQuick = isQuick === 'true';
        }

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { body: { $regex: search, $options: 'i' } },
                { subject: { $regex: search, $options: 'i' } }
            ];
        }

        const templates = await CrmTemplate.find(query).sort({ createdAt: -1 });
        res.json({ success: true, data: templates });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lỗi server.' });
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
        const { status } = req.query;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const query = { userId: req.user._id };
        if (status) {
            query.status = status;
        }

        const total = await CrmCampaign.countDocuments(query);
        const campaigns = await CrmCampaign.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({
            success: true,
            data: campaigns,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lỗi server.' });
    }
});

router.post('/campaigns', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const {
            name, templateId, channel, audienceType,
            targetCustomerIds, targetGroupIds, manualRecipients,
            selectedDeviceId, selectedAccountId,
            rateLimit, requireHumanApproval, scheduledAt
        } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Tên chiến dịch là bắt buộc.' });
        }
        if (!templateId) {
            return res.status(400).json({ success: false, message: 'Mẫu tin nhắn là bắt buộc.' });
        }

        // Validate template exists and belongs to user
        const template = await CrmTemplate.findOne({ _id: templateId, userId: req.user._id });
        if (!template) {
            return res.status(400).json({ success: false, message: 'Không tìm thấy mẫu tin nhắn.' });
        }

        // Build rate limit with defaults
        const rateLimitObj = {
            minDelaySeconds: Math.max(1, parseInt(rateLimit?.minDelaySeconds) || 3),
            maxDelaySeconds: Math.max(1, parseInt(rateLimit?.maxDelaySeconds) || 5),
            dailyCap: Math.max(1, parseInt(rateLimit?.dailyCap) || 500)
        };
        if (rateLimitObj.minDelaySeconds > rateLimitObj.maxDelaySeconds) {
            rateLimitObj.maxDelaySeconds = rateLimitObj.minDelaySeconds;
        }

        const newCampaign = new CrmCampaign({
            userId: req.user._id,
            name: name.trim(),
            templateId,
            channel: channel || 'zalo',
            audienceType: audienceType || 'custom',
            targetCustomerIds: Array.isArray(targetCustomerIds) ? targetCustomerIds : [],
            targetGroupIds: Array.isArray(targetGroupIds) ? targetGroupIds : [],
            manualRecipients: Array.isArray(manualRecipients) ? manualRecipients : [],
            selectedDeviceId: selectedDeviceId || null,
            selectedAccountId: selectedAccountId || null,
            rateLimit: rateLimitObj,
            requireHumanApproval: !!requireHumanApproval,
            scheduledAt: scheduledAt || null
        });
        await newCampaign.save();

        res.json({
            success: true,
            message: 'Da tao chien dich CRM.',
            data: newCampaign
        });
    } catch (error) {
        console.error('Campaign create error:', error);
        res.status(500).json({ success: false, message: 'Loi may chu khi tao chien dich.' });
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
            return res.status(404).json({ success: false, message: 'Không tìm thấy chiến dịch.' });
        }

        if (campaign.status === 'running' || campaign.status === 'completed' || campaign.status === 'cancelled') {
            return res.status(400).json({ success: false, message: 'Chiến dịch đã/đang chạy.' });
        }

        // Require human approval for high-risk campaigns
        if (campaign.requireHumanApproval && !req.body.humanApprovedAt) {
            return res.status(403).json({
                success: false,
                message: 'Chiến dịch yêu cầu xác nhận thủ công trước khi bắt đầu. Vui lòng gửi humanApprovedAt.'
            });
        }

        // Find active device - prefer campaign's selectedDeviceId, fallback to any active
        let activeDevice;
        if (campaign.selectedDeviceId) {
            activeDevice = await CrmDevice.findOne({ _id: campaign.selectedDeviceId, userId: req.user._id, status: 'active' });
        }
        if (!activeDevice) {
            activeDevice = await CrmDevice.findOne({ userId: req.user._id, status: 'active' });
        }
        if (!activeDevice) {
            return res.status(400).json({
                success: false,
                message: 'Không có thiết bị Windows đang hoạt động. Vui lòng ghép đôi và kích hoạt thiết bị trước khi bắt đầu chiến dịch.'
            });
        }

        // Fetch template content
        const template = await CrmTemplate.findOne({ _id: campaign.templateId, userId: req.user._id });
        if (!template) {
            return res.status(400).json({
                success: false,
                message: 'Không tìm thấy mẫu tin nhắn của chiến dịch.'
            });
        }
        const templateMessageText = template.body || 'Tin nhắn chiến dịch';

        // --- Resolve recipients from all audience sources ---
        const targetRecipients = [];

        // 1. Customer IDs → phone/name
        if (Array.isArray(campaign.targetCustomerIds) && campaign.targetCustomerIds.length > 0) {
            const customers = await CrmCustomer.find({ _id: { $in: campaign.targetCustomerIds }, userId: req.user._id });
            for (const c of customers) {
                const phone = (c.phone || '').trim();
                // Check consent status for customers if not test/mock mode
                if (phone && c.consentStatus === 'granted') {
                    targetRecipients.push({
                        customerId: c._id,
                        phone,
                        name: c.name || '',
                        threadType: 'user'
                    });
                }
            }
        }

        // 2. Group IDs → group thread targets
        if (Array.isArray(campaign.targetGroupIds) && campaign.targetGroupIds.length > 0) {
            for (const groupId of campaign.targetGroupIds) {
                const gid = (groupId || '').trim();
                if (gid) {
                    targetRecipients.push({
                        customerId: null,
                        phone: gid,
                        name: `Nhóm ${gid}`,
                        threadType: 'group'
                    });
                }
            }
        }

        // 3. Manual recipients → normalize phone
        if (Array.isArray(campaign.manualRecipients) && campaign.manualRecipients.length > 0) {
            for (const mr of campaign.manualRecipients) {
                const phone = (mr.phone || '').trim();
                if (phone) {
                    targetRecipients.push({
                        customerId: null,
                        phone,
                        name: mr.name || '',
                        threadType: 'user'
                    });
                }
            }
        }

        if (targetRecipients.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Chiến dịch không có người nhận hợp lệ nào (thiếu số điện thoại/Zalo hoặc ID nhóm, hoặc đã từ chối nhận tin).'
            });
        }

        // --- Backend Compliance & Constraint Checks ---
        const targetCount = targetRecipients.length;
        
        // 1. Target count thresholds
        if (targetCount > 500) {
            return res.status(400).json({
                success: false,
                message: `Quy mô chiến dịch vượt quá giới hạn hệ thống (tối đa 500). Hiện tại: ${targetCount}.`
            });
        }
        
        if (targetCount > 50 && !req.body.humanApprovedAt) {
            return res.status(403).json({
                success: false,
                message: `Chiến dịch gửi trên 50 tin nhắn (${targetCount}) yêu cầu xác nhận rủi ro thủ công. Vui lòng gửi humanApprovedAt.`
            });
        }

        // 2. Rate limits validation
        const minDelay = campaign.rateLimit?.minDelaySeconds || 3;
        const maxDelay = campaign.rateLimit?.maxDelaySeconds || 5;
        if (minDelay < 1 || maxDelay < 1 || minDelay > maxDelay) {
            return res.status(400).json({
                success: false,
                message: 'Cấu hình delay không hợp lệ. minDelay và maxDelay phải lớn hơn 0, và min <= max.'
            });
        }

        // Save human approval timestamp if provided
        if (req.body.humanApprovedAt) {
            campaign.humanApprovedAt = new Date(req.body.humanApprovedAt);
        }

        campaign.status = 'running';
        campaign.startedAt = new Date();
        campaign.metrics.totalTargets = targetRecipients.length;
        await campaign.save();

        // Create initial CrmExecutionLog entries with status 'queued' so UI shows progress immediately
        const now = new Date();
        const initialLogs = targetRecipients.map((r, idx) => ({
            userId: req.user._id,
            campaignId: campaign._id,
            customerId: r.customerId || undefined,
            channel: campaign.channel,
            status: 'queued',
            deviceId: activeDevice._id,
            accountId: campaign.selectedAccountId,
            templateId: campaign.templateId,
            recipientPhone: r.phone,
            recipientName: r.name,
            threadType: r.threadType || campaign.channel,
            messagePreview: buildCampaignMessagePreview(templateMessageText, r.name),
            attemptedAt: null,
            campaignSnapshot: {
                id: campaign._id,
                name: campaign.name,
                channel: campaign.channel,
                templateId: campaign.templateId
            }
        }));
        if (initialLogs.length > 0) {
            await CrmExecutionLog.insertMany(initialLogs);
        }

        // Enqueue command to active Windows agent
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
                recipients: targetRecipients,
                rateLimit: campaign.rateLimit
            },
            status: 'queued',
            idempotencyKey: `campaign-start:${campaign._id}`,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        });
        await agentCommand.save();

        res.json({
            success: true,
            message: 'Đã đưa lệnh bắt đầu chiến dịch vào hàng đợi lệnh của thiết bị.',
            data: { campaign, agentCommand }
        });
    } catch (error) {
        console.error('Campaign start error:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ.' });
    }
});

// GET /api/crm/campaigns/:id/status
router.get('/campaigns/:id/status', authMiddleware, async (req, res) => {
    try {
        const campaign = await CrmCampaign.findOne({ _id: req.params.id, userId: req.user._id });
        if (!campaign) {
            return res.status(404).json({ success: false, message: 'Khong tim thay chien dich.' });
        }

        const [command, latestLogs, rawCounts] = await Promise.all([
            CrmAgentCommand.findOne({
                userId: req.user._id,
                type: 'START_CAMPAIGN',
                $or: [
                    { 'payload.campaignId': campaign._id },
                    { 'payload.campaignId': campaign._id.toString() }
                ]
            }).sort({ createdAt: -1 }),
            CrmExecutionLog.find({ userId: req.user._id, campaignId: campaign._id })
                .sort({ updatedAt: -1, createdAt: -1 })
                .limit(20),
            CrmExecutionLog.aggregate([
                { $match: { userId: req.user._id, campaignId: campaign._id } },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ])
        ]);

        const statusCounts = {
            queued: 0,
            running: 0,
            success: 0,
            failed: 0,
            cancelled: 0
        };
        rawCounts.forEach((item) => {
            if (Object.prototype.hasOwnProperty.call(statusCounts, item._id)) {
                statusCounts[item._id] = item.count;
            }
        });

        res.json({
            success: true,
            data: {
                campaign,
                commandStatus: command?.status || null,
                commandResult: command?.result || null,
                commandError: command?.errorMessage || null,
                statusCounts,
                latestLogs
            }
        });
    } catch (error) {
        console.error('Campaign status error:', error);
        res.status(500).json({ success: false, message: 'Loi may chu khi lay trang thai chien dich.' });
    }
});

// POST /api/crm/campaigns/:id/cancel
router.post('/campaigns/:id/cancel', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const campaign = await CrmCampaign.findOne({ _id: req.params.id, userId: req.user._id });
        if (!campaign) return res.status(404).json({ success: false, message: 'Không tìm thấy chiến dịch.' });

        // Reject cancellation of already-completed campaigns
        if (campaign.status === 'completed') {
            return res.status(400).json({ success: false, message: 'Không thể hủy chiến dịch đã hoàn thành.' });
        }
        if (campaign.status === 'cancelled') {
            return res.status(400).json({ success: false, message: 'Chiến dịch đã bị hủy trước đó.' });
        }

        campaign.status = 'cancelled';
        campaign.finishedAt = new Date();
        await campaign.save();

        // Update queued/running execution logs to cancelled
        await CrmExecutionLog.updateMany(
            { campaignId: campaign._id, status: { $in: ['queued', 'running'] } },
            { $set: { status: 'cancelled', failedAt: new Date() } }
        );

        // Send cancel command to the same agent that owns the campaign when possible.
        const startCommand = await CrmAgentCommand.findOne({
            userId: req.user._id,
            type: 'START_CAMPAIGN',
            $or: [
                { 'payload.campaignId': campaign._id },
                { 'payload.campaignId': campaign._id.toString() }
            ]
        }).sort({ createdAt: -1 });
        let cancelDevice = null;
        if (startCommand?.deviceId) {
            cancelDevice = await CrmDevice.findOne({ _id: startCommand.deviceId, userId: req.user._id, status: 'active' });
        }
        if (!cancelDevice && campaign.selectedDeviceId) {
            cancelDevice = await CrmDevice.findOne({ _id: campaign.selectedDeviceId, userId: req.user._id, status: 'active' });
        }
        if (!cancelDevice) {
            cancelDevice = await CrmDevice.findOne({ userId: req.user._id, status: 'active' });
        }
        if (cancelDevice) {
            await CrmAgentCommand.create({
                userId: req.user._id,
                subscriptionId: req.crmSubscription._id,
                deviceId: cancelDevice._id,
                type: 'CANCEL_CAMPAIGN',
                payload: { campaignId: campaign._id },
                status: 'queued',
                idempotencyKey: `campaign-cancel:${campaign._id}:${Date.now()}`,
                expiresAt: new Date(Date.now() + 60 * 60 * 1000)
            });
        }

        res.json({
            success: true,
            message: 'Da huy chien dich.',
            data: campaign
        });
    } catch (error) {
        console.error('Campaign cancel error:', error);
        res.status(500).json({ success: false, message: 'Loi may chu khi huy chien dich.' });
    }
});

// --- EXECUTION LOGS ---
router.get('/execution-logs', authMiddleware, async (req, res) => {
    try {
        const { campaignId, status, customerId, search, accountId, dateFrom, dateTo } = req.query;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const query = { userId: req.user._id };
        if (campaignId) {
            query.campaignId = campaignId;
        }
        if (status && status !== 'Tất cả') {
            if (status === 'Thành công' || status === 'success') {
                query.status = 'success';
            } else if (status === 'Thất bại' || status === 'failed') {
                query.status = 'failed';
            } else if (status === 'Đang chờ' || status === 'queued') {
                query.status = { $in: ['queued', 'running'] };
            } else if (status === 'cancelled') {
                query.status = 'cancelled';
            } else {
                query.status = status;
            }
        }
        if (customerId) {
            query.customerId = customerId;
        }
        if (accountId) {
            query.accountId = accountId;
        }
        // Date range filter
        if (dateFrom || dateTo) {
            query.createdAt = {};
            if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
            if (dateTo) query.createdAt.$lte = new Date(dateTo);
        }

        if (search) {
            query.$or = [
                { recipientPhone: { $regex: search, $options: 'i' } },
                { recipientName: { $regex: search, $options: 'i' } },
                { messagePreview: { $regex: search, $options: 'i' } }
            ];
        }

        const total = await CrmExecutionLog.countDocuments(query);
        const logs = await CrmExecutionLog.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({
            success: true,
            data: logs,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Lỗi server.' });
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
                message: 'Hết hạn mức AI quota. Vui lòng mua thêm gói AI top-up.'
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
// 6. LIVE CHAT AND CHATBOT ENDPOINTS
// ==========================================

router.get('/conversations', authMiddleware, async (req, res) => {
    try {
        const { accountId, threadType, search } = req.query;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = normalizeQueryLimit(req.query.limit, { defaultLimit: 30, maxLimit: 100 });
        let query = { userId: req.user._id };

        if (accountId) query.accountId = accountId;
        if (threadType) query.threadType = normalizeThreadType(threadType);
        if (search) {
            query.$or = [
                { displayName: { $regex: search, $options: 'i' } },
                { threadId: { $regex: search, $options: 'i' } },
                { lastMessagePreview: { $regex: search, $options: 'i' } }
            ];
        }

        if (req.query.includeUnmanagedGroups !== 'true' && query.threadType !== 'user') {
            const managedGroupQuery = { userId: req.user._id, isManaged: true };
            if (accountId) managedGroupQuery.accountId = accountId;
            const managedGroups = await CrmZaloGroup.find(managedGroupQuery)
                .select('accountId groupId')
                .lean();
            query = withManagedConversationVisibility(query, managedGroups);
        }

        const [total, conversations] = await Promise.all([
            CrmConversation.countDocuments(query),
            CrmConversation.find(query)
                .sort({ lastMessageAt: -1, updatedAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
        ]);

        res.json({
            success: true,
            data: conversations,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('Conversation list error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai hoi thoai.' });
    }
});

router.get('/conversations/:id/messages', authMiddleware, async (req, res) => {
    try {
        if (isLocalFirstLiveChatEnabled()) {
            return res.json({
                success: true,
                code: 'LOCAL_BRIDGE_REQUIRED',
                message: 'Local-first mode enabled. Full history is not available from cloud.',
                data: []
            });
        }

        const conversation = await CrmConversation.findOne({ _id: req.params.id, userId: req.user._id });
        if (!conversation) return res.status(404).json({ success: false, message: 'Khong tim thay hoi thoai.' });

        const limit = normalizeQueryLimit(req.query.limit, { defaultLimit: 50, maxLimit: 100 });
        const query = buildConversationMessageQuery({
            userId: req.user._id,
            conversationId: conversation._id,
            before: req.query.before,
            after: req.query.after
        });
        const isAfterQuery = Boolean(req.query.after);

        const messages = await CrmMessage.find(query)
            .sort({ createdAt: isAfterQuery ? 1 : -1 })
            .limit(limit);

        res.json({ success: true, data: isAfterQuery ? messages : messages.reverse() });
    } catch (error) {
        console.error('Conversation messages error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai tin nhan.' });
    }
});

router.post('/conversations/:id/messages/failed/clear', authMiddleware, async (req, res) => {
    try {
        const conversation = await CrmConversation.findOne({ _id: req.params.id, userId: req.user._id });
        if (!conversation) return res.status(404).json({ success: false, message: 'Khong tim thay hoi thoai.' });

        const result = await CrmMessage.deleteMany({
            userId: req.user._id,
            conversationId: conversation._id,
            status: 'failed'
        });
        const latestMessage = await CrmMessage.findOne({ userId: req.user._id, conversationId: conversation._id })
            .sort({ createdAt: -1 });

        conversation.lastMessagePreview = latestMessage ? previewText(latestMessage.content || `[${latestMessage.messageType}]`) : '';
        conversation.lastMessageAt = latestMessage ? (latestMessage.sentAt || latestMessage.receivedAt || latestMessage.createdAt) : null;
        await conversation.save();

        res.json({ success: true, message: 'Da xoa tin nhan gui that bai.', data: { deletedCount: result.deletedCount || 0 } });
    } catch (error) {
        console.error('Conversation failed message clear error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi xoa tin nhan gui that bai.' });
    }
});

router.post('/conversations/:id/send', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const content = String(req.body.content || req.body.message || '').trim();
        if (!content) return res.status(400).json({ success: false, message: 'Noi dung tin nhan la bat buoc.' });
        if (content.length > 5000) return res.status(400).json({ success: false, message: 'Tin nhan qua dai.' });

        const conversation = await CrmConversation.findOne({ _id: req.params.id, userId: req.user._id });
        if (!conversation) return res.status(404).json({ success: false, message: 'Khong tim thay hoi thoai.' });

        let activeDevice = null;
        if (req.body.deviceId) {
            activeDevice = await CrmDevice.findOne({ _id: req.body.deviceId, userId: req.user._id, status: 'active' });
        }
        if (!activeDevice && conversation.deviceId) {
            activeDevice = await CrmDevice.findOne({ _id: conversation.deviceId, userId: req.user._id, status: 'active' });
        }
        if (!activeDevice) {
            activeDevice = await CrmDevice.findOne({ userId: req.user._id, status: 'active' });
        }
        if (!activeDevice) {
            return res.status(400).json({ success: false, message: 'Khong co thiet bi Windows dang hoat dong de gui tin.' });
        }

        const message = await CrmMessage.create({
            userId: req.user._id,
            conversationId: conversation._id,
            deviceId: activeDevice._id,
            accountId: conversation.accountId,
            threadId: conversation.threadId,
            threadType: conversation.threadType,
            direction: 'outbound',
            senderId: conversation.accountId,
            senderName: 'Operator',
            content,
            messageType: 'text',
            status: 'queued',
            sentAt: null
        });

        const command = await CrmAgentCommand.create({
            userId: req.user._id,
            subscriptionId: req.crmSubscription._id,
            deviceId: activeDevice._id,
            type: 'zalo.message.send',
            payload: {
                crmMessageId: message._id,
                accountId: conversation.accountId,
                recipientId: conversation.threadId,
                threadType: conversation.threadType,
                message: content,
                messageType: 'text'
            },
            status: 'queued',
            idempotencyKey: `live-send:${message._id}`,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000)
        });

        conversation.lastMessagePreview = previewText(content);
        conversation.lastMessageAt = new Date();
        conversation.deviceId = activeDevice._id;
        await conversation.save();

        if (conversation.customerId) {
            await CrmCustomer.updateOne(
                { _id: conversation.customerId, userId: req.user._id },
                { $set: { lastMessageAt: conversation.lastMessageAt, lastInteractionAt: conversation.lastMessageAt } }
            );
        }

        res.json({ success: true, data: { message, command } });
    } catch (error) {
        console.error('Conversation send error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi gui tin nhan.' });
    }
});

// Send attachment (image/file/video) from operator
router.post('/conversations/:id/send-attachment', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const content = String(req.body.content || req.body.message || '').trim();
        const attachments = Array.isArray(req.body.attachments)
            ? req.body.attachments.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 10)
            : [];
        const normalizedType = normalizeCrmMessageType(req.body.messageType || 'file');
        if (!content && attachments.length === 0) {
            return res.status(400).json({ success: false, message: 'Noi dung hoac file dinh kem la bat buoc.' });
        }

        const conversation = await CrmConversation.findOne({ _id: req.params.id, userId: req.user._id });
        if (!conversation) return res.status(404).json({ success: false, message: 'Khong tim thay hoi thoai.' });

        let activeDevice = conversation.deviceId
            ? await CrmDevice.findOne({ _id: conversation.deviceId, userId: req.user._id, status: 'active' })
            : null;
        if (!activeDevice) activeDevice = await CrmDevice.findOne({ userId: req.user._id, status: 'active' });
        if (!activeDevice) return res.status(400).json({ success: false, message: 'Khong co thiet bi Windows dang hoat dong de gui file.' });

        const messageType = normalizedType === 'unknown' ? 'file' : normalizedType;
        const message = await CrmMessage.create({
            userId: req.user._id,
            conversationId: conversation._id,
            deviceId: activeDevice._id,
            accountId: conversation.accountId,
            threadId: conversation.threadId,
            threadType: conversation.threadType,
            direction: 'outbound',
            senderId: conversation.accountId,
            senderName: 'Operator',
            content: content || `[${messageType}]`,
            messageType,
            attachments,
            status: 'queued',
            sentAt: null
        });

        const command = await CrmAgentCommand.create({
            userId: req.user._id,
            subscriptionId: req.crmSubscription._id,
            deviceId: activeDevice._id,
            type: 'zalo.message.send',
            payload: {
                crmMessageId: message._id,
                accountId: conversation.accountId,
                recipientId: conversation.threadId,
                threadType: conversation.threadType,
                message: content || '',
                messageType,
                attachments
            },
            status: 'queued',
            idempotencyKey: `live-send-attach:${message._id}`,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000)
        });

        conversation.lastMessagePreview = previewText(content || `[${messageType}]`);
        conversation.lastMessageAt = new Date();
        await conversation.save();

        res.json({ success: true, data: { message, command } });
    } catch (error) {
        console.error('Conversation send-attachment error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi gui file dinh kem.' });
    }
});

// Recall/undo a sent message
router.post('/conversations/:id/messages/:messageId/recall', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const conversation = await CrmConversation.findOne({ _id: req.params.id, userId: req.user._id });
        if (!conversation) return res.status(404).json({ success: false, message: 'Khong tim thay hoi thoai.' });

        const message = await CrmMessage.findOne({ _id: req.params.messageId, userId: req.user._id, conversationId: conversation._id });
        if (!message) return res.status(404).json({ success: false, message: 'Khong tim thay tin nhan.' });
        if (message.direction !== 'outbound') {
            return res.status(400).json({ success: false, message: 'Chi co the thu hoi tin nhan gui di.' });
        }

        let activeDevice = conversation.deviceId
            ? await CrmDevice.findOne({ _id: conversation.deviceId, userId: req.user._id, status: 'active' })
            : null;
        if (!activeDevice) activeDevice = await CrmDevice.findOne({ userId: req.user._id, status: 'active' });
        if (!activeDevice) return res.status(400).json({ success: false, message: 'Khong co thiet bi Windows dang hoat dong de thu hoi tin.' });

        const command = await CrmAgentCommand.create({
            userId: req.user._id,
            subscriptionId: req.crmSubscription._id,
            deviceId: activeDevice._id,
            type: 'zalo.message.recall',
            payload: {
                crmMessageId: message._id,
                accountId: conversation.accountId,
                threadId: conversation.threadId,
                threadType: conversation.threadType,
                msgId: message.providerMessageId || '',
                cliMsgId: message.providerMessageId || ''
            },
            status: 'queued',
            idempotencyKey: `live-recall:${message._id}`,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000)
        });

        message.status = 'recalled';
        message.isDeleted = true;
        await message.save();

        res.json({ success: true, data: { message, command } });
    } catch (error) {
        console.error('Conversation recall error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi thu hoi tin nhan.' });
    }
});

router.put('/conversations/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const updateData = sanitizeUpdate(req.body, ['tags', 'notes', 'assignedStatus', 'chatbotEnabled', 'customerId']);
        const conversation = await CrmConversation.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { $set: updateData },
            { new: true }
        );
        if (!conversation) return res.status(404).json({ success: false, message: 'Khong tim thay hoi thoai.' });
        res.json({ success: true, data: conversation });
    } catch (error) {
        console.error('Conversation update error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi cap nhat hoi thoai.' });
    }
});

router.post('/conversations/:id/read', authMiddleware, async (req, res) => {
    try {
        const conversation = await CrmConversation.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { $set: { unreadCount: 0 } },
            { new: true }
        );
        if (!conversation) return res.status(404).json({ success: false, message: 'Khong tim thay hoi thoai.' });
        res.json({ success: true, data: conversation });
    } catch (error) {
        console.error('Conversation read error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi danh dau da doc.' });
    }
});

router.post('/agent/events/message', agentAuthMiddleware, async (req, res) => {
    try {
        const result = await upsertConversationFromInbound({
            userId: req.crmDevice.userId,
            deviceId: req.crmDevice._id,
            event: req.body,
            enforceManagedGroup: normalizeThreadType(req.body.threadType) === 'group'
        });
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Agent message event error:', error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Loi server khi ghi nhan tin nhan agent.' });
    }
});

router.get('/agent/chatbot/config', agentAuthMiddleware, async (req, res) => {
    try {
        const userId = req.crmDevice.userId;
        const [settings, rules, crmConversations, managedGroups] = await Promise.all([
            getChatbotSettings(userId),
            CrmChatbotRule.find({ userId, isActive: true })
                .sort({ priority: 1, createdAt: -1 })
                .lean(),
            CrmConversation.find({
                userId,
                threadType: 'user',
                customerId: { $ne: null }
            }).select('accountId threadId').lean(),
            CrmZaloGroup.find({ userId, isManaged: true })
                .select('accountId groupId').lean()
        ]);
        const managedKeys = new Set(
            managedGroups.map((group) => `${group.accountId}:${group.groupId}`)
        );
        const selectedGroupKeys = (settings.selectedGroupKeys || [])
            .filter((key) => managedKeys.has(key));
        const versionSource = JSON.stringify({
            settings,
            rules: rules.map((rule) => [rule._id, rule.updatedAt]),
            crmThreadKeys: crmConversations.map(
                (conversation) => `${conversation.accountId}:${conversation.threadId}`
            ),
            selectedGroupKeys
        });
        const version = crypto
            .createHash('sha256')
            .update(versionSource)
            .digest('hex');
        const snapshot = buildChatbotConfigSnapshot({
            version,
            settings,
            rules: rules.map((rule) => ({
                id: String(rule._id),
                name: rule.name,
                keywords: rule.keywords || [],
                matchMode: rule.matchMode,
                response: rule.response,
                isActive: rule.isActive,
                priority: rule.priority,
                channelScope: rule.channelScope,
                handoffKeywords: rule.handoffKeywords || [],
                accountIds: rule.accountIds || [],
                businessHours: rule.businessHours || { enabled: false }
            })),
            crmThreadKeys: crmConversations.map(
                (conversation) => `${conversation.accountId}:${conversation.threadId}`
            ),
            selectedGroupKeys
        });
        res.json({ success: true, data: snapshot });
    } catch (error) {
        console.error('Agent chatbot config error:', error);
        res.status(500).json({
            success: false,
            code: 'CHATBOT_CONFIG_UNAVAILABLE',
            message: 'Khong the tai cau hinh chatbot.'
        });
    }
});

// Derive a sendable media type from a file name/URL extension. Mirrors the
// Flutter KnowledgeAttachmentType logic so the bridge can route the send.
function guessChatbotAttachmentType(nameOrUrl) {
    const ext = String(nameOrUrl || '')
        .split('?')[0]
        .split('#')[0]
        .split('.')
        .pop()
        .toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif'].includes(ext)) return 'image';
    if (['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus'].includes(ext)) return 'audio';
    return 'file';
}

// Knowledge snippets serialize attachments as:
//   - [File] Tên: NAME | ID: <content-hash> | Mô tả: DESC
// The id references a file stored locally by the bridge knowledge store (the
// bytes never reach the cloud). Extract them into a catalog the AI can pick from
// by short alias (F1, F2, ...).
function extractChatbotAttachmentCatalog(snippets) {
    const catalog = [];
    const seenIds = new Set();
    const lineRe = /\[File\]\s*Tên:\s*(.+?)\s*\|\s*ID:\s*(\S+)\s*(?:\|\s*Mô tả:\s*(.*))?$/;
    for (const snippet of snippets || []) {
        for (const rawLine of String(snippet).split('\n')) {
            const match = rawLine.match(lineRe);
            if (!match) continue;
            const name = (match[1] || '').trim();
            const refId = (match[2] || '').trim();
            if (!refId || seenIds.has(refId)) continue;
            seenIds.add(refId);
            catalog.push({
                alias: `F${catalog.length + 1}`,
                refId,
                name,
                type: guessChatbotAttachmentType(name),
                desc: (match[3] || '').trim()
            });
        }
    }
    return catalog;
}

// Resolve [[SEND:Fx]] markers from the AI reply into concrete attachments and
// strip them (plus any stray filename markers) from the customer-facing text.
function resolveChatbotReplyAttachments(rawReply, catalog) {
    const byAlias = new Map(catalog.map((item) => [item.alias.toUpperCase(), item]));
    const picked = [];
    const pickedIds = new Set();
    let text = String(rawReply || '').replace(
        /\[\[\s*SEND\s*:\s*([^\]]+?)\s*\]\]/gi,
        (_, ids) => {
            for (const part of String(ids).split(/[\s,]+/)) {
                const item = byAlias.get(part.trim().toUpperCase());
                if (item && !pickedIds.has(item.refId)) {
                    pickedIds.add(item.refId);
                    picked.push({ type: item.type, id: item.refId, name: item.name });
                }
            }
            return '';
        }
    );
    // Defensive: the AI sometimes still types a filename marker instead of (or
    // alongside) the SEND marker. Never leak those as text.
    text = text.replace(/\[(?:File|Image|Video|Audio|Tệp|Ảnh)\]\s*[^\[\n]*/gi, '');
    text = text
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return { reply: text, attachments: picked };
}

router.post(
    '/agent/chatbot/generate',
    crmAiLimiter,
    agentAuthMiddleware,
    async (req, res) => {
        try {
            const userId = req.crmDevice.userId;
            const settings = await getChatbotSettings(userId);
            if (!settings.enabled || !settings.aiEnabled) {
                return res.status(409).json({
                    success: false,
                    code: 'AI_DISABLED',
                    message: 'Chatbot AI dang tat.'
                });
            }
            const subscription = await CrmSubscription.findOne({
                userId,
                status: 'active',
                periodEnd: { $gt: new Date() }
            });
            if (!subscription) {
                return res.status(403).json({
                    success: false,
                    code: 'SUBSCRIPTION_REQUIRED',
                    message: 'Can goi Alpha CRM dang hoat dong.'
                });
            }
            req.user = { _id: userId };
            req.crmSubscription = subscription;

            const messages = Array.isArray(req.body.messages)
                ? req.body.messages
                    .map((message) => String(message?.content || '').trim())
                    .filter(Boolean)
                : [];
            if (messages.length === 0) {
                return res.status(400).json({
                    success: false,
                    code: 'MESSAGE_REQUIRED',
                    message: 'Can noi dung tin nhan.'
                });
            }
            const customerMessage = messages.join('\n').slice(0, 12000);
            const aiInstructions = [
                settings.systemPrompt,
                settings.soulPrompt ? `Soul / vai tro:\n${settings.soulPrompt}` : '',
                settings.responseRules ? `Quy tac bat buoc:\n${settings.responseRules}` : ''
            ].filter(Boolean).join('\n\n');
            // The bridge sends knowledge already filtered for this account
            // (per-document [Accounts] targeting). Use it when present; otherwise
            // fall back to the operator's full stored set.
            const effectiveSnippets = Array.isArray(req.body.knowledgeSnippets)
                ? req.body.knowledgeSnippets
                    .map((snippet) => String(snippet))
                    .filter((snippet) => snippet.trim())
                : (settings.knowledgeSnippets || []);
            const knowledge = effectiveSnippets.length
                ? `\n\nKien thuc noi bo:\n${effectiveSnippets.join('\n---\n')}`
                : '';
            const attachmentCatalog = extractChatbotAttachmentCatalog(effectiveSnippets);
            let sendInstructions = '';
            if (attachmentCatalog.length) {
                const catalogLines = attachmentCatalog
                    .map((item) => `[${item.alias}] ${item.name}${item.desc ? ` — ${item.desc}` : ''} (${item.type})`)
                    .join('\n');
                sendInstructions =
                    `\n\nTep co the gui cho khach:\n${catalogLines}\n` +
                    'QUY TAC GUI TEP: Khi muon gui mot tep cho khach, chen marker dang [[SEND:F1]] (dung dung id o danh sach tren, co the nhieu marker) vao cau tra loi. ' +
                    'TUYET DOI khong tu go ten tep, khong dan URL, khong mo ta ten file bang chu. ' +
                    'Chi gui tep khi that su lien quan den cau hoi cua khach; neu khong can thi khong chen marker nao.';
            }
            // Recent conversation context the operator configured the AI to read.
            // The bridge already collapses consecutive same-sender messages into
            // turns and limits the count; clamp again defensively here.
            const historyLimit = normalizeChatbotHistoryLimit(settings.aiHistoryLimit);
            const historyTurns = (historyLimit > 0 && Array.isArray(req.body.history))
                ? req.body.history
                    .filter((turn) => turn && typeof turn.content === 'string' && turn.content.trim())
                    .slice(-historyLimit)
                    .map((turn) => `${turn.role === 'assistant' ? 'Nhan vien' : 'Khach'}: ${String(turn.content).trim().slice(0, 2000)}`)
                : [];
            const historyBlock = historyTurns.length
                ? `\n\nLich su hoi thoai gan day (cu -> moi):\n${historyTurns.join('\n')}`
                : '';
            const promptContent = `${aiInstructions}${knowledge}${sendInstructions}${historyBlock}\n\nTin nhan khach hang: ${customerMessage}`;
            const quotaUnits = getChatbotModelQuotaUnits(settings.aiModel);
            const { aiResponse, usageDoc, quota } = await runCrmAiWithQuota(req, {
                promptContent,
                sessionId: `crm-chatbot-agent:${userId}:${String(req.body.conversationKey || '')}`,
                requestType: 'chatbot_reply',
                systemPrompt: aiInstructions,
                model: settings.aiModel,
                temperature: settings.temperature,
                forceGcliDirect: true,
                quotaUnits
            });
            const { reply, attachments } = resolveChatbotReplyAttachments(
                aiResponse.text,
                attachmentCatalog
            );
            res.json({
                success: true,
                data: {
                    reply,
                    attachments,
                    usage: {
                        id: usageDoc._id,
                        model: aiResponse.model || settings.aiModel,
                        quota
                    }
                }
            });
        } catch (error) {
            console.error('Agent chatbot generate error:', error);
            const quotaExceeded = error.statusCode === 403
                && /quota/i.test(error.message || '');
            res.status(error.statusCode || 502).json({
                success: false,
                code: quotaExceeded ? 'QUOTA_EXCEEDED' : 'AI_UNAVAILABLE',
                message: error.message || 'Chatbot AI khong kha dung.'
            });
        }
    }
);

router.post('/agent/chatbot/audit', agentAuthMiddleware, async (req, res) => {
    try {
        const userId = req.crmDevice.userId;
        const idempotencyKey = String(req.body.idempotencyKey || '').trim();
        if (!idempotencyKey) {
            return res.status(400).json({
                success: false,
                code: 'IDEMPOTENCY_KEY_REQUIRED',
                message: 'Can idempotencyKey.'
            });
        }
        const outcome = String(req.body.outcome || 'skipped');
        const modeMap = {
            matched: 'keyword',
            ai: 'ai',
            handoff: 'handoff',
            skipped: 'none',
            failed: 'none'
        };
        if (!Object.prototype.hasOwnProperty.call(modeMap, outcome)) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_AUDIT_OUTCOME',
                message: 'Audit outcome khong hop le.'
            });
        }
        const status = outcome === 'failed'
            ? 'failed'
            : ['handoff', 'skipped'].includes(outcome)
                ? 'skipped'
                : 'succeeded';
        const update = {
            userId,
            idempotencyKey,
            accountId: String(req.body.accountId || '').slice(0, 200),
            threadId: String(req.body.threadId || '').slice(0, 200),
            mode: modeMap[outcome],
            promptPreview: previewText(
                Array.isArray(req.body.sourceMessageIds)
                    ? req.body.sourceMessageIds.join(',')
                    : ''
            ),
            responsePreview: previewText(req.body.responsePreview || ''),
            status,
            errorMessage: previewText(req.body.error || req.body.reason || '', 1000)
        };
        if (req.body.ruleId && /^[a-f\d]{24}$/i.test(String(req.body.ruleId))) {
            update.ruleId = req.body.ruleId;
        }
        const log = await CrmChatbotLog.findOneAndUpdate(
            { userId, idempotencyKey },
            { $setOnInsert: update },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        res.json({ success: true, data: log });
    } catch (error) {
        console.error('Agent chatbot audit error:', error);
        res.status(500).json({
            success: false,
            code: 'CHATBOT_AUDIT_FAILED',
            message: 'Khong the ghi audit chatbot.'
        });
    }
});

router.get('/chatbot/settings', authMiddleware, async (req, res) => {
    try {
        const storedSettings = await getChatbotSettings(req.user._id);
        const body = req.body || {};
        const settings = {
            ...storedSettings,
            aiModel: normalizeChatbotAiModel(body.aiModel || body.model || storedSettings.aiModel),
            systemPrompt: body.systemPrompt
                ? String(body.systemPrompt).slice(0, 8000)
                : storedSettings.systemPrompt,
            temperature: Number.isFinite(Number(body.temperature))
                ? Number(body.temperature)
                : storedSettings.temperature
        };
        res.json({ success: true, data: settings });
    } catch (error) {
        console.error('Chatbot settings get error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai cau hinh chatbot.' });
    }
});

router.put('/chatbot/settings', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const settings = await saveChatbotSettings(req.user._id, req.body || {});
        res.json({ success: true, data: settings });
    } catch (error) {
        console.error('Chatbot settings save error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi luu cau hinh chatbot.' });
    }
});

router.get('/chatbot/rules', authMiddleware, async (req, res) => {
    try {
        let rules = await CrmChatbotRule.find({ userId: req.user._id }).sort({ priority: 1, createdAt: -1 });
        if (rules.length === 0) {
            const defaultRules = [
                {
                    userId: req.user._id,
                    name: 'Chào hỏi khách hàng',
                    description: 'Tự động phản hồi khi khách hàng nhắn chào hỏi',
                    keywords: ['xin chao', 'hello', 'hi', 'chao ban', 'alo'],
                    matchMode: 'contains',
                    response: 'Dạ xin chào anh/chị! Em có thể hỗ trợ gì cho anh/chị về giải pháp marketing tự động Alpha CRM ạ?',
                    isActive: true,
                    priority: 1,
                    channelScope: 'all',
                    handoffKeywords: []
                },
                {
                    userId: req.user._id,
                    name: 'Yêu cầu gửi báo giá',
                    description: 'Tự động gửi file báo giá khi khách hàng hỏi về giá hoặc chi phí',
                    keywords: ['bao gia', 'chi phi', 'gia ca', 'bao nhieu', 'báo giá'],
                    matchMode: 'contains',
                    response: 'Dạ, em gửi anh/chị thông tin chi tiết bảng báo giá dịch vụ Alpha CRM mới nhất nhé ạ.\n\n[[SEND:F1]]',
                    isActive: true,
                    priority: 2,
                    channelScope: 'all',
                    handoffKeywords: []
                },
                {
                    userId: req.user._id,
                    name: 'Hỏi về Catalogue/Sản phẩm',
                    description: 'Tự động gửi tài liệu giới thiệu sản phẩm khi khách hỏi thông tin',
                    keywords: ['catalogue', 'san pham', 'tinh nang', 'tim hieu', 'gioi thieu'],
                    matchMode: 'contains',
                    response: 'Dạ, gửi anh/chị cuốn catalogue giới thiệu sản phẩm và các tính năng của Alpha CRM để anh/chị tham khảo ạ:\n\n[[SEND:F2]]',
                    isActive: true,
                    priority: 3,
                    channelScope: 'all',
                    handoffKeywords: []
                }
            ];
            rules = await CrmChatbotRule.create(defaultRules);
        }
        res.json({ success: true, data: rules });
    } catch (error) {
        console.error('Chatbot rules list error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai kich ban chatbot.' });
    }
});

router.post('/chatbot/rules', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const keywords = Array.isArray(req.body.keywords)
            ? req.body.keywords
            : String(req.body.keyword || '').split(',').map((item) => item.trim()).filter(Boolean);
        if (!req.body.name && keywords.length === 0) return res.status(400).json({ success: false, message: 'Can ten hoac tu khoa kich ban.' });
        if (!req.body.response) return res.status(400).json({ success: false, message: 'Can noi dung phan hoi.' });

        const rule = await CrmChatbotRule.create({
            userId: req.user._id,
            name: req.body.name || keywords[0],
            description: req.body.description ? String(req.body.description).slice(0, 1000) : '',
            keywords,
            matchMode: req.body.matchMode || 'contains',
            response: req.body.response,
            isActive: req.body.isActive !== false,
            priority: Number(req.body.priority) || 100,
            channelScope: req.body.channelScope || 'user',
            handoffKeywords: Array.isArray(req.body.handoffKeywords) ? req.body.handoffKeywords : [],
            accountIds: Array.isArray(req.body.accountIds)
                ? req.body.accountIds.map((id) => String(id).trim()).filter(Boolean).slice(0, 200)
                : []
        });
        res.json({ success: true, data: rule });
    } catch (error) {
        console.error('Chatbot rule create error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tao kich ban chatbot.' });
    }
});

router.put('/chatbot/rules/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const updateData = sanitizeUpdate(req.body, ['name', 'description', 'keywords', 'matchMode', 'response', 'isActive', 'priority', 'channelScope', 'handoffKeywords', 'businessHours', 'accountIds']);
        const rule = await CrmChatbotRule.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { $set: updateData },
            { new: true }
        );
        if (!rule) return res.status(404).json({ success: false, message: 'Khong tim thay kich ban chatbot.' });
        res.json({ success: true, data: rule });
    } catch (error) {
        console.error('Chatbot rule update error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi cap nhat kich ban chatbot.' });
    }
});

router.delete('/chatbot/rules/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const result = await CrmChatbotRule.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!result) return res.status(404).json({ success: false, message: 'Khong tim thay kich ban chatbot.' });
        res.json({ success: true, message: 'Da xoa kich ban chatbot.' });
    } catch (error) {
        console.error('Chatbot rule delete error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi xoa kich ban chatbot.' });
    }
});

router.get('/chatbot/logs', authMiddleware, async (req, res) => {
    try {
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const query = { userId: req.user._id };
        if (req.query.status) query.status = req.query.status;
        const logs = await CrmChatbotLog.find(query)
            .populate('ruleId', 'name keywords')
            .sort({ createdAt: -1 })
            .limit(limit);
        res.json({ success: true, data: logs });
    } catch (error) {
        console.error('Chatbot logs error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai nhat ky chatbot.' });
    }
});

router.post('/chatbot/test', crmAiLimiter, authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const message = String(req.body.message || '').trim();
        const threadType = normalizeThreadType(req.body.threadType);
        if (!message) return res.status(400).json({ success: false, message: 'Can tin nhan de test chatbot.' });

        const storedSettings = await getChatbotSettings(req.user._id);
        const settings = {
            ...storedSettings,
            aiModel: normalizeChatbotAiModel(req.body.aiModel || req.body.model || storedSettings.aiModel),
            systemPrompt: req.body.systemPrompt ? String(req.body.systemPrompt).slice(0, 8000) : storedSettings.systemPrompt,
            soulPrompt: req.body.soulPrompt ? String(req.body.soulPrompt).slice(0, 8000) : storedSettings.soulPrompt,
            responseRules: req.body.responseRules ? String(req.body.responseRules).slice(0, 8000) : storedSettings.responseRules,
            temperature: Number.isFinite(Number(req.body.temperature)) ? Number(req.body.temperature) : storedSettings.temperature
        };
        if (hasHandoffKeyword(settings, message)) {
            const log = await CrmChatbotLog.create({
                userId: req.user._id,
                mode: 'handoff',
                promptPreview: previewText(message),
                responsePreview: 'Human handoff requested.',
                status: 'skipped'
            });
            return res.json({ success: true, data: { mode: 'handoff', text: '', log, quota: getQuotaPayload(req.crmSubscription) } });
        }

        const rules = await CrmChatbotRule.find({ userId: req.user._id, isActive: true, channelScope: { $in: ['all', threadType] } }).sort({ priority: 1, createdAt: -1 });
        const matchedRule = rules.find((rule) => !hasHandoffKeyword(rule, message) && matchChatbotRule(rule, message));
        if (matchedRule) {
            const log = await CrmChatbotLog.create({
                userId: req.user._id,
                ruleId: matchedRule._id,
                mode: 'keyword',
                promptPreview: previewText(message),
                responsePreview: previewText(matchedRule.response),
                status: 'succeeded'
            });
            return res.json({ success: true, data: { mode: 'keyword', text: matchedRule.response, rule: matchedRule, log, quota: getQuotaPayload(req.crmSubscription) } });
        }

        if (!settings.aiEnabled) {
            const log = await CrmChatbotLog.create({
                userId: req.user._id,
                mode: 'none',
                promptPreview: previewText(message),
                status: 'skipped',
                errorMessage: 'AI disabled and no keyword rule matched.'
            });
            return res.json({ success: true, data: { mode: 'none', text: '', log, quota: getQuotaPayload(req.crmSubscription) } });
        }

        const aiInstructions = [
            settings.systemPrompt,
            settings.soulPrompt ? `Soul / vai tro:\n${settings.soulPrompt}` : '',
            settings.responseRules ? `Quy tac bat buoc:\n${settings.responseRules}` : '',
            `Pham vi tu dong: ca nhan=${settings.personalAudience}; nhom=${settings.groupAudience}. Neu can gui file/anh/link, chi quyet dinh dung tai lieu nao; agent Zalo tren may nguoi dung moi thuc hien gui that.`
        ].filter(Boolean).join('\n\n');
        const knowledge = settings.knowledgeSnippets?.length ? `\n\nKien thuc noi bo:\n${settings.knowledgeSnippets.join('\n---\n')}` : '';
        const promptContent = `${aiInstructions}${knowledge}\n\nTin nhan khach hang: ${message}`;
        const quotaUnits = getChatbotModelQuotaUnits(settings.aiModel);
        const { aiResponse, usageDoc, quota } = await runCrmAiWithQuota(req, {
            promptContent,
            sessionId: `crm-chatbot-test:${req.user._id}`,
            requestType: 'chatbot_test',
            systemPrompt: aiInstructions,
            model: settings.aiModel,
            temperature: settings.temperature,
            forceGcliDirect: true,
            quotaUnits
        });
        const log = await CrmChatbotLog.create({
            userId: req.user._id,
            mode: 'ai',
            aiUsageId: usageDoc._id,
            promptPreview: previewText(message),
            responsePreview: previewText(aiResponse.text),
            status: 'succeeded'
        });

        res.json({
            success: true,
            data: {
                mode: 'ai',
                text: aiResponse.text,
                model: aiResponse.model || settings.aiModel,
                quotaCost: quotaUnits,
                log,
                quota
            }
        });
    } catch (error) {
        console.error('Chatbot test error:', error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Loi server khi test chatbot.' });
    }
});

// ==========================================
// 7. MANAGED GROUPS, SEGMENTS, TASKS, ANALYTICS
// ==========================================

router.get('/groups/accounts', authMiddleware, async (req, res) => {
    try {
        const [devices, groups] = await Promise.all([
            CrmDevice.find({ userId: req.user._id, status: 'active' }).sort({ lastSeenAt: -1 }),
            CrmZaloGroup.aggregate([
                { $match: { userId: req.user._id } },
                { $group: { _id: '$accountId', managedCount: { $sum: { $cond: ['$isManaged', 1, 0] } }, totalGroups: { $sum: 1 } } }
            ])
        ]);
        res.json({
            success: true,
            data: {
                devices,
                accounts: groups.map((item) => ({
                    accountId: item._id,
                    label: item._id,
                    totalGroups: item.totalGroups,
                    managedCount: item.managedCount
                }))
            }
        });
    } catch (error) {
        console.error('Group accounts error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai tai khoan nhom.' });
    }
});

router.post('/groups/sync', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        let device = null;
        if (req.body.deviceId) {
            device = await CrmDevice.findOne({ _id: req.body.deviceId, userId: req.user._id, status: 'active' });
        }
        if (!device) {
            device = await CrmDevice.findOne({ userId: req.user._id, status: 'active' }).sort({ lastSeenAt: -1 });
        }
        if (!device) return res.status(400).json({ success: false, message: 'Khong co thiet bi agent dang hoat dong de dong bo nhom.' });

        const command = await CrmAgentCommand.create({
            userId: req.user._id,
            subscriptionId: req.crmSubscription._id,
            deviceId: device._id,
            type: 'zalo.groups.sync',
            payload: { accountId: req.body.accountId || null },
            status: 'queued',
            idempotencyKey: `groups-sync:${device._id}:${Date.now()}`,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000)
        });
        res.json({ success: true, data: { command } });
    } catch (error) {
        console.error('Groups sync error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tao lenh dong bo nhom.' });
    }
});

router.get('/groups', authMiddleware, async (req, res) => {
    try {
        const query = { userId: req.user._id };
        if (req.query.accountId) query.accountId = req.query.accountId;
        if (req.query.managed !== undefined) query.isManaged = req.query.managed === 'true';
        const groups = await CrmZaloGroup.find(query).sort({ isManaged: -1, lastMessageAt: -1, name: 1 });
        res.json({ success: true, data: groups });
    } catch (error) {
        console.error('Groups list error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai danh sach nhom.' });
    }
});

router.get('/groups/insights', authMiddleware, async (req, res) => {
    try {
        const query = { userId: req.user._id };
        if (req.query.status) query.status = req.query.status;
        if (req.query.type) query.type = req.query.type;
        if (req.query.groupId) query.groupId = req.query.groupId;
        const insights = await CrmGroupInsight.find(query).populate('groupId', 'name accountId groupId').sort({ priority: -1, createdAt: -1 }).limit(200);
        res.json({ success: true, data: insights });
    } catch (error) {
        console.error('Group insights error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai insight nhom.' });
    }
});

router.put('/groups/insights/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const insight = await CrmGroupInsight.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { $set: sanitizeUpdate(req.body, ['status', 'priority', 'recommendedAction']) },
            { new: true }
        );
        if (!insight) return res.status(404).json({ success: false, message: 'Khong tim thay insight.' });
        res.json({ success: true, data: insight });
    } catch (error) {
        console.error('Group insight update error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi cap nhat insight.' });
    }
});

router.put('/groups/:id/manage', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const isManaged = req.body.isManaged !== false;
        const updateData = sanitizeUpdate(req.body, ['summaryCadence', 'tags', 'notes', 'summaryConfig']);
        updateData.isManaged = isManaged;
        updateData.managedSince = isManaged ? new Date() : null;
        const group = await CrmZaloGroup.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { $set: updateData },
            { new: true }
        );
        if (!group) return res.status(404).json({ success: false, message: 'Khong tim thay nhom.' });
        await CrmAuditLog.create({
            userId: req.user._id,
            subscriptionId: req.crmSubscription._id,
            action: isManaged ? 'crm_group_management_enabled' : 'crm_group_management_disabled',
            details: { groupId: group.groupId, accountId: group.accountId, name: group.name }
        });
        res.json({ success: true, data: group });
    } catch (error) {
        console.error('Group manage error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi cap nhat quan ly nhom.' });
    }
});

router.get('/groups/:id/messages', authMiddleware, async (req, res) => {
    try {
        const group = await CrmZaloGroup.findOne({ _id: req.params.id, userId: req.user._id });
        if (!group) return res.status(404).json({ success: false, message: 'Khong tim thay nhom.' });
        const query = { userId: req.user._id, groupId: group._id };
        if (req.query.from || req.query.to) {
            query.sentAt = {};
            if (req.query.from) query.sentAt.$gte = new Date(req.query.from);
            if (req.query.to) query.sentAt.$lte = new Date(req.query.to);
        }
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
        const messages = await CrmGroupMessage.find(query).sort({ sentAt: -1, createdAt: -1 }).limit(limit);
        res.json({ success: true, data: messages.reverse() });
    } catch (error) {
        console.error('Group messages error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai tin nhan nhom.' });
    }
});

router.post('/groups/:id/checkpoints', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const group = await CrmZaloGroup.findOne({ _id: req.params.id, userId: req.user._id });
        if (!group) return res.status(404).json({ success: false, message: 'Khong tim thay nhom.' });
        const fromAt = req.body.fromAt ? new Date(req.body.fromAt) : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const toAt = req.body.toAt ? new Date(req.body.toAt) : new Date();
        const messageCount = await CrmGroupMessage.countDocuments({ userId: req.user._id, groupId: group._id, sentAt: { $gte: fromAt, $lte: toAt } });
        const checkpoint = await CrmGroupCheckpoint.create({
            userId: req.user._id,
            groupId: group._id,
            name: req.body.name || `Checkpoint ${new Date().toLocaleDateString('vi-VN')}`,
            fromAt,
            toAt,
            messageCount,
            createdBy: req.user._id
        });
        res.json({ success: true, data: checkpoint });
    } catch (error) {
        console.error('Group checkpoint create error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tao checkpoint.' });
    }
});

router.get('/groups/:id/checkpoints', authMiddleware, async (req, res) => {
    try {
        const group = await CrmZaloGroup.findOne({ _id: req.params.id, userId: req.user._id });
        if (!group) return res.status(404).json({ success: false, message: 'Khong tim thay nhom.' });
        const checkpoints = await CrmGroupCheckpoint.find({ userId: req.user._id, groupId: group._id }).sort({ createdAt: -1 });
        res.json({ success: true, data: checkpoints });
    } catch (error) {
        console.error('Group checkpoints list error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai checkpoint.' });
    }
});

router.post('/groups/:id/summarize', crmAiLimiter, authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const group = await CrmZaloGroup.findOne({ _id: req.params.id, userId: req.user._id });
        if (!group) return res.status(404).json({ success: false, message: 'Khong tim thay nhom.' });
        if (!group.isManaged) return res.status(403).json({ success: false, message: 'Chi tom tat nhom da bat quan ly.' });

        const scope = (req.body && typeof req.body.scope === 'object' && req.body.scope) ? req.body.scope : {};
        const mode = ['recent', 'range', 'incremental'].includes(scope.mode) ? scope.mode : 'incremental';
        const goals = Array.isArray(req.body.goals) ? req.body.goals.map(String) : [];
        const customPrompt = String(req.body.prompt || '').slice(0, 4000);

        const priorSummary = await CrmGroupSummary
            .findOne({ userId: req.user._id, groupId: group._id })
            .sort({ createdAt: -1 });

        // Privacy: the backend does NOT store group message content. The Flutter
        // client reads messages from the operator's LOCAL store and sends them here
        // transiently for AI processing only — they are never persisted.
        const rawMessages = Array.isArray(req.body.messages) ? req.body.messages : [];
        const messages = rawMessages
            .map((item) => ({
                senderName: String(item?.senderName || item?.senderId || 'Thanh vien').slice(0, 120),
                content: redactPhoneLikeStrings(String(item?.content || '')).slice(0, 4000),
                sentAt: item?.sentAt ? new Date(item.sentAt) : null
            }))
            .filter((item) => item.content.trim().length > 0)
            .sort((a, b) => (a.sentAt ? a.sentAt.getTime() : 0) - (b.sentAt ? b.sentAt.getTime() : 0))
            .slice(0, 400);

        const fromAt = messages.length ? messages[0].sentAt : null;
        const toAt = messages.length
            ? (messages[messages.length - 1].sentAt || new Date())
            : new Date();

        if (req.body.saveConfig) {
            group.summaryConfig = {
                scope: { mode, count: scope.count || null, rangeDays: scope.rangeDays || null },
                goals,
                industry: String(req.body.industry || group.summaryConfig?.industry || 'generic'),
                prompt: customPrompt,
                autoCreateTasks: req.body.autoCreateTasks === true
            };
            await group.save();
        }

        if (messages.length === 0) {
            return res.json({ success: true, data: { empty: true, messageCount: 0, summary: null, insights: [], quota: getQuotaPayload(req.crmSubscription) } });
        }

        // Open items (skip-done + tranh tao lai action item da theo doi)
        const openInsights = await CrmGroupInsight
            .find({ userId: req.user._id, groupId: group._id, status: 'open' })
            .select('title')
            .limit(60);
        const openItems = openInsights.map((item) => item.title);

        const promptContent = buildGroupSummaryPromptV2({
            group,
            messages,
            goals,
            customPrompt,
            priorSummary: priorSummary?.summaryText || '',
            openItems
        });
        // Model is a client-side (local) tab preference sent in the body; pro
        // models cost 2 quota units.
        const aiModel = normalizeSummaryAiModel(req.body.aiModel);
        const { aiResponse, usageDoc, quota } = await runCrmAiWithQuota(req, {
            promptContent,
            sessionId: `crm-group-summary:${req.user._id}:${group._id}`,
            requestType: 'group_summary',
            model: aiModel,
            quotaUnits: getChatbotModelQuotaUnits(aiModel)
        });

        const parsed = parseGroupSummaryJson(aiResponse.text);
        const summaryText = redactPhoneLikeStrings(parsed?.summaryText || aiResponse.text);
        const structured = parsed || {
            keyTopics: [], decisions: [], questions: [], risks: [], opportunities: [], sentiment: 'neutral', actionItems: []
        };

        const summary = await CrmGroupSummary.create({
            userId: req.user._id,
            groupId: group._id,
            summaryText,
            coveredFrom: fromAt,
            coveredTo: toAt,
            messageCount: messages.length,
            aiUsageId: usageDoc._id,
            model: aiResponse.model,
            keyTopics: structured.keyTopics,
            decisions: structured.decisions,
            questions: structured.questions,
            risks: structured.risks,
            opportunities: structured.opportunities,
            sentiment: structured.sentiment
        });

        // Record this summary in the chatbot response log (Nhật ký phản hồi) with tokens.
        await CrmChatbotLog.create({
            userId: req.user._id,
            kind: 'group_summary',
            accountId: group.accountId || '',
            threadId: group.groupId || '',
            mode: 'ai',
            aiUsageId: usageDoc._id,
            tokenIn: usageDoc.tokens?.promptTokens || 0,
            tokenOut: usageDoc.tokens?.completionTokens || 0,
            promptPreview: previewText(`Tóm tắt nhóm ${group.name || group.groupId} (${messages.length} tin)`),
            responsePreview: previewText(summaryText),
            status: 'succeeded'
        });

        // Structured output -> insight candidates (opportunities/risks/questions/actionItems)
        const candidates = [];
        (structured.opportunities || []).forEach((text) => candidates.push({ type: 'opportunity', title: text, description: '', priority: 'high' }));
        (structured.risks || []).forEach((text) => candidates.push({ type: 'risk', title: text, description: '', priority: 'high' }));
        (structured.questions || []).forEach((text) => candidates.push({ type: 'question', title: text, description: '', priority: 'medium' }));
        (structured.actionItems || []).forEach((item) => candidates.push({ type: 'follow_up', title: item.title, description: item.description || '', priority: item.priority || 'medium' }));

        const insights = [];
        for (const candidate of candidates) {
            const title = redactPhoneLikeStrings(String(candidate.title || '').trim()).slice(0, 200);
            if (!title) continue;
            const dedupKey = dedupKeyForItem(String(group._id), title);
            const existing = await CrmGroupInsight.findOne({ userId: req.user._id, groupId: group._id, dedupKey });
            if (existing) {
                // da co (open) hoac da xu ly (done/dismissed) -> khong tao lai
                if (existing.status === 'open') insights.push(existing);
                continue;
            }
            const created = await CrmGroupInsight.create({
                userId: req.user._id,
                groupId: group._id,
                summaryId: summary._id,
                dedupKey,
                type: candidate.type,
                title,
                description: redactPhoneLikeStrings(String(candidate.description || '')).slice(0, 1000),
                priority: candidate.priority,
                status: 'open'
            });
            insights.push(created);
        }

        res.json({ success: true, data: { summary, insights, quota } });
    } catch (error) {
        console.error('Group summarize error:', error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Loi server khi tom tat nhom.' });
    }
});

router.get('/groups/:id/summaries', authMiddleware, async (req, res) => {
    try {
        const group = await CrmZaloGroup.findOne({ _id: req.params.id, userId: req.user._id });
        if (!group) return res.status(404).json({ success: false, message: 'Khong tim thay nhom.' });
        const summaries = await CrmGroupSummary.find({ userId: req.user._id, groupId: group._id }).sort({ createdAt: -1 }).limit(100);
        res.json({ success: true, data: summaries });
    } catch (error) {
        console.error('Group summaries list error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai tom tat nhom.' });
    }
});

router.get('/agent/groups/managed', agentAuthMiddleware, async (req, res) => {
    try {
        const groups = await CrmZaloGroup.find({ userId: req.crmDevice.userId, isManaged: true }).select('accountId groupId name');
        res.json({ success: true, data: groups });
    } catch (error) {
        console.error('Agent managed groups error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai nhom managed.' });
    }
});

router.get('/segments', authMiddleware, async (req, res) => {
    try {
        const segments = await CrmSegment.find({ userId: req.user._id }).sort({ updatedAt: -1 });
        res.json({ success: true, data: segments });
    } catch (error) {
        console.error('Segments list error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai segment.' });
    }
});

router.post('/segments', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        if (!req.body.name) return res.status(400).json({ success: false, message: 'Ten segment la bat buoc.' });
        const segment = await CrmSegment.create({
            userId: req.user._id,
            name: req.body.name,
            description: req.body.description || '',
            filters: req.body.filters || {}
        });
        res.json({ success: true, data: segment });
    } catch (error) {
        console.error('Segment create error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tao segment.' });
    }
});

router.put('/segments/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const segment = await CrmSegment.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { $set: sanitizeUpdate(req.body, ['name', 'description', 'filters']) },
            { new: true }
        );
        if (!segment) return res.status(404).json({ success: false, message: 'Khong tim thay segment.' });
        res.json({ success: true, data: segment });
    } catch (error) {
        console.error('Segment update error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi cap nhat segment.' });
    }
});

router.delete('/segments/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const result = await CrmSegment.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!result) return res.status(404).json({ success: false, message: 'Khong tim thay segment.' });
        res.json({ success: true, message: 'Da xoa segment.' });
    } catch (error) {
        console.error('Segment delete error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi xoa segment.' });
    }
});

router.post('/segments/:id/preview', authMiddleware, async (req, res) => {
    try {
        const segment = await CrmSegment.findOne({ _id: req.params.id, userId: req.user._id });
        if (!segment) return res.status(404).json({ success: false, message: 'Khong tim thay segment.' });
        const query = buildSegmentQuery(req.user._id, segment.filters || {});
        const customers = await CrmCustomer.find(query).sort({ updatedAt: -1 }).limit(200);
        const total = await CrmCustomer.countDocuments(query);
        res.json({ success: true, data: { segment, customers, total } });
    } catch (error) {
        console.error('Segment preview error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi preview segment.' });
    }
});

router.get('/tasks', authMiddleware, async (req, res) => {
    try {
        const query = { userId: req.user._id };
        if (req.query.status) query.status = req.query.status;
        if (req.query.priority) query.priority = req.query.priority;
        const tasks = await CrmTask.find(query)
            .populate('customerId', 'name phone lifecycleStage')
            .populate('groupId', 'name accountId groupId')
            .sort({ status: 1, dueAt: 1, createdAt: -1 })
            .limit(300);
        res.json({ success: true, data: tasks });
    } catch (error) {
        console.error('Tasks list error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai task.' });
    }
});

router.post('/tasks', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        if (!req.body.title) return res.status(400).json({ success: false, message: 'Tieu de task la bat buoc.' });
        let leadScoreSnapshot = 0;
        if (req.body.customerId) {
            const customer = await CrmCustomer.findOne({ _id: req.body.customerId, userId: req.user._id });
            const recentInboundCount = await CrmMessage.countDocuments({ userId: req.user._id, direction: 'inbound', createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, ...(req.body.conversationId ? { conversationId: req.body.conversationId } : {}) });
            leadScoreSnapshot = calculateCrmLeadScore({ customer, recentInboundCount, manualAdjustment: req.body.manualScoreAdjustment || 0 });
        }
        const task = await CrmTask.create({
            userId: req.user._id,
            title: req.body.title,
            description: req.body.description || '',
            relatedType: req.body.relatedType || 'manual',
            customerId: req.body.customerId || null,
            groupId: req.body.groupId || null,
            conversationId: req.body.conversationId || null,
            insightId: req.body.insightId || null,
            dueAt: req.body.dueAt || null,
            priority: req.body.priority || 'medium',
            status: req.body.status || 'open',
            ownerNote: req.body.ownerNote || '',
            leadScoreSnapshot,
            manualScoreAdjustment: Number(req.body.manualScoreAdjustment) || 0
        });
        res.json({ success: true, data: task });
    } catch (error) {
        console.error('Task create error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tao task.' });
    }
});

router.put('/tasks/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const task = await CrmTask.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { $set: sanitizeUpdate(req.body, ['title', 'description', 'dueAt', 'priority', 'status', 'ownerNote', 'manualScoreAdjustment']) },
            { new: true }
        );
        if (!task) return res.status(404).json({ success: false, message: 'Khong tim thay task.' });
        res.json({ success: true, data: task });
    } catch (error) {
        console.error('Task update error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi cap nhat task.' });
    }
});

router.delete('/tasks/:id', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const result = await CrmTask.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!result) return res.status(404).json({ success: false, message: 'Khong tim thay task.' });
        res.json({ success: true, message: 'Da xoa task.' });
    } catch (error) {
        console.error('Task delete error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi xoa task.' });
    }
});

router.get('/analytics/funnel', authMiddleware, async (req, res) => {
    try {
        const raw = await CrmCustomer.aggregate([
            { $match: { userId: req.user._id } },
            { $group: { _id: '$lifecycleStage', count: { $sum: 1 } } }
        ]);
        res.json({ success: true, data: raw.map((item) => ({ label: item._id || 'other', value: item.count })) });
    } catch (error) {
        console.error('Analytics funnel error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai funnel.' });
    }
});

router.get('/analytics/campaigns', authMiddleware, async (req, res) => {
    try {
        const raw = await CrmExecutionLog.aggregate([
            { $match: { userId: req.user._id, createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
            { $group: { _id: { day: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d' } }, status: '$status' }, count: { $sum: 1 } } },
            { $sort: { '_id.day': 1 } }
        ]);
        res.json({ success: true, data: raw.map((item) => ({ date: item._id.day, status: item._id.status, count: item.count })) });
    } catch (error) {
        console.error('Analytics campaigns error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai analytics chien dich.' });
    }
});

router.get('/analytics/chatbot', authMiddleware, async (req, res) => {
    try {
        const raw = await CrmChatbotLog.aggregate([
            { $match: { userId: req.user._id } },
            { $group: { _id: '$mode', count: { $sum: 1 } } }
        ]);
        res.json({ success: true, data: raw.map((item) => ({ mode: item._id, count: item.count })) });
    } catch (error) {
        console.error('Analytics chatbot error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai analytics chatbot.' });
    }
});

router.get('/analytics/groups', authMiddleware, async (req, res) => {
    try {
        const [managedGroups, summaries, openInsights] = await Promise.all([
            CrmZaloGroup.countDocuments({ userId: req.user._id, isManaged: true }),
            CrmGroupSummary.countDocuments({ userId: req.user._id }),
            CrmGroupInsight.countDocuments({ userId: req.user._id, status: 'open' })
        ]);
        res.json({ success: true, data: { managedGroups, summaries, openInsights } });
    } catch (error) {
        console.error('Analytics groups error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai analytics nhom.' });
    }
});

// Daily AI token usage (in/out) for chatbot replies + group summaries, for the
// campaign-overview chart. Range defaults to the last 30 days.
router.get('/analytics/ai-tokens', authMiddleware, async (req, res) => {
    try {
        const to = req.query.to ? new Date(req.query.to) : new Date();
        const from = req.query.from
            ? new Date(req.query.from)
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const rows = await CrmAiUsage.aggregate([
            { $match: { userId: req.user._id, createdAt: { $gte: from, $lte: to } } },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: '$createdAt',
                            timezone: 'Asia/Ho_Chi_Minh'
                        }
                    },
                    tokenIn: { $sum: { $ifNull: ['$tokens.promptTokens', 0] } },
                    tokenOut: { $sum: { $ifNull: ['$tokens.completionTokens', 0] } },
                    requests: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);
        res.json({
            success: true,
            data: rows.map((r) => ({
                date: r._id,
                tokenIn: r.tokenIn || 0,
                tokenOut: r.tokenOut || 0,
                requests: r.requests || 0
            }))
        });
    } catch (error) {
        console.error('Analytics ai-tokens error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai thong ke token AI.' });
    }
});

router.get('/exports/customers', authMiddleware, async (req, res) => {
    try {
        let query = {
            userId: req.user._id,
            ...(req.query.status ? { status: req.query.status } : {}),
            ...(req.query.lifecycleStage ? { lifecycleStage: req.query.lifecycleStage } : {}),
            ...(req.query.tag ? { tags: req.query.tag } : {})
        };

        if (req.query.segmentId) {
            const segment = await CrmSegment.findOne({ _id: req.query.segmentId, userId: req.user._id });
            if (!segment) return res.status(404).json({ success: false, message: 'Khong tim thay segment.' });
            query = buildSegmentQuery(req.user._id, segment.filters || {});
        }

        const customers = await CrmCustomer.find(query).sort({ createdAt: -1 }).limit(10000);
        const rows = customers.map((customer) => ({
            name: customer.name || '',
            phone: customer.phone || '',
            email: customer.email || '',
            company: customer.company || '',
            lifecycleStage: customer.lifecycleStage || '',
            status: customer.status || '',
            tags: Array.isArray(customer.tags) ? customer.tags.join(';') : '',
            source: customer.source || '',
            consentStatus: customer.consentStatus || '',
            leadScore: customer.leadScore || 0,
            lastInteractionAt: customer.lastInteractionAt || '',
            createdAt: customer.createdAt || ''
        }));
        const csv = serializeCsv([
            { key: 'name', label: 'Name' },
            { key: 'phone', label: 'Phone' },
            { key: 'email', label: 'Email' },
            { key: 'company', label: 'Company' },
            { key: 'lifecycleStage', label: 'Lifecycle Stage' },
            { key: 'status', label: 'Status' },
            { key: 'tags', label: 'Tags' },
            { key: 'source', label: 'Source' },
            { key: 'consentStatus', label: 'Consent Status' },
            { key: 'leadScore', label: 'Lead Score' },
            { key: 'lastInteractionAt', label: 'Last Interaction At' },
            { key: 'createdAt', label: 'Created At' }
        ], rows);
        res.json({ success: true, data: { filename: 'crm-customers.csv', csv, count: rows.length } });
    } catch (error) {
        console.error('Customers export error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi export khach hang.' });
    }
});

router.get('/exports/campaign-logs', authMiddleware, async (req, res) => {
    try {
        const logs = await CrmExecutionLog.find({ userId: req.user._id })
            .populate('campaignId', 'name channel')
            .sort({ createdAt: -1 })
            .limit(10000);
        const rows = logs.map((log) => ({
            campaignName: log.campaignId?.name || '',
            channel: log.channel || log.campaignId?.channel || '',
            recipientName: log.recipientName || '',
            recipientPhone: log.recipientPhone || '',
            status: log.status || '',
            messagePreview: log.messagePreview || '',
            providerMessageId: log.providerMessageId || '',
            errorMessage: log.errorMessage || '',
            sentAt: log.sentAt || '',
            createdAt: log.createdAt || ''
        }));
        const csv = serializeCsv([
            { key: 'campaignName', label: 'Campaign' },
            { key: 'channel', label: 'Channel' },
            { key: 'recipientName', label: 'Recipient Name' },
            { key: 'recipientPhone', label: 'Recipient Phone' },
            { key: 'status', label: 'Status' },
            { key: 'messagePreview', label: 'Message Preview' },
            { key: 'providerMessageId', label: 'Provider Message ID' },
            { key: 'errorMessage', label: 'Error Message' },
            { key: 'sentAt', label: 'Sent At' },
            { key: 'createdAt', label: 'Created At' }
        ], rows);
        res.json({ success: true, data: { filename: 'crm-campaign-logs.csv', csv, count: rows.length } });
    } catch (error) {
        console.error('Campaign logs export error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi export log chien dich.' });
    }
});

router.get('/exports/group-summaries', authMiddleware, async (req, res) => {
    try {
        const query = {
            userId: req.user._id,
            ...(req.query.groupId ? { groupId: req.query.groupId } : {})
        };
        const summaries = await CrmGroupSummary.find(query).sort({ createdAt: -1 }).limit(10000);
        const rows = summaries.map((summary) => ({
            groupId: summary.groupId || '',
            summaryText: summary.summaryText || '',
            keyTopics: Array.isArray(summary.keyTopics) ? summary.keyTopics.join(';') : '',
            decisions: Array.isArray(summary.decisions) ? summary.decisions.join(';') : '',
            sentiment: summary.sentiment || '',
            aiUsageId: summary.aiUsageId || '',
            createdAt: summary.createdAt || ''
        }));
        const csv = serializeCsv([
            { key: 'groupId', label: 'Group ID' },
            { key: 'summaryText', label: 'Summary' },
            { key: 'keyTopics', label: 'Key Topics' },
            { key: 'decisions', label: 'Decisions' },
            { key: 'sentiment', label: 'Sentiment' },
            { key: 'aiUsageId', label: 'AI Usage ID' },
            { key: 'createdAt', label: 'Created At' }
        ], rows);
        res.json({ success: true, data: { filename: 'crm-group-summaries.csv', csv, count: rows.length } });
    } catch (error) {
        console.error('Group summaries export error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi export tom tat nhom.' });
    }
});

router.post('/customers/import', authMiddleware, requireActiveSubscription, async (req, res) => {
    try {
        const rows = Array.isArray(req.body.rows) ? req.body.rows : parseCsvRows(req.body.csv || '');
        if (rows.length === 0) return res.status(400).json({ success: false, message: 'Khong co dong import hop le.' });

        const validationErrors = [];
        let createdCount = 0;
        let updatedCount = 0;
        let skippedDuplicates = 0;

        for (let index = 0; index < rows.length; index++) {
            const row = rows[index];
            const name = String(row.name || row.ten || '').trim();
            const phone = String(row.phone || row.sdt || '').trim();
            const email = String(row.email || '').trim().toLowerCase();
            const zaloUserId = String(row.zaloUserId || '').trim();
            if (!name || (!phone && !email && !zaloUserId)) {
                validationErrors.push({ row: index + 1, message: 'Can name va it nhat phone/email/zaloUserId.' });
                continue;
            }
            const duplicateQuery = {
                userId: req.user._id,
                $or: [
                    ...(phone ? [{ phone }] : []),
                    ...(email ? [{ email }] : []),
                    ...(zaloUserId ? [{ zaloUserId }] : [])
                ]
            };
            const existing = duplicateQuery.$or.length > 0 ? await CrmCustomer.findOne(duplicateQuery) : null;
            const tags = String(row.tags || '').split(/[;|,]/).map((item) => item.trim()).filter(Boolean);
            if (existing) {
                existing.name = name || existing.name;
                existing.phone = phone || existing.phone;
                existing.email = email || existing.email;
                existing.company = row.company || existing.company || '';
                existing.tags = tags.length > 0 ? tags : existing.tags;
                existing.consentStatus = row.consentStatus || existing.consentStatus || 'pending';
                await existing.save();
                updatedCount += 1;
            } else {
                await CrmCustomer.create({
                    userId: req.user._id,
                    name,
                    phone,
                    email,
                    company: row.company || '',
                    tags,
                    consentStatus: row.consentStatus || 'pending',
                    source: row.source || 'CSV Import',
                    lifecycleStage: row.lifecycleStage || 'lead',
                    zaloUserId,
                    consentEvidence: row.consentEvidence || 'CSV import'
                });
                createdCount += 1;
            }
        }

        res.json({ success: true, data: { createdCount, updatedCount, skippedDuplicates, validationErrors } });
    } catch (error) {
        console.error('Customers import error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi import khach hang.' });
    }
});

router.get('/admin/tenant-health', authMiddleware, adminOnly, async (req, res) => {
    try {
        const [
            activeSubscriptions,
            activeDevices,
            commandBacklog,
            failedCampaigns,
            aiUsageByType,
            groupSummaryUsage
        ] = await Promise.all([
            CrmSubscription.countDocuments({ status: 'active' }),
            CrmDevice.countDocuments({ status: 'active' }),
            CrmAgentCommand.countDocuments({ status: { $in: ['queued', 'sent', 'running'] } }),
            CrmCampaign.countDocuments({ status: { $in: ['cancelled'] } }),
            CrmAiUsage.aggregate([{ $group: { _id: '$requestType', count: { $sum: 1 } } }]),
            CrmGroupSummary.countDocuments()
        ]);
        res.json({
            success: true,
            data: {
                activeSubscriptions,
                activeDevices,
                commandBacklog,
                failedCampaigns,
                aiUsageByType: aiUsageByType.map((item) => ({ requestType: item._id, count: item.count })),
                groupSummaryUsage
            }
        });
    } catch (error) {
        console.error('Admin tenant health error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tai tenant health.' });
    }
});

router.post('/admin/automation/disable', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { userId, deviceId, reason } = req.body;
        if (!userId && !deviceId) return res.status(400).json({ success: false, message: 'Can userId hoac deviceId.' });
        const deviceQuery = deviceId ? { _id: deviceId } : { userId, status: 'active' };
        const result = await CrmDevice.updateMany(deviceQuery, { $set: { status: 'disabled' } });
        await CrmAuditLog.create({
            userId: userId || req.user._id,
            action: 'admin_automation_disabled',
            details: { adminUserId: req.user._id, deviceId, reason: reason || '' }
        });
        res.json({ success: true, data: { modifiedCount: result.modifiedCount } });
    } catch (error) {
        console.error('Admin automation disable error:', error);
        res.status(500).json({ success: false, message: 'Loi server khi tat automation.' });
    }
});

// ==========================================
// 8. ADMIN CRM ENDPOINTS
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

        // Dynamic fallback to Backblaze B2 latest release if not specified in DB
        let b2Data = null;
        try {
            const response = await fetch('https://cdn.giaiphapsangtao.com/file/alpha-studio/crm-app/version.json');
            if (response.ok) {
                const release = await response.json();
                const windowsAsset = release.assets?.find(a => a.name.endsWith('.exe') || a.name.endsWith('.msix') || a.name.endsWith('.zip'));
                const androidAsset = release.assets?.find(a => a.name.endsWith('.apk'));
                b2Data = {
                    version: release.tag_name ? (release.tag_name.startsWith('v') ? release.tag_name.substring(1) : release.tag_name) : '1.0.0',
                    windowsInstallerUrl: windowsAsset ? windowsAsset.browser_download_url : 'https://cdn.giaiphapsangtao.com/file/alpha-studio/crm-app/releases/alpha-crm-v1.0.0.exe',
                    androidApkUrl: androidAsset ? androidAsset.browser_download_url : 'https://cdn.giaiphapsangtao.com/file/alpha-studio/crm-app/releases/alpha-crm-v1.0.0.apk',
                    releaseNotes: release.body || 'Bản phát hành chính thức Alpha CRM',
                    sha256: 'mock-sha256-hash-value',
                    publishedAt: release.published_at || new Date().toISOString()
                };
            }
        } catch (fetchError) {
            console.error('Failed to fetch from Backblaze B2:', fetchError.message);
        }

        // Return B2 data or the hardcoded default
        const latestRelease = b2Data || {
            version: '1.0.0',
            windowsInstallerUrl: 'https://cdn.giaiphapsangtao.com/file/alpha-studio/crm-app/releases/alpha-crm-v1.0.0.exe',
            androidApkUrl: 'https://cdn.giaiphapsangtao.com/file/alpha-studio/crm-app/releases/alpha-crm-v1.0.0.apk',
            releaseNotes: 'Bản phát hành chính thức Alpha CRM Production',
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

