import express from 'express';
import Article from '../models/Article.js';
import { authMiddleware, modOnly } from '../middleware/auth.js';

const router = express.Router();

// ==================== PUBLIC ROUTES ====================

// GET /api/articles - List articles (public, filtered by category + status=published)
router.get('/', async (req, res) => {
    try {
        const { category, page = 1, limit = 20, search } = req.query;
        const query = { status: 'published' };

        if (category) {
            query.category = category;
        }

        if (search) {
            query.$text = { $search: search };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [data, total] = await Promise.all([
            Article.find(query)
                .populate('author', 'name avatar')
                .sort({ order: 1, createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Article.countDocuments(query)
        ]);

        res.json({
            success: true,
            data,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get articles error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ==================== ADMIN/MOD ROUTES ====================
// NOTE: Admin routes MUST be defined before /:slug to avoid route conflicts

// GET /api/articles/admin/list - List all articles for admin (includes drafts)
router.get('/admin/list', authMiddleware, modOnly, async (req, res) => {
    try {
        const { category, status, page = 1, limit = 20, search } = req.query;
        const query = {};

        if (category) query.category = category;
        if (status) query.status = status;

        if (search) {
            query.$or = [
                { 'title.vi': { $regex: search, $options: 'i' } },
                { 'title.en': { $regex: search, $options: 'i' } },
                { tags: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [data, total] = await Promise.all([
            Article.find(query)
                .populate('author', 'name avatar')
                .sort({ order: 1, createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Article.countDocuments(query)
        ]);

        res.json({
            success: true,
            data,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Admin list articles error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// POST /api/articles - Create article
router.post('/', authMiddleware, modOnly, async (req, res) => {
    try {
        const { title, excerpt, content, thumbnail, category, tags, order, isFeatured } = req.body;

        if (!title?.vi || !title?.en) {
            return res.status(400).json({ success: false, message: 'Cần tiêu đề cả tiếng Việt và tiếng Anh' });
        }

        if (!category || !['about', 'services'].includes(category)) {
            return res.status(400).json({ success: false, message: 'Category không hợp lệ' });
        }

        const article = new Article({
            title,
            excerpt,
            content,
            thumbnail,
            category,
            tags: tags || [],
            order: order || 0,
            isFeatured: isFeatured || false,
            author: req.user._id
        });

        await article.save();

        res.status(201).json({
            success: true,
            message: 'Tạo bài viết thành công',
            data: article
        });
    } catch (error) {
        console.error('Create article error:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: error.message });
        }
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// PUT /api/articles/:id - Update article
router.put('/:id', authMiddleware, modOnly, async (req, res) => {
    try {
        const { title, excerpt, content, thumbnail, category, tags, order, isFeatured, status } = req.body;

        const article = await Article.findById(req.params.id);
        if (!article) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bài viết' });
        }

        if (title) article.title = title;
        if (excerpt !== undefined) article.excerpt = excerpt;
        if (content !== undefined) article.content = content;
        if (thumbnail !== undefined) article.thumbnail = thumbnail;
        if (category) article.category = category;
        if (tags !== undefined) article.tags = tags;
        if (order !== undefined) article.order = order;
        if (isFeatured !== undefined) article.isFeatured = isFeatured;
        if (status) article.status = status;

        await article.save();

        res.json({
            success: true,
            message: 'Cập nhật bài viết thành công',
            data: article
        });
    } catch (error) {
        console.error('Update article error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// PATCH /api/articles/:id/publish - Publish article
router.patch('/:id/publish', authMiddleware, modOnly, async (req, res) => {
    try {
        const article = await Article.findByIdAndUpdate(
            req.params.id,
            { status: 'published' },
            { new: true }
        );
        if (!article) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bài viết' });
        }

        res.json({ success: true, message: 'Xuất bản bài viết thành công', data: article });
    } catch (error) {
        console.error('Publish article error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// PATCH /api/articles/:id/unpublish - Unpublish article
router.patch('/:id/unpublish', authMiddleware, modOnly, async (req, res) => {
    try {
        const article = await Article.findByIdAndUpdate(
            req.params.id,
            { status: 'draft' },
            { new: true }
        );
        if (!article) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bài viết' });
        }

        res.json({ success: true, message: 'Hủy xuất bản thành công', data: article });
    } catch (error) {
        console.error('Unpublish article error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// DELETE /api/articles/:id - Delete article
router.delete('/:id', authMiddleware, modOnly, async (req, res) => {
    try {
        const article = await Article.findByIdAndDelete(req.params.id);
        if (!article) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bài viết' });
        }

        res.json({ success: true, message: 'Xóa bài viết thành công' });
    } catch (error) {
        console.error('Delete article error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// GET /api/articles/:slug - Get single article by slug (public)
// NOTE: This MUST be last because :slug is a catch-all param
router.get('/:slug', async (req, res) => {
    try {
        const article = await Article.findOne({
            slug: req.params.slug,
            status: 'published'
        }).populate('author', 'name avatar');

        if (!article) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bài viết' });
        }

        res.json({ success: true, data: article });
    } catch (error) {
        console.error('Get article detail error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

export default router;
