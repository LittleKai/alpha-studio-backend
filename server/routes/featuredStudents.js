import express from 'express';
import FeaturedStudent from '../models/FeaturedStudent.js';
import User from '../models/User.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = express.Router();

const USER_FIELDS = '_id name avatar backgroundImage bio skills socials featuredWorks role';

// ─── Helper: map DB entry → landing-page shape ────────────────────────────────
const toPublicShape = (entry) => {
    const u = entry.userId;
    if (!u) return null;
    return {
        id: u._id.toString(),
        name: u.name,
        role: entry.label || u.role,
        image: u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=random&size=200`,
        backgroundImage: u.backgroundImage || null,
        work: u.featuredWorks?.[0]?.image || u.avatar || '',
        hired: entry.hired,
        bio: u.bio || '',
        skills: u.skills || [],
        gallery: (u.featuredWorks || []).map(w => w.image).filter(Boolean),
        socials: u.socials || {}
    };
};

// ─── Public ──────────────────────────────────────────────────────────────────

// GET /api/featured-students  →  list for landing page (no auth)
router.get('/', async (req, res) => {
    try {
        const entries = await FeaturedStudent.find({})
            .sort({ order: 1 })
            .populate('userId', USER_FIELDS);
        res.json({
            success: true,
            data: entries.map(toPublicShape).filter(Boolean)
        });
    } catch (error) {
        console.error('Get featured students error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ─── Admin ───────────────────────────────────────────────────────────────────
router.use(authMiddleware);
router.use(adminOnly);

// GET /api/featured-students/admin  →  list with full user info for admin panel
router.get('/admin', async (req, res) => {
    try {
        const entries = await FeaturedStudent.find({})
            .sort({ order: 1 })
            .populate('userId', USER_FIELDS);
        res.json({
            success: true,
            data: entries.map(e => {
                const u = e.userId;
                if (!u) return null;
                return {
                    _id: e._id.toString(),
                    userId: u._id.toString(),
                    name: u.name,
                    avatar: u.avatar || null,
                    email: u.email,
                    role: u.role,
                    label: e.label,
                    hired: e.hired,
                    order: e.order,
                    hasFeaturedWork: (u.featuredWorks?.length ?? 0) > 0
                };
            }).filter(Boolean)
        });
    } catch (error) {
        console.error('Get admin featured students error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/featured-students  →  add a user
router.post('/', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ success: false, message: 'userId required' });

        const user = await User.findById(userId).select('_id');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const exists = await FeaturedStudent.findOne({ userId });
        if (exists) return res.status(409).json({ success: false, message: 'User already in list' });

        const count = await FeaturedStudent.countDocuments();
        const entry = await FeaturedStudent.create({ userId, order: count });
        await entry.populate('userId', USER_FIELDS);

        res.json({
            success: true,
            message: 'Added to featured students',
            data: {
                _id: entry._id.toString(),
                userId: entry.userId._id.toString(),
                name: entry.userId.name,
                avatar: entry.userId.avatar || null,
                email: entry.userId.email,
                role: entry.userId.role,
                label: entry.label,
                hired: entry.hired,
                order: entry.order,
                hasFeaturedWork: (entry.userId.featuredWorks?.length ?? 0) > 0
            }
        });
    } catch (error) {
        console.error('Add featured student error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PUT /api/featured-students/:userId  →  update label / hired
router.put('/:userId', async (req, res) => {
    try {
        const { label, hired } = req.body;
        const entry = await FeaturedStudent.findOneAndUpdate(
            { userId: req.params.userId },
            { ...(label !== undefined && { label }), ...(hired !== undefined && { hired }) },
            { new: true }
        ).populate('userId', USER_FIELDS);

        if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });

        res.json({ success: true, message: 'Updated' });
    } catch (error) {
        console.error('Update featured student error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PUT /api/featured-students/reorder  →  update order for all
router.put('/reorder/save', async (req, res) => {
    try {
        const { orderedIds } = req.body; // array of userId strings in new order
        if (!Array.isArray(orderedIds)) return res.status(400).json({ success: false, message: 'orderedIds required' });

        await Promise.all(
            orderedIds.map((userId, idx) =>
                FeaturedStudent.findOneAndUpdate({ userId }, { order: idx })
            )
        );

        res.json({ success: true, message: 'Order saved' });
    } catch (error) {
        console.error('Reorder featured students error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// DELETE /api/featured-students/:userId  →  remove
router.delete('/:userId', async (req, res) => {
    try {
        await FeaturedStudent.findOneAndDelete({ userId: req.params.userId });
        res.json({ success: true, message: 'Removed from featured students' });
    } catch (error) {
        console.error('Delete featured student error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

export default router;
