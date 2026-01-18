import express from 'express';
import Partner from '../models/Partner.js';
import { authMiddleware, modOnly } from '../middleware/auth.js';

const router = express.Router();

// All routes require mod/admin access
router.use(authMiddleware, modOnly);

// @route   GET /api/partners
// @desc    Get all partners with filtering, pagination, search
// @access  Mod/Admin
router.get('/', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            partnerType,
            status,
            search,
            sort = '-createdAt'
        } = req.query;

        // Build query
        const query = {};

        if (partnerType) {
            query.partnerType = partnerType;
        }

        if (status) {
            query.status = status;
        }

        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { companyName: searchRegex },
                { 'description.vi': searchRegex },
                { 'description.en': searchRegex }
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

        const [partners, total] = await Promise.all([
            Partner.find(query)
                .populate('createdBy', 'name email')
                .sort(sortOption)
                .skip(skip)
                .limit(limitNum),
            Partner.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: partners,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Get partners error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching partners'
        });
    }
});

// @route   GET /api/partners/stats
// @desc    Get partner statistics
// @access  Mod/Admin
router.get('/stats', async (req, res) => {
    try {
        const [
            totalPartners,
            publishedPartners,
            draftPartners,
            archivedPartners,
            byType
        ] = await Promise.all([
            Partner.countDocuments(),
            Partner.countDocuments({ status: 'published' }),
            Partner.countDocuments({ status: 'draft' }),
            Partner.countDocuments({ status: 'archived' }),
            Partner.aggregate([
                { $group: { _id: '$partnerType', count: { $sum: 1 } } }
            ])
        ]);

        res.json({
            success: true,
            data: {
                totalPartners,
                publishedPartners,
                draftPartners,
                archivedPartners,
                byType: byType.reduce((acc, item) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {})
            }
        });
    } catch (error) {
        console.error('Get partner stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching statistics'
        });
    }
});

// Helper function to find partner by ID or slug
async function findPartnerByIdOrSlug(identifier) {
    // Check if identifier is a valid MongoDB ObjectId
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);

    if (isObjectId) {
        return await Partner.findById(identifier).populate('createdBy', 'name email');
    }

    // Otherwise, try to find by slug
    return await Partner.findOne({ slug: identifier }).populate('createdBy', 'name email');
}

// @route   GET /api/partners/:idOrSlug
// @desc    Get single partner by ID or slug
// @access  Mod/Admin
router.get('/:idOrSlug', async (req, res) => {
    try {
        const partner = await findPartnerByIdOrSlug(req.params.idOrSlug);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner not found'
            });
        }

        res.json({
            success: true,
            data: partner
        });
    } catch (error) {
        console.error('Get partner error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid partner ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while fetching partner'
        });
    }
});

// @route   POST /api/partners
// @desc    Create a new partner
// @access  Mod/Admin
router.post('/', async (req, res) => {
    try {
        const {
            companyName,
            description,
            logo,
            website,
            email,
            phone,
            address,
            partnerType,
            status,
            featured,
            order,
            socialLinks
        } = req.body;

        if (!companyName) {
            return res.status(400).json({
                success: false,
                message: 'Company name is required'
            });
        }

        const partner = new Partner({
            companyName,
            description: description || { vi: '', en: '' },
            logo: logo || '',
            website: website || '',
            email: email || '',
            phone: phone || '',
            address: address || '',
            partnerType: partnerType || 'technology',
            status: status || 'draft',
            featured: featured || false,
            order: order || 0,
            socialLinks: socialLinks || {},
            createdBy: req.user._id
        });

        if (status === 'published') {
            partner.publishedAt = new Date();
        }

        await partner.save();

        res.status(201).json({
            success: true,
            message: 'Partner created successfully',
            data: partner
        });
    } catch (error) {
        console.error('Create partner error:', error);

        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                message: messages.join(', ')
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while creating partner'
        });
    }
});

// @route   PUT /api/partners/:idOrSlug
// @desc    Update a partner
// @access  Mod/Admin
router.put('/:idOrSlug', async (req, res) => {
    try {
        const {
            companyName,
            description,
            logo,
            website,
            email,
            phone,
            address,
            partnerType,
            status,
            featured,
            order,
            socialLinks
        } = req.body;

        const partner = await findPartnerByIdOrSlug(req.params.idOrSlug);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner not found'
            });
        }

        if (companyName) partner.companyName = companyName;
        if (description) partner.description = description;
        if (logo !== undefined) partner.logo = logo;
        if (website !== undefined) partner.website = website;
        if (email !== undefined) partner.email = email;
        if (phone !== undefined) partner.phone = phone;
        if (address !== undefined) partner.address = address;
        if (partnerType) partner.partnerType = partnerType;
        if (featured !== undefined) partner.featured = featured;
        if (order !== undefined) partner.order = order;
        if (socialLinks) partner.socialLinks = socialLinks;

        if (status && status !== partner.status) {
            partner.status = status;
            if (status === 'published' && !partner.publishedAt) {
                partner.publishedAt = new Date();
            }
        }

        await partner.save();

        res.json({
            success: true,
            message: 'Partner updated successfully',
            data: partner
        });
    } catch (error) {
        console.error('Update partner error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid partner ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while updating partner'
        });
    }
});

// @route   DELETE /api/partners/:idOrSlug
// @desc    Delete a partner
// @access  Mod/Admin
router.delete('/:idOrSlug', async (req, res) => {
    try {
        const partner = await findPartnerByIdOrSlug(req.params.idOrSlug);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner not found'
            });
        }

        await Partner.findByIdAndDelete(partner._id);

        res.json({
            success: true,
            message: 'Partner deleted successfully'
        });
    } catch (error) {
        console.error('Delete partner error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid partner ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while deleting partner'
        });
    }
});

// @route   PATCH /api/partners/:idOrSlug/publish
// @desc    Publish a partner
// @access  Mod/Admin
router.patch('/:idOrSlug/publish', async (req, res) => {
    try {
        const partner = await findPartnerByIdOrSlug(req.params.idOrSlug);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner not found'
            });
        }

        if (partner.status === 'published') {
            return res.status(400).json({
                success: false,
                message: 'Partner is already published'
            });
        }

        partner.status = 'published';
        partner.publishedAt = new Date();
        await partner.save();

        res.json({
            success: true,
            message: 'Partner published successfully',
            data: partner
        });
    } catch (error) {
        console.error('Publish partner error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid partner ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while publishing partner'
        });
    }
});

// @route   PATCH /api/partners/:idOrSlug/unpublish
// @desc    Unpublish a partner
// @access  Mod/Admin
router.patch('/:idOrSlug/unpublish', async (req, res) => {
    try {
        const partner = await findPartnerByIdOrSlug(req.params.idOrSlug);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner not found'
            });
        }

        if (partner.status !== 'published') {
            return res.status(400).json({
                success: false,
                message: 'Partner is not currently published'
            });
        }

        partner.status = 'draft';
        await partner.save();

        res.json({
            success: true,
            message: 'Partner unpublished successfully',
            data: partner
        });
    } catch (error) {
        console.error('Unpublish partner error:', error);

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid partner ID'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error while unpublishing partner'
        });
    }
});

export default router;
