import express from 'express';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import PageVisit, { RETENTION_DAYS } from '../models/PageVisit.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// The beacon is public and writes to the DB — cap it well above real browsing speed.
const trackLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many analytics events.' },
});

// Reports are grouped by Vietnam local days, not UTC days.
const REPORT_TIMEZONE = 'Asia/Ho_Chi_Minh';

const BOT_PATTERN = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python-requests|axios|node-fetch|postman|semrush|ahrefs|mj12|dotbot|petalbot|yandex|applebot|duckduckbot/i;

const SEARCH_ENGINES = ['google.', 'bing.', 'yahoo.', 'duckduckgo.', 'coccoc.', 'baidu.', 'yandex.', 'ecosia.', 'brave.'];
const SOCIAL_NETWORKS = ['facebook.', 'instagram.', 'tiktok.', 'youtube.', 'youtu.be', 'zalo.', 'twitter.', 'x.com', 'linkedin.', 'pinterest.', 'reddit.', 't.co', 'threads.'];
const PAID_MEDIUMS = ['cpc', 'ppc', 'paid', 'paidsearch', 'paid-search', 'cpm', 'cpv', 'display', 'banner', 'retargeting'];

/** Hosts that count as "our own site" so internal navigation is not logged as a referral. */
const SELF_HOSTS = ['giaiphapsangtao.com', 'alpha-studio', 'localhost', '127.0.0.1', 'vercel.app'];

export function isBotUserAgent(userAgent) {
    if (!userAgent) return true; // no UA at all is almost always a script
    return BOT_PATTERN.test(String(userAgent));
}

export function parseUserAgent(rawUa) {
    const lower = String(rawUa || '').toLowerCase();

    let device = 'desktop';
    if (/ipad|tablet|playbook|silk|kindle/.test(lower) || (/android/.test(lower) && !/mobile/.test(lower))) {
        device = 'tablet';
    } else if (/mobi|iphone|ipod|android|blackberry|windows phone|opera mini/.test(lower)) {
        device = 'mobile';
    }

    let browser = 'other';
    if (/coc_coc_browser/.test(lower)) browser = 'Coc Coc';
    else if (/edg\//.test(lower)) browser = 'Edge';
    else if (/opr\/|opera/.test(lower)) browser = 'Opera';
    else if (/samsungbrowser/.test(lower)) browser = 'Samsung Internet';
    else if (/firefox|fxios/.test(lower)) browser = 'Firefox';
    else if (/chrome|crios/.test(lower)) browser = 'Chrome';
    else if (/safari/.test(lower)) browser = 'Safari';

    let os = 'other';
    if (/windows/.test(lower)) os = 'Windows';
    else if (/android/.test(lower)) os = 'Android';
    else if (/iphone|ipad|ipod/.test(lower)) os = 'iOS';
    else if (/mac os x|macintosh/.test(lower)) os = 'macOS';
    else if (/linux|ubuntu|x11/.test(lower)) os = 'Linux';

    return { device, browser, os };
}

export function hostFromUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    try {
        return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return '';
    }
}

export function isSelfHost(host) {
    const value = String(host || '').toLowerCase();
    if (!value) return false;
    return SELF_HOSTS.some((self) => value.includes(self));
}

/**
 * Maps an acquisition signal set to a marketing channel.
 * Google Ads traffic lands in `paid-search` (gclid, or utm_medium=cpc).
 */
export function classifyChannel({ referrerHost = '', utmSource = '', utmMedium = '', gclid = '' } = {}) {
    const medium = String(utmMedium || '').toLowerCase();
    const source = String(utmSource || '').toLowerCase();
    const host = String(referrerHost || '').toLowerCase();

    if (gclid) return 'paid-search';
    if (PAID_MEDIUMS.includes(medium)) {
        return ['display', 'banner', 'cpm'].includes(medium) ? 'paid-social' : 'paid-search';
    }
    if (medium === 'email' || source === 'email' || source === 'newsletter') return 'email';
    if (medium === 'social') return 'social';
    if (source) return 'campaign';

    if (!host || isSelfHost(host)) return 'direct';
    if (SEARCH_ENGINES.some((s) => host.includes(s))) return 'organic-search';
    if (SOCIAL_NETWORKS.some((s) => host.includes(s))) return 'social';
    return 'referral';
}

/**
 * Collapses volatile id segments so `/students/<objectId>` groups into one row.
 * Slugs are kept - they are the readable part of the URL.
 */
export function normalizePath(rawPath) {
    let value = String(rawPath || '/').split('?')[0].split('#')[0].trim();
    if (!value.startsWith('/')) value = `/${value}`;
    if (value.length > 1) value = value.replace(/\/+$/, '') || '/';
    if (value.length > 200) value = value.slice(0, 200);

    return value
        .split('/')
        .map((segment) => {
            if (/^[a-f0-9]{24}$/i.test(segment)) return ':id';
            if (/^\d+$/.test(segment) && segment.length > 3) return ':id';
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment)) return ':id';
            return segment;
        })
        .join('/');
}

const trim = (value, max = 120) => String(value ?? '').trim().slice(0, max);

// ─────────────────────────────────────────────────────────────────────────────
// Public tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/analytics/track
 * Fire-and-forget pageview beacon from the browser.
 */
router.post('/track', trackLimiter, async (req, res) => {
    try {
        const userAgent = req.headers['user-agent'] || '';
        if (isBotUserAgent(userAgent)) {
            return res.json({ success: true, message: 'Ignored' });
        }

        const body = req.body || {};
        const visitorId = trim(body.visitorId, 64);
        const sessionId = trim(body.sessionId, 64);
        if (!visitorId || !sessionId || !body.path) {
            return res.status(400).json({ success: false, message: 'visitorId, sessionId và path là bắt buộc' });
        }

        const referrer = trim(body.referrer, 500);
        const referrerHost = hostFromUrl(referrer);
        const utmSource = trim(body.utmSource, 80).toLowerCase();
        const utmMedium = trim(body.utmMedium, 80).toLowerCase();
        const gclid = trim(body.gclid, 200);
        const { device, browser, os } = parseUserAgent(userAgent);

        await PageVisit.create({
            visitorId,
            sessionId,
            userId: mongoose.isValidObjectId(body.userId) ? body.userId : null,
            path: normalizePath(body.path),
            title: trim(body.title, 160),
            referrer,
            referrerHost: isSelfHost(referrerHost) ? '' : referrerHost,
            channel: classifyChannel({ referrerHost, utmSource, utmMedium, gclid }),
            utmSource,
            utmMedium,
            utmCampaign: trim(body.utmCampaign, 120),
            utmContent: trim(body.utmContent, 120),
            utmTerm: trim(body.utmTerm, 120),
            gclid,
            device,
            browser,
            os,
            language: trim(body.language, 12),
            screenWidth: Number.isFinite(Number(body.screenWidth))
                ? Math.max(0, Math.min(10000, Math.round(Number(body.screenWidth))))
                : 0,
            isNewVisitor: Boolean(body.isNewVisitor),
            isSessionStart: Boolean(body.isSessionStart),
            createdAt: new Date(),
        });

        return res.json({ success: true, message: 'Đã ghi nhận' });
    } catch (error) {
        console.error('Analytics track error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin reporting
// ─────────────────────────────────────────────────────────────────────────────

router.use(authMiddleware);
router.use(adminOnly);

const countStage = (idExpr) => [
    { $group: { _id: idExpr, views: { $sum: 1 }, visitors: { $addToSet: '$visitorId' } } },
    { $project: { _id: 0, key: '$_id', views: 1, visitors: { $size: '$visitors' } } },
    { $sort: { views: -1 } },
];

async function summarize(from, to) {
    const [row] = await PageVisit.aggregate([
        { $match: { createdAt: { $gte: from, $lt: to } } },
        {
            $group: {
                _id: null,
                pageviews: { $sum: 1 },
                visitors: { $addToSet: '$visitorId' },
                sessions: { $addToSet: '$sessionId' },
                newVisitors: { $sum: { $cond: ['$isNewVisitor', 1, 0] } },
                loggedInViews: { $sum: { $cond: [{ $ifNull: ['$userId', false] }, 1, 0] } },
            },
        },
        {
            $project: {
                _id: 0,
                pageviews: 1,
                newVisitors: 1,
                loggedInViews: 1,
                visitors: { $size: '$visitors' },
                sessions: { $size: '$sessions' },
            },
        },
    ]);
    return row || { pageviews: 0, visitors: 0, sessions: 0, newVisitors: 0, loggedInViews: 0 };
}

/**
 * GET /api/analytics/overview?days=30
 * Everything the dashboard renders, in one aggregation pass.
 */
router.get('/overview', async (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), RETENTION_DAYS);
        const to = new Date();
        const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
        const prevFrom = new Date(from.getTime() - days * 24 * 60 * 60 * 1000);

        const [facets] = await PageVisit.aggregate([
            { $match: { createdAt: { $gte: from, $lte: to } } },
            {
                $facet: {
                    daily: [
                        {
                            $group: {
                                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: REPORT_TIMEZONE } },
                                views: { $sum: 1 },
                                visitors: { $addToSet: '$visitorId' },
                                sessions: { $addToSet: '$sessionId' },
                            },
                        },
                        {
                            $project: {
                                _id: 0,
                                date: '$_id',
                                views: 1,
                                visitors: { $size: '$visitors' },
                                sessions: { $size: '$sessions' },
                            },
                        },
                        { $sort: { date: 1 } },
                    ],
                    topPages: [...countStage('$path'), { $limit: 15 }],
                    channels: [
                        { $group: { _id: '$channel', views: { $sum: 1 }, sessions: { $addToSet: '$sessionId' } } },
                        { $project: { _id: 0, key: '$_id', views: 1, sessions: { $size: '$sessions' } } },
                        { $sort: { sessions: -1 } },
                    ],
                    referrers: [
                        { $match: { referrerHost: { $ne: '' } } },
                        ...countStage('$referrerHost'),
                        { $limit: 10 },
                    ],
                    campaigns: [
                        { $match: { $or: [{ utmCampaign: { $ne: '' } }, { gclid: { $ne: '' } }] } },
                        {
                            $group: {
                                _id: {
                                    source: { $cond: [{ $eq: ['$utmSource', ''] }, 'google', '$utmSource'] },
                                    medium: { $cond: [{ $eq: ['$utmMedium', ''] }, 'cpc', '$utmMedium'] },
                                    campaign: { $cond: [{ $eq: ['$utmCampaign', ''] }, '(no name)', '$utmCampaign'] },
                                },
                                views: { $sum: 1 },
                                visitors: { $addToSet: '$visitorId' },
                                sessions: { $addToSet: '$sessionId' },
                                paidClicks: { $sum: { $cond: [{ $ne: ['$gclid', ''] }, 1, 0] } },
                            },
                        },
                        {
                            $project: {
                                _id: 0,
                                source: '$_id.source',
                                medium: '$_id.medium',
                                campaign: '$_id.campaign',
                                views: 1,
                                paidClicks: 1,
                                visitors: { $size: '$visitors' },
                                sessions: { $size: '$sessions' },
                            },
                        },
                        { $sort: { sessions: -1 } },
                        { $limit: 15 },
                    ],
                    devices: countStage('$device'),
                    browsers: [...countStage('$browser'), { $limit: 8 }],
                    os: [...countStage('$os'), { $limit: 8 }],
                    languages: [{ $match: { language: { $ne: '' } } }, ...countStage('$language'), { $limit: 6 }],
                    hourly: [
                        {
                            $group: {
                                _id: { $hour: { date: '$createdAt', timezone: REPORT_TIMEZONE } },
                                views: { $sum: 1 },
                            },
                        },
                        { $project: { _id: 0, hour: '$_id', views: 1 } },
                        { $sort: { hour: 1 } },
                    ],
                    weekday: [
                        {
                            $group: {
                                _id: { $isoDayOfWeek: { date: '$createdAt', timezone: REPORT_TIMEZONE } },
                                views: { $sum: 1 },
                            },
                        },
                        { $project: { _id: 0, weekday: '$_id', views: 1 } },
                        { $sort: { weekday: 1 } },
                    ],
                    entryPages: [
                        { $match: { isSessionStart: true } },
                        ...countStage('$path'),
                        { $limit: 10 },
                    ],
                    sessionDepth: [
                        { $group: { _id: '$sessionId', views: { $sum: 1 } } },
                        {
                            $group: {
                                _id: null,
                                sessions: { $sum: 1 },
                                bounced: { $sum: { $cond: [{ $eq: ['$views', 1] }, 1, 0] } },
                                totalViews: { $sum: '$views' },
                            },
                        },
                        { $project: { _id: 0, sessions: 1, bounced: 1, totalViews: 1 } },
                    ],
                },
            },
        ]);

        const [current, previous] = await Promise.all([summarize(from, to), summarize(prevFrom, from)]);
        const depth = facets?.sessionDepth?.[0] || { sessions: 0, bounced: 0, totalViews: 0 };

        // Fill gaps so the line chart has one point per day even on quiet days.
        const dailyMap = new Map((facets?.daily || []).map((d) => [d.date, d]));
        const daily = [];
        for (let i = days - 1; i >= 0; i -= 1) {
            const day = new Date(to.getTime() - i * 24 * 60 * 60 * 1000);
            const key = day.toLocaleDateString('en-CA', { timeZone: REPORT_TIMEZONE });
            daily.push(dailyMap.get(key) || { date: key, views: 0, visitors: 0, sessions: 0 });
        }

        const channels = facets?.channels || [];
        const paidSessions = channels
            .filter((c) => c.key === 'paid-search' || c.key === 'paid-social')
            .reduce((sum, c) => sum + c.sessions, 0);

        return res.json({
            success: true,
            data: {
                range: { days, from, to },
                summary: {
                    ...current,
                    previous,
                    bounceRate: depth.sessions ? Math.round((depth.bounced / depth.sessions) * 1000) / 10 : 0,
                    pagesPerSession: depth.sessions ? Math.round((depth.totalViews / depth.sessions) * 10) / 10 : 0,
                    returningVisitors: Math.max(0, current.visitors - current.newVisitors),
                    paidSessions,
                },
                daily,
                topPages: facets?.topPages || [],
                entryPages: facets?.entryPages || [],
                channels,
                referrers: facets?.referrers || [],
                campaigns: facets?.campaigns || [],
                devices: facets?.devices || [],
                browsers: facets?.browsers || [],
                os: facets?.os || [],
                languages: facets?.languages || [],
                hourly: facets?.hourly || [],
                weekday: facets?.weekday || [],
            },
        });
    } catch (error) {
        console.error('Analytics overview error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

/**
 * GET /api/analytics/realtime
 * Visitors active in the last 5 minutes and what they are looking at.
 */
router.get('/realtime', async (_req, res) => {
    try {
        const since = new Date(Date.now() - 5 * 60 * 1000);
        const [row] = await PageVisit.aggregate([
            { $match: { createdAt: { $gte: since } } },
            {
                $facet: {
                    totals: [
                        { $group: { _id: null, views: { $sum: 1 }, visitors: { $addToSet: '$visitorId' } } },
                        { $project: { _id: 0, views: 1, visitors: { $size: '$visitors' } } },
                    ],
                    pages: [...countStage('$path'), { $limit: 8 }],
                },
            },
        ]);

        const totals = row?.totals?.[0] || { views: 0, visitors: 0 };
        return res.json({ success: true, data: { ...totals, pages: row?.pages || [], since } });
    } catch (error) {
        console.error('Analytics realtime error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

export default router;
