import test from 'node:test';
import assert from 'node:assert/strict';

import Article from '../server/models/Article.js';
import Course from '../server/models/Course.js';
import Job from '../server/models/Job.js';
import Prompt from '../server/models/Prompt.js';

// Nội dung đăng lên web chỉ bắt buộc tiếng Việt; tiếng Anh để trống thì
// frontend hiển thị bản tiếng Việt.

const cases = [
    ['Article', Article, { title: { vi: 'Bài viết' }, category: 'about' }],
    ['Course', Course, {
        title: { vi: 'Khóa học' },
        category: 'ai-basic',
        modules: [{
            moduleId: 'm1',
            title: { vi: 'Chương 1' },
            lessons: [{ lessonId: 'l1', title: { vi: 'Bài 1' } }]
        }],
        createdBy: '000000000000000000000001'
    }],
    ['Job', Job, { title: { vi: 'Tuyển dụng' }, createdBy: '000000000000000000000001' }],
    ['Prompt', Prompt, {
        title: { vi: 'Prompt' },
        promptContent: 'xin chào',
        author: '000000000000000000000001'
    }]
];

for (const [name, Model, doc] of cases) {
    test(`${name}: bỏ trống tiêu đề tiếng Anh vẫn hợp lệ`, () => {
        const error = new Model(doc).validateSync();
        const enPaths = Object.keys(error?.errors ?? {}).filter(p => p.includes('.en'));
        assert.deepEqual(enPaths, [], `còn required trên: ${enPaths.join(', ')}`);
    });

    test(`${name}: thiếu tiêu đề tiếng Việt thì báo lỗi`, () => {
        const error = new Model({ ...doc, title: {} }).validateSync();
        assert.ok(error?.errors?.['title.vi'], 'title.vi phải là bắt buộc');
    });
}
