import express from 'express';
import mongoose from 'mongoose';
import Review from '../models/Review.js';
import Enrollment from '../models/Enrollment.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// @route   GET /api/reviews/course/:courseId
// @desc    Get all reviews for a course
// @access  Public
router.get('/course/:courseId', async (req, res) => {
    try {
        const { page = 1, limit = 10, sort = '-createdAt' } = req.query;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // Build sort
        let sortOption = {};
        if (sort.startsWith('-')) {
            sortOption[sort.substring(1)] = -1;
        } else {
            sortOption[sort] = 1;
        }

        const [reviews, total] = await Promise.all([
            Review.find({
                course: req.params.courseId,
                status: 'approved'
            })
                .populate('user', 'name avatar')
                .populate('reply.repliedBy', 'name')
                .sort(sortOption)
                .skip(skip)
                .limit(limitNum),
            Review.countDocuments({
                course: req.params.courseId,
                status: 'approved'
            })
        ]);

        // Calculate rating distribution
        const courseObjectId = new mongoose.Types.ObjectId(req.params.courseId);
        const ratingDistribution = await Review.aggregate([
            { $match: { course: courseObjectId, status: 'approved' } },
            { $group: { _id: '$rating', count: { $sum: 1 } } },
            { $sort: { _id: -1 } }
        ]);

        res.json({
            success: true,
            data: reviews,
            ratingDistribution: ratingDistribution.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }),
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Get reviews error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching reviews'
        });
    }
});

// @route   GET /api/reviews/my-review/:courseId
// @desc    Get current user's review for a course
// @access  Private
router.get('/my-review/:courseId', authMiddleware, async (req, res) => {
    try {
        const review = await Review.findOne({
            user: req.user._id,
            course: req.params.courseId
        });

        res.json({
            success: true,
            data: review
        });
    } catch (error) {
        console.error('Get my review error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching review'
        });
    }
});

// @route   POST /api/reviews/:courseId
// @desc    Create a review for a course
// @access  Private
router.post('/:courseId', authMiddleware, async (req, res) => {
    try {
        const { rating, comment } = req.body;

        // Validate rating
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                success: false,
                message: 'Rating must be between 1 and 5'
            });
        }

        // Validate comment
        if (!comment || comment.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Comment is required'
            });
        }

        // Check if user is enrolled in the course
        const enrollment = await Enrollment.findOne({
            user: req.user._id,
            course: req.params.courseId
        });

        // Check if review already exists
        const existingReview = await Review.findOne({
            user: req.user._id,
            course: req.params.courseId
        });

        if (existingReview) {
            return res.status(400).json({
                success: false,
                message: 'You have already reviewed this course'
            });
        }

        const review = new Review({
            user: req.user._id,
            course: req.params.courseId,
            rating,
            comment: comment.trim(),
            isVerifiedPurchase: !!enrollment
        });

        await review.save();

        // Populate user info for response
        await review.populate('user', 'name avatar');

        res.status(201).json({
            success: true,
            message: 'Review submitted successfully',
            data: review
        });
    } catch (error) {
        console.error('Create review error:', error);

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'You have already reviewed this course'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while creating review'
        });
    }
});

// @route   PUT /api/reviews/:reviewId
// @desc    Update a review
// @access  Private
router.put('/:reviewId', authMiddleware, async (req, res) => {
    try {
        const { rating, comment } = req.body;

        const review = await Review.findById(req.params.reviewId);

        if (!review) {
            return res.status(404).json({
                success: false,
                message: 'Review not found'
            });
        }

        // Check if user owns the review
        if (review.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to update this review'
            });
        }

        if (rating) {
            if (rating < 1 || rating > 5) {
                return res.status(400).json({
                    success: false,
                    message: 'Rating must be between 1 and 5'
                });
            }
            review.rating = rating;
        }

        if (comment) {
            review.comment = comment.trim();
        }

        await review.save();

        await review.populate('user', 'name avatar');

        res.json({
            success: true,
            message: 'Review updated successfully',
            data: review
        });
    } catch (error) {
        console.error('Update review error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while updating review'
        });
    }
});

// @route   DELETE /api/reviews/:reviewId
// @desc    Delete a review
// @access  Private
router.delete('/:reviewId', authMiddleware, async (req, res) => {
    try {
        const review = await Review.findById(req.params.reviewId);

        if (!review) {
            return res.status(404).json({
                success: false,
                message: 'Review not found'
            });
        }

        // Check if user owns the review or is admin
        if (review.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to delete this review'
            });
        }

        await Review.findByIdAndDelete(req.params.reviewId);

        res.json({
            success: true,
            message: 'Review deleted successfully'
        });
    } catch (error) {
        console.error('Delete review error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while deleting review'
        });
    }
});

// @route   POST /api/reviews/:reviewId/helpful
// @desc    Mark a review as helpful
// @access  Private
router.post('/:reviewId/helpful', authMiddleware, async (req, res) => {
    try {
        const review = await Review.findById(req.params.reviewId);

        if (!review) {
            return res.status(404).json({
                success: false,
                message: 'Review not found'
            });
        }

        // Check if user already marked as helpful
        const alreadyMarked = review.helpful.users.includes(req.user._id);

        if (alreadyMarked) {
            // Remove helpful
            review.helpful.users = review.helpful.users.filter(
                u => u.toString() !== req.user._id.toString()
            );
            review.helpful.count = Math.max(0, review.helpful.count - 1);
        } else {
            // Add helpful
            review.helpful.users.push(req.user._id);
            review.helpful.count += 1;
        }

        await review.save();

        res.json({
            success: true,
            message: alreadyMarked ? 'Removed helpful mark' : 'Marked as helpful',
            data: {
                helpfulCount: review.helpful.count,
                isHelpful: !alreadyMarked
            }
        });
    } catch (error) {
        console.error('Mark helpful error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @route   POST /api/reviews/:reviewId/reply
// @desc    Admin reply to a review
// @access  Admin
router.post('/:reviewId/reply', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { content } = req.body;

        if (!content || content.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Reply content is required'
            });
        }

        const review = await Review.findById(req.params.reviewId);

        if (!review) {
            return res.status(404).json({
                success: false,
                message: 'Review not found'
            });
        }

        review.reply = {
            content: content.trim(),
            repliedAt: new Date(),
            repliedBy: req.user._id
        };

        await review.save();

        await review.populate('reply.repliedBy', 'name');

        res.json({
            success: true,
            message: 'Reply added successfully',
            data: review
        });
    } catch (error) {
        console.error('Reply to review error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

export default router;
