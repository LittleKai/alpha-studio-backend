import InteriorQuota from '../models/InteriorQuota.js';

const QUOTA_PER_DAY = 5;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function isUnlimitedRole(role) {
    return role === 'admin' || role === 'mod';
}

function getWindowStart(now = new Date()) {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    return start;
}

export function interiorQuotaCheck(bucket) {
    return async (req, res, next) => {
        if (process.env.INTERIOR_QUOTA_ENABLED === 'false') return next();
        if (!req.user) return res.status(401).json({ success: false, message: 'Chưa đăng nhập.' });
        if (isUnlimitedRole(req.user.role)) return next();

        const windowStart = getWindowStart();
        try {
            const existing = await InteriorQuota.findOne({ userId: req.user._id, bucket, windowStart });
            const used = existing?.count || 0;
            if (used >= QUOTA_PER_DAY) {
                return res.status(429).json({
                    success: false,
                    message: `Đã hết lượt ${bucket === 'analyze' ? 'phân tích' : 'render'} hôm nay (${QUOTA_PER_DAY}/ngày).`,
                    data: { used, limit: QUOTA_PER_DAY, resetAt: new Date(windowStart.getTime() + WINDOW_MS) }
                });
            }
            req._interiorQuota = { bucket, windowStart, used };
            return next();
        } catch (error) {
            console.error('Interior quota check error:', error);
            return next();
        }
    };
}

export async function commitInteriorQuota(req) {
    if (process.env.INTERIOR_QUOTA_ENABLED === 'false') return;
    if (!req._interiorQuota || !req.user || isUnlimitedRole(req.user.role)) return;
    const { bucket, windowStart } = req._interiorQuota;
    try {
        await InteriorQuota.findOneAndUpdate(
            { userId: req.user._id, bucket, windowStart },
            { $inc: { count: 1 } },
            { upsert: true, new: true }
        );
    } catch (error) {
        console.error('Interior quota commit error:', error);
    }
}
