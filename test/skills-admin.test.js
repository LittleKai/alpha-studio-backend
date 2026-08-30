import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeSkillInput } from '../server/routes/skills.js';

// ─── partial update ────────────────────────────────────────────────────────

test('chỉ đưa vào $set những field có mặt trong body', () => {
    const { update, error } = sanitizeSkillInput({ name: 'SEO Auditor' });
    assert.equal(error, undefined);
    assert.deepEqual(update, { name: 'SEO Auditor' });
});

test('cắt khoảng trắng thừa của field chuỗi', () => {
    const { update } = sanitizeSkillInput({ headline_vi: '  Tối ưu SEO tự động  ' });
    assert.equal(update.headline_vi, 'Tối ưu SEO tự động');
});

test('body rỗng bị từ chối vì không có gì để cập nhật', () => {
    assert.equal(sanitizeSkillInput({}).error, 'Không có trường nào để cập nhật');
    assert.ok(sanitizeSkillInput(null).error);
    assert.ok(sanitizeSkillInput([]).error);
});

// ─── field không được phép sửa ─────────────────────────────────────────────

test('bỏ qua field ngoài whitelist — slug và _id không sửa được', () => {
    const { update } = sanitizeSkillInput({
        name: 'A',
        slug: 'slug-moi',
        _id: 'gia-mao',
        createdAt: '2020-01-01'
    });
    assert.deepEqual(update, { name: 'A' });
});

// ─── validate ──────────────────────────────────────────────────────────────

test('tên rỗng bị từ chối', () => {
    assert.equal(sanitizeSkillInput({ name: '   ' }).error, 'Tên skill không được để trống');
});

test('danh mục rỗng bị từ chối', () => {
    assert.equal(sanitizeSkillInput({ category: '' }).error, 'Danh mục không được để trống');
});

test('tier và difficulty phải nằm trong enum của model', () => {
    assert.equal(sanitizeSkillInput({ tier: 'Platinum' }).error, 'Cấp độ (tier) không hợp lệ');
    assert.equal(sanitizeSkillInput({ difficulty: 'Expert' }).error, 'Độ khó không hợp lệ');
    assert.equal(sanitizeSkillInput({ tier: 'Gold' }).error, undefined);
    assert.equal(sanitizeSkillInput({ difficulty: '' }).error, undefined);
});

test('field chuỗi nhận sai kiểu bị từ chối', () => {
    assert.equal(sanitizeSkillInput({ author: 42 }).error, 'Trường author phải là chuỗi');
});

test('github_stars phải là số không âm và được làm tròn', () => {
    assert.equal(sanitizeSkillInput({ github_stars: -1 }).error, 'Số sao GitHub không hợp lệ');
    assert.equal(sanitizeSkillInput({ github_stars: 'nhiều' }).error, 'Số sao GitHub không hợp lệ');
    assert.equal(sanitizeSkillInput({ github_stars: 12.6 }).update.github_stars, 13);
    assert.equal(sanitizeSkillInput({ github_stars: '250' }).update.github_stars, 250);
});

// ─── mảng ──────────────────────────────────────────────────────────────────

test('works_with và tags bỏ phần tử rỗng, cắt trắng, khử trùng lặp', () => {
    const { update } = sanitizeSkillInput({
        works_with: ['  Claude ', '', 'Claude', 'Cursor'],
        tags: ['seo', 'seo', '   ']
    });
    assert.deepEqual(update.works_with, ['Claude', 'Cursor']);
    assert.deepEqual(update.tags, ['seo']);
});

test('mảng sai kiểu bị từ chối', () => {
    assert.equal(sanitizeSkillInput({ tags: 'seo' }).error, 'Trường tags phải là mảng chuỗi');
});

// ─── sections ──────────────────────────────────────────────────────────────

test('sections được làm phẳng thành dotted path để không ghi đè nhánh khác', () => {
    const { update } = sanitizeSkillInput({
        sections: { overview_vi: 'Tổng quan', requirements: ['Node 20', '', 'Node 20'] }
    });
    assert.deepEqual(update, {
        'sections.overview_vi': 'Tổng quan',
        'sections.requirements': ['Node 20']
    });
});

test('sections giữ nguyên khoảng trắng của nội dung dài', () => {
    const { update } = sanitizeSkillInput({ sections: { usage: '  line1\n  line2  ' } });
    assert.equal(update['sections.usage'], '  line1\n  line2  ');
});

test('sections sai kiểu bị từ chối', () => {
    assert.equal(sanitizeSkillInput({ sections: 'abc' }).error, 'Trường sections phải là object');
    assert.equal(
        sanitizeSkillInput({ sections: { setup: 5 } }).error,
        'Trường sections.setup phải là chuỗi'
    );
    assert.equal(
        sanitizeSkillInput({ sections: { related_skills: 'a' } }).error,
        'Trường sections.related_skills phải là mảng chuỗi'
    );
});

test('sections rỗng không tạo update giả', () => {
    assert.equal(sanitizeSkillInput({ sections: {} }).error, 'Không có trường nào để cập nhật');
});
