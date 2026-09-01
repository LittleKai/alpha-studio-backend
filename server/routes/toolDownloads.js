import express from 'express';
import ToolDownload from '../models/ToolDownload.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = express.Router();

export const KNOWN_TOOLS = {
    vietyaku: 'VietYaku',
    vocabflip: 'VocabFlip',
    crm: 'Alpha CRM',
};

const VALID_PLATFORMS = ['windows', 'android', 'mac', 'linux', 'other'];

/**
 * Helper to normalize platform name
 */
export function normalizePlatform(platform) {
    const p = String(platform || '').toLowerCase().trim();
    if (VALID_PLATFORMS.includes(p)) return p;
    if (p.includes('mac') || p.includes('darwin') || p.includes('ios') || p.includes('apple')) return 'mac';
    if (p.includes('apk') || p.includes('android')) return 'android';
    if (p.startsWith('win') || p.includes('windows')) return 'windows';
    if (p.includes('linux')) return 'linux';
    return 'other';
}

/**
 * Helper to get or initialize a ToolDownload document
 */
export async function getOrCreateToolDownload(rawToolId) {
    const toolId = String(rawToolId || '').toLowerCase().trim();
    const defaultName = KNOWN_TOOLS[toolId] || (toolId.charAt(0).toUpperCase() + toolId.slice(1));

    let doc = await ToolDownload.findOne({ toolId });
    if (!doc) {
        doc = await ToolDownload.create({
            toolId,
            toolName: defaultName,
            totalDownloads: 0,
            platforms: { windows: 0, android: 0, mac: 0, linux: 0, other: 0 },
            versions: new Map(),
            lastDownloadedAt: null,
            recentDownloads: [],
        });
    }
    return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/tools/:toolId/download
 * Track a download event for a specific tool.
 */
router.post('/:toolId/download', async (req, res) => {
    try {
        const rawToolId = req.params.toolId;
        if (!rawToolId) {
            return res.status(400).json({ success: false, message: 'toolId is required' });
        }

        const toolId = String(rawToolId).toLowerCase().trim();
        const platform = normalizePlatform(req.body?.platform);
        const version = String(req.body?.version || '').trim();
        const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
        const userAgent = req.headers['user-agent'] || '';

        const now = new Date();
        const doc = await getOrCreateToolDownload(toolId);

        doc.totalDownloads = (doc.totalDownloads || 0) + 1;
        doc.platforms[platform] = (doc.platforms?.[platform] || 0) + 1;
        doc.lastDownloadedAt = now;

        if (version) {
            if (!doc.versions) doc.versions = new Map();
            const currentVersionCount = doc.versions.get(version) || 0;
            doc.versions.set(version, currentVersionCount + 1);
        }

        const newDownloadEntry = {
            platform,
            version: version || '',
            ip: typeof ip === 'string' ? ip.split(',')[0].trim() : '',
            userAgent: userAgent ? userAgent.slice(0, 200) : '',
            downloadedAt: now,
        };

        if (!doc.recentDownloads) doc.recentDownloads = [];
        doc.recentDownloads.unshift(newDownloadEntry);
        if (doc.recentDownloads.length > 50) {
            doc.recentDownloads = doc.recentDownloads.slice(0, 50);
        }

        await doc.save();

        return res.json({
            success: true,
            message: 'Download tracked',
            data: {
                toolId: doc.toolId,
                toolName: doc.toolName,
                totalDownloads: doc.totalDownloads,
                platforms: doc.platforms,
                lastDownloadedAt: doc.lastDownloadedAt,
            },
        });
    } catch (error) {
        console.error('Error tracking tool download:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error while tracking download',
        });
    }
});

/**
 * GET /api/tools/:toolId/stats
 * Public basic stats for a tool
 */
router.get('/:toolId/stats', async (req, res) => {
    try {
        const toolId = String(req.params.toolId || '').toLowerCase().trim();
        const doc = await ToolDownload.findOne({ toolId });
        if (!doc) {
            return res.json({
                success: true,
                data: {
                    toolId,
                    toolName: KNOWN_TOOLS[toolId] || toolId,
                    totalDownloads: 0,
                    platforms: { windows: 0, android: 0, mac: 0, linux: 0, other: 0 },
                    lastDownloadedAt: null,
                },
            });
        }

        return res.json({
            success: true,
            data: {
                toolId: doc.toolId,
                toolName: doc.toolName,
                totalDownloads: doc.totalDownloads,
                platforms: doc.platforms,
                lastDownloadedAt: doc.lastDownloadedAt,
            },
        });
    } catch (error) {
        console.error('Error fetching tool stats:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/tools/admin/downloads
 * Get detailed download stats for all tools
 */
router.get('/admin/downloads', authMiddleware, adminOnly, async (_req, res) => {
    try {
        // Ensure known tools exist
        for (const [toolId, toolName] of Object.entries(KNOWN_TOOLS)) {
            const existing = await ToolDownload.findOne({ toolId });
            if (!existing) {
                await ToolDownload.create({
                    toolId,
                    toolName,
                    totalDownloads: 0,
                    platforms: { windows: 0, android: 0, mac: 0, linux: 0, other: 0 },
                    versions: new Map(),
                    lastDownloadedAt: null,
                    recentDownloads: [],
                });
            }
        }

        const allTools = await ToolDownload.find({}).sort({ totalDownloads: -1 });

        let totalDownloads = 0;
        let windowsDownloads = 0;
        let androidDownloads = 0;
        let otherDownloads = 0;
        let topTool = null;
        let maxCount = -1;

        const recentActivities = [];

        const toolsData = allTools.map((t) => {
            const toolTotal = t.totalDownloads || 0;
            const win = t.platforms?.windows || 0;
            const apk = t.platforms?.android || 0;
            const mac = t.platforms?.mac || 0;
            const linux = t.platforms?.linux || 0;
            const other = t.platforms?.other || 0;

            totalDownloads += toolTotal;
            windowsDownloads += win;
            androidDownloads += apk;
            otherDownloads += (mac + linux + other);

            if (toolTotal > maxCount && toolTotal > 0) {
                maxCount = toolTotal;
                topTool = { toolId: t.toolId, toolName: t.toolName, count: toolTotal };
            }

            // Collect recent downloads for timeline
            if (Array.isArray(t.recentDownloads)) {
                for (const r of t.recentDownloads) {
                    recentActivities.push({
                        toolId: t.toolId,
                        toolName: t.toolName,
                        platform: r.platform,
                        version: r.version,
                        downloadedAt: r.downloadedAt,
                    });
                }
            }

            // Convert versions Map to object
            const versionsObj = {};
            if (t.versions instanceof Map) {
                for (const [k, v] of t.versions.entries()) {
                    versionsObj[k] = v;
                }
            } else if (t.versions && typeof t.versions === 'object') {
                Object.assign(versionsObj, t.versions);
            }

            return {
                toolId: t.toolId,
                toolName: t.toolName,
                totalDownloads: toolTotal,
                platforms: {
                    windows: win,
                    android: apk,
                    mac,
                    linux,
                    other,
                },
                versions: versionsObj,
                lastDownloadedAt: t.lastDownloadedAt,
                updatedAt: t.updatedAt,
            };
        });

        // Sort recent activities by downloadedAt desc
        recentActivities.sort((a, b) => new Date(b.downloadedAt).getTime() - new Date(a.downloadedAt).getTime());

        return res.json({
            success: true,
            data: {
                summary: {
                    totalDownloads,
                    windowsDownloads,
                    androidDownloads,
                    otherDownloads,
                    topTool,
                },
                tools: toolsData,
                recentActivities: recentActivities.slice(0, 30),
            },
        });
    } catch (error) {
        console.error('Error fetching admin tool download stats:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * PUT /api/tools/admin/downloads/:toolId
 * Update/calibrate download counts for a tool
 */
router.put('/admin/downloads/:toolId', authMiddleware, adminOnly, async (req, res) => {
    try {
        const toolId = String(req.params.toolId || '').toLowerCase().trim();
        const { totalDownloads, platforms, toolName } = req.body || {};

        const doc = await getOrCreateToolDownload(toolId);

        if (toolName && typeof toolName === 'string') {
            doc.toolName = toolName.trim();
        }

        if (typeof totalDownloads === 'number' && totalDownloads >= 0) {
            doc.totalDownloads = totalDownloads;
        }

        if (platforms && typeof platforms === 'object') {
            for (const p of VALID_PLATFORMS) {
                if (typeof platforms[p] === 'number' && platforms[p] >= 0) {
                    doc.platforms[p] = platforms[p];
                }
            }
            // If totalDownloads wasn't provided directly, sync total with sum of platforms
            if (typeof totalDownloads !== 'number') {
                doc.totalDownloads = Object.values(doc.platforms).reduce((acc, val) => acc + (val || 0), 0);
            }
        }

        await doc.save();

        return res.json({
            success: true,
            message: `Đã cập nhật số lượt tải cho ${doc.toolName}`,
            data: {
                toolId: doc.toolId,
                toolName: doc.toolName,
                totalDownloads: doc.totalDownloads,
                platforms: doc.platforms,
                lastDownloadedAt: doc.lastDownloadedAt,
                updatedAt: doc.updatedAt,
            },
        });
    } catch (error) {
        console.error('Error updating tool download count:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * POST /api/tools/admin/downloads/:toolId/reset
 * Reset download counts for a tool
 */
router.post('/admin/downloads/:toolId/reset', authMiddleware, adminOnly, async (req, res) => {
    try {
        const toolId = String(req.params.toolId || '').toLowerCase().trim();
        const doc = await getOrCreateToolDownload(toolId);

        doc.totalDownloads = 0;
        doc.platforms = { windows: 0, android: 0, mac: 0, linux: 0, other: 0 };
        doc.versions = new Map();
        doc.recentDownloads = [];
        await doc.save();

        return res.json({
            success: true,
            message: `Đã đặt lại số lượt tải cho ${doc.toolName} về 0`,
            data: {
                toolId: doc.toolId,
                toolName: doc.toolName,
                totalDownloads: 0,
                platforms: doc.platforms,
                lastDownloadedAt: doc.lastDownloadedAt,
            },
        });
    } catch (error) {
        console.error('Error resetting tool download count:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

export default router;
