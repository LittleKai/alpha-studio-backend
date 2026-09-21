import express from 'express';
import ServiceCategory, { ACCENTS } from '../models/ServiceCategory.js';
import Article from '../models/Article.js';
import { authMiddleware, modOnly } from '../middleware/auth.js';

const router = express.Router();

/** Chỉ nhận field hợp lệ từ body; bỏ mọi thứ khác. */
export function pickCategoryFields(body = {}) {
    const out = {};
    if (body.title) out.title = { vi: String(body.title.vi || ''), en: String(body.title.en || '') };
    if (body.description !== undefined) {
        out.description = {
            vi: String(body.description?.vi || ''),
            en: String(body.description?.en || '')
        };
    }
    if (body.coverImage !== undefined) out.coverImage = String(body.coverImage || '');
    if (body.icon !== undefined) out.icon = String(body.icon || '').slice(0, 8);
    if (ACCENTS.includes(body.accent)) out.accent = body.accent;
    if (body.order !== undefined) out.order = Number(body.order) || 0;
    if (['published', 'hidden'].includes(body.status)) out.status = body.status;
    return out;
}

// ==================== PUBLIC ====================

// GET /api/service-categories - phân mục đang hiển thị
router.get('/', async (req, res) => {
    try {
        const data = await ServiceCategory.find({ status: 'published' })
            .sort({ order: 1, createdAt: 1 });
        res.json({ success: true, data });
    } catch (error) {
        console.error('Get service categories error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ==================== ADMIN/MOD ====================

// GET /api/service-categories/admin/list - gồm cả phân mục đang ẩn
router.get('/admin/list', authMiddleware, modOnly, async (req, res) => {
    try {
        const data = await ServiceCategory.find({}).sort({ order: 1, createdAt: 1 });
        res.json({ success: true, data });
    } catch (error) {
        console.error('Admin list service categories error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// POST /api/service-categories
router.post('/', authMiddleware, modOnly, async (req, res) => {
    try {
        const fields = pickCategoryFields(req.body);
        if (!fields.title?.vi) {
            return res.status(400).json({ success: false, message: 'Cần tên tiếng Việt' });
        }

        const category = new ServiceCategory(fields);
        await category.save();

        res.status(201).json({ success: true, message: 'Tạo phân mục thành công', data: category });
    } catch (error) {
        console.error('Create service category error:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: error.message });
        }
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// PUT /api/service-categories/:id
router.put('/:id', authMiddleware, modOnly, async (req, res) => {
    try {
        const category = await ServiceCategory.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy phân mục' });
        }

        Object.assign(category, pickCategoryFields(req.body));
        await category.save();

        res.json({ success: true, message: 'Cập nhật phân mục thành công', data: category });
    } catch (error) {
        console.error('Update service category error:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: error.message });
        }
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// DELETE /api/service-categories/:id
router.delete('/:id', authMiddleware, modOnly, async (req, res) => {
    try {
        const category = await ServiceCategory.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy phân mục' });
        }

        // Gỡ liên kết trước khi xoá để bài không trỏ vào phân mục đã biến mất
        await Article.updateMany(
            { serviceCategory: category._id },
            { $set: { serviceCategory: null } }
        );
        await category.deleteOne();

        res.json({ success: true, message: 'Xóa phân mục thành công' });
    } catch (error) {
        console.error('Delete service category error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

export default router;
