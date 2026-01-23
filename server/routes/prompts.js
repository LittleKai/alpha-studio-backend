import express from 'express';
import Prompt from '../models/Prompt.js';
import { authMiddleware, modOnly, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// Helper function to check if user is mod/admin from token
async function checkIsMod(authHeader) {
    try {
        const token = authHeader.replace('Bearer ', '');
        const { verifyToken } = await import('../middleware/auth.js');
        const decoded = verifyToken(token);
        const User = (await import('../models/User.js')).default;
        const user = await User.findById(decoded.userId);
        return user && (user.role === 'admin' || user.role === 'mod');
    } catch {
        return false;
    }
}

// Helper function to get user ID from token
async function getUserId(authHeader) {
    try {
        const token = authHeader.replace('Bearer ', '');
        const { verifyToken } = await import('../middleware/auth.js');
        const decoded = verifyToken(token);
        return decoded.userId;
    } catch {
        return null;
    }
}

// @route   GET /api/prompts
// @desc    Get all prompts with filtering, pagination, search
// @access  Public
router.get('/', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 12,
            category,
            platform,
            tags,
            search,
            sort = '-createdAt',
            author
        } = req.query;

        // Build query
        const query = { status: 'published' };

        if (category) query.category = category;
        if (platform) query.platform = platform;
        if (author) query.author = author;

        if (tags) {
            const tagArray = tags.split(',').map(t => t.trim().toLowerCase());
            query.tags = { $in: tagArray };
        }

        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { 'title.vi': searchRegex },
                { 'title.en': searchRegex },
                { 'description.vi': searchRegex },
                { 'description.en': searchRegex },
                { promptContent: searchRegex },
                { 'promptContents.content': searchRegex },
                { tags: searchRegex }
            ];
        }

        // Build sort
        let sortOption = {};
        switch (sort) {
            case 'popular':
                sortOption = { likesCount: -1, createdAt: -1 };
                break;
            case 'downloads':
                sortOption = { downloadsCount: -1, createdAt: -1 };
                break;
            case 'rating':
                sortOption = { 'rating.average': -1, 'rating.count': -1, createdAt: -1 };
                break;
            default:
                if (sort.startsWith('-')) {
                    sortOption[sort.substring(1)] = -1;
                } else {
                    sortOption[sort] = 1;
                }
        }

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // Get user ID for checking likes/bookmarks
        const authHeader = req.headers.authorization;
        const userId = authHeader ? await getUserId(authHeader) : null;

        const [prompts, total] = await Promise.all([
            Prompt.find(query)
                .populate('author', 'name avatar')
                .sort(sortOption)
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Prompt.countDocuments(query)
        ]);

        // Add user interaction flags
        const promptsWithUserData = prompts.map(prompt => ({
            ...prompt,
            isLiked: userId ? prompt.likes?.some(id => id.toString() === userId) : false,
            isBookmarked: userId ? prompt.bookmarks?.some(id => id.toString() === userId) : false
        }));

        res.json({
            success: true,
            data: promptsWithUserData,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Get prompts error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching prompts'
        });
    }
});

// @route   GET /api/prompts/featured
// @desc    Get featured prompts
// @access  Public
router.get('/featured', async (req, res) => {
    try {
        const { limit = 6 } = req.query;

        const prompts = await Prompt.find({
            status: 'published',
            isFeatured: true
        })
            .populate('author', 'name avatar')
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .lean();

        res.json({
            success: true,
            data: prompts
        });
    } catch (error) {
        console.error('Get featured prompts error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching featured prompts'
        });
    }
});

// @route   GET /api/prompts/my/created
// @desc    Get user's created prompts
// @access  Private
router.get('/my/created', authMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 12, status } = req.query;

        const query = { author: req.user._id };
        if (status) query.status = status;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const [prompts, total] = await Promise.all([
            Prompt.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Prompt.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: prompts,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Get my prompts error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching your prompts'
        });
    }
});

// @route   GET /api/prompts/my/bookmarked
// @desc    Get user's bookmarked prompts
// @access  Private
router.get('/my/bookmarked', authMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 12 } = req.query;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const [prompts, total] = await Promise.all([
            Prompt.find({
                bookmarks: req.user._id,
                status: 'published'
            })
                .populate('author', 'name avatar')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Prompt.countDocuments({
                bookmarks: req.user._id,
                status: 'published'
            })
        ]);

        res.json({
            success: true,
            data: prompts,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Get bookmarked prompts error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching bookmarked prompts'
        });
    }
});

// @route   GET /api/prompts/:slug
// @desc    Get single prompt by slug
// @access  Public
router.get('/:slug', async (req, res) => {
    try {
        const prompt = await Prompt.findOne({ slug: req.params.slug })
            .populate('author', 'name avatar');

        if (!prompt) {
            return res.status(404).json({
                success: false,
                message: 'Prompt not found'
            });
        }

        // Check if prompt is published (or user is owner/mod)
        const authHeader = req.headers.authorization;
        const userId = authHeader ? await getUserId(authHeader) : null;
        const isMod = authHeader && await checkIsMod(authHeader);
        const isOwner = userId && prompt.author._id.toString() === userId;

        if (prompt.status !== 'published' && !isMod && !isOwner) {
            return res.status(404).json({
                success: false,
                message: 'Prompt not found'
            });
        }

        // Increment view count
        await Prompt.findByIdAndUpdate(prompt._id, { $inc: { viewsCount: 1 } });

        const promptData = prompt.toObject();
        promptData.isLiked = userId ? prompt.likes?.some(id => id.toString() === userId) : false;
        promptData.isBookmarked = userId ? prompt.bookmarks?.some(id => id.toString() === userId) : false;
        promptData.userRating = userId ? prompt.ratings?.find(r => r.user.toString() === userId)?.score : null;

        res.json({
            success: true,
            data: promptData
        });
    } catch (error) {
        console.error('Get prompt error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching prompt'
        });
    }
});

// @route   POST /api/prompts
// @desc    Create a new prompt
// @access  Private
router.post('/', authMiddleware, async (req, res) => {
    try {
        const {
            title,
            description,
            promptContent,
            promptContents,
            notes,
            category,
            platform,
            exampleImages,
            tags
        } = req.body;

        if (!title?.vi || !title?.en) {
            return res.status(400).json({
                success: false,
                message: 'Title in both Vietnamese and English is required'
            });
        }

        // Check for prompt content - support both legacy (promptContent) and new (promptContents) formats
        const hasPromptContent = promptContent && promptContent.trim() !== '';
        const hasPromptContents = promptContents && Array.isArray(promptContents) &&
            promptContents.some(p => p.content && p.content.trim() !== '');

        if (!hasPromptContent && !hasPromptContents) {
            return res.status(400).json({
                success: false,
                message: 'Prompt content is required'
            });
        }

        const prompt = new Prompt({
            title,
            description: description || { vi: '', en: '' },
            promptContent: promptContent || '',
            promptContents: promptContents || [],
            notes: notes || '',
            category: category || 'other',
            platform: platform || 'other',
            exampleImages: exampleImages || [],
            tags: tags || [],
            author: req.user._id,
            status: 'published',  // Auto-publish
            publishedAt: new Date()
        });

        await prompt.save();
        await prompt.populate('author', 'name avatar');

        res.status(201).json({
            success: true,
            message: 'Prompt created successfully',
            data: prompt
        });
    } catch (error) {
        console.error('Create prompt error:', error);

        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                message: messages.join(', ')
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while creating prompt'
        });
    }
});

// @route   PUT /api/prompts/:id
// @desc    Update own prompt
// @access  Private
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const prompt = await Prompt.findById(req.params.id);

        if (!prompt) {
            return res.status(404).json({
                success: false,
                message: 'Prompt not found'
            });
        }

        // Check ownership (or mod)
        const isMod = req.user.role === 'admin' || req.user.role === 'mod';
        if (prompt.author.toString() !== req.user._id.toString() && !isMod) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to update this prompt'
            });
        }

        const {
            title,
            description,
            promptContent,
            promptContents,
            notes,
            category,
            platform,
            exampleImages,
            tags
        } = req.body;

        if (title) prompt.title = title;
        if (description) prompt.description = description;
        if (promptContent !== undefined) prompt.promptContent = promptContent;
        if (promptContents !== undefined) prompt.promptContents = promptContents;
        if (notes !== undefined) prompt.notes = notes;
        if (category) prompt.category = category;
        if (platform) prompt.platform = platform;
        if (exampleImages) prompt.exampleImages = exampleImages;
        if (tags) prompt.tags = tags;

        await prompt.save();
        await prompt.populate('author', 'name avatar');

        res.json({
            success: true,
            message: 'Prompt updated successfully',
            data: prompt
        });
    } catch (error) {
        console.error('Update prompt error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while updating prompt'
        });
    }
});

// @route   DELETE /api/prompts/:id
// @desc    Delete own prompt
// @access  Private
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const prompt = await Prompt.findById(req.params.id);

        if (!prompt) {
            return res.status(404).json({
                success: false,
                message: 'Prompt not found'
            });
        }

        // Check ownership (or mod)
        const isMod = req.user.role === 'admin' || req.user.role === 'mod';
        if (prompt.author.toString() !== req.user._id.toString() && !isMod) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to delete this prompt'
            });
        }

        await Prompt.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'Prompt deleted successfully'
        });
    } catch (error) {
        console.error('Delete prompt error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while deleting prompt'
        });
    }
});

// @route   POST /api/prompts/:id/like
// @desc    Toggle like on prompt
// @access  Private
router.post('/:id/like', authMiddleware, async (req, res) => {
    try {
        const prompt = await Prompt.findById(req.params.id);

        if (!prompt) {
            return res.status(404).json({
                success: false,
                message: 'Prompt not found'
            });
        }

        const userId = req.user._id;
        const likeIndex = prompt.likes.findIndex(id => id.toString() === userId.toString());

        if (likeIndex === -1) {
            prompt.likes.push(userId);
        } else {
            prompt.likes.splice(likeIndex, 1);
        }
        prompt.likesCount = prompt.likes.length;

        await prompt.save();

        res.json({
            success: true,
            message: likeIndex === -1 ? 'Prompt liked' : 'Prompt unliked',
            data: {
                liked: likeIndex === -1,
                likesCount: prompt.likesCount
            }
        });
    } catch (error) {
        console.error('Like prompt error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while liking prompt'
        });
    }
});

// @route   POST /api/prompts/:id/bookmark
// @desc    Toggle bookmark on prompt
// @access  Private
router.post('/:id/bookmark', authMiddleware, async (req, res) => {
    try {
        const prompt = await Prompt.findById(req.params.id);

        if (!prompt) {
            return res.status(404).json({
                success: false,
                message: 'Prompt not found'
            });
        }

        const userId = req.user._id;
        const bookmarkIndex = prompt.bookmarks.findIndex(id => id.toString() === userId.toString());

        if (bookmarkIndex === -1) {
            prompt.bookmarks.push(userId);
        } else {
            prompt.bookmarks.splice(bookmarkIndex, 1);
        }
        prompt.bookmarksCount = prompt.bookmarks.length;

        await prompt.save();

        res.json({
            success: true,
            message: bookmarkIndex === -1 ? 'Prompt bookmarked' : 'Bookmark removed',
            data: {
                bookmarked: bookmarkIndex === -1,
                bookmarksCount: prompt.bookmarksCount
            }
        });
    } catch (error) {
        console.error('Bookmark prompt error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while bookmarking prompt'
        });
    }
});

// @route   POST /api/prompts/:id/download
// @desc    Track download
// @access  Private
router.post('/:id/download', authMiddleware, async (req, res) => {
    try {
        const prompt = await Prompt.findByIdAndUpdate(
            req.params.id,
            { $inc: { downloadsCount: 1 } },
            { new: true }
        );

        if (!prompt) {
            return res.status(404).json({
                success: false,
                message: 'Prompt not found'
            });
        }

        res.json({
            success: true,
            message: 'Download tracked',
            data: {
                downloadsCount: prompt.downloadsCount,
                promptContent: prompt.promptContent,
                promptContents: prompt.promptContents
            }
        });
    } catch (error) {
        console.error('Track download error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while tracking download'
        });
    }
});

// @route   POST /api/prompts/:id/rate
// @desc    Rate prompt 1-5 stars
// @access  Private
router.post('/:id/rate', authMiddleware, async (req, res) => {
    try {
        const { score } = req.body;

        if (!score || score < 1 || score > 5) {
            return res.status(400).json({
                success: false,
                message: 'Score must be between 1 and 5'
            });
        }

        const prompt = await Prompt.findById(req.params.id);

        if (!prompt) {
            return res.status(404).json({
                success: false,
                message: 'Prompt not found'
            });
        }

        const userId = req.user._id;
        const existingRatingIndex = prompt.ratings.findIndex(
            r => r.user.toString() === userId.toString()
        );

        if (existingRatingIndex !== -1) {
            // Update existing rating
            prompt.ratings[existingRatingIndex].score = score;
            prompt.ratings[existingRatingIndex].ratedAt = new Date();
        } else {
            // Add new rating
            prompt.ratings.push({
                user: userId,
                score,
                ratedAt: new Date()
            });
        }

        prompt.recalculateRating();
        await prompt.save();

        res.json({
            success: true,
            message: 'Rating submitted successfully',
            data: {
                userRating: score,
                rating: prompt.rating
            }
        });
    } catch (error) {
        console.error('Rate prompt error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while rating prompt'
        });
    }
});

// @route   PATCH /api/prompts/:id/hide
// @desc    Hide violating content
// @access  Mod/Admin
router.patch('/:id/hide', authMiddleware, modOnly, async (req, res) => {
    try {
        const { reason } = req.body;

        const prompt = await Prompt.findById(req.params.id);

        if (!prompt) {
            return res.status(404).json({
                success: false,
                message: 'Prompt not found'
            });
        }

        prompt.status = 'hidden';
        prompt.moderatedBy = req.user._id;
        prompt.moderatedAt = new Date();
        prompt.moderationReason = reason || 'Content violation';

        await prompt.save();

        res.json({
            success: true,
            message: 'Prompt has been hidden',
            data: prompt
        });
    } catch (error) {
        console.error('Hide prompt error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while hiding prompt'
        });
    }
});

// @route   PATCH /api/prompts/:id/unhide
// @desc    Restore hidden content
// @access  Mod/Admin
router.patch('/:id/unhide', authMiddleware, modOnly, async (req, res) => {
    try {
        const prompt = await Prompt.findById(req.params.id);

        if (!prompt) {
            return res.status(404).json({
                success: false,
                message: 'Prompt not found'
            });
        }

        prompt.status = 'published';
        prompt.moderatedBy = req.user._id;
        prompt.moderatedAt = new Date();
        prompt.moderationReason = null;

        await prompt.save();

        res.json({
            success: true,
            message: 'Prompt has been restored',
            data: prompt
        });
    } catch (error) {
        console.error('Unhide prompt error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while restoring prompt'
        });
    }
});

// @route   PATCH /api/prompts/:id/feature
// @desc    Toggle featured status
// @access  Admin
router.patch('/:id/feature', authMiddleware, adminOnly, async (req, res) => {
    try {
        const prompt = await Prompt.findById(req.params.id);

        if (!prompt) {
            return res.status(404).json({
                success: false,
                message: 'Prompt not found'
            });
        }

        prompt.isFeatured = !prompt.isFeatured;
        await prompt.save();

        res.json({
            success: true,
            message: prompt.isFeatured ? 'Prompt featured' : 'Prompt unfeatured',
            data: prompt
        });
    } catch (error) {
        console.error('Feature prompt error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while featuring prompt'
        });
    }
});

export default router;
