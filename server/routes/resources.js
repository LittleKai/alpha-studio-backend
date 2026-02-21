import express from 'express';
import Resource from '../models/Resource.js';
import { authMiddleware, modOnly, adminOnly } from '../middleware/auth.js';
import { generatePresignedDownloadUrl } from '../utils/b2Storage.js';
const router = express.Router();

/** Extract B2 object key from CDN or direct backblazeb2.com URL. Returns null if not a B2 URL. */
function extractB2Key(url) {
    if (!url) return null;
    const bucket = process.env.B2_BUCKET_NAME;
    const cdnBase = process.env.CDN_BASE_URL;
    if (cdnBase && url.startsWith(cdnBase)) {
        return url.slice(cdnBase.endsWith('/') ? cdnBase.length : cdnBase.length + 1);
    }
    const b2Pattern = `.backblazeb2.com/file/${bucket}/`;
    const idx = url.indexOf(b2Pattern);
    if (idx !== -1) return url.slice(idx + b2Pattern.length);
    return null;
}

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

// @route   GET /api/resources
// @desc    Get all resources with filtering, pagination, search
// @access  Public
router.get('/', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 12,
            resourceType,
            tags,
            compatibleSoftware,
            search,
            sort = '-createdAt',
            author
        } = req.query;

        // Build query
        const query = { status: 'published' };

        if (resourceType) query.resourceType = resourceType;
        if (author) query.author = author;

        if (tags) {
            const tagArray = tags.split(',').map(t => t.trim().toLowerCase());
            query.tags = { $in: tagArray };
        }

        if (compatibleSoftware) {
            const softwareArray = compatibleSoftware.split(',').map(s => s.trim());
            query.compatibleSoftware = { $in: softwareArray };
        }

        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { 'title.vi': searchRegex },
                { 'title.en': searchRegex },
                { 'description.vi': searchRegex },
                { 'description.en': searchRegex },
                { tags: searchRegex },
                { compatibleSoftware: searchRegex }
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

        const [resources, total] = await Promise.all([
            Resource.find(query)
                .populate('author', 'name avatar')
                .sort(sortOption)
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Resource.countDocuments(query)
        ]);

        // Add user interaction flags
        const resourcesWithUserData = resources.map(resource => ({
            ...resource,
            isLiked: userId ? resource.likes?.some(id => id.toString() === userId) : false,
            isBookmarked: userId ? resource.bookmarks?.some(id => id.toString() === userId) : false
        }));

        res.json({
            success: true,
            data: resourcesWithUserData,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Get resources error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching resources'
        });
    }
});

// @route   GET /api/resources/featured
// @desc    Get featured resources
// @access  Public
router.get('/featured', async (req, res) => {
    try {
        const { limit = 6 } = req.query;

        const resources = await Resource.find({
            status: 'published',
            isFeatured: true
        })
            .populate('author', 'name avatar')
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .lean();

        res.json({
            success: true,
            data: resources
        });
    } catch (error) {
        console.error('Get featured resources error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching featured resources'
        });
    }
});

// @route   GET /api/resources/my/created
// @desc    Get user's created resources
// @access  Private
router.get('/my/created', authMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 12, status } = req.query;

        const query = { author: req.user._id };
        if (status) query.status = status;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const [resources, total] = await Promise.all([
            Resource.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Resource.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: resources,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Get my resources error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching your resources'
        });
    }
});

// @route   GET /api/resources/my/bookmarked
// @desc    Get user's bookmarked resources
// @access  Private
router.get('/my/bookmarked', authMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 12 } = req.query;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const [resources, total] = await Promise.all([
            Resource.find({
                bookmarks: req.user._id,
                status: 'published'
            })
                .populate('author', 'name avatar')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Resource.countDocuments({
                bookmarks: req.user._id,
                status: 'published'
            })
        ]);

        res.json({
            success: true,
            data: resources,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Get bookmarked resources error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching bookmarked resources'
        });
    }
});

// @route   GET /api/resources/:slug
// @desc    Get single resource by slug
// @access  Public
router.get('/:slug', async (req, res) => {
    try {
        const resource = await Resource.findOne({ slug: req.params.slug })
            .populate('author', 'name avatar');

        if (!resource) {
            return res.status(404).json({
                success: false,
                message: 'Resource not found'
            });
        }

        // Check if resource is published (or user is owner/mod)
        const authHeader = req.headers.authorization;
        const userId = authHeader ? await getUserId(authHeader) : null;
        const isMod = authHeader && await checkIsMod(authHeader);
        const isOwner = userId && resource.author._id.toString() === userId;

        if (resource.status !== 'published' && !isMod && !isOwner) {
            return res.status(404).json({
                success: false,
                message: 'Resource not found'
            });
        }

        // Increment view count
        await Resource.findByIdAndUpdate(resource._id, { $inc: { viewsCount: 1 } });

        const resourceData = resource.toObject();
        resourceData.isLiked = userId ? resource.likes?.some(id => id.toString() === userId) : false;
        resourceData.isBookmarked = userId ? resource.bookmarks?.some(id => id.toString() === userId) : false;
        resourceData.userRating = userId ? resource.ratings?.find(r => r.user.toString() === userId)?.score : null;

        res.json({
            success: true,
            data: resourceData
        });
    } catch (error) {
        console.error('Get resource error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching resource'
        });
    }
});

// @route   POST /api/resources
// @desc    Create a new resource
// @access  Private
router.post('/', authMiddleware, async (req, res) => {
    try {
        const {
            title,
            description,
            resourceType,
            file,
            thumbnail,
            previewImages,
            tags,
            compatibleSoftware
        } = req.body;

        if (!title?.vi || !title?.en) {
            return res.status(400).json({
                success: false,
                message: 'Title in both Vietnamese and English is required'
            });
        }

        if (!file?.url || !file?.filename || !file?.size) {
            return res.status(400).json({
                success: false,
                message: 'File information is required'
            });
        }

        // Check file size (50MB limit)
        if (file.size > Resource.MAX_FILE_SIZE) {
            return res.status(400).json({
                success: false,
                message: 'File size cannot exceed 50MB'
            });
        }

        const resource = new Resource({
            title,
            description: description || { vi: '', en: '' },
            resourceType: resourceType || 'other',
            file,
            thumbnail: thumbnail || null,
            previewImages: previewImages || [],
            tags: tags || [],
            compatibleSoftware: compatibleSoftware || [],
            author: req.user._id,
            status: 'published',  // Auto-publish
            publishedAt: new Date()
        });

        await resource.save();
        await resource.populate('author', 'name avatar');

        res.status(201).json({
            success: true,
            message: 'Resource created successfully',
            data: resource
        });
    } catch (error) {
        console.error('Create resource error:', error);

        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                message: messages.join(', ')
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while creating resource'
        });
    }
});

// @route   PUT /api/resources/:id
// @desc    Update own resource
// @access  Private
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const resource = await Resource.findById(req.params.id);

        if (!resource) {
            return res.status(404).json({
                success: false,
                message: 'Resource not found'
            });
        }

        // Check ownership (or mod)
        const isMod = req.user.role === 'admin' || req.user.role === 'mod';
        if (resource.author.toString() !== req.user._id.toString() && !isMod) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to update this resource'
            });
        }

        const {
            title,
            description,
            resourceType,
            file,
            thumbnail,
            previewImages,
            tags,
            compatibleSoftware
        } = req.body;

        if (title) resource.title = title;
        if (description) resource.description = description;
        if (resourceType) resource.resourceType = resourceType;
        if (file) {
            if (file.size > Resource.MAX_FILE_SIZE) {
                return res.status(400).json({
                    success: false,
                    message: 'File size cannot exceed 50MB'
                });
            }
            resource.file = file;
        }
        if (thumbnail !== undefined) resource.thumbnail = thumbnail;
        if (previewImages) resource.previewImages = previewImages;
        if (tags) resource.tags = tags;
        if (compatibleSoftware) resource.compatibleSoftware = compatibleSoftware;

        await resource.save();
        await resource.populate('author', 'name avatar');

        res.json({
            success: true,
            message: 'Resource updated successfully',
            data: resource
        });
    } catch (error) {
        console.error('Update resource error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while updating resource'
        });
    }
});

// @route   DELETE /api/resources/:id
// @desc    Delete own resource
// @access  Private
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const resource = await Resource.findById(req.params.id);

        if (!resource) {
            return res.status(404).json({
                success: false,
                message: 'Resource not found'
            });
        }

        // Check ownership (or mod)
        const isMod = req.user.role === 'admin' || req.user.role === 'mod';
        if (resource.author.toString() !== req.user._id.toString() && !isMod) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to delete this resource'
            });
        }

        await Resource.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'Resource deleted successfully'
        });
    } catch (error) {
        console.error('Delete resource error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while deleting resource'
        });
    }
});

// @route   POST /api/resources/:id/like
// @desc    Toggle like on resource
// @access  Private
router.post('/:id/like', authMiddleware, async (req, res) => {
    try {
        const resource = await Resource.findById(req.params.id);

        if (!resource) {
            return res.status(404).json({
                success: false,
                message: 'Resource not found'
            });
        }

        const userId = req.user._id;
        const likeIndex = resource.likes.findIndex(id => id.toString() === userId.toString());

        if (likeIndex === -1) {
            resource.likes.push(userId);
        } else {
            resource.likes.splice(likeIndex, 1);
        }
        resource.likesCount = resource.likes.length;

        await resource.save();

        res.json({
            success: true,
            message: likeIndex === -1 ? 'Resource liked' : 'Resource unliked',
            data: {
                liked: likeIndex === -1,
                likesCount: resource.likesCount
            }
        });
    } catch (error) {
        console.error('Like resource error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while liking resource'
        });
    }
});

// @route   POST /api/resources/:id/bookmark
// @desc    Toggle bookmark on resource
// @access  Private
router.post('/:id/bookmark', authMiddleware, async (req, res) => {
    try {
        const resource = await Resource.findById(req.params.id);

        if (!resource) {
            return res.status(404).json({
                success: false,
                message: 'Resource not found'
            });
        }

        const userId = req.user._id;
        const bookmarkIndex = resource.bookmarks.findIndex(id => id.toString() === userId.toString());

        if (bookmarkIndex === -1) {
            resource.bookmarks.push(userId);
        } else {
            resource.bookmarks.splice(bookmarkIndex, 1);
        }
        resource.bookmarksCount = resource.bookmarks.length;

        await resource.save();

        res.json({
            success: true,
            message: bookmarkIndex === -1 ? 'Resource bookmarked' : 'Bookmark removed',
            data: {
                bookmarked: bookmarkIndex === -1,
                bookmarksCount: resource.bookmarksCount
            }
        });
    } catch (error) {
        console.error('Bookmark resource error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while bookmarking resource'
        });
    }
});

// @route   POST /api/resources/:id/download
// @desc    Track download and get file URL
// @access  Private
router.post('/:id/download', authMiddleware, async (req, res) => {
    try {
        const resource = await Resource.findByIdAndUpdate(
            req.params.id,
            { $inc: { downloadsCount: 1 } },
            { new: true }
        );

        if (!resource) {
            return res.status(404).json({
                success: false,
                message: 'Resource not found'
            });
        }

        const fileData = { ...resource.file.toObject() };

        // Auto-sign B2 file URLs (handles both CDN_BASE_URL and direct backblazeb2.com URLs)
        const b2Key = extractB2Key(fileData.url);
        if (b2Key) {
            fileData.url = await generatePresignedDownloadUrl(b2Key, 3600); // 1-hour download link
        }

        res.json({
            success: true,
            message: 'Download tracked',
            data: {
                downloadsCount: resource.downloadsCount,
                file: fileData
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

// @route   POST /api/resources/:id/rate
// @desc    Rate resource 1-5 stars
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

        const resource = await Resource.findById(req.params.id);

        if (!resource) {
            return res.status(404).json({
                success: false,
                message: 'Resource not found'
            });
        }

        const userId = req.user._id;
        const existingRatingIndex = resource.ratings.findIndex(
            r => r.user.toString() === userId.toString()
        );

        if (existingRatingIndex !== -1) {
            // Update existing rating
            resource.ratings[existingRatingIndex].score = score;
            resource.ratings[existingRatingIndex].ratedAt = new Date();
        } else {
            // Add new rating
            resource.ratings.push({
                user: userId,
                score,
                ratedAt: new Date()
            });
        }

        resource.recalculateRating();
        await resource.save();

        res.json({
            success: true,
            message: 'Rating submitted successfully',
            data: {
                userRating: score,
                rating: resource.rating
            }
        });
    } catch (error) {
        console.error('Rate resource error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while rating resource'
        });
    }
});

// @route   PATCH /api/resources/:id/hide
// @desc    Hide violating content
// @access  Mod/Admin
router.patch('/:id/hide', authMiddleware, modOnly, async (req, res) => {
    try {
        const { reason } = req.body;

        const resource = await Resource.findById(req.params.id);

        if (!resource) {
            return res.status(404).json({
                success: false,
                message: 'Resource not found'
            });
        }

        resource.status = 'hidden';
        resource.moderatedBy = req.user._id;
        resource.moderatedAt = new Date();
        resource.moderationReason = reason || 'Content violation';

        await resource.save();

        res.json({
            success: true,
            message: 'Resource has been hidden',
            data: resource
        });
    } catch (error) {
        console.error('Hide resource error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while hiding resource'
        });
    }
});

// @route   PATCH /api/resources/:id/unhide
// @desc    Restore hidden content
// @access  Mod/Admin
router.patch('/:id/unhide', authMiddleware, modOnly, async (req, res) => {
    try {
        const resource = await Resource.findById(req.params.id);

        if (!resource) {
            return res.status(404).json({
                success: false,
                message: 'Resource not found'
            });
        }

        resource.status = 'published';
        resource.moderatedBy = req.user._id;
        resource.moderatedAt = new Date();
        resource.moderationReason = null;

        await resource.save();

        res.json({
            success: true,
            message: 'Resource has been restored',
            data: resource
        });
    } catch (error) {
        console.error('Unhide resource error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while restoring resource'
        });
    }
});

// @route   PATCH /api/resources/:id/feature
// @desc    Toggle featured status
// @access  Admin
router.patch('/:id/feature', authMiddleware, adminOnly, async (req, res) => {
    try {
        const resource = await Resource.findById(req.params.id);

        if (!resource) {
            return res.status(404).json({
                success: false,
                message: 'Resource not found'
            });
        }

        resource.isFeatured = !resource.isFeatured;
        await resource.save();

        res.json({
            success: true,
            message: resource.isFeatured ? 'Resource featured' : 'Resource unfeatured',
            data: resource
        });
    } catch (error) {
        console.error('Feature resource error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while featuring resource'
        });
    }
});

export default router;
