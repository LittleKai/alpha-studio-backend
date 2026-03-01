import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

const DAILY_LIMIT = 3;

// Get today's date string in YYYY-MM-DD (UTC)
function getTodayString() {
    return new Date().toISOString().slice(0, 10);
}

// GET /api/studio/usage — returns current daily usage for authenticated user
router.get('/usage', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('studioUsage');
        const today = getTodayString();

        const sameDay = user.studioUsage?.date === today;
        const used = sameDay ? (user.studioUsage?.count || 0) : 0;

        res.json({
            success: true,
            data: {
                used,
                limit: DAILY_LIMIT,
                remaining: Math.max(0, DAILY_LIMIT - used)
            }
        });
    } catch (error) {
        console.error('Studio usage error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// POST /api/studio/use — check and consume one daily use
router.post('/use', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('studioUsage role');
        const today = getTodayString();

        // Admin/mod users have no limit
        if (user.role === 'admin' || user.role === 'mod') {
            return res.json({
                success: true,
                data: { used: 0, limit: null, remaining: null, unlimited: true }
            });
        }

        const sameDay = user.studioUsage?.date === today;
        const currentCount = sameDay ? (user.studioUsage?.count || 0) : 0;

        if (currentCount >= DAILY_LIMIT) {
            return res.status(429).json({
                success: false,
                message: `Bạn đã dùng hết ${DAILY_LIMIT} lần miễn phí hôm nay. Quay lại vào ngày mai!`,
                data: { used: currentCount, limit: DAILY_LIMIT, remaining: 0 }
            });
        }

        // Increment usage
        const newCount = currentCount + 1;
        await User.findByIdAndUpdate(req.user._id, {
            studioUsage: { date: today, count: newCount }
        });

        res.json({
            success: true,
            data: {
                used: newCount,
                limit: DAILY_LIMIT,
                remaining: Math.max(0, DAILY_LIMIT - newCount)
            }
        });
    } catch (error) {
        console.error('Studio use error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

export default router;
