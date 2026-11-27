import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DAILY_CHAT_LIMIT,
    isUnlimitedChatRole,
    getChatTodayString,
    formatChatUsage,
    consumeChatQuota,
    refundChatQuota
} from '../server/routes/chat.js';

function createMockUserModel(initial = {}) {
    const state = {
        chatUsage: initial.chatUsage ? { ...initial.chatUsage } : { date: '', count: 0 }
    };

    return {
        state,
        async updateOne(filter, update) {
            const neDate = filter?.['chatUsage.date']?.$ne;
            const eqDate = filter?.['chatUsage.date'];
            const gtZero = filter?.['chatUsage.count']?.$gt === 0;
            if (neDate !== undefined && state.chatUsage.date === neDate) return { modifiedCount: 0 };
            if (typeof eqDate === 'string' && state.chatUsage.date !== eqDate) return { modifiedCount: 0 };
            if (gtZero && !(state.chatUsage.count > 0)) return { modifiedCount: 0 };

            if (update.$set) {
                if ('chatUsage.date' in update.$set) state.chatUsage.date = update.$set['chatUsage.date'];
                if ('chatUsage.count' in update.$set) state.chatUsage.count = update.$set['chatUsage.count'];
            }
            if (update.$inc && 'chatUsage.count' in update.$inc) {
                state.chatUsage.count += update.$inc['chatUsage.count'];
            }
            return { modifiedCount: 1 };
        },
        async findOneAndUpdate(filter, update) {
            const eqDate = filter?.['chatUsage.date'];
            const ltCount = filter?.['chatUsage.count']?.$lt;
            if (state.chatUsage.date !== eqDate) return null;
            if (!(state.chatUsage.count < ltCount)) return null;
            if (update.$inc && 'chatUsage.count' in update.$inc) {
                state.chatUsage.count += update.$inc['chatUsage.count'];
            }
            return { chatUsage: { ...state.chatUsage } };
        }
    };
}

test('DAILY_CHAT_LIMIT is 10 and admin/mod are unlimited', () => {
    assert.equal(DAILY_CHAT_LIMIT, 10);
    assert.equal(isUnlimitedChatRole('admin'), true);
    assert.equal(isUnlimitedChatRole('mod'), true);
    assert.equal(isUnlimitedChatRole('student'), false);
    assert.equal(isUnlimitedChatRole('partner'), false);
});

test('formatChatUsage resets count when stored date differs from Vietnam today', () => {
    const now = new Date('2026-11-27T17:30:00.000Z'); // 2026-11-28 00:30 ICT
    const today = getChatTodayString(now);
    assert.equal(today, '2026-11-28');

    assert.deepEqual(formatChatUsage({ date: '2026-11-27', count: 10 }, 'student', today), {
        used: 0,
        limit: 10,
        remaining: 10,
        unlimited: false
    });

    assert.deepEqual(formatChatUsage({ date: '2026-11-28', count: 4 }, 'student', today), {
        used: 4,
        limit: 10,
        remaining: 6,
        unlimited: false
    });

    assert.deepEqual(formatChatUsage({ date: '2026-11-28', count: 99 }, 'admin', today), {
        used: 0,
        limit: null,
        remaining: null,
        unlimited: true
    });
});

test('consumeChatQuota enforces 10 messages per day and rolls over on a new day', async () => {
    const day1 = new Date('2026-11-27T10:00:00.000Z'); // 17:00 ICT on 2026-11-27
    const UserModel = createMockUserModel();

    for (let i = 1; i <= 10; i += 1) {
        const res = await consumeChatQuota('u1', 'student', { UserModel, now: day1 });
        assert.equal(res.ok, true);
        assert.equal(res.usage.used, i);
        assert.equal(res.usage.remaining, 10 - i);
    }

    const blocked = await consumeChatQuota('u1', 'student', { UserModel, now: day1 });
    assert.equal(blocked.ok, false);
    assert.deepEqual(blocked.usage, {
        used: 10,
        limit: 10,
        remaining: 0,
        unlimited: false
    });

    // Refund restores 1 turn if AI upstream failed
    await refundChatQuota('u1', 'student', { UserModel, now: day1 });
    const retried = await consumeChatQuota('u1', 'student', { UserModel, now: day1 });
    assert.equal(retried.ok, true);
    assert.equal(retried.usage.used, 10);

    // Next Vietnam day resets to 1/10
    const day2 = new Date('2026-11-27T17:05:00.000Z'); // 00:05 ICT on 2026-11-28
    const nextDay = await consumeChatQuota('u1', 'student', { UserModel, now: day2 });
    assert.equal(nextDay.ok, true);
    assert.equal(nextDay.usage.used, 1);
    assert.equal(nextDay.usage.remaining, 9);
});

test('consumeChatQuota never blocks admin or mod roles', async () => {
    const UserModel = createMockUserModel({ chatUsage: { date: getChatTodayString(), count: 100 } });
    const res = await consumeChatQuota('admin1', 'admin', { UserModel });
    assert.equal(res.ok, true);
    assert.equal(res.usage.unlimited, true);
    assert.equal(UserModel.state.chatUsage.count, 100);
});
