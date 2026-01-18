import express from 'express';
import Job from '../models/Job.js';
import { authMiddleware, modOnly } from '../middleware/auth.js';

const router = express.Router();

// @route   GET /api/jobs
// @desc    Get all jobs with filtering, pagination, search
// @access  Public
router.get('/', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            category,
            jobType,
            experienceLevel,
            status,
            search,
            sort = '-createdAt'
        } = req.query;

        // Build query
        const query = {};

        // Check if user is mod/admin
        const authHeader = req.headers.authorization;
        const isMod = authHeader && await checkIsMod(authHeader);

        // Public users only see published jobs
        if (status && isMod) {
            query.status = status;
        } else if (!isMod) {
            query.status = 'published';
        }

        if (category) {
            query.category = category;
        }

        if (jobType) {
            query.jobType = jobType;
        }

        if (experienceLevel) {
            query.experienceLevel = experienceLevel;
        }

        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { 'title.vi': searchRegex },
                { 'title.en': searchRegex },
                { 'description.vi': searchRegex },
                { 'description.en': searchRegex },
                { skills: searchRegex }
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

        const [jobs, total] = await Promise.all([
            Job.find(query)
                .populate('createdBy', 'name email')
                .sort(sortOption)
                .skip(skip)
                .limit(limitNum),
            Job.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: jobs,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Get jobs error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching jobs'
        });
    }
});

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

// @route   GET /api/jobs/stats
// @desc    Get job statistics
// @access  Mod/Admin
router.get('/stats', authMiddleware, modOnly, async (req, res) => {
    try {
        const [
            totalJobs,
            publishedJobs,
            draftJobs,
            closedJobs,
            totalApplications,
            byCategory,
            byJobType
        ] = await Promise.all([
            Job.countDocuments(),
            Job.countDocuments({ status: 'published' }),
            Job.countDocuments({ status: 'draft' }),
            Job.countDocuments({ status: 'closed' }),
            Job.aggregate([
                { $group: { _id: null, total: { $sum: '$applicationCount' } } }
            ]),
            Job.aggregate([
                { $group: { _id: '$category', count: { $sum: 1 } } }
            ]),
            Job.aggregate([
                { $group: { _id: '$jobType', count: { $sum: 1 } } }
            ])
        ]);

        res.json({
            success: true,
            data: {
                totalJobs,
                publishedJobs,
                draftJobs,
                closedJobs,
                totalApplications: totalApplications[0]?.total || 0,
                byCategory: byCategory.reduce((acc, item) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {}),
                byJobType: byJobType.reduce((acc, item) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {})
            }
        });
    } catch (error) {
        console.error('Get job stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching statistics'
        });
    }
});

// @route   GET /api/jobs/:id
// @desc    Get single job by ID
// @access  Public
router.get('/:id', async (req, res) => {
    try {
        const job = await Job.findById(req.params.id)
            .populate('createdBy', 'name email');

        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Job not found'
            });
        }

        // Check if job is published (or user is mod/admin)
        const authHeader = req.headers.authorization;
        const isMod = authHeader && await checkIsMod(authHeader);

        if (job.status !== 'published' && !isMod) {
            return res.status(404).json({
                success: false,
                message: 'Job not found'
            });
        }

        res.json({
            success: true,
            data: job
        });
    } catch (error) {
        console.error('Get job error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid job ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while fetching job'
        });
    }
});

// @route   POST /api/jobs
// @desc    Create a new job
// @access  Mod/Admin
router.post('/', authMiddleware, modOnly, async (req, res) => {
    try {
        const {
            title,
            description,
            requirements,
            benefits,
            company,
            location,
            jobType,
            experienceLevel,
            salary,
            category,
            skills,
            status,
            featured,
            applicationDeadline
        } = req.body;

        if (!title?.vi || !title?.en) {
            return res.status(400).json({
                success: false,
                message: 'Title in both Vietnamese and English is required'
            });
        }

        const job = new Job({
            title,
            description: description || { vi: '', en: '' },
            requirements: requirements || { vi: '', en: '' },
            benefits: benefits || { vi: '', en: '' },
            company: company || { name: 'Alpha Studio', logo: '' },
            location: location || '',
            jobType: jobType || 'full-time',
            experienceLevel: experienceLevel || 'junior',
            salary: salary || { min: 0, max: 0, currency: 'VND', negotiable: true },
            category: category || 'engineering',
            skills: skills || [],
            status: status || 'draft',
            featured: featured || false,
            applicationDeadline: applicationDeadline || null,
            createdBy: req.user._id
        });

        if (status === 'published') {
            job.publishedAt = new Date();
        }

        await job.save();

        res.status(201).json({
            success: true,
            message: 'Job created successfully',
            data: job
        });
    } catch (error) {
        console.error('Create job error:', error);

        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                message: messages.join(', ')
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while creating job'
        });
    }
});

// @route   PUT /api/jobs/:id
// @desc    Update a job
// @access  Mod/Admin
router.put('/:id', authMiddleware, modOnly, async (req, res) => {
    try {
        const {
            title,
            description,
            requirements,
            benefits,
            company,
            location,
            jobType,
            experienceLevel,
            salary,
            category,
            skills,
            status,
            featured,
            applicationDeadline
        } = req.body;

        const job = await Job.findById(req.params.id);

        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Job not found'
            });
        }

        if (title) job.title = title;
        if (description) job.description = description;
        if (requirements) job.requirements = requirements;
        if (benefits) job.benefits = benefits;
        if (company) job.company = company;
        if (location !== undefined) job.location = location;
        if (jobType) job.jobType = jobType;
        if (experienceLevel) job.experienceLevel = experienceLevel;
        if (salary) job.salary = salary;
        if (category) job.category = category;
        if (skills) job.skills = skills;
        if (featured !== undefined) job.featured = featured;
        if (applicationDeadline !== undefined) job.applicationDeadline = applicationDeadline;

        if (status && status !== job.status) {
            job.status = status;
            if (status === 'published' && !job.publishedAt) {
                job.publishedAt = new Date();
            }
        }

        await job.save();

        res.json({
            success: true,
            message: 'Job updated successfully',
            data: job
        });
    } catch (error) {
        console.error('Update job error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid job ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while updating job'
        });
    }
});

// @route   DELETE /api/jobs/:id
// @desc    Delete a job
// @access  Mod/Admin
router.delete('/:id', authMiddleware, modOnly, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);

        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Job not found'
            });
        }

        await Job.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'Job deleted successfully'
        });
    } catch (error) {
        console.error('Delete job error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid job ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while deleting job'
        });
    }
});

// @route   PATCH /api/jobs/:id/publish
// @desc    Publish a job
// @access  Mod/Admin
router.patch('/:id/publish', authMiddleware, modOnly, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);

        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Job not found'
            });
        }

        if (job.status === 'published') {
            return res.status(400).json({
                success: false,
                message: 'Job is already published'
            });
        }

        job.status = 'published';
        job.publishedAt = new Date();
        await job.save();

        res.json({
            success: true,
            message: 'Job published successfully',
            data: job
        });
    } catch (error) {
        console.error('Publish job error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid job ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while publishing job'
        });
    }
});

// @route   PATCH /api/jobs/:id/close
// @desc    Close a job
// @access  Mod/Admin
router.patch('/:id/close', authMiddleware, modOnly, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);

        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Job not found'
            });
        }

        job.status = 'closed';
        await job.save();

        res.json({
            success: true,
            message: 'Job closed successfully',
            data: job
        });
    } catch (error) {
        console.error('Close job error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid job ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while closing job'
        });
    }
});

export default router;
