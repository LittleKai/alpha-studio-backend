import express from 'express';
import { Readable } from 'stream';
import Article from '../models/Article.js';
import { authMiddleware, modOnly } from '../middleware/auth.js';
import { sanitizeSections, SERVICE_SECTION_KINDS } from '../utils/contentSections.js';
import { extractB2Key } from './admin.js';
import { generatePresignedDownloadUrl, attachmentDisposition } from '../utils/b2Storage.js';

const router = express.Router();

// Tệp tham khảo tải về đi kèm bài dịch vụ (.skp, .html…). Chỉ giữ đúng 5 field
// của `Article.attachments`; ảnh không đi đường này mà nằm trong khối gallery.
const MAX_ATTACHMENTS = 20;
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function sanitizeAttachments(list) {
    return (Array.isArray(list) ? list : [])
        .filter(a => a && str(a.url).trim())
        .slice(0, MAX_ATTACHMENTS)
        .map(a => ({
            name: str(a.name),
            url: str(a.url),
            fileKey: str(a.fileKey),
            size: str(a.size),
            mime: str(a.mime)
        }));
}

function basenameFromFileKey(fileKey) {
    const raw = str(fileKey).split(/[\\/]/).pop()?.trim() || '';
    if (!raw) return '';

    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

/**
 * Keep the editorial label separate from the browser download filename.
 * Upload keys are prefixed with Date.now(); remove that implementation prefix
 * so downloads use the original sanitized filename (for example `model.skp`).
 */
export function getAttachmentDownloadFilename(attachment, fileKey) {
    const keyName = basenameFromFileKey(fileKey).replace(/^\d{10,}-/, '');
    return keyName || str(attachment?.name).trim() || 'download';
}

// ==================== PUBLIC ROUTES ====================

// GET /api/articles - List articles (public, filtered by category + status=published)
router.get('/', async (req, res) => {
    try {
        const { category, serviceCategory, page = 1, limit = 20, search } = req.query;
        const query = { status: 'published' };

        if (category) {
            query.category = category;
        }

        if (serviceCategory) {
            query.serviceCategory = serviceCategory;
        }

        if (search) {
            query.$text = { $search: search };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [data, total] = await Promise.all([
            Article.find(query)
                .populate('author', 'name avatar')
                .populate('serviceCategory', 'title slug accent icon')
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
        const { category, serviceCategory, status, page = 1, limit = 20, search } = req.query;
        const query = {};

        if (category) query.category = category;
        if (serviceCategory) query.serviceCategory = serviceCategory;
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
                .populate('serviceCategory', 'title slug accent icon')
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
        const {
            title, excerpt, content, thumbnail, category, tags, order, isFeatured,
            serviceCategory, sections, attachments
        } = req.body;

        if (!title?.vi) {
            return res.status(400).json({ success: false, message: 'Cần tiêu đề tiếng Việt' });
        }

        // Lấy từ enum của model để whitelist không lệch khi thêm category mới
        if (!category || !Article.schema.path('category').enumValues.includes(category)) {
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
            author: req.user._id,
            serviceCategory: serviceCategory || null,
            sections: sanitizeSections(sections, SERVICE_SECTION_KINDS),
            attachments: sanitizeAttachments(attachments)
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
        const {
            title, excerpt, content, thumbnail, category, tags, order, isFeatured, status,
            serviceCategory, sections, attachments
        } = req.body;

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
        if (serviceCategory !== undefined) article.serviceCategory = serviceCategory || null;
        if (sections !== undefined) article.sections = sanitizeSections(sections, SERVICE_SECTION_KINDS);
        if (attachments !== undefined) article.attachments = sanitizeAttachments(attachments);

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

// GET /api/articles/:id/attachments/:index/download
// Tải tệp đính kèm với Content-Disposition: attachment để browser luôn tải về máy,
// không mở tab mới với các file html, pdf, text...
router.get('/:id/attachments/:index/download', async (req, res) => {
    try {
        const article = await Article.findOne({ _id: req.params.id, status: 'published' });
        if (!article) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bài viết' });
        }

        const index = parseInt(req.params.index, 10);
        if (isNaN(index) || index < 0 || !article.attachments?.[index]) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tệp đính kèm' });
        }

        const attachment = article.attachments[index];
        const fileKey = attachment.fileKey || extractB2Key(attachment.url);
        const filename = getAttachmentDownloadFilename(attachment, fileKey);

        // Tăng lượt tải
        await Article.findByIdAndUpdate(req.params.id, { $inc: { downloadCount: 1 } });

        if (fileKey) {
            try {
                const signedUrl = await generatePresignedDownloadUrl(fileKey, 3600, filename);
                return res.redirect(signedUrl);
            } catch (err) {
                console.warn('Failed to generate presigned download URL for B2 key:', fileKey, err);
            }
        }

        // Nếu là URL ngoài hoặc presign lỗi, thử proxy stream kèm header Content-Disposition
        try {
            const fileRes = await fetch(attachment.url);
            if (fileRes.ok) {
                res.setHeader('Content-Disposition', attachmentDisposition(filename));
                const contentType = attachment.mime || fileRes.headers.get('content-type');
                if (contentType) {
                    res.setHeader('Content-Type', contentType);
                }
                const readable = Readable.fromWeb(fileRes.body);
                return readable.pipe(res);
            }
        } catch (fetchErr) {
            console.warn('Proxy fetch failed for attachment:', attachment.url, fetchErr);
        }

        return res.redirect(attachment.url);
    } catch (error) {
        console.error('Download article attachment error:', error);
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
        })
            .populate('author', 'name avatar')
            .populate('serviceCategory', 'title slug accent icon');

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
