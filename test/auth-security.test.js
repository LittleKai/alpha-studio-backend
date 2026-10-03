import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Dummy values only. No application startup, database, or mail transport calls.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'auth-security-regression-dummy-secret-only';
const { default: User } = await import('../server/models/User.js');
const { default: router } = await import('../server/routes/auth.js');
const { generateToken, generateMediaToken, getUserFromToken, authMiddleware, mediaTokenMiddleware } = await import('../server/middleware/auth.js');
const { checkIsMod } = await import('../server/utils/authRole.js');

const userId = '000000000000000000000001';
const fixture = (extra = {}) => new User({
    _id: userId, email: 'dummy@example.test', name: 'Dummy',
    password: 'dummy-password', ...extra
});
const handler = (path, method) => {
    const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
    return route.stack.at(-1).handle;
};
const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; },
    cookie() { return this; },
    clearCookie(name) { this.clearedCookie = name; return this; }
});
const mockLookup = (t, read) => t.mock.method(User, 'findById', () => ({
    select: () => Promise.resolve(read())
}));

test('user JSON excludes reset credentials even when explicitly loaded', () => {
    const user = fixture({ passwordResetCode: '123456', passwordResetExpires: new Date(), tokenVersion: 4 });
    const json = JSON.parse(JSON.stringify(user));
    assert.equal(json.email, 'dummy@example.test');
    for (const key of ['password', 'passwordResetCode', 'passwordResetExpires', 'tokenVersion']) {
        assert.equal(Object.hasOwn(json, key), false);
    }
    assert.equal(User.schema.path('passwordResetCode').options.select, false);
    assert.equal(User.schema.path('passwordResetExpires').options.select, false);
});

test('revocation rejects old header/cookie tokens and optional role checks', async t => {
    const user = fixture({ role: 'admin', tokenVersion: 3 });
    mockLookup(t, () => user);
    const token = generateToken(userId, 3);
    assert.equal((await getUserFromToken(token))._id.toString(), userId);
    assert.equal(await checkIsMod(`Bearer ${token}`), true);
    user.tokenVersion = 4;
    await assert.rejects(getUserFromToken(token), { name: 'JsonWebTokenError' });
    assert.equal(await checkIsMod(`Bearer ${token}`), false);
    for (const req of [
        { headers: { authorization: `Bearer ${token}` } },
        { headers: {}, cookies: { token } }
    ]) {
        const res = response();
        await authMiddleware(req, res, () => assert.fail('revoked token must not reach handler'));
        assert.equal(res.statusCode, 401);
    }
});

test('legacy, media, inactive and deleted identities cannot authenticate', async t => {
    let user = fixture();
    mockLookup(t, () => user);
    const legacy = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
    await assert.rejects(getUserFromToken(legacy), { name: 'JsonWebTokenError' });
    await assert.rejects(getUserFromToken(generateMediaToken(userId, 'dummy-gen', 0)), { name: 'JsonWebTokenError' });
    user.isActive = false;
    await assert.rejects(getUserFromToken(generateToken(userId)), { name: 'JsonWebTokenError' });
    user = null;
    await assert.rejects(getUserFromToken(generateToken(userId)), { name: 'JsonWebTokenError' });
});

test('logout persists revocation before returning success', async t => {
    const user = fixture();
    mockLookup(t, () => user);
    t.mock.method(User, 'updateOne', async (filter, update) => {
        assert.equal(String(filter._id), userId);
        user.tokenVersion += update.$inc.tokenVersion;
        return { matchedCount: 1 };
    });
    const token = generateToken(userId);
    const res = response();
    await handler('/logout', 'post')({ user }, res);
    assert.equal(res.body.success, true);
    assert.equal(res.clearedCookie, 'token');
    await assert.rejects(getUserFromToken(token), { name: 'JsonWebTokenError' });
});

test('media tokens are item-scoped and invalid after account revocation', async t => {
    const user = fixture({ tokenVersion: 2 });
    mockLookup(t, () => user);
    const token = generateMediaToken(userId, 'dummy-gen', 0, 1800, 2);
    const req = { headers: {}, query: { t: token }, params: { genId: 'dummy-gen', itemIdx: '0' } };
    let authorized = false;
    await mediaTokenMiddleware(req, response(), () => { authorized = true; });
    assert.equal(authorized, true);
    const wrongItem = response();
    await mediaTokenMiddleware({ ...req, params: { genId: 'dummy-gen', itemIdx: '1' } }, wrongItem,
        () => assert.fail('wrong item must be denied'));
    assert.equal(wrongItem.statusCode, 401);
    user.tokenVersion++;
    const revoked = response();
    await mediaTokenMiddleware(req, revoked, () => assert.fail('revoked media must be denied'));
    assert.equal(revoked.statusCode, 401);
});

test('login after revocation issues a token with the current version', async t => {
    const user = fixture({ tokenVersion: 7, password: await bcrypt.hash('dummy-password', 4), passwordResetCode: '123456' });
    t.mock.method(User, 'findOne', async () => user);
    t.mock.method(User, 'updateOne', async () => ({ matchedCount: 1 }));
    mockLookup(t, () => user);
    const res = response();
    await handler('/login', 'post')({ body: { email: user.email, password: 'dummy-password' } }, res);
    assert.equal(res.body.success, true);
    assert.equal(Object.hasOwn(res.body.data.user, 'passwordResetCode'), false);
    assert.equal((await getUserFromToken(res.body.data.token)).tokenVersion, 7);
});

test('failed revocation must not return successful logout', async t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(User, 'updateOne', async () => { throw new Error('dummy write failure'); });
    const res = response();
    await handler('/logout', 'post')({ user: fixture() }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
});

test('concurrent password changes permit one write and revoke all old tokens', async t => {
    const oldHash = await bcrypt.hash('old-dummy-password', 4);
    const state = { password: oldHash, tokenVersion: 0, passwordResetCode: '123456', passwordResetExpires: new Date() };
    t.mock.method(User, 'findById', () => {
        const user = fixture({ ...state });
        return { then: (resolve, reject) => Promise.resolve(user).then(resolve, reject), select: async () => user };
    });
    let writes = 0;
    t.mock.method(User, 'findOneAndUpdate', async (filter, update) => {
        assert.equal(filter.isActive, true);
        assert.ok(filter.$or.some(condition => condition.tokenVersion === 0));
        if (filter.password !== state.password || state.tokenVersion !== 0) return null;
        Object.assign(state, update.$set);
        state.tokenVersion += update.$inc.tokenVersion;
        writes++;
        return fixture({ ...state });
    });
    const oldToken = generateToken(userId);
    const first = response();
    const second = response();
    const request = newPassword => ({ user: fixture(), body: { currentPassword: 'old-dummy-password', newPassword } });
    await Promise.all([
        handler('/password', 'put')(request('first-new-dummy-password'), first),
        handler('/password', 'put')(request('second-new-dummy-password'), second)
    ]);
    assert.equal(writes, 1);
    assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 401]);
    const winner = first.statusCode === 200 ? first : second;
    assert.equal(winner.clearedCookie, 'token');
    assert.equal(state.passwordResetCode, null);
    assert.equal(state.passwordResetExpires, null);
    const winningPassword = first.statusCode === 200 ? 'first-new-dummy-password' : 'second-new-dummy-password';
    assert.equal(await bcrypt.compare(winningPassword, state.password), true);
    await assert.rejects(getUserFromToken(oldToken), { name: 'JsonWebTokenError' });
    assert.equal((await getUserFromToken(generateToken(userId, state.tokenVersion)))._id.toString(), userId);
});

test('wrong current password cannot change password or session version', async t => {
    const user = fixture({ password: await bcrypt.hash('correct-dummy-password', 4) });
    t.mock.method(User, 'findById', async () => user);
    t.mock.method(User, 'findOneAndUpdate', () => assert.fail('must not update'));
    const res = response();
    await handler('/password', 'put')({ user, body: { currentPassword: 'wrong-dummy-password', newPassword: 'new-dummy-password' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(user.tokenVersion, 0);
});

test('registration unexpected errors never expose internal messages', async t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(User, 'findOne', async () => { throw new Error('dummy-internal-detail'); });
    const res = response();
    await handler('/register', 'post')({ body: { email: 'dummy@example.test', password: 'dummy-password', name: 'Dummy' } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, 'Server error during registration');
});
