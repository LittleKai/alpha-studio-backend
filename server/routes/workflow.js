import express from 'express';
import WorkflowProject from '../models/WorkflowProject.js';
import WorkflowDocument from '../models/WorkflowDocument.js';
import User from '../models/User.js';
import { authMiddleware, modOnly } from '../middleware/auth.js';

const router = express.Router();

// Helper: check if requester owns resource or is admin
const isOwnerOrAdmin = (resource, user) =>
    resource.createdBy.toString() === user._id.toString() || user.role === 'admin';

// ─── PROJECTS ──────────────────────────────────────────────────────────────

// @route   GET /api/workflow/projects
// @desc    Get all projects for current user
// @access  Auth
router.get('/projects', authMiddleware, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        const isAdmin = req.user.role === 'admin';

        let query;
        if (isAdmin) {
            query = {}; // admin sees all projects
        } else {
            // All non-completed projects + own/member completed projects
            query = {
                $or: [
                    { status: { $ne: 'completed' } },
                    { createdBy: req.user._id },
                    { 'team.id': userId }
                ]
            };
        }

        const projects = await WorkflowProject.find(query).sort({ createdAt: -1 });
        res.json({ success: true, data: projects });
    } catch (error) {
        console.error('Get workflow projects error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   POST /api/workflow/projects
// @desc    Create a new project
// @access  Admin/Mod only
router.post('/projects', authMiddleware, modOnly, async (req, res) => {
    try {
        const {
            name, client, description, department, status,
            startDate, deadline, budget, expenses, expenseLog,
            team, progress, chatHistory, tasks
        } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Tên dự án là bắt buộc' });
        }

        const project = new WorkflowProject({
            name,
            client: client || '',
            description: description || '',
            department: department || 'event_planner',
            status: status || 'planning',
            startDate: startDate || new Date().toISOString().split('T')[0],
            deadline: deadline || 'TBD',
            budget: budget || 0,
            expenses: expenses || 0,
            expenseLog: expenseLog || [],
            team: team || [],
            progress: progress || 0,
            chatHistory: chatHistory || [],
            tasks: tasks || [],
            createdBy: req.user._id
        });

        await project.save();
        res.status(201).json({ success: true, message: 'Tạo dự án thành công', data: project });
    } catch (error) {
        console.error('Create workflow project error:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ success: false, message: messages.join(', ') });
        }
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   PUT /api/workflow/projects/:id
// @desc    Update a project (creator or admin)
// @access  Auth
router.put('/projects/:id', authMiddleware, async (req, res) => {
    try {
        const project = await WorkflowProject.findById(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy dự án' });
        }
        if (!isOwnerOrAdmin(project, req.user)) {
            return res.status(403).json({ success: false, message: 'Không có quyền chỉnh sửa' });
        }

        const allowedFields = [
            'name', 'client', 'description', 'department', 'status',
            'startDate', 'deadline', 'budget', 'expenses', 'expenseLog',
            'team', 'progress', 'chatHistory', 'tasks', 'avatar'
        ];

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                project[field] = req.body[field];
            }
        }

        await project.save();
        res.json({ success: true, message: 'Cập nhật dự án thành công', data: project });
    } catch (error) {
        console.error('Update workflow project error:', error);
        if (error.name === 'CastError') {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ' });
        }
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   DELETE /api/workflow/projects/:id
// @desc    Delete a project (creator or admin)
// @access  Auth
router.delete('/projects/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Chỉ admin mới có thể xóa dự án' });
        }

        const project = await WorkflowProject.findById(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy dự án' });
        }
        if (project.status !== 'completed') {
            return res.status(400).json({ success: false, message: 'Chỉ có thể xóa dự án đã hoàn thành' });
        }

        await WorkflowProject.findByIdAndDelete(req.params.id);
        await WorkflowDocument.deleteMany({ projectId: req.params.id });

        res.json({ success: true, message: 'Xóa dự án thành công' });
    } catch (error) {
        console.error('Delete workflow project error:', error);
        if (error.name === 'CastError') {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ' });
        }
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ─── USER SEARCH ────────────────────────────────────────────────────────────

// @route   GET /api/workflow/users/search?q=xxx
// @desc    Search users by name or email (for adding to project)
// @access  Auth
router.get('/users/search', authMiddleware, async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q || q.length < 2) {
            return res.json({ success: true, data: [] });
        }
        const regex = new RegExp(q, 'i');
        const users = await User.find({
            $or: [{ name: regex }, { email: regex }],
            _id: { $ne: req.user._id } // exclude self
        })
            .select('_id name avatar role email')
            .limit(10)
            .lean();

        const result = users.map(u => ({
            id: u._id.toString(),
            name: u.name,
            avatar: u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=random`,
            role: u.role,
            email: u.email,
            isExternal: false
        }));

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Search users error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ─── DOCUMENTS ─────────────────────────────────────────────────────────────

// @route   GET /api/workflow/documents
// @desc    Get documents for current user, optional ?projectId=xxx filter
// @access  Auth
router.get('/documents', authMiddleware, async (req, res) => {
    try {
        if (req.query.projectId) {
            // For project documents: check membership, then return all docs for that project
            const userId = req.user._id.toString();
            const isAdmin = req.user.role === 'admin' || req.user.role === 'mod';
            let canAccess = isAdmin;

            if (!canAccess) {
                const project = await WorkflowProject.findById(req.query.projectId).lean();
                if (project) {
                    canAccess = project.createdBy.toString() === userId ||
                        project.team.some(m => m.id === userId);
                }
            }

            if (!canAccess) {
                return res.status(403).json({ success: false, message: 'Không có quyền xem' });
            }

            const documents = await WorkflowDocument.find({ projectId: req.query.projectId }).sort({ createdAt: -1 });
            return res.json({ success: true, data: documents });
        }

        // No projectId: return own documents only
        const documents = await WorkflowDocument.find({ createdBy: req.user._id }).sort({ createdAt: -1 });
        res.json({ success: true, data: documents });
    } catch (error) {
        console.error('Get workflow documents error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   POST /api/workflow/documents
// @desc    Create a document record
// @access  Auth
router.post('/documents', authMiddleware, async (req, res) => {
    try {
        const {
            name, type, size, uploadDate, uploader,
            status, url, fileKey, isProject, projectId, comments
        } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Tên file là bắt buộc' });
        }

        const doc = new WorkflowDocument({
            name,
            type: type || 'FILE',
            size: size || '0 B',
            uploadDate: uploadDate || new Date().toISOString().split('T')[0],
            uploader: uploader || req.user.name,
            status: status || 'pending',
            url: url || '',
            fileKey: fileKey || '',
            isProject: isProject || false,
            projectId: projectId || null,
            comments: comments || [],
            createdBy: req.user._id
        });

        await doc.save();
        res.status(201).json({ success: true, message: 'Tạo tài liệu thành công', data: doc });
    } catch (error) {
        console.error('Create workflow document error:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ success: false, message: messages.join(', ') });
        }
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   PUT /api/workflow/documents/:id
// @desc    Update a document (status, comments, etc.)
// @access  Auth
router.put('/documents/:id', authMiddleware, async (req, res) => {
    try {
        const doc = await WorkflowDocument.findById(req.params.id);
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu' });
        }
        const userId = req.user._id.toString();
        const isOwner = doc.createdBy.toString() === userId;
        const isAdmin = req.user.role === 'admin' || req.user.role === 'mod';

        // Also allow project creator/manager to update doc status/comments
        let isProjectManager = false;
        if (doc.projectId) {
            const project = await WorkflowProject.findById(doc.projectId).lean();
            if (project) {
                const member = project.team.find(m => m.id === userId);
                if (member && (member.projectRole === 'creator' || member.projectRole === 'manager')) {
                    isProjectManager = true;
                }
                // Also check createdBy
                if (project.createdBy.toString() === userId) isProjectManager = true;
            }
        }

        if (!isOwner && !isAdmin && !isProjectManager) {
            return res.status(403).json({ success: false, message: 'Không có quyền chỉnh sửa' });
        }

        const allowedFields = ['name', 'type', 'size', 'uploadDate', 'uploader', 'status', 'url', 'fileKey', 'isProject', 'projectId', 'comments', 'note'];
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                doc[field] = req.body[field];
            }
        }

        await doc.save();
        res.json({ success: true, message: 'Cập nhật tài liệu thành công', data: doc });
    } catch (error) {
        console.error('Update workflow document error:', error);
        if (error.name === 'CastError') {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ' });
        }
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   DELETE /api/workflow/documents/:id
// @desc    Delete a document (creator, admin, or project creator/manager)
// @access  Auth
router.delete('/documents/:id', authMiddleware, async (req, res) => {
    try {
        const doc = await WorkflowDocument.findById(req.params.id);
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu' });
        }

        const userId = req.user._id.toString();
        const isOwner = doc.createdBy.toString() === userId;
        const isAdmin = req.user.role === 'admin';

        // Check if user is project creator/manager
        let isProjectManager = false;
        if (doc.projectId) {
            const project = await WorkflowProject.findById(doc.projectId).lean();
            if (project) {
                const member = project.team.find(m => m.id === userId);
                if (member && (member.projectRole === 'creator' || member.projectRole === 'manager')) {
                    isProjectManager = true;
                }
            }
        }

        if (!isOwner && !isAdmin && !isProjectManager) {
            return res.status(403).json({ success: false, message: 'Không có quyền xóa' });
        }

        await WorkflowDocument.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Xóa tài liệu thành công' });
    } catch (error) {
        console.error('Delete workflow document error:', error);
        if (error.name === 'CastError') {
            return res.status(400).json({ success: false, message: 'ID không hợp lệ' });
        }
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

export default router;
