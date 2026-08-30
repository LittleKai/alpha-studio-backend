import test from 'node:test';
import assert from 'node:assert/strict';

// Ảnh TinyMCE trong mô tả dự án được upload thẳng lên B2 (prefix
// `project-descriptions/`), nhưng URL của chúng chỉ tồn tại dưới dạng chuỗi HTML
// trong `WorkflowProject.description` — không có field B2 riêng nào trỏ tới.
// Nếu orphan checker không đọc được key từ chuỗi HTML đó thì
// `DELETE /storage/orphaned` sẽ xoá ảnh đang được dùng.
process.env.CDN_BASE_URL = 'https://cdn.example.com/file/alpha-bucket';
process.env.B2_BUCKET_NAME = 'alpha-bucket';

const {
    extractB2Key,
    extractB2KeysFromHtml,
    blockedDeleteReason,
    DELETE_GUARD_TTL_MS
} = await import('../server/routes/admin.js');

const CDN = 'https://cdn.example.com/file/alpha-bucket';
const DIRECT = 'https://f004.backblazeb2.com/file/alpha-bucket';

// ─── extractB2Key: hành vi nền ─────────────────────────────────────────────

test('extractB2Key đọc được cả URL CDN lẫn URL B2 trực tiếp', () => {
    assert.equal(extractB2Key(`${CDN}/project-descriptions/a.webp`), 'project-descriptions/a.webp');
    assert.equal(extractB2Key(`${DIRECT}/project-descriptions/a.webp`), 'project-descriptions/a.webp');
});

test('extractB2Key bỏ qua URL không phải B2', () => {
    assert.equal(extractB2Key('https://res.cloudinary.com/x/image/upload/v1/a.jpg'), null);
    assert.equal(extractB2Key(''), null);
    assert.equal(extractB2Key(null), null);
});

// ─── extractB2KeysFromHtml: lỗi được sửa ───────────────────────────────────

test('lấy được key của ảnh TinyMCE nhúng trong mô tả dự án', () => {
    const html = `<p>Mô tả</p><img src="${CDN}/project-descriptions/so-do.webp" alt="sơ đồ">`;
    assert.deepEqual(extractB2KeysFromHtml(html), ['project-descriptions/so-do.webp']);
});

test('lấy đủ nhiều ảnh trong cùng một mô tả', () => {
    const html = [
        `<img src="${CDN}/project-descriptions/1.webp">`,
        `<p>giữa</p>`,
        `<img src='${DIRECT}/project-descriptions/2.png'>`
    ].join('');
    assert.deepEqual(extractB2KeysFromHtml(html), [
        'project-descriptions/1.webp',
        'project-descriptions/2.png'
    ]);
});

test('bắt cả link tải và ảnh nền, không chỉ <img src>', () => {
    // Người dùng có thể chèn link tệp hoặc ảnh nền — xoá nhầm vẫn là mất dữ liệu
    const html = `<a href="${CDN}/project-descriptions/brief.pdf">brief</a>`
        + `<div style="background-image:url(${CDN}/project-descriptions/bg.webp)"></div>`;
    assert.deepEqual(extractB2KeysFromHtml(html).sort(), [
        'project-descriptions/bg.webp',
        'project-descriptions/brief.pdf'
    ]);
});

test('bỏ qua ảnh Cloudinary và ảnh ngoài — chúng không nằm trên B2', () => {
    const html = `<img src="https://res.cloudinary.com/demo/image/upload/v1/a.jpg">`
        + `<img src="https://images.unsplash.com/photo-1?w=800">`;
    assert.deepEqual(extractB2KeysFromHtml(html), []);
});

test('giải mã &amp; trong URL do TinyMCE escape', () => {
    const html = `<img src="${CDN}/project-descriptions/a&amp;b.webp">`;
    assert.deepEqual(extractB2KeysFromHtml(html), ['project-descriptions/a&b.webp']);
});

test('mô tả rỗng hoặc không phải chuỗi trả về mảng rỗng', () => {
    assert.deepEqual(extractB2KeysFromHtml(''), []);
    assert.deepEqual(extractB2KeysFromHtml(null), []);
    assert.deepEqual(extractB2KeysFromHtml(undefined), []);
    assert.deepEqual(extractB2KeysFromHtml({ vi: 'x' }), []);
});

test('mô tả chỉ có chữ, không có URL nào', () => {
    assert.deepEqual(extractB2KeysFromHtml('<p>Dự án sự kiện cuối năm.</p>'), []);
});

test('không trả về key trùng khi cùng một ảnh xuất hiện hai lần', () => {
    const html = `<img src="${CDN}/project-descriptions/x.webp"><img src="${CDN}/project-descriptions/x.webp">`;
    assert.deepEqual(extractB2KeysFromHtml(html), ['project-descriptions/x.webp']);
});

// ─── chặn xoá file vẫn đang được tham chiếu ────────────────────────────────
//
// `DELETE /storage/orphaned` trước đây xoá thẳng key client gửi lên, chỉ chặn mỗi
// prefix bản phát hành app. Danh sách trên trang admin có thể đã cũ (ai đó chèn
// ảnh vào mô tả dự án sau lúc admin bấm tải) → xoá nhầm file đang dùng.


test('chặn xoá key đang được tham chiếu trong DB', () => {
    const used = new Set(['project-descriptions/so-do.webp']);
    const reason = blockedDeleteReason('project-descriptions/so-do.webp', used);
    assert.match(reason, /đang được tham chiếu/);
});

test('cho xoá key thật sự mồ côi', () => {
    const used = new Set(['project-descriptions/dang-dung.webp']);
    assert.equal(blockedDeleteReason('workflow-docs/rac.tmp', used), null);
});

test('vẫn chặn bản phát hành app kể cả khi không có trong usedKeys', () => {
    const used = new Set();
    assert.match(blockedDeleteReason('vocabflip-app/version.json', used), /bản phát hành/);
    assert.match(blockedDeleteReason('vietyaku-app/VietYaku-1.0.zip', used), /bản phát hành/);
});

test('key rỗng bị từ chối', () => {
    assert.match(blockedDeleteReason('', new Set()), /bắt buộc/);
    assert.match(blockedDeleteReason(null, new Set()), /bắt buộc/);
});

test('so khớp key chính xác, không so theo tiền tố', () => {
    // `a/b.webp` đang dùng KHÔNG được biến `a/b.webp.bak` thành không xoá được
    const used = new Set(['project-descriptions/b.webp']);
    assert.equal(blockedDeleteReason('project-descriptions/b.webp.bak', used), null);
});

test('cửa sổ cache của guard đủ ngắn để không che mất tham chiếu mới', () => {
    assert.ok(DELETE_GUARD_TTL_MS > 0, 'phải có cache — trang admin xoá hàng loạt tuần tự');
    assert.ok(DELETE_GUARD_TTL_MS <= 30_000, 'cache quá dài thì lại quay về đúng lỗi vừa sửa');
});
