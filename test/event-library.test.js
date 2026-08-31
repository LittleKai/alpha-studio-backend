import test from 'node:test';
import assert from 'node:assert/strict';

import {
    slugifyTitle,
    buildVisibilityFilter,
    parseCsv,
    buildListQuery,
    buildSort,
    formatBudget,
    budgetTierOf,
    mapProjectToLibraryItem,
    mapDocumentToLibraryItem,
    canPublishProject,
    canPublishDocument,
    sanitizeSections,
    toggleLike,
    upsertRating,
    summarizeRatings,
    MAX_REVIEW_COMMENT,
    hasProAccess,
    redactLockedItem,
    CREDIT_IN_TYPES,
    shouldCountView,
    viewerKey,
    VIEW_COOLDOWN_MS
} from '../server/routes/eventLibrary.js';
import { PRO_MIN_LIFETIME_CREDITS, BUDGET_TIERS } from '../server/models/EventLibraryItem.js';

const OWNER_ID = 'owner-object-id';
const MEMBER = { _id: OWNER_ID, role: 'user', name: 'Thanh Tân' };
const ADMIN = { _id: 'admin-object-id', role: 'admin', name: 'Admin' };

// ─── slug ──────────────────────────────────────────────────────────────────

test('slugifyTitle bỏ dấu tiếng Việt và giữ hậu tố phân biệt', () => {
    assert.equal(
        slugifyTitle('Roadshow Sự kiện Đầu tư 2026', 'abc'),
        'roadshow-su-kien-dau-tu-2026-abc'
    );
    assert.equal(slugifyTitle('', 'abc'), 'muc-abc');
    assert.equal(slugifyTitle('!!! ???', 'abc'), 'muc-abc');
});

test('slugifyTitle cắt phần gốc ở 60 ký tự', () => {
    const base = slugifyTitle('a'.repeat(200), 'x');
    assert.equal(base, `${'a'.repeat(60)}-x`);
});

// ─── phân quyền hiển thị ───────────────────────────────────────────────────

test('khách chỉ thấy item của web và item công khai của cộng đồng', () => {
    assert.deepEqual(buildVisibilityFilter(null), {
        $or: [
            { ownership: 'platform' },
            { ownership: 'user', visibility: 'public' }
        ]
    });
});

test('người dùng đăng nhập thấy thêm item riêng tư của chính mình', () => {
    const filter = buildVisibilityFilter(MEMBER);
    assert.deepEqual(filter.$or[2], { owner: OWNER_ID });
    // Không có nhánh nào cho phép đọc item riêng tư của người khác
    assert.equal(filter.$or.length, 3);
});

test('admin không bị giới hạn hiển thị', () => {
    assert.deepEqual(buildVisibilityFilter(ADMIN), {});
});

// ─── bộ lọc danh sách ──────────────────────────────────────────────────────

test('parseCsv loại bỏ giá trị không nằm trong danh sách cho phép', () => {
    assert.deepEqual(parseCsv('event, roadshow ,hacked', ['event', 'roadshow']), ['event', 'roadshow']);
    assert.deepEqual(parseCsv('', ['event']), []);
    assert.deepEqual(parseCsv(undefined), []);
});

test('buildListQuery luôn kèm điều kiện hiển thị dù lọc kiểu gì', () => {
    const query = buildListQuery({ itemType: 'case_study', category: 'activation' }, MEMBER);
    assert.deepEqual(query.$and[0], buildVisibilityFilter(MEMBER));
    assert.deepEqual(query.$and[1], { itemType: 'case_study' });
    assert.deepEqual(query.$and[2], { category: { $in: ['activation'] } });
});

test('buildListQuery bỏ qua itemType và category giả mạo', () => {
    const query = buildListQuery({ itemType: 'admin_only', category: 'nope' }, null);
    assert.deepEqual(query, buildVisibilityFilter(null));
});

test('scope=mine giới hạn theo chủ sở hữu, không nới quyền cho khách', () => {
    const mine = buildListQuery({ scope: 'mine' }, MEMBER);
    assert.deepEqual(mine.$and[1], { owner: OWNER_ID });

    const guest = buildListQuery({ scope: 'mine' }, null);
    assert.deepEqual(guest.$and[1], { owner: null });
});

test('tìm kiếm escape ký tự regex thay vì để lọt vào truy vấn', () => {
    const query = buildListQuery({ search: 'a.*b' }, null);
    const searchClause = query.$and[1].$or[0]['title.vi'];
    assert.ok(searchClause instanceof RegExp);
    assert.equal(searchClause.source, 'a\\.\\*b');
    assert.ok(!searchClause.test('axxb'));
    assert.ok(searchClause.test('A.*B'));
});

test('buildSort quay về "mới nhất" khi tham số lạ', () => {
    assert.deepEqual(buildSort('popular'), { 'stats.views': -1, createdAt: -1 });
    assert.deepEqual(buildSort('drop-table'), { createdAt: -1 });
});

// ─── ngân sách ─────────────────────────────────────────────────────────────

test('formatBudget rút gọn theo triệu/tỷ', () => {
    assert.equal(formatBudget(2_000_000_000), '2 tỷ');
    assert.equal(formatBudget(2_500_000_000), '2.5 tỷ');
    assert.equal(formatBudget(350_000_000), '350 triệu');
    assert.equal(formatBudget(0), '0');
});

test('budgetTierOf khớp đúng các mốc trong bộ lọc', () => {
    assert.equal(budgetTierOf(0), '');
    assert.equal(budgetTierOf(49_000_000), 'under_50m');
    assert.equal(budgetTierOf(50_000_000), '50m_200m');
    assert.equal(budgetTierOf(200_000_000), '200m_500m');
    assert.equal(budgetTierOf(500_000_000), '500m_2b');
    assert.equal(budgetTierOf(2_000_000_000), 'over_2b');
    // Mọi bậc trả về phải nằm trong enum của model
    for (const amount of [10_000_000, 120_000_000, 300_000_000, 900_000_000, 9_000_000_000]) {
        assert.ok(BUDGET_TIERS.includes(budgetTierOf(amount)), `thiếu bậc cho ${amount}`);
    }
});

// ─── đăng từ Workflow ──────────────────────────────────────────────────────

const PROJECT = {
    _id: 'project-id',
    name: 'Heineken Mall Activation',
    client: 'Heineken',
    tagline: 'Chuỗi activation 3 trung tâm thương mại',
    description: '<p>Chi tiết triển khai</p>',
    requirements: 'Yêu cầu gốc',
    avatar: 'https://cdn.example/avatar.png',
    budget: 2_400_000_000,
    progress: 80,
    team: [{ id: '1' }, { id: '2' }],
    tasks: [{ id: 't1' }]
};

test('dự án Workflow mặc định thành case study riêng tư của người đăng', () => {
    const item = mapProjectToLibraryItem(PROJECT, MEMBER);

    assert.equal(item.itemType, 'case_study');
    assert.equal(item.ownership, 'user');
    assert.equal(item.visibility, 'private');
    assert.equal(item.owner, OWNER_ID);
    assert.equal(item.authorName, 'Thanh Tân');
    assert.equal(item.title.vi, 'Heineken Mall Activation');
    assert.equal(item.summary.vi, 'Chuỗi activation 3 trung tâm thương mại');
    assert.equal(item.content.vi, '<p>Chi tiết triển khai</p>');
    assert.equal(item.coverImage, 'https://cdn.example/avatar.png');
    assert.equal(item.budgetTier, 'over_2b');
    assert.equal(item.verification, 'unverified');
    assert.deepEqual(item.origin, { kind: 'workflow_project', refId: 'project-id' });
});

test('dự án Workflow sinh sẵn các chỉ số hiển thị trên card', () => {
    const { metrics } = mapProjectToLibraryItem(PROJECT, MEMBER);
    assert.deepEqual(metrics, [
        { label: 'budget', value: '2.4 tỷ' },
        { label: 'team', value: '2' },
        { label: 'progress', value: '80%' },
        { label: 'tasks', value: '1' }
    ]);
});

test('người đăng không thể tự nâng cấp bản ghi thành nội dung của web', () => {
    const item = mapProjectToLibraryItem(PROJECT, MEMBER, {
        ownership: 'platform',
        verification: 'verified',
        owner: 'someone-else',
        visibility: 'public'
    });

    assert.equal(item.ownership, 'user');
    assert.equal(item.verification, 'unverified');
    assert.equal(item.owner, OWNER_ID);
    // visibility là lựa chọn hợp lệ của người đăng nên vẫn được tôn trọng
    assert.equal(item.visibility, 'public');
});

test('override loại nội dung và phân loại chỉ nhận giá trị hợp lệ', () => {
    const ok = mapProjectToLibraryItem(PROJECT, MEMBER, {
        itemType: 'playbook',
        category: 'activation',
        objectives: ['brand_awareness', 'khong-hop-le'],
        kpis: ['engagement', 'bogus'],
        depth: 'deep'
    });
    assert.equal(ok.itemType, 'playbook');
    assert.equal(ok.category, 'activation');
    assert.deepEqual(ok.objectives, ['brand_awareness']);
    assert.deepEqual(ok.kpis, ['engagement']);
    assert.equal(ok.depth, 'deep');

    const bad = mapProjectToLibraryItem(PROJECT, MEMBER, { itemType: 'x', category: 'y', depth: 'z' });
    assert.equal(bad.itemType, 'case_study');
    assert.equal(bad.category, 'other');
    assert.equal(bad.depth, 'basic');
});

const DOCUMENT = {
    _id: 'doc-id',
    name: 'Event Proposal Deck 2026.pptx',
    note: 'Slide proposal chuẩn ngành',
    size: '12.4 MB',
    type: 'PPTX',
    url: 'https://cdn.example/file/alpha-studio/workflow-docs/deck.pptx',
    fileKey: 'workflow-docs/deck.pptx'
};

test('tài liệu Workflow thành template và giữ nguyên file B2 đã upload', () => {
    const item = mapDocumentToLibraryItem(DOCUMENT, MEMBER);

    assert.equal(item.itemType, 'template');
    assert.equal(item.visibility, 'private');
    assert.equal(item.summary.vi, 'Slide proposal chuẩn ngành');
    assert.deepEqual(item.attachments, [{
        name: 'Event Proposal Deck 2026.pptx',
        url: 'https://cdn.example/file/alpha-studio/workflow-docs/deck.pptx',
        fileKey: 'workflow-docs/deck.pptx',
        size: '12.4 MB',
        mime: 'PPTX'
    }]);
    assert.deepEqual(item.metrics, [{ label: 'fileSize', value: '12.4 MB' }]);
    assert.deepEqual(item.origin, { kind: 'workflow_document', refId: 'doc-id' });
});

test('tài liệu không có ghi chú vẫn tạo được bản ghi hợp lệ', () => {
    const item = mapDocumentToLibraryItem({ _id: 'd2', name: 'File.pdf' }, MEMBER);
    assert.equal(item.summary.vi, '');
    assert.deepEqual(item.metrics, []);
    assert.equal(item.attachments[0].fileKey, '');
});

// ─── quyền đăng từ Workflow ────────────────────────────────────────────────

test('chỉ người tạo, thành viên đội hoặc admin được đăng dự án', () => {
    const project = {
        createdBy: 'someone-else',
        team: [{ id: OWNER_ID, name: 'Thanh Tân' }]
    };
    assert.equal(canPublishProject(project, MEMBER), true);
    assert.equal(canPublishProject(project, ADMIN), true);
    assert.equal(canPublishProject(project, { _id: 'outsider', role: 'user' }), false);
});

test('người tạo dự án luôn đăng được kể cả khi không nằm trong team', () => {
    const project = { createdBy: OWNER_ID, team: [] };
    assert.equal(canPublishProject(project, MEMBER), true);
});

test('chỉ người upload hoặc admin được đăng tài liệu', () => {
    const doc = { createdBy: OWNER_ID };
    assert.equal(canPublishDocument(doc, MEMBER), true);
    assert.equal(canPublishDocument(doc, ADMIN), true);
    assert.equal(canPublishDocument(doc, { _id: 'outsider', role: 'user' }), false);
    assert.equal(canPublishDocument({}, MEMBER), false);
});

// ─── thân bài có cấu trúc ──────────────────────────────────────────────────

test('sanitizeSections bỏ khối có kind lạ', () => {
    const out = sanitizeSections([
        { kind: 'richText', html: '<p>ok</p>' },
        { kind: 'evilBlock', html: '<p>no</p>' },
        null,
        'not-an-object'
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'richText');
});

test('sanitizeSections chỉ giữ field thuộc về kind của khối', () => {
    const [block] = sanitizeSections([{
        kind: 'quote',
        title: 'Insight cốt lõi',
        quote: 'Trung Thu không chỉ là truyền thống',
        quoteBy: 'Emotional Value',
        // field của kind khác, phải bị cắt
        html: '<script>alert(1)</script>',
        rows: [{ label: 'x', value: 'y' }],
        images: ['https://evil.test/a.png']
    }]);

    assert.deepEqual(block, {
        kind: 'quote',
        title: 'Insight cốt lõi',
        quote: 'Trung Thu không chỉ là truyền thống',
        quoteBy: 'Emotional Value'
    });
});

test('sanitizeSections dựng đúng hình dạng cho từng kind', () => {
    const out = sanitizeSections([
        { kind: 'keyValue', rows: [{ label: 'Nhận diện', value: 'Tăng 32.6%' }] },
        { kind: 'metrics', metrics: [{ label: 'Reach', value: '2.6M', note: '112% mục tiêu' }] },
        { kind: 'bulletGroups', groups: [{ title: 'Điểm mạnh', items: ['Visual mạnh', '', 'KOL phù hợp'] }] },
        { kind: 'steps', steps: [{ title: 'Thu hút', desc: 'Visual teaser' }] },
        { kind: 'gallery', images: ['https://cdn.test/1.png', ''] },
        { kind: 'linkedItems', links: [{ slug: 'booth-prompt-abc', label: 'Booth Design Prompt' }] }
    ]);

    assert.deepEqual(out[0].rows, [{ label: 'Nhận diện', value: 'Tăng 32.6%' }]);
    assert.deepEqual(out[1].metrics, [{ label: 'Reach', value: '2.6M', note: '112% mục tiêu' }]);
    // bullet rỗng bị loại, bullet có nội dung giữ nguyên thứ tự
    assert.deepEqual(out[2].groups, [{ title: 'Điểm mạnh', items: ['Visual mạnh', 'KOL phù hợp'] }]);
    assert.deepEqual(out[3].steps, [{ title: 'Thu hút', desc: 'Visual teaser' }]);
    assert.deepEqual(out[4].images, ['https://cdn.test/1.png']);
    assert.deepEqual(out[5].links, [{ slug: 'booth-prompt-abc', label: 'Booth Design Prompt' }]);
});

test('sanitizeSections chặn payload phình to', () => {
    const many = Array.from({ length: 100 }, () => ({ kind: 'richText', html: 'x' }));
    assert.equal(sanitizeSections(many).length, 30);

    const bigRows = [{ kind: 'keyValue', rows: Array.from({ length: 200 }, (_, i) => ({ label: String(i), value: 'v' })) }];
    assert.equal(sanitizeSections(bigRows)[0].rows.length, 50);
});

test('sanitizeSections chịu được đầu vào không phải mảng', () => {
    assert.deepEqual(sanitizeSections(undefined), []);
    assert.deepEqual(sanitizeSections('sections'), []);
    assert.deepEqual(sanitizeSections({ kind: 'richText' }), []);
});

// ─── tương tác: like & đánh giá ────────────────────────────────────────────

test('toggleLike bật rồi tắt, không nhân bản', () => {
    const first = toggleLike([], OWNER_ID);
    assert.deepEqual(first, { likes: [OWNER_ID], liked: true });

    const second = toggleLike(first.likes, OWNER_ID);
    assert.deepEqual(second, { likes: [], liked: false });

    // like của người khác không bị đụng tới
    const mixed = toggleLike(['other-user'], OWNER_ID);
    assert.deepEqual(mixed.likes, ['other-user', OWNER_ID]);
});

test('upsertRating chỉ giữ một phiếu cho mỗi người', () => {
    let ratings = upsertRating([], OWNER_ID, 4);
    assert.equal(ratings.length, 1);

    ratings = upsertRating(ratings, OWNER_ID, 2);
    assert.equal(ratings.length, 1, 'chấm lại phải ghi đè, không thêm phiếu');
    assert.equal(ratings[0].score, 2);

    ratings = upsertRating(ratings, 'someone-else', 5);
    assert.equal(ratings.length, 2);
});

test('summarizeRatings tính trung bình làm tròn 1 chữ số', () => {
    assert.deepEqual(summarizeRatings([]), { average: 0, count: 0 });
    assert.deepEqual(summarizeRatings([{ score: 5 }]), { average: 5, count: 1 });
    // (5+4+4)/3 = 4.333… → 4.3
    assert.deepEqual(summarizeRatings([{ score: 5 }, { score: 4 }, { score: 4 }]), { average: 4.3, count: 3 });
    // (5+2)/2 = 3.5 giữ nguyên
    assert.deepEqual(summarizeRatings([{ score: 5 }, { score: 2 }]), { average: 3.5, count: 2 });
});

test('summarizeRatings chịu được mảng rỗng/undefined', () => {
    assert.deepEqual(summarizeRatings(undefined), { average: 0, count: 0 });
});

// ─── nhận xét đi kèm phiếu chấm ────────────────────────────────────────────

test('upsertRating lưu nhận xét kèm điểm và cắt bớt phần quá dài', () => {
    const [r] = upsertRating([], OWNER_ID, 5, '  Rất sát thực tế booth mall.  ');
    assert.equal(r.score, 5);
    assert.equal(r.comment, 'Rất sát thực tế booth mall.', 'phải trim hai đầu');

    const [long] = upsertRating([], OWNER_ID, 3, 'x'.repeat(MAX_REVIEW_COMMENT + 500));
    assert.equal(long.comment.length, MAX_REVIEW_COMMENT);
});

test('chấm lại ghi đè cả điểm lẫn nhận xét cũ', () => {
    let ratings = upsertRating([], OWNER_ID, 2, 'Chưa đủ chi tiết');
    ratings = upsertRating(ratings, OWNER_ID, 5, 'Đã bổ sung, giờ rất tốt');

    assert.equal(ratings.length, 1);
    assert.equal(ratings[0].score, 5);
    assert.equal(ratings[0].comment, 'Đã bổ sung, giờ rất tốt');
});

test('chấm không kèm nhận xét vẫn hợp lệ, comment là chuỗi rỗng', () => {
    const [r] = upsertRating([], OWNER_ID, 4);
    assert.equal(r.comment, '');
    // phiếu suông vẫn tính vào trung bình
    assert.deepEqual(summarizeRatings([r]), { average: 4, count: 1 });
});

// ─── khoá nội dung theo credit tích luỹ ────────────────────────────────────

const PRO_ITEM = { accessLevel: 'pro', owner: OWNER_ID };
const FREE_ITEM = { accessLevel: 'public', owner: OWNER_ID };
const STRANGER = { _id: 'someone-else', role: 'user', balance: 0 };

test('mục public mở cho tất cả, kể cả khách chưa đăng nhập', () => {
    assert.equal(hasProAccess(FREE_ITEM, null, 0), true);
    assert.equal(hasProAccess({}, null, 0), true, 'thiếu accessLevel = public');
});

test('mục pro đóng với khách và với người chưa đủ credit tích luỹ', () => {
    assert.equal(hasProAccess(PRO_ITEM, null, 0), false);
    assert.equal(hasProAccess(PRO_ITEM, STRANGER, PRO_MIN_LIFETIME_CREDITS - 1), false);
});

test('mục pro mở đúng từ ngưỡng tích luỹ, không phụ thuộc số dư còn lại', () => {
    // Đã nạp đủ rồi tiêu sạch — vẫn phải xem được
    assert.equal(hasProAccess(PRO_ITEM, { ...STRANGER, balance: 0 }, PRO_MIN_LIFETIME_CREDITS), true);
    assert.equal(hasProAccess(PRO_ITEM, STRANGER, PRO_MIN_LIFETIME_CREDITS + 5000), true);
});

test('số dư hiện tại bù cho tài khoản cũ không có bản ghi giao dịch', () => {
    assert.equal(hasProAccess(PRO_ITEM, { ...STRANGER, balance: PRO_MIN_LIFETIME_CREDITS }, 0), true);
});

test('admin và chủ sở hữu luôn mở được mục pro', () => {
    assert.equal(hasProAccess(PRO_ITEM, ADMIN, 0), true);
    assert.equal(hasProAccess(PRO_ITEM, MEMBER, 0), true);
});

test('credit admin cấp tay được tính như credit nạp tiền', () => {
    assert.ok(CREDIT_IN_TYPES.includes('topup'));
    assert.ok(CREDIT_IN_TYPES.includes('manual_topup'));
    assert.ok(CREDIT_IN_TYPES.includes('bonus'));
    assert.ok(!CREDIT_IN_TYPES.includes('spend'), 'tiêu credit không làm tăng mức tích luỹ');
});

test('redactLockedItem cắt thân bài và tệp, giữ phần giới thiệu', () => {
    const locked = redactLockedItem({
        slug: 'case-abc',
        title: { vi: 'Case ABC', en: '' },
        summary: { vi: 'Tóm tắt', en: '' },
        coverImage: 'https://cdn/x.jpg',
        content: { vi: '<p>bí mật</p>', en: '<p>secret</p>' },
        sections: [{ kind: 'richText', html: '<p>bí mật</p>' }],
        attachments: [{ name: 'boq.xlsx', url: 'https://b2/boq.xlsx' }],
        metrics: [{ label: 'reach', value: '31.7K' }]
    });

    assert.deepEqual(locked.content, { vi: '', en: '' });
    assert.deepEqual(locked.sections, []);
    assert.deepEqual(locked.attachments, []);
    assert.equal(locked.locked, true);
    // Phần dùng để mời đọc thì giữ nguyên
    assert.equal(locked.title.vi, 'Case ABC');
    assert.equal(locked.summary.vi, 'Tóm tắt');
    assert.equal(locked.coverImage, 'https://cdn/x.jpg');
    assert.equal(locked.metrics.length, 1);
});

// ─── đếm lượt xem có thời gian nguội ───────────────────────────────────────

test('viewerKey phân biệt theo user, rơi về IP khi chưa đăng nhập', () => {
    assert.equal(viewerKey({ user: MEMBER, ip: '1.2.3.4' }, 'case-abc'), `${OWNER_ID}:case-abc`);
    assert.equal(viewerKey({ ip: '1.2.3.4' }, 'case-abc'), '1.2.3.4:case-abc');
    assert.equal(viewerKey({}, 'case-abc'), 'unknown:case-abc');
    // Cùng người xem nhưng khác mục thì khác khoá
    assert.notEqual(viewerKey({ ip: '1.2.3.4' }, 'case-abc'), viewerKey({ ip: '1.2.3.4' }, 'case-xyz'));
});

test('shouldCountView chỉ tính một lượt trong thời gian nguội', () => {
    const store = new Map();
    const t0 = 1_000_000;

    assert.equal(shouldCountView('u1:case-abc', t0, store), true);
    // F5 liên tục không cộng thêm
    assert.equal(shouldCountView('u1:case-abc', t0 + 1, store), false);
    assert.equal(shouldCountView('u1:case-abc', t0 + VIEW_COOLDOWN_MS - 1, store), false);
    // Hết thời gian nguội thì tính lại
    assert.equal(shouldCountView('u1:case-abc', t0 + VIEW_COOLDOWN_MS, store), true);
    // Người xem khác không bị chặn theo người trước
    assert.equal(shouldCountView('u2:case-abc', t0 + VIEW_COOLDOWN_MS, store), true);
});

test('shouldCountView dọn khoá hết hạn khi store phình to', () => {
    const store = new Map();
    const t0 = 1_000_000;
    for (let i = 0; i < 5001; i++) store.set(`old-${i}`, t0);

    // Lượt mới sau thời gian nguội → dọn sạch khoá cũ đã hết hạn
    assert.equal(shouldCountView('u1:case-abc', t0 + VIEW_COOLDOWN_MS, store), true);
    assert.equal(store.size, 1);
    assert.equal(store.has('u1:case-abc'), true);
});

test('shouldCountView cắt bớt khoá cũ nhất khi chưa khoá nào hết hạn', () => {
    const store = new Map();
    const t0 = 1_000_000;
    // Toàn khoá còn trong thời gian nguội → vòng dọn theo hạn không xoá được gì
    for (let i = 0; i < 5001; i++) store.set(`fresh-${i}`, t0);

    assert.equal(shouldCountView('u1:case-abc', t0 + 1, store), true);
    assert.equal(store.size, 5000);
    // Khoá vừa ghi phải còn, khoá cũ nhất bị bỏ
    assert.equal(store.has('u1:case-abc'), true);
    assert.equal(store.has('fresh-0'), false);
});

test('thời gian nguội của bộ đếm view là 6 giờ', () => {
    assert.equal(VIEW_COOLDOWN_MS, 6 * 60 * 60 * 1000);
});

test('viewerKey đọc x-forwarded-for vì app không bật trust proxy', () => {
    const req = { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, ip: '10.0.0.1' };
    assert.equal(viewerKey(req, 'case-abc'), '203.0.113.9:case-abc');
});
