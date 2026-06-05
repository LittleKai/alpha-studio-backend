import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildConversationMessageQuery,
    normalizeCrmMessageType,
    withManagedConversationVisibility
} from '../../utils/crmLiveChat.js';

test('normalizeCrmMessageType accepts rich Zalo content types and falls back to unknown', () => {
    assert.equal(normalizeCrmMessageType('video'), 'video');
    assert.equal(normalizeCrmMessageType('VOICE'), 'voice');
    assert.equal(normalizeCrmMessageType('contact_card'), 'contact_card');
    assert.equal(normalizeCrmMessageType('bad-type'), 'unknown');
});

test('buildConversationMessageQuery supports before and after windows together', () => {
    const query = buildConversationMessageQuery({
        userId: 'user-1',
        conversationId: 'conversation-1',
        before: '2026-06-05T12:00:00.000Z',
        after: '2026-06-05T10:00:00.000Z'
    });

    assert.equal(query.userId, 'user-1');
    assert.equal(query.conversationId, 'conversation-1');
    assert.ok(query.createdAt.$lt instanceof Date);
    assert.ok(query.createdAt.$gt instanceof Date);
    assert.equal(query.createdAt.$lt.toISOString(), '2026-06-05T12:00:00.000Z');
    assert.equal(query.createdAt.$gt.toISOString(), '2026-06-05T10:00:00.000Z');
});

test('withManagedConversationVisibility keeps direct chats and only managed groups', () => {
    const filter = withManagedConversationVisibility(
        {
            userId: 'user-1',
            $or: [{ displayName: { $regex: 'abc', $options: 'i' } }]
        },
        [
            { accountId: 'acc-1', groupId: 'group-1' },
            { accountId: 'acc-2', groupId: 'group-2' }
        ]
    );

    assert.deepEqual(filter.$and[0], {
        userId: 'user-1',
        $or: [{ displayName: { $regex: 'abc', $options: 'i' } }]
    });
    assert.deepEqual(filter.$and[1], {
        $or: [
            { threadType: 'user' },
            { threadType: 'group', accountId: 'acc-1', threadId: 'group-1' },
            { threadType: 'group', accountId: 'acc-2', threadId: 'group-2' }
        ]
    });
});

test('withManagedConversationVisibility hides unmanaged groups when group filter is requested', () => {
    const filter = withManagedConversationVisibility(
        { userId: 'user-1', threadType: 'group' },
        []
    );

    assert.deepEqual(filter, {
        $and: [
            { userId: 'user-1', threadType: 'group' },
            { _id: { $exists: false } }
        ]
    });
});
