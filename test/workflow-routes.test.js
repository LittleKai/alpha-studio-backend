import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildUserSearchRegex,
    canAccessProject,
    canManageWorkflowDocument,
    isProjectManagerOrAdmin,
    resolveDocumentUpdateAccess,
    resolveProjectUpdateAccess,
} from '../server/routes/workflow.js';

// ─── buildUserSearchRegex ──────────────────────────────────────────────────

test('buildUserSearchRegex từ chối chuỗi quá ngắn hoặc sai kiểu', () => {
    assert.equal(buildUserSearchRegex(''), null);
    assert.equal(buildUserSearchRegex('   '), null);
    assert.equal(buildUserSearchRegex('a'), null);
    assert.equal(buildUserSearchRegex(null), null);
    assert.equal(buildUserSearchRegex(undefined), null);
});

test('buildUserSearchRegex thoát ký tự đặc biệt regex tránh lỗi SyntaxError / ReDoS', () => {
    const regex = buildUserSearchRegex('  [admin](test).*+?^${}|\\  ');
    assert.ok(regex instanceof RegExp);
    assert.equal(regex.test('[admin](test).*+?^${}|\\'), true);
    assert.equal(regex.test('admin'), false);
});

test('buildUserSearchRegex cắt chuỗi tối đa 64 ký tự', () => {
    const longInput = 'a'.repeat(100);
    const regex = buildUserSearchRegex(longInput);
    assert.ok(regex instanceof RegExp);
    assert.equal(regex.source.length, 64);
});

// ─── resolveProjectUpdateAccess ────────────────────────────────────────────

const sampleProject = {
    createdBy: 'u-creator',
    team: [
        { id: 'u-creator', name: 'Creator', projectRole: 'creator' },
        { id: 'u-manager', name: 'Manager', projectRole: 'manager' },
        { id: 'u-member', name: 'Member', projectRole: '' },
    ],
};

test('creator, manager, mod và admin được phép cập nhật toàn bộ trường dự án', () => {
    for (const user of [
        { _id: 'u-creator', role: 'student' },
        { _id: 'u-manager', role: 'student' },
        { _id: 'u-mod', role: 'mod' },
        { _id: 'u-admin', role: 'admin' },
    ]) {
        assert.equal(isProjectManagerOrAdmin(sampleProject, user), true);
        const res = resolveProjectUpdateAccess(sampleProject, user, {
            name: 'New Name',
            budget: 5000000,
            team: sampleProject.team,
        });
        assert.equal(res.allowed, true);
        assert.equal(res.allowedFields.includes('name'), true);
        assert.equal(res.allowedFields.includes('team'), true);
    }
});

test('thành viên thường được phép cập nhật tasks, progress, expenses, expenseLog và chatHistory', () => {
    const member = { _id: 'u-member', role: 'student' };
    const res = resolveProjectUpdateAccess(sampleProject, member, {
        tasks: [{ id: 't1', title: 'Task 1' }],
        progress: 60,
        expenses: 100000,
        expenseLog: [{ id: 'e1', name: 'In ấn', amount: 100000 }],
        chatHistory: [{ id: 'c1', author: 'Member', text: 'Done' }],
    });
    assert.equal(res.allowed, true);
});

test('thành viên thường được phép tự rời dự án nhưng không được xóa người khác hoặc sửa ngân sách', () => {
    const member = { _id: 'u-member', role: 'student' };

    const leaveRes = resolveProjectUpdateAccess(sampleProject, member, {
        team: [
            { id: 'u-creator', name: 'Creator', projectRole: 'creator' },
            { id: 'u-manager', name: 'Manager', projectRole: 'manager' },
        ],
        chatHistory: [{ id: 'sys-1', author: 'System', text: 'Member left', isSystem: true }],
    });
    assert.equal(leaveRes.allowed, true);
    assert.equal(leaveRes.allowedFields.includes('team'), true);

    const kickOtherRes = resolveProjectUpdateAccess(sampleProject, member, {
        team: [
            { id: 'u-creator', name: 'Creator', projectRole: 'creator' },
            { id: 'u-member', name: 'Member', projectRole: '' },
        ],
    });
    assert.equal(kickOtherRes.allowed, false);

    const budgetRes = resolveProjectUpdateAccess(sampleProject, member, {
        budget: 99999999,
    });
    assert.equal(budgetRes.allowed, false);
});

test('người ngoài dự án bị từ chối mọi cập nhật', () => {
    const outsider = { _id: 'u-outsider', role: 'student' };
    assert.equal(canAccessProject(sampleProject, outsider), false);
    assert.equal(
        resolveProjectUpdateAccess(sampleProject, outsider, { chatHistory: [] }).allowed,
        false
    );
});

// ─── resolveDocumentUpdateAccess & canManageWorkflowDocument ───────────────

const sampleDoc = {
    createdBy: 'u-member',
    projectId: 'proj-1',
};

test('chủ sở hữu tài liệu và admin/mod có toàn quyền sửa và xóa tài liệu', () => {
    for (const user of [
        { _id: 'u-member', role: 'student' },
        { _id: 'u-mod', role: 'mod' },
        { _id: 'u-admin', role: 'admin' },
    ]) {
        const access = resolveDocumentUpdateAccess(sampleDoc, sampleProject, user);
        assert.equal(access.allowed, true);
        assert.equal(access.allowedFields.includes('url'), true);
        assert.equal(canManageWorkflowDocument(sampleDoc, sampleProject, user), true);
    }
});

test('project creator và project manager được duyệt/ghi chú/xóa tài liệu dự án nhưng không ghi đè url/fileKey', () => {
    for (const user of [
        { _id: 'u-creator', role: 'student' },
        { _id: 'u-manager', role: 'student' },
    ]) {
        const access = resolveDocumentUpdateAccess(sampleDoc, sampleProject, user);
        assert.equal(access.allowed, true);
        assert.deepEqual(access.allowedFields, ['status', 'comments', 'note']);
        assert.equal(canManageWorkflowDocument(sampleDoc, sampleProject, user), true);
    }
});

test('thành viên thường khác không được sửa hoặc xóa tài liệu của người khác', () => {
    const otherUser = { _id: 'u-other', role: 'student' };
    assert.equal(resolveDocumentUpdateAccess(sampleDoc, sampleProject, otherUser).allowed, false);
    assert.equal(canManageWorkflowDocument(sampleDoc, sampleProject, otherUser), false);
});
