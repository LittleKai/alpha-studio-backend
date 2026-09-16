export async function checkIsMod(authHeader) {
    try {
        const token = authHeader.replace('Bearer ', '');
        const { verifyToken } = await import('../middleware/auth.js');
        const decoded = verifyToken(token);
        const User = (await import('../models/User.js')).default;
        const user = await User.findById(decoded.userId);
        return Boolean(user && (user.role === 'admin' || user.role === 'mod'));
    } catch {
        return false;
    }
}
