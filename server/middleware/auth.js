import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'alpha-studio-secret-key-2025';

// Generate JWT token
export const generateToken = (userId) => {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
};

// Verify JWT token
export const verifyToken = (token) => {
    return jwt.verify(token, JWT_SECRET);
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

        // Verify token
        const decoded = verifyToken(token);

        // Find user
        const user = await User.findById(decoded.userId).select('-password');

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token. User not found.'
            });
        }

        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                message: 'Account is deactivated.'
            });
        }

        req.user = user;
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
export const generateMediaToken = (userId, genId, itemIdx, ttlSeconds = 1800) => {
    return jwt.sign(
        { userId: String(userId), scope: 'media', genId: String(genId), itemIdx: Number(itemIdx) },
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
                && decoded.genId === String(req.params.genId)
                && Number(decoded.itemIdx) === urlIdx
            ) {
                const user = await User.findById(decoded.userId).select('-password');
                if (user && user.isActive) {
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
