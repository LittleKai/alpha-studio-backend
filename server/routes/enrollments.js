import express from 'express';
import Enrollment from '../models/Enrollment.js';
import Course from '../models/Course.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// @route   GET /api/enrollments/my-courses
// @desc    Get all courses enrolled by current user
// @access  Private
router.get('/my-courses', authMiddleware, async (req, res) => {
    try {
        const enrollments = await Enrollment.find({ user: req.user._id })
            .populate({
                path: 'course',
                select: 'slug title thumbnail duration level category instructor modules enrolledCount rating reviewCount'
            })
            .sort({ lastAccessedAt: -1 });

        // Filter out enrollments where course might be deleted
        const validEnrollments = enrollments.filter(e => e.course);

        res.json({
            success: true,
            data: validEnrollments
        });
    } catch (error) {
        console.error('Get my courses error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching enrolled courses'
        });
    }
});

// @route   GET /api/enrollments/check/:courseId
// @desc    Check if user is enrolled in a course
// @access  Private
router.get('/check/:courseId', authMiddleware, async (req, res) => {
    try {
        const enrollment = await Enrollment.findOne({
            user: req.user._id,
            course: req.params.courseId
        });

        res.json({
            success: true,
            enrolled: !!enrollment,
            data: enrollment
        });
    } catch (error) {
        console.error('Check enrollment error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while checking enrollment'
        });
    }
});

// @route   POST /api/enrollments/:courseId
// @desc    Enroll in a course
// @access  Private
router.post('/:courseId', authMiddleware, async (req, res) => {
    try {
        const course = await Course.findById(req.params.courseId);

        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        if (course.status !== 'published') {
            return res.status(400).json({
                success: false,
                message: 'Course is not available for enrollment'
            });
        }

        // Check if already enrolled
        const existingEnrollment = await Enrollment.findOne({
            user: req.user._id,
            course: req.params.courseId
        });

        if (existingEnrollment) {
            return res.status(400).json({
                success: false,
                message: 'You are already enrolled in this course'
            });
        }

        // Determine payment status based on course price
        const paymentStatus = course.finalPrice > 0 ? 'pending' : 'free';

        // For free courses or already paid, enroll directly
        // For paid courses, this would normally go through a payment flow
        if (paymentStatus === 'pending') {
            return res.status(400).json({
                success: false,
                message: 'This is a paid course. Payment integration not implemented yet.',
                requiresPayment: true,
                price: course.finalPrice
            });
        }

        // Set initial current lesson to first lesson of first module
        let currentLesson = { moduleId: '', lessonId: '' };
        if (course.modules && course.modules.length > 0) {
            const firstModule = course.modules[0];
            if (firstModule.lessons && firstModule.lessons.length > 0) {
                currentLesson = {
                    moduleId: firstModule.moduleId,
                    lessonId: firstModule.lessons[0].lessonId
                };
            }
        }

        const enrollment = new Enrollment({
            user: req.user._id,
            course: req.params.courseId,
            paymentStatus,
            currentLesson
        });

        await enrollment.save();

        // Increment enrolled count on course
        await Course.findByIdAndUpdate(req.params.courseId, {
            $inc: { enrolledCount: 1 }
        });

        res.status(201).json({
            success: true,
            message: 'Successfully enrolled in course',
            data: enrollment
        });
    } catch (error) {
        console.error('Enroll error:', error);

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'You are already enrolled in this course'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while enrolling'
        });
    }
});

// @route   GET /api/enrollments/:courseId/progress
// @desc    Get enrollment progress for a course
// @access  Private
router.get('/:courseId/progress', authMiddleware, async (req, res) => {
    try {
        const enrollment = await Enrollment.findOne({
            user: req.user._id,
            course: req.params.courseId
        });

        if (!enrollment) {
            return res.status(404).json({
                success: false,
                message: 'Enrollment not found'
            });
        }

        res.json({
            success: true,
            data: {
                progress: enrollment.progress,
                completedLessons: enrollment.completedLessons,
                currentLesson: enrollment.currentLesson,
                status: enrollment.status,
                lastAccessedAt: enrollment.lastAccessedAt
            }
        });
    } catch (error) {
        console.error('Get progress error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching progress'
        });
    }
});

// @route   PUT /api/enrollments/:courseId/progress
// @desc    Update lesson progress
// @access  Private
router.put('/:courseId/progress', authMiddleware, async (req, res) => {
    try {
        const { lessonId, moduleId, completed, watchedDuration, lastPosition } = req.body;

        const enrollment = await Enrollment.findOne({
            user: req.user._id,
            course: req.params.courseId
        });

        if (!enrollment) {
            return res.status(404).json({
                success: false,
                message: 'Enrollment not found'
            });
        }

        // Get course to calculate total lessons
        const course = await Course.findById(req.params.courseId);
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        // Update current lesson
        if (moduleId && lessonId) {
            enrollment.currentLesson = { moduleId, lessonId };
        }

        // Update lesson progress
        if (lessonId) {
            if (completed) {
                enrollment.markLessonCompleted(lessonId);
            } else if (watchedDuration !== undefined) {
                enrollment.updateVideoProgress(lessonId, watchedDuration, lastPosition || 0);
            }
        }

        // Calculate total lessons
        let totalLessons = 0;
        course.modules.forEach(module => {
            totalLessons += module.lessons.length;
        });

        // Update progress percentage
        enrollment.progress = enrollment.calculateProgress(totalLessons);

        // Check if course is completed
        if (enrollment.progress === 100 && enrollment.status !== 'completed') {
            enrollment.status = 'completed';
            enrollment.completedAt = new Date();
        }

        // Update last accessed
        enrollment.lastAccessedAt = new Date();

        await enrollment.save();

        res.json({
            success: true,
            message: 'Progress updated',
            data: {
                progress: enrollment.progress,
                completedLessons: enrollment.completedLessons,
                currentLesson: enrollment.currentLesson,
                status: enrollment.status
            }
        });
    } catch (error) {
        console.error('Update progress error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while updating progress'
        });
    }
});

// @route   DELETE /api/enrollments/:courseId
// @desc    Unenroll from a course
// @access  Private
router.delete('/:courseId', authMiddleware, async (req, res) => {
    try {
        const enrollment = await Enrollment.findOneAndDelete({
            user: req.user._id,
            course: req.params.courseId
        });

        if (!enrollment) {
            return res.status(404).json({
                success: false,
                message: 'Enrollment not found'
            });
        }

        // Decrement enrolled count on course
        await Course.findByIdAndUpdate(req.params.courseId, {
            $inc: { enrolledCount: -1 }
        });

        res.json({
            success: true,
            message: 'Successfully unenrolled from course'
        });
    } catch (error) {
        console.error('Unenroll error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while unenrolling'
        });
    }
});

export default router;
