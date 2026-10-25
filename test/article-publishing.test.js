import test from 'node:test';
import assert from 'node:assert/strict';
import Article from '../server/models/Article.js';

test('news cannot be published with an empty body, while drafts and real content remain valid', async () => {
    const article = new Article({ title: { vi: 'Tin tức' }, category: 'news', status: 'published', content: { vi: '<p>&nbsp;</p>' } });
    await assert.rejects(article.validate(), /nội dung/i);
    article.status = 'draft';
    await article.validate();
    article.status = 'published';
    article.content.vi = '<p>Dự án thiết kế thực tế.</p>';
    await article.validate();
});
