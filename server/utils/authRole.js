export async function checkIsMod(authHeader) {
    try {
        const token = authHeader.replace('Bearer ', '');
        const { getUserFromToken } = await import('../middleware/auth.js');
        const user = await getUserFromToken(token);
        return Boolean(user && (user.role === 'admin' || user.role === 'mod'));
    } catch {
        return false;
    }
}
