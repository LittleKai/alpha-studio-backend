import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import ChatMessage from '../models/ChatMessage.js';
import { callConfiguredAiProvider } from '../utils/aiProvider.js';

const router = express.Router();

const HISTORY_DEFAULT_LIMIT = 50;
const HISTORY_MAX_LIMIT = 200;
const MAX_USER_MESSAGE_CHARS = 8000;

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

router.post('/send', authMiddleware, async (req, res) => {
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
            console.error('AI chat forward error:', err.message);
            return res.status(502).json({
                success: false,
                message: err.message || 'Trợ lý AI tạm thời không phản hồi.',
                data: { userMessage }
            });
        }

        const assistantMessage = await ChatMessage.create({
            userId: req.user._id,
            role: 'assistant',
            content: aiText
        });

        return res.json({
            success: true,
            data: { userMessage, assistantMessage }
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
