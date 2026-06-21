import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildChatbotConfigSnapshot,
    hasHandoffKeyword,
    matchChatbotRule,
    normalizeChatbotDebounceSeconds
} from '../crmChatbot.js';

test('handoff and rule matching ignore Vietnamese accents and case', () => {
    assert.equal(
        hasHandoffKeyword({ handoffKeywords: ['gap nhan vien'] }, 'GẶP NHÂN VIÊN'),
        true
    );
    assert.equal(
        matchChatbotRule(
            { keywords: ['báo giá'], matchMode: 'contains' },
            'Xin BAO GIA'
        ),
        true
    );
});

test('rule business hours are honored', () => {
    assert.equal(
        matchChatbotRule({
            keywords: ['price'],
            businessHours: {
                enabled: true,
                timezone: 'Asia/Ho_Chi_Minh',
                days: [4],
                start: '08:00',
                end: '18:00'
            }
        }, 'price', new Date('2026-06-11T03:00:00.000Z')),
        true
    );
});

test('snapshot deduplicates scope keys', () => {
    const snapshot = buildChatbotConfigSnapshot({
        settings: { enabled: true },
        rules: [],
        crmThreadKeys: ['a:b', 'a:b'],
        selectedGroupKeys: [],
        version: 'v1'
    });
    assert.deepEqual(snapshot.scope.crmThreadKeys, ['a:b']);
});

test('chatbot debounce is normalized to the supported range', () => {
    assert.equal(normalizeChatbotDebounceSeconds(undefined), 20);
    assert.equal(normalizeChatbotDebounceSeconds('invalid'), 20);
    assert.equal(normalizeChatbotDebounceSeconds(5), 10);
    assert.equal(normalizeChatbotDebounceSeconds(30), 30);
    assert.equal(normalizeChatbotDebounceSeconds(200), 120);
});
