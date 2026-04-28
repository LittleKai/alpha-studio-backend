import express from 'express';
import crypto from 'crypto';
import { authMiddleware, generateMediaToken, mediaTokenMiddleware } from '../middleware/auth.js';
import User from '../models/User.js';
import FlowServer from '../models/FlowServer.js';
import StudioGeneration from '../models/StudioGeneration.js';
import { uploadFile, deleteFile, generatePresignedDownloadUrl } from '../utils/b2Storage.js';

const router = express.Router();

// ─── Quotas ─────────────────────────────────────────────────────────────────

const DAILY_LIMIT_LEGACY = 3;
const DAILY_LIMIT_IMAGE = 5;
const DAILY_LIMIT_VIDEO = 1;

const VALID_IMAGE_MODELS = ['banana2', 'banana-pro'];
const VALID_IMAGE_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const VALID_VIDEO_MODELS = [
    'veo', 'veo-fast', 'veo-quality', 'veo-lite',
    'veo-fast-lp', 'veo-lite-lp',
    'veo-r2v',
];
const VALID_VIDEO_RATIOS = ['16:9', '9:16'];

function getTodayString() {
    return new Date().toISOString().slice(0, 10);
}

function isUnlimited(role) {
    return role === 'admin' || role === 'mod';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function pickFlowServer() {
    const candidates = await FlowServer.find({
        status: 'available',
        enabled: true,
        tokenValid: true
    });
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
}

async function agentFetch(server, path, init = {}) {
    const url = `${server.agentUrl.replace(/\/$/, '')}${path}`;
    const headers = {
        ...(init.headers || {}),
        'x-agent-secret': server.secret,
    };
    return fetch(url, { ...init, headers });
}

// Extract a B2 object key from a public URL. Mirrors the same helper in
// admin.js so we can clean up reference-image uploads after gen completes.
function extractB2KeyFromUrl(url) {
    if (!url) return null;
    const cdnBase = process.env.CDN_BASE_URL;
    if (cdnBase && url.startsWith(cdnBase)) {
        const base = cdnBase.endsWith('/') ? cdnBase : cdnBase + '/';
        return url.slice(base.length);
    }
    const bucket = process.env.B2_BUCKET_NAME;
    const pattern = `.backblazeb2.com/file/${bucket}/`;
    const idx = url.indexOf(pattern);
    if (idx !== -1) return url.slice(idx + pattern.length);
    return null;
}

// Call flow-agent POST /api/studio/resign and return { fifeUrl, expiresAt }.
// Returns null on any failure; caller decides how to respond to user (502 / 410).
async function resignMediaViaAgent(server, mediaName) {
    try {
        const resp = await agentFetch(server, '/api/studio/resign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mediaName }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) {
            console.warn(`[studio] resign failed for ${mediaName}: HTTP ${resp.status} ${data.error || data.detail || ''}`);
            return null;
        }
        return data.data;   // { fifeUrl, expiresAt, keyName, uuid, latencyMs }
    } catch (err) {
        console.warn(`[studio] resign threw for ${mediaName}:`, err.message);
        return null;
    }
}

function requireBody(res, body, requiredKeys) {
    for (const k of requiredKeys) {
        if (body[k] === undefined || body[k] === null || body[k] === '') {
            res.status(400).json({ success: false, message: `Thiếu trường "${k}"` });
            return false;
        }
    }
    return true;
}

async function consumeQuota(userId, kind, role) {
    if (isUnlimited(role)) return { unlimited: true };

    const today = getTodayString();
    const user = await User.findById(userId).select('studioUsage');
    const sameDay = user.studioUsage?.date === today;
    const currentImage = sameDay ? (user.studioUsage?.imageCount || 0) : 0;
    const currentVideo = sameDay ? (user.studioUsage?.videoCount || 0) : 0;

    if (kind === 'image' && currentImage >= DAILY_LIMIT_IMAGE) {
        return { rejected: true, limit: DAILY_LIMIT_IMAGE, used: currentImage };
    }
    if (kind === 'video' && currentVideo >= DAILY_LIMIT_VIDEO) {
        return { rejected: true, limit: DAILY_LIMIT_VIDEO, used: currentVideo };
    }

    const update = {
        'studioUsage.date': today,
        'studioUsage.imageCount': sameDay ? currentImage : 0,
        'studioUsage.videoCount': sameDay ? currentVideo : 0,
    };
    if (kind === 'image') update['studioUsage.imageCount'] = currentImage + 1;
    else if (kind === 'video') update['studioUsage.videoCount'] = currentVideo + 1;

    await User.findByIdAndUpdate(userId, update);
    return {
        used: kind === 'image' ? currentImage + 1 : currentVideo + 1,
        limit: kind === 'image' ? DAILY_LIMIT_IMAGE : DAILY_LIMIT_VIDEO,
    };
}

async function refundQuota(userId, kind, role) {
    if (isUnlimited(role)) return;
    const field = kind === 'image' ? 'studioUsage.imageCount' : 'studioUsage.videoCount';
    await User.findByIdAndUpdate(userId, { $inc: { [field]: -1 } });
}

// Build the proxy URL returned to the frontend for each item. Includes a
// short-lived media token so <img>/<video> can load directly without needing
// an Authorization header. Backend route accepts either this token or Bearer.
// Path is relative to the /api base — the frontend prepends VITE_API_URL.
function buildPreviewUrl(userId, genId, idx) {
    const token = generateMediaToken(userId, genId, idx);
    return `/studio/media/${genId}/${idx}?t=${token}`;
}

const EXT_MIME = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp4: 'video/mp4',
};
function guessMime(ext, fallback = 'application/octet-stream') {
    return EXT_MIME[(ext || '').toLowerCase()] || fallback;
}

function serializeGeneration(gen) {
    return {
        id: gen._id,
        type: gen.type,
        model: gen.model,
        prompt: gen.prompt,
        aspectRatio: gen.aspectRatio,
        count: gen.count,
        hasReferenceImage: gen.hasReferenceImage,
        items: gen.items.map((item, idx) => ({
            index: idx,
            previewUrl: buildPreviewUrl(gen.userId, gen._id, idx),
            saved: item.saved,
            b2Url: item.saved ? item.b2Url : null,
            seed: item.seed,
            ext: item.ext,
        })),
        projectId: gen.projectId || '',
        projectTitle: gen.projectTitle || '',
        createdAt: gen.createdAt,
        expiresAt: gen.expiresAt,
    };
}

// ─── Usage ──────────────────────────────────────────────────────────────────

// GET /api/studio/usage — combined image + video quotas
router.get('/usage', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('studioUsage role');
        const today = getTodayString();

        if (isUnlimited(user.role)) {
            return res.json({
                success: true,
                data: {
                    unlimited: true,
                    image: { used: 0, limit: null, remaining: null },
                    video: { used: 0, limit: null, remaining: null },
                    legacy: { used: 0, limit: null, remaining: null }
                }
            });
        }

        const sameDay = user.studioUsage?.date === today;
        const usedLegacy = sameDay ? (user.studioUsage?.count || 0) : 0;
        const usedImage = sameDay ? (user.studioUsage?.imageCount || 0) : 0;
        const usedVideo = sameDay ? (user.studioUsage?.videoCount || 0) : 0;

        res.json({
            success: true,
            data: {
                unlimited: false,
                image: { used: usedImage, limit: DAILY_LIMIT_IMAGE, remaining: Math.max(0, DAILY_LIMIT_IMAGE - usedImage) },
                video: { used: usedVideo, limit: DAILY_LIMIT_VIDEO, remaining: Math.max(0, DAILY_LIMIT_VIDEO - usedVideo) },
                legacy: { used: usedLegacy, limit: DAILY_LIMIT_LEGACY, remaining: Math.max(0, DAILY_LIMIT_LEGACY - usedLegacy) }
            }
        });
    } catch (error) {
        console.error('Studio usage error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// POST /api/studio/use — LEGACY, kept for frontends still on old quota flow
router.post('/use', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('studioUsage role');
        const today = getTodayString();

        if (isUnlimited(user.role)) {
            return res.json({
                success: true,
                data: { used: 0, limit: null, remaining: null, unlimited: true }
            });
        }

        const sameDay = user.studioUsage?.date === today;
        const currentCount = sameDay ? (user.studioUsage?.count || 0) : 0;

        if (currentCount >= DAILY_LIMIT_LEGACY) {
            return res.status(429).json({
                success: false,
                message: `Bạn đã dùng hết ${DAILY_LIMIT_LEGACY} lần miễn phí hôm nay. Quay lại vào ngày mai!`,
                data: { used: currentCount, limit: DAILY_LIMIT_LEGACY, remaining: 0 }
            });
        }

        const newCount = currentCount + 1;
        await User.findByIdAndUpdate(req.user._id, {
            'studioUsage.date': today,
            'studioUsage.count': newCount
        });

        res.json({
            success: true,
            data: {
                used: newCount,
                limit: DAILY_LIMIT_LEGACY,
                remaining: Math.max(0, DAILY_LIMIT_LEGACY - newCount)
            }
        });
    } catch (error) {
        console.error('Studio use error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ─── Image generation ───────────────────────────────────────────────────────

router.post('/image/generate', authMiddleware, async (req, res) => {
    if (!requireBody(res, req.body, ['prompt', 'model', 'ratio'])) return;

    const { prompt, model, ratio, count = 1, seed, referenceImage, referenceImageUrl, referenceImageUrls } = req.body;

    if (!VALID_IMAGE_MODELS.includes(model)) {
        return res.status(400).json({ success: false, message: `Model không hợp lệ (${model})` });
    }
    if (!VALID_IMAGE_RATIOS.includes(ratio)) {
        return res.status(400).json({ success: false, message: `Tỷ lệ không hợp lệ (${ratio})` });
    }
    const safeCount = Math.min(Math.max(parseInt(count, 10) || 1, 1), 4);

    let quota;
    try {
        const user = await User.findById(req.user._id).select('role');
        quota = await consumeQuota(req.user._id, 'image', user.role);
        if (quota.rejected) {
            return res.status(429).json({
                success: false,
                message: `Bạn đã dùng hết ${quota.limit} lượt ảnh hôm nay. Quay lại vào ngày mai!`,
                data: { used: quota.used, limit: quota.limit, remaining: 0 }
            });
        }

        const server = await pickFlowServer();
        if (!server) {
            await refundQuota(req.user._id, 'image', user.role);
            return res.status(503).json({ success: false, message: 'Không có flow server khả dụng.' });
        }

        // Swap each B2 public URL for a short-lived presigned GET URL before
        // forwarding to the agent. CDN public URL can race with cache
        // propagation or hit auth issues; presigned URL is always accessible.
        async function presignIfPossible(url) {
            try {
                const key = extractB2KeyFromUrl(url);
                if (key && key.startsWith('studio/refs/')) {
                    return await generatePresignedDownloadUrl(key, 900);
                }
            } catch (err) {
                console.warn('[studio] presign download failed:', err?.message);
            }
            return url;
        }

        // Coalesce single + array into one array. Backend accepts either form.
        const inputUrls = [
            ...(Array.isArray(referenceImageUrls) ? referenceImageUrls : []),
            ...(referenceImageUrl ? [referenceImageUrl] : []),
        ].slice(0, 10);   // hard cap matching flow-agent
        const agentRefUrls = await Promise.all(inputUrls.map(presignIfPossible));

        const agentBody = {
            prompt,
            model,
            ratio,
            count: safeCount,
            ...(seed !== undefined ? { seed: Number(seed) } : {}),
            ...(agentRefUrls.length > 0 ? { referenceImageUrls: agentRefUrls } : {}),
            ...(referenceImage ? { referenceImage } : {}),
            ...(server.projectId ? { projectId: server.projectId } : {}),
        };

        // The frontend supplies its own genId so it can start polling
        // /progress/:genId immediately, before the long-running generate
        // request returns. Fall back to a server-generated UUID if missing.
        const genId = (typeof req.body.genId === 'string' && req.body.genId)
            || crypto.randomUUID();

        let agentData;
        let agentStatus = 0;
        try {
            const agentRes = await agentFetch(server, '/api/studio/image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-gen-id': genId },
                body: JSON.stringify(agentBody),
            });
            agentStatus = agentRes.status;
            agentData = await agentRes.json().catch(() => ({}));
            if (!agentRes.ok || !agentData.success) {
                const err = new Error(agentData.detail || agentData.error || `Agent error ${agentRes.status}`);
                err.status = agentRes.status;
                err.detail = agentData.detail;
                throw err;
            }
        } catch (agentError) {
            console.error('Flow agent error (image):', agentError);
            await refundQuota(req.user._id, 'image', user.role);
            // Map flow-agent's WAB-specific status codes to user-facing messages.
            const status = agentError.status || agentStatus;
            const detail = agentError.detail;
            if (status === 412) {
                // Preflight: Chrome / project tab not in expected state.
                const reason = detail && typeof detail === 'object' ? detail.reason : null;
                let msg = 'Vui lòng mở Chrome và truy cập tab Flow project trước khi tạo ảnh.';
                if (reason === 'tab_not_project') {
                    msg = 'Hãy mở một tab Flow project (labs.google/fx/tools/flow/project/...) rồi thử lại.';
                } else if (reason === 'bridge_unreachable') {
                    msg = 'Trợ lý tự động hóa Chrome chưa kết nối. Hãy mở extension và thử lại.';
                }
                return res.status(412).json({ success: false, message: msg, reason });
            }
            if (status === 503) {
                return res.status(503).json({
                    success: false,
                    message: 'Dịch vụ tạo ảnh tạm thời không khả dụng. Hãy thử lại sau.',
                });
            }
            if (status === 422) {
                // Flow rejected the gen (content moderation, quota, model error).
                // Forward Flow's own message verbatim — already user-friendly.
                return res.status(422).json({
                    success: false,
                    message: typeof detail === 'string' ? detail
                        : 'Flow từ chối yêu cầu — chỉnh prompt và thử lại.',
                    canRetry: true,
                });
            }
            if (status === 501) {
                return res.status(501).json({
                    success: false,
                    message: typeof detail === 'string' ? detail
                        : 'Tính năng chưa hỗ trợ. Vui lòng đổi tuỳ chọn.',
                });
            }
            return res.status(502).json({ success: false, message: 'Flow agent lỗi. Hãy thử lại.' });
        }

        const result = agentData.data;
        const items = (result.items || []).filter(item => item.mediaName);
        if (items.length === 0) {
            await refundQuota(req.user._id, 'image', user.role);
            return res.status(502).json({ success: false, message: 'Flow agent không trả mediaName — cần cập nhật daemon.' });
        }
        const gen = await StudioGeneration.create({
            userId: req.user._id,
            flowServerId: server._id,
            type: 'image',
            model,
            prompt,
            aspectRatio: ratio,
            count: items.length,
            hasReferenceImage: !!referenceImage,
            batchId: result.batchId || '',
            projectId: result.projectId || '',
            projectTitle: result.projectTitle || '',
            items: items.map(item => ({
                mediaName: item.mediaName,
                ext: item.ext || '',
                seed: item.seed || 0,
            })),
        });

        res.json({
            success: true,
            data: {
                ...serializeGeneration(gen),
                genId,
                quota: quota.unlimited ? null : { used: quota.used, limit: quota.limit }
            }
        });
    } catch (error) {
        console.error('Image generate error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// POST /api/studio/cancel/:genId — set the cancel flag on flow-agent so the
// in-flight WAB gen aborts on its next poll tick (~3s).
router.post('/cancel/:genId', authMiddleware, async (req, res) => {
    try {
        const server = await pickFlowServer();
        if (!server) {
            return res.json({ success: true, data: { cancelled: false, reason: 'no_server' } });
        }
        const upstream = await agentFetch(server, `/api/studio/cancel/${encodeURIComponent(req.params.genId)}`, {
            method: 'POST',
        });
        const body = await upstream.json().catch(() => ({}));
        return res.json({ success: !!body.success, data: body.data || {} });
    } catch (err) {
        console.error('Cancel proxy error:', err);
        return res.json({ success: false, data: { cancelled: false } });
    }
});

// GET /api/studio/progress/:genId — proxy to flow-agent. Returns
// { progress, status: 'starting'|'generating'|'done'|'failed'|'unknown',
//   elapsedSeconds }.
// genId is a per-request UUID; backend doesn't enforce ownership beyond
// the user's auth (the genId is opaque enough that guessing isn't useful).
router.get('/progress/:genId', authMiddleware, async (req, res) => {
    try {
        const server = await pickFlowServer();
        if (!server) {
            return res.json({ success: true, data: { status: 'unknown', genId: req.params.genId } });
        }
        const upstream = await agentFetch(server, `/api/studio/progress/${encodeURIComponent(req.params.genId)}`);
        const body = await upstream.json().catch(() => ({}));
        if (!upstream.ok || !body.success) {
            return res.json({ success: true, data: { status: 'unknown', genId: req.params.genId } });
        }
        return res.json({ success: true, data: body.data });
    } catch (err) {
        console.error('Progress proxy error:', err);
        return res.json({ success: true, data: { status: 'unknown', genId: req.params.genId } });
    }
});

// ─── Video generation ───────────────────────────────────────────────────────

router.post('/video/generate', authMiddleware, async (req, res) => {
    if (!requireBody(res, req.body, ['prompt', 'model', 'ratio'])) return;

    const {
        prompt, model, ratio, seed, referenceImage, referenceImageUrl, referenceImageUrls,
        subtype, duration, count = 1,
    } = req.body;

    if (!VALID_VIDEO_MODELS.includes(model)) {
        return res.status(400).json({ success: false, message: `Model không hợp lệ (${model})` });
    }
    if (!VALID_VIDEO_RATIOS.includes(ratio)) {
        return res.status(400).json({ success: false, message: `Tỷ lệ không hợp lệ (${ratio})` });
    }
    const safeCount = Math.min(Math.max(parseInt(count, 10) || 1, 1), 4);

    try {
        const user = await User.findById(req.user._id).select('role');
        const quota = await consumeQuota(req.user._id, 'video', user.role);
        if (quota.rejected) {
            return res.status(429).json({
                success: false,
                message: `Bạn đã dùng hết ${quota.limit} lượt video hôm nay.`,
                data: { used: quota.used, limit: quota.limit, remaining: 0 }
            });
        }

        const server = await pickFlowServer();
        if (!server) {
            await refundQuota(req.user._id, 'video', user.role);
            return res.status(503).json({ success: false, message: 'Không có flow server khả dụng.' });
        }

        // Mint a per-request gen id (or accept FE-supplied one) so the FE
        // can poll progress while WAB drives Chrome (~30-90s typical).
        const genId = (typeof req.body.genId === 'string' && req.body.genId)
            || crypto.randomUUID();

        // Swap each B2 public URL for a fresh presigned download URL (avoid
        // CDN cache races).
        async function presignIfPossible(url) {
            try {
                const key = extractB2KeyFromUrl(url);
                if (key && key.startsWith('studio/refs/')) {
                    return await generatePresignedDownloadUrl(key, 900);
                }
            } catch (err) { /* fall through */ }
            return url;
        }
        const inputUrls = [
            ...(Array.isArray(referenceImageUrls) ? referenceImageUrls : []),
            ...(referenceImageUrl ? [referenceImageUrl] : []),
        ].slice(0, 10);
        const agentRefUrls = await Promise.all(inputUrls.map(presignIfPossible));

        const agentBody = {
            prompt,
            model,
            ratio,
            ...(subtype ? { subtype } : {}),
            ...(duration ? { duration } : {}),
            ...(safeCount ? { count: safeCount } : {}),
            ...(seed !== undefined ? { seed: Number(seed) } : {}),
            ...(agentRefUrls.length > 0 ? { referenceImageUrls: agentRefUrls } : {}),
            ...(referenceImage ? { referenceImage } : {}),
            ...(server.projectId ? { projectId: server.projectId } : {}),
        };

        let agentData;
        let agentStatus = 0;
        try {
            const agentRes = await agentFetch(server, '/api/studio/video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-gen-id': genId },
                body: JSON.stringify(agentBody),
            });
            agentStatus = agentRes.status;
            agentData = await agentRes.json().catch(() => ({}));
            if (!agentRes.ok || !agentData.success) {
                const err = new Error(agentData.detail || agentData.error || `Agent error ${agentRes.status}`);
                err.status = agentRes.status;
                err.detail = agentData.detail;
                throw err;
            }
        } catch (agentError) {
            console.error('Flow agent error (video):', agentError);
            await refundQuota(req.user._id, 'video', user.role);
            const status = agentError.status || agentStatus;
            const detail = agentError.detail;
            if (status === 412) {
                const reason = detail && typeof detail === 'object' ? detail.reason : null;
                let msg = 'Vui lòng mở Chrome và truy cập tab Flow project trước khi tạo video.';
                if (reason === 'tab_not_project') msg = 'Hãy mở một tab Flow project rồi thử lại.';
                else if (reason === 'bridge_unreachable') msg = 'Trợ lý tự động hóa Chrome chưa kết nối.';
                return res.status(412).json({ success: false, message: msg, reason });
            }
            if (status === 503) return res.status(503).json({ success: false, message: 'Dịch vụ tạm thời không khả dụng.' });
            if (status === 422) return res.status(422).json({
                success: false,
                message: typeof detail === 'string' ? detail : 'Flow từ chối yêu cầu — chỉnh prompt và thử lại.',
                canRetry: true,
            });
            if (status === 501) return res.status(501).json({
                success: false,
                message: typeof detail === 'string' ? detail : 'Tính năng chưa hỗ trợ.',
            });
            return res.status(502).json({ success: false, message: 'Flow agent lỗi. Hãy thử lại.' });
        }

        const result = agentData.data;
        const items = (result.items || []).filter(item => item.mediaName);
        if (items.length === 0) {
            await refundQuota(req.user._id, 'video', user.role);
            return res.status(502).json({ success: false, message: 'Flow agent không trả mediaName — cần cập nhật daemon.' });
        }
        const gen = await StudioGeneration.create({
            userId: req.user._id,
            flowServerId: server._id,
            type: 'video',
            model,
            prompt,
            aspectRatio: ratio,
            count: items.length,
            hasReferenceImage: agentRefUrls.length > 0 || !!referenceImage,
            batchId: result.batchId || '',
            projectId: result.projectId || '',
            projectTitle: result.projectTitle || '',
            items: items.map(item => ({
                mediaName: item.mediaName,
                ext: item.ext || 'mp4',
                seed: item.seed || 0,
                durationSeconds: item.durationSeconds || null,
            })),
        });

        res.json({
            success: true,
            data: {
                ...serializeGeneration(gen),
                genId,
                quota: quota.unlimited ? null : { used: quota.used, limit: quota.limit }
            }
        });
    } catch (error) {
        console.error('Video generate error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ─── Media proxy ────────────────────────────────────────────────────────────

// GET /api/studio/media/:genId/:itemIdx
// Plan 4 lazy re-sign: browser follows a 302 to either the user's saved B2 URL
// (persisted) or a freshly-minted Google CDN signed URL (mediaName → flow-agent
// /resign). Backend never streams bytes.
router.get('/media/:genId/:itemIdx', mediaTokenMiddleware, async (req, res) => {
    try {
        const { genId, itemIdx } = req.params;
        const idx = parseInt(itemIdx, 10);
        if (!Number.isInteger(idx) || idx < 0) {
            return res.status(400).json({ success: false, message: 'Invalid item index' });
        }

        const gen = await StudioGeneration.findById(genId);
        if (!gen) return res.status(404).json({ success: false, message: 'Generation not found' });
        if (String(gen.userId) !== String(req.user._id)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const item = gen.items[idx];
        if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

        // Saved path — user has persisted to B2. Public CDN, no re-sign needed.
        if (item.saved && item.b2Url) {
            return res.redirect(302, item.b2Url);
        }

        if (!item.mediaName) {
            return res.status(410).json({ success: false, message: 'Item has no mediaName (legacy / corrupted).' });
        }

        const server = await FlowServer.findById(gen.flowServerId);
        if (!server) {
            return res.status(502).json({ success: false, message: 'Source flow server no longer registered' });
        }

        const signed = await resignMediaViaAgent(server, item.mediaName);
        if (!signed || !signed.fifeUrl) {
            return res.status(502).json({ success: false, message: 'Flow agent re-sign thất bại. Hãy thử lại hoặc lưu B2.' });
        }

        // Signed URLs are short-lived (~6h). Tell browser/CDN not to cache the
        // 302 response itself so reloads always mint a fresh URL.
        res.setHeader('Cache-Control', 'no-store, private');
        return res.redirect(302, signed.fifeUrl);
    } catch (error) {
        console.error('Media proxy error:', error);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ─── Save to B2 ─────────────────────────────────────────────────────────────

router.post('/save/:genId/:itemIdx', authMiddleware, async (req, res) => {
    try {
        const { genId, itemIdx } = req.params;
        const idx = parseInt(itemIdx, 10);

        const gen = await StudioGeneration.findById(genId);
        if (!gen) return res.status(404).json({ success: false, message: 'Generation not found' });
        if (String(gen.userId) !== String(req.user._id)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const item = gen.items[idx];
        if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
        if (item.saved) {
            return res.json({ success: true, data: { b2Url: item.b2Url, alreadySaved: true } });
        }
        if (!item.mediaName) {
            return res.status(410).json({ success: false, message: 'Item has no mediaName (legacy / corrupted).' });
        }

        const server = await FlowServer.findById(gen.flowServerId);
        if (!server) return res.status(502).json({ success: false, message: 'Source flow server unavailable' });

        // 1. Resign to get a fresh signed URL.
        const signed = await resignMediaViaAgent(server, item.mediaName);
        if (!signed || !signed.fifeUrl) {
            return res.status(502).json({ success: false, message: 'Flow agent re-sign thất bại.' });
        }

        // 2. Server-side fetch from Google CDN. Signed URL is public; no auth.
        let cdnRes;
        try {
            cdnRes = await fetch(signed.fifeUrl);
        } catch (err) {
            console.error('CDN fetch error:', err);
            return res.status(502).json({ success: false, message: 'Không tải được file từ CDN.' });
        }
        if (!cdnRes.ok) {
            return res.status(502).json({ success: false, message: `CDN trả lỗi ${cdnRes.status}` });
        }
        const buffer = Buffer.from(await cdnRes.arrayBuffer());
        const contentType = cdnRes.headers.get('content-type') || guessMime(item.ext);

        // 3. Upload to B2 under a stable key derived from generation id.
        const folder = gen.type === 'video' ? 'studio/videos' : 'studio/images';
        const b2Key = `${folder}/${gen._id}_${idx}.${item.ext || 'bin'}`;
        const { publicUrl } = await uploadFile(b2Key, buffer, contentType);

        item.saved = true;
        item.b2Key = b2Key;
        item.b2Url = publicUrl;
        item.savedAt = new Date();
        gen.markModified('items');
        await gen.save();

        res.json({ success: true, data: { b2Url: publicUrl, b2Key } });
    } catch (error) {
        console.error('Studio save error:', error);
        res.status(500).json({ success: false, message: 'Lưu file thất bại' });
    }
});

// ─── History ────────────────────────────────────────────────────────────────

// DELETE /api/studio/refs — remove a temp reference image from B2.
// FE calls this after a gen request returns (success or failure) so refs
// don't pile up. Body or query: ?key=<b2-key> or ?url=<b2-public-url>.
// Only allows deletion under the studio/refs/ prefix to prevent abuse.
router.delete('/refs', authMiddleware, async (req, res) => {
    try {
        let key = (typeof req.query.key === 'string' && req.query.key)
            || (typeof req.body?.key === 'string' && req.body.key)
            || null;
        if (!key) {
            const url = (typeof req.query.url === 'string' && req.query.url)
                || (typeof req.body?.url === 'string' && req.body.url)
                || null;
            if (url) key = extractB2KeyFromUrl(url);
        }
        if (!key) {
            return res.status(400).json({ success: false, message: 'key or url is required' });
        }
        if (!key.startsWith('studio/refs/')) {
            return res.status(403).json({ success: false, message: 'Only studio/refs/* keys can be deleted via this endpoint' });
        }
        await deleteFile(key);
        res.json({ success: true, data: { key } });
    } catch (error) {
        // Idempotent — if the file's already gone, that's success from the
        // caller's POV (intent fulfilled).
        if (error?.name === 'NoSuchKey') {
            return res.json({ success: true, data: { alreadyDeleted: true } });
        }
        console.error('Studio refs delete error:', error);
        res.status(500).json({ success: false, message: 'Xoá ảnh tham chiếu thất bại' });
    }
});

router.get('/history', authMiddleware, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const type = req.query.type;
        const filter = { userId: req.user._id };
        if (type === 'image' || type === 'video') filter.type = type;

        const rows = await StudioGeneration.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit);

        res.json({ success: true, data: rows.map(serializeGeneration) });
    } catch (error) {
        console.error('Studio history error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

export default router;
