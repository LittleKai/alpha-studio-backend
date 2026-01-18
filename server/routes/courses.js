import express from 'express';
import Course from '../models/Course.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// @route   GET /api/courses
// @desc    Get all courses with filtering, pagination, search
// @access  Public
router.get('/', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            category,
            level,
            status,
            search,
            sort = '-createdAt'
        } = req.query;

        // Build query
        const query = {};

        // Filter by category
        if (category) {
            query.category = category;
        }

        // Filter by level
        if (level) {
            query.level = level;
        }

        // Filter by status (only show published for public, admin can see all)
        // Status filter is only for admin - checked via header token
        const authHeader = req.headers.authorization;
        const isAdmin = authHeader && await checkIsAdmin(authHeader);

        if (status && isAdmin) {
            query.status = status;
        } else if (!isAdmin) {
            // Public users only see published courses
            query.status = 'published';
        }

        // Search by title or tags
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { 'title.vi': searchRegex },
                { 'title.en': searchRegex },
                { tags: searchRegex }
            ];
        }

        // Build sort
        let sortOption = {};
        if (sort.startsWith('-')) {
            sortOption[sort.substring(1)] = -1;
        } else {
            sortOption[sort] = 1;
        }

        // Execute query with pagination
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const [courses, total] = await Promise.all([
            Course.find(query)
                .populate('createdBy', 'name email')
                .sort(sortOption)
                .skip(skip)
                .limit(limitNum),
            Course.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: courses,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Get courses error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching courses'
        });
    }
});

// Helper function to check if user is admin from token
async function checkIsAdmin(authHeader) {
    try {
        const token = authHeader.replace('Bearer ', '');
        const { verifyToken } = await import('../middleware/auth.js');
        const decoded = verifyToken(token);
        const User = (await import('../models/User.js')).default;
        const user = await User.findById(decoded.userId);
        return user && user.role === 'admin';
    } catch {
        return false;
    }
}

// @route   GET /api/courses/stats
// @desc    Get course statistics
// @access  Admin
router.get('/stats', authMiddleware, adminOnly, async (req, res) => {
    try {
        const [
            totalCourses,
            publishedCourses,
            draftCourses,
            archivedCourses,
            totalEnrollments,
            avgRating,
            byCategory
        ] = await Promise.all([
            Course.countDocuments(),
            Course.countDocuments({ status: 'published' }),
            Course.countDocuments({ status: 'draft' }),
            Course.countDocuments({ status: 'archived' }),
            Course.aggregate([
                { $group: { _id: null, total: { $sum: '$enrolledCount' } } }
            ]),
            Course.aggregate([
                { $match: { rating: { $gt: 0 } } },
                { $group: { _id: null, avg: { $avg: '$rating' } } }
            ]),
            Course.aggregate([
                { $group: { _id: '$category', count: { $sum: 1 } } }
            ])
        ]);

        res.json({
            success: true,
            data: {
                totalCourses,
                publishedCourses,
                draftCourses,
                archivedCourses,
                totalEnrollments: totalEnrollments[0]?.total || 0,
                averageRating: avgRating[0]?.avg ? avgRating[0].avg.toFixed(1) : 0,
                byCategory: byCategory.reduce((acc, item) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {})
            }
        });
    } catch (error) {
        console.error('Get course stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching statistics'
        });
    }
});

// Helper function to find course by ID or slug
async function findCourseByIdOrSlug(identifier) {
    // Check if identifier is a valid MongoDB ObjectId
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);

    if (isObjectId) {
        return await Course.findById(identifier).populate('createdBy', 'name email');
    }

    // Otherwise, try to find by slug
    return await Course.findOne({ slug: identifier }).populate('createdBy', 'name email');
}

// @route   GET /api/courses/:idOrSlug
// @desc    Get single course by ID or slug
// @access  Public
router.get('/:idOrSlug', async (req, res) => {
    try {
        const course = await findCourseByIdOrSlug(req.params.idOrSlug);

        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        // Check if course is published (or user is admin)
        const authHeader = req.headers.authorization;
        const isAdmin = authHeader && await checkIsAdmin(authHeader);

        if (course.status !== 'published' && !isAdmin) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        res.json({
            success: true,
            data: course
        });
    } catch (error) {
        console.error('Get course error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid course ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while fetching course'
        });
    }
});

// @route   POST /api/courses
// @desc    Create a new course
// @access  Admin
router.post('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const {
            title,
            description,
            category,
            thumbnail,
            duration,
            level,
            price,
            discount,
            status,
            instructor,
            modules,
            tags,
            prerequisites,
            learningOutcomes
        } = req.body;

        // Validate required fields
        if (!title?.vi || !title?.en) {
            return res.status(400).json({
                success: false,
                message: 'Title in both Vietnamese and English is required'
            });
        }

        if (!category) {
            return res.status(400).json({
                success: false,
                message: 'Category is required'
            });
        }

        // Create course
        const course = new Course({
            title,
            description: description || { vi: '', en: '' },
            category,
            thumbnail: thumbnail || '',
            duration: duration || 0,
            level: level || 'beginner',
            price: price || 0,
            discount: discount || 0,
            status: status || 'draft',
            instructor: instructor || {},
            modules: modules || [],
            tags: tags || [],
            prerequisites: prerequisites || [],
            learningOutcomes: learningOutcomes || [],
            createdBy: req.user._id
        });

        // If publishing immediately, set publishedAt
        if (status === 'published') {
            course.publishedAt = new Date();
        }

        await course.save();

        res.status(201).json({
            success: true,
            message: 'Course created successfully',
            data: course
        });
    } catch (error) {
        console.error('Create course error:', error);

        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                message: messages.join(', ')
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while creating course'
        });
    }
});

// @route   PUT /api/courses/:idOrSlug
// @desc    Update a course
// @access  Admin
router.put('/:idOrSlug', authMiddleware, adminOnly, async (req, res) => {
    try {
        const {
            title,
            description,
            category,
            thumbnail,
            duration,
            level,
            price,
            discount,
            status,
            instructor,
            modules,
            tags,
            prerequisites,
            learningOutcomes
        } = req.body;

        const course = await findCourseByIdOrSlug(req.params.idOrSlug);

        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        // Update fields
        if (title) course.title = title;
        if (description) course.description = description;
        if (category) course.category = category;
        if (thumbnail !== undefined) course.thumbnail = thumbnail;
        if (duration !== undefined) course.duration = duration;
        if (level) course.level = level;
        if (price !== undefined) course.price = price;
        if (discount !== undefined) course.discount = discount;
        if (instructor) course.instructor = instructor;
        if (modules) course.modules = modules;
        if (tags) course.tags = tags;
        if (prerequisites) course.prerequisites = prerequisites;
        if (learningOutcomes) course.learningOutcomes = learningOutcomes;

        // Handle status change
        if (status && status !== course.status) {
            course.status = status;
            if (status === 'published' && !course.publishedAt) {
                course.publishedAt = new Date();
            }
        }

        await course.save();

        res.json({
            success: true,
            message: 'Course updated successfully',
            data: course
        });
    } catch (error) {
        console.error('Update course error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid course ID'
            });
        }

        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                message: messages.join(', ')
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while updating course'
        });
    }
});

// @route   DELETE /api/courses/:idOrSlug
// @desc    Delete a course
// @access  Admin
router.delete('/:idOrSlug', authMiddleware, adminOnly, async (req, res) => {
    try {
        const course = await findCourseByIdOrSlug(req.params.idOrSlug);

        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        // Check if course has enrolled students
        if (course.enrolledCount > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete course with enrolled students. Consider archiving instead.'
            });
        }

        await Course.findByIdAndDelete(course._id);

        res.json({
            success: true,
            message: 'Course deleted successfully'
        });
    } catch (error) {
        console.error('Delete course error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid course ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while deleting course'
        });
    }
});

// @route   PATCH /api/courses/:idOrSlug/publish
// @desc    Publish a course
// @access  Admin
router.patch('/:idOrSlug/publish', authMiddleware, adminOnly, async (req, res) => {
    try {
        const course = await findCourseByIdOrSlug(req.params.idOrSlug);

        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        if (course.status === 'published') {
            return res.status(400).json({
                success: false,
                message: 'Course is already published'
            });
        }

        course.status = 'published';
        course.publishedAt = new Date();
        await course.save();

        res.json({
            success: true,
            message: 'Course published successfully',
            data: course
        });
    } catch (error) {
        console.error('Publish course error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid course ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while publishing course'
        });
    }
});

// @route   PATCH /api/courses/:idOrSlug/unpublish
// @desc    Unpublish a course (set to draft)
// @access  Admin
router.patch('/:idOrSlug/unpublish', authMiddleware, adminOnly, async (req, res) => {
    try {
        const course = await findCourseByIdOrSlug(req.params.idOrSlug);

        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        if (course.status !== 'published') {
            return res.status(400).json({
                success: false,
                message: 'Course is not currently published'
            });
        }

        course.status = 'draft';
        await course.save();

        res.json({
            success: true,
            message: 'Course unpublished successfully',
            data: course
        });
    } catch (error) {
        console.error('Unpublish course error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid course ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while unpublishing course'
        });
    }
});

// @route   PATCH /api/courses/:idOrSlug/archive
// @desc    Archive a course
// @access  Admin
router.patch('/:idOrSlug/archive', authMiddleware, adminOnly, async (req, res) => {
    try {
        const course = await findCourseByIdOrSlug(req.params.idOrSlug);

        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        course.status = 'archived';
        await course.save();

        res.json({
            success: true,
            message: 'Course archived successfully',
            data: course
        });
    } catch (error) {
        console.error('Archive course error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid course ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while archiving course'
        });
    }
});

export default router;
