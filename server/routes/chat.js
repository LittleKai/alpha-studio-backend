import express from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middleware/auth.js';
import ChatMessage from '../models/ChatMessage.js';
import User from '../models/User.js';
import { callConfiguredAiProvider } from '../utils/aiProvider.js';

const router = express.Router();

const HISTORY_DEFAULT_LIMIT = 50;
const HISTORY_MAX_LIMIT = 200;
const MAX_USER_MESSAGE_CHARS = 8000;
export const DAILY_CHAT_LIMIT = 10;
const CHAT_TIMEZONE = 'Asia/Ho_Chi_Minh';

const chatSendLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Bạn gửi tin nhắn quá nhanh, vui lòng thử lại sau ít phút.'
    }
});

export function isUnlimitedChatRole(role) {
    return role === 'admin' || role === 'mod';
}

export function getChatTodayString(now = new Date()) {
    return now.toLocaleDateString('en-CA', { timeZone: CHAT_TIMEZONE });
}

export function formatChatUsage(chatUsage, role, today = getChatTodayString()) {
    if (isUnlimitedChatRole(role)) {
        return {
            used: 0,
            limit: null,
            remaining: null,
            unlimited: true
        };
    }
    const used = chatUsage?.date === today ? Math.max(0, Number(chatUsage.count) || 0) : 0;
    return {
        used,
        limit: DAILY_CHAT_LIMIT,
        remaining: Math.max(0, DAILY_CHAT_LIMIT - used),
        unlimited: false
    };
}

export async function consumeChatQuota(userId, role, { UserModel = User, now = new Date() } = {}) {
    if (isUnlimitedChatRole(role)) {
        return {
            ok: true,
            usage: formatChatUsage(null, role)
        };
    }

    const today = getChatTodayString(now);
    await UserModel.updateOne(
        { _id: userId, 'chatUsage.date': { $ne: today } },
        { $set: { 'chatUsage.date': today, 'chatUsage.count': 0 } }
    );

    const updated = await UserModel.findOneAndUpdate(
        {
            _id: userId,
            'chatUsage.date': today,
            'chatUsage.count': { $lt: DAILY_CHAT_LIMIT }
        },
        { $inc: { 'chatUsage.count': 1 } },
        { new: true, select: 'chatUsage' }
    );

    if (!updated) {
        return {
            ok: false,
            usage: {
                used: DAILY_CHAT_LIMIT,
                limit: DAILY_CHAT_LIMIT,
                remaining: 0,
                unlimited: false
            }
        };
    }

    return {
        ok: true,
        usage: formatChatUsage(updated.chatUsage, role, today)
    };
}

export async function refundChatQuota(userId, role, { UserModel = User, now = new Date() } = {}) {
    if (isUnlimitedChatRole(role)) return;
    const today = getChatTodayString(now);
    await UserModel.updateOne(
        { _id: userId, 'chatUsage.date': today, 'chatUsage.count': { $gt: 0 } },
        { $inc: { 'chatUsage.count': -1 } }
    );
}

router.get('/usage', authMiddleware, async (req, res) => {
    try {
        if (isUnlimitedChatRole(req.user.role)) {
            return res.json({
                success: true,
                data: formatChatUsage(null, req.user.role)
            });
        }
        const user = await User.findById(req.user._id).select('chatUsage').lean();
        return res.json({
            success: true,
            data: formatChatUsage(user?.chatUsage, req.user.role)
        });
    } catch (error) {
        console.error('Chat usage error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi kiểm tra lượt chat.' });
    }
});

router.get('/history', authMiddleware, async (req, res) => {
    try {
        const requested = parseInt(req.query.limit, 10);
        const limit = Math.min(
            Number.isFinite(requested) && requested > 0 ? requested : HISTORY_DEFAULT_LIMIT,
            HISTORY_MAX_LIMIT
        );

        const messages = await ChatMessage
            .find({ userId: req.user._id })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return res.json({
            success: true,
            data: messages.reverse()
        });
    } catch (error) {
        console.error('Chat history error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi tải lịch sử chat.' });
    }
});

router.post('/send', authMiddleware, chatSendLimiter, async (req, res) => {
    try {
        const { content } = req.body || {};
        if (typeof content !== 'string' || !content.trim()) {
            return res.status(400).json({ success: false, message: 'Nội dung tin nhắn không hợp lệ.' });
        }

        const trimmed = content.trim();
        if (trimmed.length > MAX_USER_MESSAGE_CHARS) {
            return res.status(400).json({
                success: false,
                message: `Tin nhắn quá dài (tối đa ${MAX_USER_MESSAGE_CHARS} ký tự).`
            });
        }

        const quota = await consumeChatQuota(req.user._id, req.user.role);
        if (!quota.ok) {
            return res.status(429).json({
                success: false,
                message: `Bạn đã dùng hết ${DAILY_CHAT_LIMIT} lượt hỏi trợ lý AI hôm nay. Vui lòng quay lại vào ngày mai!`,
                data: { usage: quota.usage }
            });
        }

        const recentMessages = await ChatMessage
            .find({ userId: req.user._id })
            .sort({ createdAt: -1 })
            .limit(3)
            .lean();
        const directProviderHistory = recentMessages
            .reverse()
            .map((msg) => ({
                role: msg.role,
                content: msg.content
            }));

        const userMessage = await ChatMessage.create({
            userId: req.user._id,
            role: 'user',
            content: trimmed
        });
        directProviderHistory.push({
            role: 'user',
            content: trimmed
        });

        let aiText;
        try {
            const aiResult = await callConfiguredAiProvider(trimmed, req.user._id.toString(), {
                messages: directProviderHistory
            });
            aiText = aiResult.text;
        } catch (err) {
            await refundChatQuota(req.user._id, req.user.role).catch(() => {});
            console.error('AI chat forward error:', err.message);
            return res.status(502).json({
                success: false,
                message: err.message || 'Trợ lý AI tạm thời không phản hồi.',
                data: {
                    userMessage,
                    usage: quota.usage.unlimited
                        ? quota.usage
                        : {
                            ...quota.usage,
                            used: Math.max(0, quota.usage.used - 1),
                            remaining: Math.min(DAILY_CHAT_LIMIT, (quota.usage.remaining ?? 0) + 1)
                        }
                }
            });
        }

        const assistantMessage = await ChatMessage.create({
            userId: req.user._id,
            role: 'assistant',
            content: aiText
        });

        return res.json({
            success: true,
            data: { userMessage, assistantMessage, usage: quota.usage }
        });
    } catch (error) {
        console.error('Chat send error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi xử lý tin nhắn.' });
    }
});

router.delete('/history', authMiddleware, async (req, res) => {
    try {
        const result = await ChatMessage.deleteMany({ userId: req.user._id });
        return res.json({
            success: true,
            message: 'Đã xóa lịch sử chat.',
            data: { deletedCount: result.deletedCount }
        });
    } catch (error) {
        console.error('Chat reset error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi xóa lịch sử chat.' });
    }
});

export default router;
