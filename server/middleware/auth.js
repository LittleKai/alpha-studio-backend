import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET environment variable is required in production');
    }
    console.warn('[auth] JWT_SECRET not set — using a random ephemeral secret (dev/test only). Tokens will not survive restarts.');
    return crypto.randomBytes(32).toString('hex');
})();

// Generate JWT token
export const generateToken = (userId, tokenVersion = 0) => {
    return jwt.sign({ userId, scope: 'auth', tokenVersion }, JWT_SECRET, { expiresIn: '7d' });
};

// All auth consumers must check account state and revocation, not just signature.
export const getUserFromToken = async (token) => {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.scope !== 'auth' || !Number.isSafeInteger(decoded.tokenVersion) || decoded.tokenVersion < 0) {
        throw new jwt.JsonWebTokenError('Invalid auth token');
    }
    const user = await User.findById(decoded.userId).select('-password');
    if (!user || !user.isActive || decoded.tokenVersion !== (user.tokenVersion ?? 0)) {
        throw new jwt.JsonWebTokenError('Invalid or revoked auth token');
    }
    return user;
};

// Auth middleware - protect routes
export const authMiddleware = async (req, res, next) => {
    try {
        // Get token from header or cookie
        let token = req.headers.authorization?.replace('Bearer ', '');

        if (!token && req.cookies?.token) {
            token = req.cookies.token;
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.'
            });
        }

        const user = await getUserFromToken(token);

        req.user = user;

        // Throttled update of lastActiveAt (at most once every 5 minutes to minimize DB write load)
        const now = new Date();
        if (!user.lastActiveAt || (now.getTime() - new Date(user.lastActiveAt).getTime() > 5 * 60 * 1000)) {
            User.updateOne({ _id: user._id }, { $set: { lastActiveAt: now } }).exec().catch(() => {});
        }

        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token.'
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired. Please login again.'
            });
        }
        return res.status(500).json({
            success: false,
            message: 'Server error.'
        });
    }
};

// Short-lived JWT scoped to a single media item, suitable for embedding in
// <img>/<video> src attributes (Plan 4 fifeUrl direct delivery). The token is
// bound to { userId, genId, itemIdx } so leaking one URL only exposes that
// single item, for TTL seconds.
export const generateMediaToken = (userId, genId, itemIdx, ttlSeconds = 1800, tokenVersion = 0) => {
    return jwt.sign(
        { userId: String(userId), scope: 'media', tokenVersion, genId: String(genId), itemIdx: Number(itemIdx) },
        JWT_SECRET,
        { expiresIn: ttlSeconds }
    );
};

// Middleware for /media/:genId/:itemIdx — prefers a ?t=<media-token> query
// (so the browser can load the URL with <img src> and no Authorization header),
// but falls through to the normal authMiddleware for Bearer/cookie auth.
// The token is rejected unless its genId/itemIdx match the URL params.
export const mediaTokenMiddleware = async (req, res, next) => {
    const rawToken = typeof req.query?.t === 'string' ? req.query.t : '';
    if (rawToken) {
        try {
            const decoded = jwt.verify(rawToken, JWT_SECRET);
            const urlIdx = parseInt(req.params.itemIdx, 10);
            if (
                decoded?.scope === 'media'
                && Number.isSafeInteger(decoded.tokenVersion)
                && decoded.tokenVersion >= 0
                && decoded.genId === String(req.params.genId)
                && Number(decoded.itemIdx) === urlIdx
            ) {
                const user = await User.findById(decoded.userId).select('-password');
                if (user && user.isActive && decoded.tokenVersion === (user.tokenVersion ?? 0)) {
                    req.user = user;
                    return next();
                }
            }
        } catch {
            // invalid / expired → fall through to authMiddleware
        }
    }
    return authMiddleware(req, res, next);
};

// Admin only middleware
export const adminOnly = (req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Admin only.'
        });
    }
    next();
};

// Mod only middleware (allows admin and mod)
export const modOnly = (req, res, next) => {
    if (req.user?.role !== 'admin' && req.user?.role !== 'mod') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Admin or Moderator only.'
        });
    }
    next();
};
