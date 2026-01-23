import express from 'express';
import Comment from '../models/Comment.js';
import Prompt from '../models/Prompt.js';
import Resource from '../models/Resource.js';
import { authMiddleware, modOnly } from '../middleware/auth.js';

const router = express.Router();

// Helper to get the target model
const getTargetModel = (targetType) => {
    switch (targetType) {
        case 'prompt': return Prompt;
        case 'resource': return Resource;
        default: return null;
    }
};

// @route   GET /api/comments/replies/:commentId
// @desc    Get replies for a comment
// @access  Public
// NOTE: This route must come BEFORE /:targetType/:targetId to avoid conflict
router.get('/replies/:commentId', async (req, res) => {
    try {
        const { commentId } = req.params;
        const { page = 1, limit = 10 } = req.query;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const [replies, total] = await Promise.all([
            Comment.find({
                parentComment: commentId,
                status: 'visible'
            })
                .populate('author', 'name avatar')
                .sort({ createdAt: 1 })
                .skip(skip)
                .limit(limitNum),
            Comment.countDocuments({
                parentComment: commentId,
                status: 'visible'
            })
        ]);

        res.json({
            success: true,
            data: replies,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Get replies error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching replies'
        });
    }
});

// @route   GET /api/comments/:targetType/:targetId
// @desc    Get comments for a target (prompt or resource)
// @access  Public
router.get('/:targetType/:targetId', async (req, res) => {
    try {
        const { targetType, targetId } = req.params;
        const { page = 1, limit = 20, sort = '-createdAt' } = req.query;

        if (!['prompt', 'resource'].includes(targetType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid target type'
            });
        }

        const query = {
            targetType,
            targetId,
            status: 'visible',
            parentComment: null  // Only top-level comments
        };

        // Build sort
        let sortOption = {};
        if (sort.startsWith('-')) {
            sortOption[sort.substring(1)] = -1;
        } else {
            sortOption[sort] = 1;
        }

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const [comments, total] = await Promise.all([
            Comment.find(query)
                .populate('author', 'name avatar')
                .populate('repliesCount')
                .sort(sortOption)
                .skip(skip)
                .limit(limitNum),
            Comment.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: comments,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Get comments error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching comments'
        });
    }
});


// @route   POST /api/comments/:targetType/:targetId
// @desc    Create a comment
// @access  Private
router.post('/:targetType/:targetId', authMiddleware, async (req, res) => {
    try {
        const { targetType, targetId } = req.params;
        const { content, parentComment } = req.body;

        if (!['prompt', 'resource'].includes(targetType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid target type'
            });
        }

        if (!content || content.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Comment content is required'
            });
        }

        // Verify target exists
        const TargetModel = getTargetModel(targetType);
        const target = await TargetModel.findById(targetId);
        if (!target) {
            return res.status(404).json({
                success: false,
                message: `${targetType} not found`
            });
        }

        // If replying, verify parent comment exists
        if (parentComment) {
            const parent = await Comment.findById(parentComment);
            if (!parent || parent.targetId.toString() !== targetId) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid parent comment'
                });
            }
        }

        const comment = new Comment({
            targetType,
            targetId,
            author: req.user._id,
            content: content.trim(),
            parentComment: parentComment || null
        });

        await comment.save();

        // Update comments count on target
        await TargetModel.findByIdAndUpdate(targetId, {
            $inc: { commentsCount: 1 }
        });

        // Populate author for response
        await comment.populate('author', 'name avatar');

        res.status(201).json({
            success: true,
            message: 'Comment created successfully',
            data: comment
        });
    } catch (error) {
        console.error('Create comment error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while creating comment'
        });
    }
});

// @route   PUT /api/comments/:id
// @desc    Edit own comment
// @access  Private
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { content } = req.body;

        if (!content || content.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Comment content is required'
            });
        }

        const comment = await Comment.findById(req.params.id);

        if (!comment) {
            return res.status(404).json({
                success: false,
                message: 'Comment not found'
            });
        }

        // Check ownership
        if (comment.author.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to edit this comment'
            });
        }

        comment.content = content.trim();
        comment.isEdited = true;
        await comment.save();

        await comment.populate('author', 'name avatar');

        res.json({
            success: true,
            message: 'Comment updated successfully',
            data: comment
        });
    } catch (error) {
        console.error('Update comment error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while updating comment'
        });
    }
});

// @route   DELETE /api/comments/:id
// @desc    Delete comment (owner or mod)
// @access  Private
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const comment = await Comment.findById(req.params.id);

        if (!comment) {
            return res.status(404).json({
                success: false,
                message: 'Comment not found'
            });
        }

        const isOwner = comment.author.toString() === req.user._id.toString();
        const isMod = req.user.role === 'admin' || req.user.role === 'mod';

        if (!isOwner && !isMod) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to delete this comment'
            });
        }

        // Update comments count on target
        const TargetModel = getTargetModel(comment.targetType);
        await TargetModel.findByIdAndUpdate(comment.targetId, {
            $inc: { commentsCount: -1 }
        });

        // Delete all replies too
        const repliesCount = await Comment.countDocuments({ parentComment: comment._id });
        await Comment.deleteMany({ parentComment: comment._id });

        // Update count for deleted replies
        if (repliesCount > 0) {
            await TargetModel.findByIdAndUpdate(comment.targetId, {
                $inc: { commentsCount: -repliesCount }
            });
        }

        await Comment.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'Comment deleted successfully'
        });
    } catch (error) {
        console.error('Delete comment error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while deleting comment'
        });
    }
});

// @route   POST /api/comments/:id/like
// @desc    Toggle like on comment
// @access  Private
router.post('/:id/like', authMiddleware, async (req, res) => {
    try {
        const comment = await Comment.findById(req.params.id);

        if (!comment) {
            return res.status(404).json({
                success: false,
                message: 'Comment not found'
            });
        }

        const userId = req.user._id;
        const likeIndex = comment.likes.indexOf(userId);

        if (likeIndex === -1) {
            // Add like
            comment.likes.push(userId);
            comment.likesCount = comment.likes.length;
        } else {
            // Remove like
            comment.likes.splice(likeIndex, 1);
            comment.likesCount = comment.likes.length;
        }

        await comment.save();

        res.json({
            success: true,
            message: likeIndex === -1 ? 'Comment liked' : 'Comment unliked',
            data: {
                liked: likeIndex === -1,
                likesCount: comment.likesCount
            }
        });
    } catch (error) {
        console.error('Like comment error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while liking comment'
        });
    }
});

// @route   POST /api/comments/:id/flag
// @desc    Report/flag a comment
// @access  Private
router.post('/:id/flag', authMiddleware, async (req, res) => {
    try {
        const comment = await Comment.findById(req.params.id);

        if (!comment) {
            return res.status(404).json({
                success: false,
                message: 'Comment not found'
            });
        }

        comment.status = 'flagged';
        await comment.save();

        res.json({
            success: true,
            message: 'Comment has been flagged for review'
        });
    } catch (error) {
        console.error('Flag comment error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while flagging comment'
        });
    }
});

// @route   PATCH /api/comments/:id/moderate
// @desc    Moderate comment (hide/show)
// @access  Mod/Admin
router.patch('/:id/moderate', authMiddleware, modOnly, async (req, res) => {
    try {
        const { status } = req.body;

        if (!['visible', 'hidden'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Must be "visible" or "hidden"'
            });
        }

        const comment = await Comment.findById(req.params.id);

        if (!comment) {
            return res.status(404).json({
                success: false,
                message: 'Comment not found'
            });
        }

        comment.status = status;
        await comment.save();

        res.json({
            success: true,
            message: `Comment ${status === 'hidden' ? 'hidden' : 'restored'} successfully`,
            data: comment
        });
    } catch (error) {
        console.error('Moderate comment error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while moderating comment'
        });
    }
});

export default router;
