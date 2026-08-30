import test from 'node:test';
import assert from 'node:assert/strict';

import {
    canManageAttachments,
    sanitizeAttachments,
    MAX_ATTACHMENTS
} from '../server/routes/prompts.js';

const ADMIN = { _id: 'a1', role: 'admin' };
const MOD = { _id: 'm1', role: 'mod' };
const STUDENT = { _id: 's1', role: 'student' };
const PARTNER = { _id: 'p1', role: 'partner' };

// ─── ai được gắn tệp ───────────────────────────────────────────────────────

test('chỉ admin và mod được gắn tệp vào prompt', () => {
    assert.equal(canManageAttachments(ADMIN), true);
    assert.equal(canManageAttachments(MOD), true);
    assert.equal(canManageAttachments(STUDENT), false);
    assert.equal(canManageAttachments(PARTNER), false);
});

test('khách chưa đăng nhập không gắn được tệp', () => {
    assert.equal(canManageAttachments(null), false);
    assert.equal(canManageAttachments(undefined), false);
    assert.equal(canManageAttachments({}), false);
});

// ─── chuẩn hoá danh sách tệp ───────────────────────────────────────────────

test('sanitizeAttachments giữ đúng 5 field và ép về chuỗi', () => {
    const [a] = sanitizeAttachments([{
        name: 'workflow.json',
        url: 'https://b2/prompts/workflow.json',
        fileKey: 'prompts/workflow.json',
        size: 12345,
        mime: 'application/json',
        // field lạ phải bị bỏ
        evil: '<script>'
    }]);

    assert.deepEqual(Object.keys(a).sort(), ['fileKey', 'mime', 'name', 'size', 'url']);
    assert.equal(a.size, '12345', 'size ép về chuỗi');
    assert.equal(a.url, 'https://b2/prompts/workflow.json');
});

test('bỏ mục thiếu url — không có url thì không có gì để tải', () => {
    const out = sanitizeAttachments([
        { name: 'khong-co-url' },
        { name: 'trong', url: '   ' },
        { name: 'ok', url: 'https://b2/prompts/a.zip' }
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'ok');
});

test('url được trim, field thiếu thành chuỗi rỗng', () => {
    const [a] = sanitizeAttachments([{ url: '  https://b2/prompts/b.pdf  ' }]);
    assert.equal(a.url, 'https://b2/prompts/b.pdf');
    assert.equal(a.name, '');
    assert.equal(a.fileKey, '');
});

test('cắt ở MAX_ATTACHMENTS để document không phình', () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 7 }, (_, i) => ({ url: `https://b2/p/${i}` }));
    assert.equal(sanitizeAttachments(many).length, MAX_ATTACHMENTS);
});

test('đầu vào không phải mảng trả về mảng rỗng', () => {
    assert.deepEqual(sanitizeAttachments(undefined), []);
    assert.deepEqual(sanitizeAttachments(null), []);
    assert.deepEqual(sanitizeAttachments('https://b2/x'), []);
    assert.deepEqual(sanitizeAttachments([null, undefined]), []);
});
