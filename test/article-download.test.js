import test from 'node:test';
import assert from 'node:assert/strict';

process.env.B2_ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';
process.env.B2_ACCESS_KEY_ID = 'dummy_key';
process.env.B2_SECRET_ACCESS_KEY = 'dummy_secret';
process.env.B2_BUCKET_NAME = 'alpha-studio';
process.env.CDN_BASE_URL = 'https://download.giaiphapsangtao.com/file/alpha-studio';

const { extractB2Key } = await import('../server/routes/admin.js');
const { getAttachmentDownloadFilename } = await import('../server/routes/articles.js');
const { generatePresignedDownloadUrl, attachmentDisposition } = await import('../server/utils/b2Storage.js');

test('attachmentDisposition giữ tên tiếng Việt qua filename* và có fallback ASCII', () => {
    const header = attachmentDisposition("tủ quần áo \"v2\" (bé's).html");
    assert.equal(
        header,
        `attachment; filename="t_ qu_n _o _v2_ (b_'s).html"; filename*=UTF-8''t%E1%BB%A7%20qu%E1%BA%A7n%20%C3%A1o%20%22v2%22%20%28b%C3%A9%27s%29.html`
    );
});

test('extractB2Key bóc tách đúng fileKey từ URL B2 của bài viết dịch vụ', () => {
    const url = 'https://download.giaiphapsangtao.com/file/alpha-studio/services/tu_ao/1790780527353-tu_quan_ao_thiet_ke.html';
    const key = extractB2Key(url);
    assert.equal(key, 'services/tu_ao/1790780527353-tu_quan_ao_thiet_ke.html');
});

test('download filename lấy basename gốc từ fileKey, không lấy nhãn biên tập', () => {
    assert.equal(
        getAttachmentDownloadFilename(
            { name: 'Mô hình SketchUp tủ bếp (.skp)' },
            'services/tu_bep/1790825665162-tu_bep.skp'
        ),
        'tu_bep.skp'
    );
    assert.equal(
        getAttachmentDownloadFilename(
            { name: 'Trang HTML gửi khách (Bản vẽ tương tác)' },
            'services/tu_bep/1790825658081-tu_bep_thiet_ke.html'
        ),
        'tu_bep_thiet_ke.html'
    );
});

test('generatePresignedDownloadUrl chèn response-content-disposition khi có filename', async () => {
    const filename = 'tu_quan_ao_thiet_ke.html';
    const key = 'services/tu_ao/1790780527353-tu_quan_ao_thiet_ke.html';

    const signedUrl = await generatePresignedDownloadUrl(key, 3600, filename);
    assert.match(signedUrl, /response-content-disposition=attachment/i);
    assert.match(signedUrl, /tu_quan_ao_thiet_ke\.html/);
});

test('generatePresignedDownloadUrl không có filename thì không chèn response-content-disposition', async () => {
    const key = 'services/tu_ao/model.skp';
    const signedUrl = await generatePresignedDownloadUrl(key, 3600);
    assert.doesNotMatch(signedUrl, /response-content-disposition/i);
});

test('GET /:id/attachments/:index/download chỉ phục vụ bài đã published', async (t) => {
    const express = (await import('express')).default;
    const Article = (await import('../server/models/Article.js')).default;
    const router = (await import('../server/routes/articles.js')).default;
    let captured;
    t.mock.method(Article, 'findOne', async (query) => { captured = query; return null; });

    const app = express().use('/api/articles', router);
    const server = app.listen(0);
    t.after(() => server.close());
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/articles/64b000000000000000000001/attachments/0/download`);

    assert.equal(res.status, 404);
    assert.deepEqual(captured, { _id: '64b000000000000000000001', status: 'published' });
});

test('downloadCount bị ẩn khỏi query mặc định, admin phải select tường minh', async () => {
    const Article = (await import('../server/models/Article.js')).default;
    assert.equal(Article.schema.path('downloadCount').options.select, false);
});

test('POST /:id/track-download cũ đã bị xóa', async (t) => {
    const express = (await import('express')).default;
    const router = (await import('../server/routes/articles.js')).default;
    const server = express().use('/api/articles', router).listen(0);
    t.after(() => server.close());
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/articles/64b000000000000000000001/track-download`, { method: 'POST' });
    assert.equal(res.status, 404);
});
