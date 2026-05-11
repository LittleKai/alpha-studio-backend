import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';

const router = express.Router();

/**
 * @route   POST /api/vocab/spend
 * @desc    Deduct credits for VocabFlip actions
 * @access  Private
 */
router.post('/spend', authMiddleware, async (req, res) => {
    try {
        const { amount, reason } = req.body;

        // Input validation
        if (!amount || typeof amount !== 'number' || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Số xu không hợp lệ'
            });
        }

        const userId = req.user.id;

        // Get up-to-date user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }

        // Check balance
        if (user.balance < amount) {
            return res.status(400).json({
                success: false,
                message: 'Không đủ số dư để thực hiện thao tác này'
            });
        }

        // Deduct balance
        user.balance -= amount;
        await user.save();

        // Create transaction
        await Transaction.create({
            userId: user._id,
            type: 'spend',
            serviceType: 'vocab',
            amount: amount,
            status: 'completed',
            notes: reason || 'VocabFlip action',
            createdAt: new Date()
        });

        return res.json({
            success: true,
            message: 'Đã trừ xu thành công',
            data: {
                remainingBalance: user.balance
            }
        });

    } catch (error) {
        console.error('Context:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi server khi trừ xu VocabFlip'
        });
    }
});

export default router;
