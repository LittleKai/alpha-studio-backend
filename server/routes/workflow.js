import express from 'express';
import WorkflowProject from '../models/WorkflowProject.js';
import WorkflowDocument from '../models/WorkflowDocument.js';
import User from '../models/User.js';
import { authMiddleware, modOnly } from '../middleware/auth.js';

const router = express.Router();

const MANAGER_PROJECT_FIELDS = [
    'name', 'client', 'tagline', 'requirements', 'description', 'department', 'status',
    'startDate', 'deadline', 'budget', 'expenses', 'expenseLog',
    'team', 'progress', 'chatHistory', 'tasks', 'avatar'
];

const MEMBER_PROJECT_FIELDS = [
    'chatHistory', 'tasks', 'progress', 'expenses', 'expenseLog'
];

const OWNER_DOCUMENT_FIELDS = [
    'name', 'type', 'size', 'uploadDate', 'uploader',
    'status', 'url', 'fileKey', 'isProject', 'projectId', 'comments', 'note'
];

const MANAGER_DOCUMENT_FIELDS = ['status', 'comments', 'note'];

export function buildUserSearchRegex(rawQuery) {
    const q = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 64) : '';
    if (q.length < 2) return null;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'i');
}

export function isProjectManagerOrAdmin(project, user) {
    if (!project || !user) return false;
    if (user.role === 'admin' || user.role === 'mod') return true;
    const userId = user._id?.toString();
    if (!userId) return false;
    if (project.createdBy?.toString() === userId) return true;
    const team = Array.isArray(project.team) ? project.team : [];
    const member = team.find(m => m.id?.toString() === userId);
    return Boolean(member && (member.projectRole === 'creator' || member.projectRole === 'manager'));
}

export function canAccessProject(project, user) {
    if (!project || !user) return false;
    if (isProjectManagerOrAdmin(project, user)) return true;
    const userId = user._id?.toString();
    const team = Array.isArray(project.team) ? project.team : [];
    return Boolean(userId && team.some(m => m.id?.toString() === userId));
}

function isSelfLeaveTeamUpdate(currentTeam, nextTeam, userId) {
    if (!Array.isArray(currentTeam) || !Array.isArray(nextTeam)) return false;
    const expectedIds = currentTeam
        .map(m => m.id?.toString())
        .filter(id => id && id !== userId);
    const actualIds = nextTeam.map(m => m?.id?.toString()).filter(Boolean);
    if (expectedIds.length !== actualIds.length) return false;
    return expectedIds.every((id, idx) => id === actualIds[idx]);
}

export function resolveProjectUpdateAccess(project, user, body) {
    if (!project || !user || !body || typeof body !== 'object' || Array.isArray(body)) {
        return { allowed: false, allowedFields: [] };
    }
    if (isProjectManagerOrAdmin(project, user)) {
        return { allowed: true, allowedFields: MANAGER_PROJECT_FIELDS };
    }
    const userId = user._id?.toString();
    const team = Array.isArray(project.team) ? project.team : [];
    const isTeamMember = Boolean(userId && team.some(m => m.id?.toString() === userId));
    if (!isTeamMember) {
        return { allowed: false, allowedFields: [] };
    }

    const requestedFields = Object.keys(body);
    if (requestedFields.length === 0) {
        return { allowed: false, allowedFields: [] };
    }

    const allowedForCall = [...MEMBER_PROJECT_FIELDS];
    if (body.team !== undefined && isSelfLeaveTeamUpdate(team, body.team, userId)) {
        allowedForCall.push('team');
    }

    const allPermitted = requestedFields.every(field => allowedForCall.includes(field));
    if (!allPermitted) {
        return { allowed: false, allowedFields: [] };
    }

    return { allowed: true, allowedFields: allowedForCall };
}

export function resolveDocumentUpdateAccess(doc, project, user) {
    if (!doc || !user) return { allowed: false, allowedFields: [] };
    const userId = user._id?.toString();
    if (!userId) return { allowed: false, allowedFields: [] };
    const isOwner = doc.createdBy?.toString() === userId;
    const isAdmin = user.role === 'admin' || user.role === 'mod';
    if (isOwner || isAdmin) {
        return { allowed: true, allowedFields: OWNER_DOCUMENT_FIELDS };
    }
    if (project && isProjectManagerOrAdmin(project, user)) {
        return { allowed: true, allowedFields: MANAGER_DOCUMENT_FIELDS };
    }
    return { allowed: false, allowedFields: [] };
}

export function canManageWorkflowDocument(doc, project, user) {
    return resolveDocumentUpdateAccess(doc, project, user).allowed;
}

function handleRouteError(res, label, error) {
    console.error(`${label}:`, error);
    if (error?.code === 'INLINE_MEDIA_NOT_ALLOWED') {
        return res.status(400).json({ success: false, message: error.message });
    }
    if (error?.name === 'ValidationError') {
        const messages = Object.values(error.errors || {}).map(e => e.message);
        return res.status(400).json({ success: false, message: messages.join(', ') || error.message });
    }
    if (error?.name === 'CastError') {
        return res.status(400).json({ success: false, message: 'ID không hợp lệ' });
    }
    return res.status(500).json({ success: false, message: 'Lỗi server' });
}

// ─── PROJECTS ──────────────────────────────────────────────────────────────

// @route   GET /api/workflow/projects
// @desc    Get all projects for current user
// @access  Auth
router.get('/projects', authMiddleware, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin';
        const query = isAdmin ? {} : { status: { $ne: 'completed' } };

        const projects = await WorkflowProject.find(query).sort({ createdAt: -1 });
        res.json({ success: true, data: projects });
    } catch (error) {
        handleRouteError(res, 'Get workflow projects error', error);
    }
});

// @route   POST /api/workflow/projects
// @desc    Create a new project
// @access  Admin/Mod only
router.post('/projects', authMiddleware, modOnly, async (req, res) => {
    try {
        const {
            name, client, tagline, requirements, description, department, status,
            startDate, deadline, budget, expenses, expenseLog,
            team, progress, chatHistory, tasks
        } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Tên dự án là bắt buộc' });
        }

        const project = new WorkflowProject({
            name,
            client: client || '',
            tagline: tagline || '',
            requirements: requirements || '',
            description: description || '',
            department: department || 'event_planner',
            status: status || 'planning',
            startDate: startDate || new Date().toISOString().split('T')[0],
            deadline: deadline || '',
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
        handleRouteError(res, 'Create workflow project error', error);
    }
});

// @route   PUT /api/workflow/projects/:id
// @desc    Update a project (creator, manager, mod, admin; team members may update tasks/progress/expenses/chatHistory or self-leave)
// @access  Auth
router.put('/projects/:id', authMiddleware, async (req, res) => {
    try {
        const project = await WorkflowProject.findById(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy dự án' });
        }

        const { allowed, allowedFields } = resolveProjectUpdateAccess(project, req.user, req.body);
        if (!allowed) {
            return res.status(403).json({ success: false, message: 'Không có quyền chỉnh sửa' });
        }

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                project[field] = req.body[field];
            }
        }

        await project.save();
        res.json({ success: true, message: 'Cập nhật dự án thành công', data: project });
    } catch (error) {
        handleRouteError(res, 'Update workflow project error', error);
    }
});

// @route   DELETE /api/workflow/projects/:id
// @desc    Delete a project (admin only, completed projects only)
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
        handleRouteError(res, 'Delete workflow project error', error);
    }
});

// ─── USER SEARCH ────────────────────────────────────────────────────────────

// @route   GET /api/workflow/users/search?q=xxx
// @desc    Search users by name or email (for adding to project)
// @access  Auth
router.get('/users/search', authMiddleware, async (req, res) => {
    try {
        const regex = buildUserSearchRegex(req.query.q);
        if (!regex) {
            return res.json({ success: true, data: [] });
        }
        const filter = { $or: [{ name: regex }, { email: regex }] };
        if (req.query.includeSelf !== 'true') {
            filter._id = { $ne: req.user._id };
        }
        const users = await User.find(filter)
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
        handleRouteError(res, 'Search users error', error);
    }
});

// @route   GET /api/workflow/users/:id
// @desc    Get public profile of a user by ID
// @access  Public
router.get('/users/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .select('_id name avatar backgroundImage role email phone bio skills location socials')
            .lean();

        if (!user) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
        }

        res.json({
            success: true,
            data: {
                id: user._id.toString(),
                name: user.name,
                avatar: user.avatar || null,
                backgroundImage: user.backgroundImage || null,
                role: user.role,
                email: user.email,
                phone: user.phone || '',
                bio: user.bio || '',
                skills: user.skills || [],
                location: user.location || '',
                socials: user.socials || {}
            }
        });
    } catch (error) {
        handleRouteError(res, 'Get user profile error', error);
    }
});

// ─── DOCUMENTS ─────────────────────────────────────────────────────────────

// @route   GET /api/workflow/documents
// @desc    Get documents for current user, optional ?projectId=xxx filter
// @access  Auth
router.get('/documents', authMiddleware, async (req, res) => {
    try {
        if (req.query.projectId) {
            const project = await WorkflowProject.findById(req.query.projectId).lean();
            if (!canAccessProject(project, req.user)) {
                return res.status(403).json({ success: false, message: 'Không có quyền xem' });
            }

            const documents = await WorkflowDocument.find({ projectId: req.query.projectId }).sort({ createdAt: -1 });
            return res.json({ success: true, data: documents });
        }

        // No projectId: return own documents only
        const documents = await WorkflowDocument.find({ createdBy: req.user._id }).sort({ createdAt: -1 });
        res.json({ success: true, data: documents });
    } catch (error) {
        handleRouteError(res, 'Get workflow documents error', error);
    }
});

// @route   POST /api/workflow/documents
// @desc    Create a document record
// @access  Auth
router.post('/documents', authMiddleware, async (req, res) => {
    try {
        const {
            name, type, size, uploadDate, uploader,
            status, url, fileKey, isProject, projectId, comments, note
        } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Tên file là bắt buộc' });
        }

        if (projectId) {
            const project = await WorkflowProject.findById(projectId).lean();
            if (!project) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy dự án' });
            }
            if (!canAccessProject(project, req.user)) {
                return res.status(403).json({ success: false, message: 'Không có quyền tải file vào dự án này' });
            }
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
            isProject: isProject || Boolean(projectId),
            projectId: projectId || null,
            comments: comments || [],
            note: note || '',
            createdBy: req.user._id
        });

        await doc.save();
        res.status(201).json({ success: true, message: 'Tạo tài liệu thành công', data: doc });
    } catch (error) {
        handleRouteError(res, 'Create workflow document error', error);
    }
});

// @route   PUT /api/workflow/documents/:id
// @desc    Update a document (status, comments, note, etc.)
// @access  Auth
router.put('/documents/:id', authMiddleware, async (req, res) => {
    try {
        const doc = await WorkflowDocument.findById(req.params.id);
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu' });
        }

        const project = doc.projectId ? await WorkflowProject.findById(doc.projectId).lean() : null;
        const { allowed, allowedFields } = resolveDocumentUpdateAccess(doc, project, req.user);
        if (!allowed) {
            return res.status(403).json({ success: false, message: 'Không có quyền chỉnh sửa' });
        }

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                doc[field] = req.body[field];
            }
        }

        await doc.save();
        res.json({ success: true, message: 'Cập nhật tài liệu thành công', data: doc });
    } catch (error) {
        handleRouteError(res, 'Update workflow document error', error);
    }
});

// @route   DELETE /api/workflow/documents/:id
// @desc    Delete a document (creator, admin/mod, or project creator/manager)
// @access  Auth
router.delete('/documents/:id', authMiddleware, async (req, res) => {
    try {
        const doc = await WorkflowDocument.findById(req.params.id);
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu' });
        }

        const project = doc.projectId ? await WorkflowProject.findById(doc.projectId).lean() : null;
        if (!canManageWorkflowDocument(doc, project, req.user)) {
            return res.status(403).json({ success: false, message: 'Không có quyền xóa' });
        }

        await WorkflowDocument.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Xóa tài liệu thành công' });
    } catch (error) {
        handleRouteError(res, 'Delete workflow document error', error);
    }
});

export default router;
