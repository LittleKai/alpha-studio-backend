import express from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import HostMachine from '../models/HostMachine.js';
import CloudSession from '../models/CloudSession.js';

const router = express.Router();

// ==================== USER ROUTES ====================

// POST /api/cloud/connect - Connect to a cloud desktop
router.post('/connect', authMiddleware, async (req, res) => {
    try {
        // Check for existing active session
        const existingSession = await CloudSession.findOne({
            userId: req.user._id,
            status: 'active'
        }).populate('hostMachineId', 'name specs status');

        if (existingSession) {
            return res.json({
                success: true,
                message: 'Existing session found',
                data: {
                    sessionId: existingSession._id,
                    noVncUrl: existingSession.noVncUrl,
                    session: existingSession
                }
            });
        }

        // Pick a random available host with capacity
        const availableHosts = await HostMachine.find({
            status: 'available',
            enabled: true,
            $expr: { $lt: ['$currentContainers', '$maxContainers'] }
        });

        if (availableHosts.length === 0) {
            return res.status(503).json({
                success: false,
                message: 'No available machines at the moment. Please try again later.'
            });
        }

        const host = availableHosts[Math.floor(Math.random() * availableHosts.length)];

        // Call host agent to create container
        let agentResponse;
        try {
            const agentRes = await fetch(`${host.agentUrl}/api/sessions/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-agent-secret': host.secret
                },
                body: JSON.stringify({ userId: req.user._id.toString() })
            });
            agentResponse = await agentRes.json();

            if (!agentRes.ok || !agentResponse.success) {
                throw new Error(agentResponse.message || 'Agent failed to create session');
            }
        } catch (agentError) {
            console.error('Agent communication error:', agentError);
            return res.status(502).json({
                success: false,
                message: 'Failed to create cloud desktop. Host agent unreachable.'
            });
        }

        // Save session
        const session = await CloudSession.create({
            userId: req.user._id,
            hostMachineId: host._id,
            containerId: agentResponse.data.containerId,
            noVncUrl: agentResponse.data.noVncUrl,
            status: 'active',
            startedAt: new Date()
        });

        // Increment container count
        await HostMachine.findByIdAndUpdate(host._id, {
            $inc: { currentContainers: 1 }
        });

        const populatedSession = await CloudSession.findById(session._id)
            .populate('hostMachineId', 'name specs status');

        res.json({
            success: true,
            message: 'Cloud desktop created successfully',
            data: {
                sessionId: session._id,
                noVncUrl: agentResponse.data.noVncUrl,
                session: populatedSession
            }
        });
    } catch (error) {
        console.error('Cloud connect error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to connect to cloud desktop'
        });
    }
});

// POST /api/cloud/disconnect - Disconnect from cloud desktop
router.post('/disconnect', authMiddleware, async (req, res) => {
    try {
        const session = await CloudSession.findOne({
            userId: req.user._id,
            status: 'active'
        }).populate('hostMachineId');

        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'No active session found'
            });
        }

        const host = session.hostMachineId;

        // Call agent to destroy container
        try {
            await fetch(`${host.agentUrl}/api/sessions/${session.containerId}/destroy`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-agent-secret': host.secret
                }
            });
        } catch (agentError) {
            console.error('Agent destroy error (continuing anyway):', agentError);
        }

        // Update session
        session.status = 'ended';
        session.endedAt = new Date();
        session.endReason = 'user_disconnect';
        await session.save();

        // Decrement container count
        await HostMachine.findByIdAndUpdate(host._id, {
            $inc: { currentContainers: -1 }
        });

        res.json({
            success: true,
            message: 'Disconnected successfully'
        });
    } catch (error) {
        console.error('Cloud disconnect error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to disconnect'
        });
    }
});

// GET /api/cloud/session - Get user's active session
router.get('/session', authMiddleware, async (req, res) => {
    try {
        const session = await CloudSession.findOne({
            userId: req.user._id,
            status: 'active'
        }).populate('hostMachineId', 'name specs status');

        res.json({
            success: true,
            data: session
        });
    } catch (error) {
        console.error('Get session error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get session'
        });
    }
});

// ==================== AGENT ROUTE ====================

// POST /api/cloud/heartbeat - Host agent heartbeat (secret-based auth)
router.post('/heartbeat', async (req, res) => {
    try {
        const agentSecret = req.headers['x-agent-secret'];
        const { machineId, status, currentContainers, specs } = req.body;

        if (!agentSecret || !machineId) {
            return res.status(400).json({
                success: false,
                message: 'Missing machineId or x-agent-secret header'
            });
        }

        const machine = await HostMachine.findOne({ machineId });

        if (!machine) {
            return res.status(404).json({
                success: false,
                message: 'Machine not found'
            });
        }

        if (machine.secret !== agentSecret) {
            return res.status(403).json({
                success: false,
                message: 'Invalid secret'
            });
        }

        // Update machine info
        machine.lastPingAt = new Date();
        if (status) machine.status = status;
        if (typeof currentContainers === 'number') machine.currentContainers = currentContainers;
        if (specs) {
            if (specs.cpu) machine.specs.cpu = specs.cpu;
            if (specs.ram) machine.specs.ram = specs.ram;
            if (specs.gpu) machine.specs.gpu = specs.gpu;
        }
        await machine.save();

        res.json({ success: true, message: 'Heartbeat received' });
    } catch (error) {
        console.error('Heartbeat error:', error);
        res.status(500).json({
            success: false,
            message: 'Heartbeat failed'
        });
    }
});

// ==================== ADMIN ROUTES ====================

// GET /api/cloud/admin/machines - List all machines
router.get('/admin/machines', authMiddleware, adminOnly, async (req, res) => {
    try {
        const machines = await HostMachine.find().sort({ createdAt: -1 });
        res.json({ success: true, data: machines });
    } catch (error) {
        console.error('List machines error:', error);
        res.status(500).json({ success: false, message: 'Failed to list machines' });
    }
});

// POST /api/cloud/admin/machines - Register a new machine
router.post('/admin/machines', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name, machineId, agentUrl, secret, specs, maxContainers } = req.body;

        if (!name || !machineId || !agentUrl || !secret) {
            return res.status(400).json({
                success: false,
                message: 'name, machineId, agentUrl, and secret are required'
            });
        }

        const existing = await HostMachine.findOne({ machineId });
        if (existing) {
            return res.status(409).json({
                success: false,
                message: 'Machine ID already exists'
            });
        }

        const machine = await HostMachine.create({
            name,
            machineId,
            agentUrl,
            secret,
            specs: specs || {},
            maxContainers: maxContainers || 5
        });

        res.status(201).json({
            success: true,
            message: 'Machine registered successfully',
            data: machine
        });
    } catch (error) {
        console.error('Register machine error:', error);
        res.status(500).json({ success: false, message: 'Failed to register machine' });
    }
});

// PUT /api/cloud/admin/machines/:id - Update machine
router.put('/admin/machines/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name, agentUrl, secret, specs, maxContainers } = req.body;

        const machine = await HostMachine.findById(req.params.id);
        if (!machine) {
            return res.status(404).json({ success: false, message: 'Machine not found' });
        }

        if (name) machine.name = name;
        if (agentUrl) machine.agentUrl = agentUrl;
        if (secret) machine.secret = secret;
        if (specs) machine.specs = { ...machine.specs, ...specs };
        if (typeof maxContainers === 'number') machine.maxContainers = maxContainers;

        await machine.save();

        res.json({
            success: true,
            message: 'Machine updated successfully',
            data: machine
        });
    } catch (error) {
        console.error('Update machine error:', error);
        res.status(500).json({ success: false, message: 'Failed to update machine' });
    }
});

// PATCH /api/cloud/admin/machines/:id/toggle - Toggle machine enabled
router.patch('/admin/machines/:id/toggle', authMiddleware, adminOnly, async (req, res) => {
    try {
        const machine = await HostMachine.findById(req.params.id);
        if (!machine) {
            return res.status(404).json({ success: false, message: 'Machine not found' });
        }

        machine.enabled = !machine.enabled;
        await machine.save();

        res.json({
            success: true,
            message: `Machine ${machine.enabled ? 'enabled' : 'disabled'}`,
            data: machine
        });
    } catch (error) {
        console.error('Toggle machine error:', error);
        res.status(500).json({ success: false, message: 'Failed to toggle machine' });
    }
});

// GET /api/cloud/admin/sessions - List sessions with filters
router.get('/admin/sessions', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;
        const filter = {};
        if (status) filter.status = status;

        const total = await CloudSession.countDocuments(filter);
        const sessions = await CloudSession.find(filter)
            .populate('userId', 'name email')
            .populate('hostMachineId', 'name machineId')
            .sort({ createdAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));

        res.json({
            success: true,
            data: sessions,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('List sessions error:', error);
        res.status(500).json({ success: false, message: 'Failed to list sessions' });
    }
});

// POST /api/cloud/admin/sessions/:id/force-end - Force end a session
router.post('/admin/sessions/:id/force-end', authMiddleware, adminOnly, async (req, res) => {
    try {
        const session = await CloudSession.findById(req.params.id)
            .populate('hostMachineId');

        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        if (session.status === 'ended') {
            return res.status(400).json({ success: false, message: 'Session already ended' });
        }

        const host = session.hostMachineId;

        // Call agent to destroy container
        try {
            await fetch(`${host.agentUrl}/api/sessions/${session.containerId}/destroy`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-agent-secret': host.secret
                }
            });
        } catch (agentError) {
            console.error('Agent destroy error (continuing anyway):', agentError);
        }

        session.status = 'ended';
        session.endedAt = new Date();
        session.endReason = 'admin_force';
        await session.save();

        await HostMachine.findByIdAndUpdate(host._id, {
            $inc: { currentContainers: -1 }
        });

        res.json({
            success: true,
            message: 'Session force-ended successfully'
        });
    } catch (error) {
        console.error('Force end session error:', error);
        res.status(500).json({ success: false, message: 'Failed to force end session' });
    }
});

export default router;
