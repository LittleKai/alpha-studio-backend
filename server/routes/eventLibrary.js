import express from 'express';
import mongoose from 'mongoose';
import EventLibraryItem, {
    ITEM_TYPES, CATEGORIES, OBJECTIVES, KPIS, BUDGET_TIERS, VERIFICATIONS, DEPTHS,
    ACCESS_LEVELS, PRO_MIN_LIFETIME_CREDITS
} from '../models/EventLibraryItem.js';
import Transaction from '../models/Transaction.js';
import WorkflowProject from '../models/WorkflowProject.js';
import WorkflowDocument from '../models/WorkflowDocument.js';
import { authMiddleware, verifyToken } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

// ─── Pure helpers (exported for tests) ─────────────────────────────────────

/**
 * Chuyển tiêu đề thành slug an toàn cho URL, có hậu tố ngẫu nhiên để tránh
 * đụng nhau khi hai người đăng cùng một tên.
 */
export function slugifyTitle(title, suffix = Date.now().toString(36)) {
    const base = String(title || 'muc')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/gi, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return `${base || 'muc'}-${suffix}`;
}

/**
 * Điều kiện Mongo quyết định người dùng được thấy bản ghi nào.
 *
 * - Khách:      item của web + item công khai của cộng đồng
 * - Đăng nhập:  như trên, cộng thêm toàn bộ item riêng tư của chính mình
 * - Admin:      thấy tất cả
 */
export function buildVisibilityFilter(user) {
    if (user?.role === 'admin') return {};

    const clauses = [
        { ownership: 'platform' },
        { ownership: 'user', visibility: 'public' }
    ];
    if (user?._id) {
        clauses.push({ owner: user._id });
    }
    return { $or: clauses };
}

/** Tách "a,b,c" thành mảng, bỏ giá trị rỗng và giá trị không nằm trong `allowed`. */
export function parseCsv(value, allowed = null) {
    if (!value) return [];
    const parts = String(value).split(',').map(s => s.trim()).filter(Boolean);
    return allowed ? parts.filter(p => allowed.includes(p)) : parts;
}

/** Ghép bộ lọc từ query string với điều kiện hiển thị. */
export function buildListQuery(params = {}, user = null) {
    const and = [buildVisibilityFilter(user)];

    if (params.scope === 'mine') {
        and.push({ owner: user?._id ?? null });
    } else if (params.scope === 'platform') {
        and.push({ ownership: 'platform' });
    } else if (params.scope === 'community') {
        and.push({ ownership: 'user' });
    }

    if (params.itemType && ITEM_TYPES.includes(params.itemType)) {
        and.push({ itemType: params.itemType });
    }

    const pushIn = (field, values) => {
        if (values.length) and.push({ [field]: { $in: values } });
    };
    pushIn('category', parseCsv(params.category, CATEGORIES));
    pushIn('industries', parseCsv(params.industry));
    pushIn('objectives', parseCsv(params.objective, OBJECTIVES));
    pushIn('kpis', parseCsv(params.kpi, KPIS));
    pushIn('budgetTier', parseCsv(params.budgetTier, BUDGET_TIERS));
    pushIn('verification', parseCsv(params.verification, VERIFICATIONS));
    pushIn('depth', parseCsv(params.depth, DEPTHS));

    const search = String(params.search || '').trim();
    if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        and.push({
            $or: [
                { 'title.vi': rx }, { 'title.en': rx },
                { 'summary.vi': rx }, { 'summary.en': rx },
                { tags: rx }, { authorName: rx }
            ]
        });
    }

    return and.length === 1 ? and[0] : { $and: and };
}

// Số khối tối đa mỗi mục và số phần tử tối đa trong một khối — chặn payload
// khổng lồ làm phình document (giới hạn 16MB của Mongo).
const MAX_SECTIONS = 30;
const MAX_ROWS = 50;

/** Chỉ giữ lại field thuộc về `kind` của khối; bỏ mọi thứ khác. */
const SECTION_FIELDS = {
    richText: (s) => ({ html: String(s.html || '') }),
    keyValue: (s) => ({
        rows: asArray(s.rows).map(r => ({ label: str(r.label), value: str(r.value) }))
    }),
    metrics: (s) => ({
        metrics: asArray(s.metrics).map(m => ({ label: str(m.label), value: str(m.value), note: str(m.note) }))
    }),
    bulletGroups: (s) => ({
        groups: asArray(s.groups).map(g => ({
            title: str(g.title),
            items: asArray(g.items).map(str).filter(Boolean)
        }))
    }),
    steps: (s) => ({
        steps: asArray(s.steps).map(st => ({ title: str(st.title), desc: str(st.desc) }))
    }),
    quote: (s) => ({ quote: str(s.quote), quoteBy: str(s.quoteBy) }),
    gallery: (s) => ({ images: asArray(s.images).map(str).filter(Boolean) }),
    linkedItems: (s) => ({
        links: asArray(s.links).map(l => ({ slug: str(l.slug), label: str(l.label) }))
    })
};

function asArray(value) {
    return Array.isArray(value) ? value.slice(0, MAX_ROWS) : [];
}

function str(value) {
    return typeof value === 'string' ? value : (value == null ? '' : String(value));
}

/**
 * Chuẩn hoá `sections` gửi lên từ trình đăng: bỏ khối có `kind` lạ, cắt field
 * không thuộc kind đó, và giới hạn kích thước.
 */
export function sanitizeSections(sections) {
    return (Array.isArray(sections) ? sections : [])
        .filter(s => s && SECTION_FIELDS[s.kind])
        .slice(0, MAX_SECTIONS)
        .map(s => ({
            kind: s.kind,
            title: str(s.title),
            ...SECTION_FIELDS[s.kind](s)
        }));
}

/**
 * Ghi điểm của một người vào mảng `ratings` — mỗi người chỉ có một phiếu, chấm
 * lại thì ghi đè. Trả về mảng mới, không sửa mảng cũ.
 */
export const MAX_REVIEW_COMMENT = 1000;

export function upsertRating(ratings, userId, score, comment = '') {
    const uid = String(userId);
    const rest = (ratings || []).filter(r => String(r.user) !== uid);
    return [...rest, {
        user: userId,
        score,
        comment: String(comment || '').trim().slice(0, MAX_REVIEW_COMMENT)
    }];
}

/** Trung bình làm tròn 1 chữ số thập phân + số lượt chấm. */
export function summarizeRatings(ratings) {
    const list = ratings || [];
    if (!list.length) return { average: 0, count: 0 };
    const total = list.reduce((sum, r) => sum + Number(r.score || 0), 0);
    return { average: Math.round((total / list.length) * 10) / 10, count: list.length };
}

/** Bật/tắt like của một người trong mảng `likes`. */
export function toggleLike(likes, userId) {
    const uid = String(userId);
    const existing = (likes || []).map(String);
    return existing.includes(uid)
        ? { likes: (likes || []).filter(l => String(l) !== uid), liked: false }
        : { likes: [...(likes || []), userId], liked: true };
}

const SORTS = {
    recent: { createdAt: -1 },
    popular: { 'stats.views': -1, createdAt: -1 },
    used: { 'stats.uses': -1, createdAt: -1 },
    az: { 'title.vi': 1 }
};

export function buildSort(sort) {
    return SORTS[sort] || SORTS.recent;
}

// ─── Đếm lượt xem có thời gian nguội ───────────────────────────────────────
// Trước đây mỗi lần GET chi tiết là +1 view, nên F5 vài lần hay mở đi mở lại
// một mục là số nhảy liên tục. Mỗi người xem chỉ được tính một lượt cho mỗi
// mục trong VIEW_COOLDOWN_MS.
export const VIEW_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const VIEW_STORE_MAX = 5000;

const recentViews = new Map();

/**
 * Khoá định danh người xem: user đã đăng nhập thì theo id, còn lại theo IP.
 * App không bật `trust proxy` nên `req.ip` trên Fly.io là IP của proxy — phải
 * đọc `x-forwarded-for` trước, nếu không mọi khách vãng lai dùng chung một khoá.
 */
export function viewerKey(req, slug) {
    if (req.user?._id) return `${String(req.user._id)}:${slug}`;
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return `${forwarded || req.ip || 'unknown'}:${slug}`;
}

/**
 * `true` nếu lượt xem này được tính. Ghi luôn mốc thời gian vào store, nên chỉ
 * gọi một lần cho mỗi request.
 */
export function shouldCountView(key, now = Date.now(), store = recentViews) {
    const last = store.get(key);
    if (last !== undefined && now - last < VIEW_COOLDOWN_MS) return false;
    store.set(key, now);
    if (store.size > VIEW_STORE_MAX) {
        for (const [k, ts] of store) {
            if (now - ts >= VIEW_COOLDOWN_MS) store.delete(k);
        }
        // Cửa sổ nguội dài (6 giờ) nên có thể chẳng khoá nào đủ cũ để dọn — khi
        // đó bỏ bớt khoá cũ nhất (Map giữ đúng thứ tự chèn) để store không phình.
        for (const k of store.keys()) {
            if (store.size <= VIEW_STORE_MAX) break;
            store.delete(k);
        }
    }
    return true;
}

/** Định dạng số tiền VND thành chuỗi ngắn để hiển thị trên card. */
export function formatBudget(amount) {
    const n = Number(amount) || 0;
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)} tỷ`;
    if (n >= 1_000_000) return `${Math.round(n / 1_000_000)} triệu`;
    return String(n);
}

/** Suy ra bậc ngân sách từ số tiền của dự án Workflow. */
export function budgetTierOf(amount) {
    const n = Number(amount) || 0;
    if (n <= 0) return '';
    if (n < 50_000_000) return 'under_50m';
    if (n < 200_000_000) return '50m_200m';
    if (n < 500_000_000) return '200m_500m';
    if (n < 2_000_000_000) return '500m_2b';
    return 'over_2b';
}

/**
 * Dự án Workflow → bản ghi thư viện. `overrides` là phần người đăng chỉnh tay
 * trong modal (loại nội dung, chế độ hiển thị, danh mục, tiêu đề…).
 */
export function mapProjectToLibraryItem(project, user, overrides = {}) {
    const title = overrides.title || project.name || '';
    const metrics = [];
    if (project.budget) metrics.push({ label: 'budget', value: formatBudget(project.budget) });
    if (Array.isArray(project.team) && project.team.length) {
        metrics.push({ label: 'team', value: String(project.team.length) });
    }
    if (project.progress) metrics.push({ label: 'progress', value: `${project.progress}%` });
    if (Array.isArray(project.tasks) && project.tasks.length) {
        metrics.push({ label: 'tasks', value: String(project.tasks.length) });
    }

    return {
        slug: slugifyTitle(title),
        itemType: ITEM_TYPES.includes(overrides.itemType) ? overrides.itemType : 'case_study',
        ownership: 'user',
        visibility: overrides.visibility === 'public' ? 'public' : 'private',
        owner: user._id,
        authorName: user.name || user.email || '',
        title: { vi: title, en: overrides.titleEn || title },
        summary: {
            vi: overrides.summary || project.tagline || project.client || '',
            en: overrides.summaryEn || overrides.summary || project.tagline || project.client || ''
        },
        content: {
            vi: project.description || project.requirements || '',
            en: project.description || project.requirements || ''
        },
        coverImage: project.avatar || '',
        category: CATEGORIES.includes(overrides.category) ? overrides.category : 'other',
        industries: Array.isArray(overrides.industries) ? overrides.industries : [],
        objectives: (overrides.objectives || []).filter(o => OBJECTIVES.includes(o)),
        kpis: (overrides.kpis || []).filter(k => KPIS.includes(k)),
        budgetTier: budgetTierOf(project.budget),
        verification: 'unverified',
        depth: DEPTHS.includes(overrides.depth) ? overrides.depth : 'basic',
        tags: Array.isArray(overrides.tags) ? overrides.tags : [],
        metrics,
        attachments: [],
        origin: { kind: 'workflow_project', refId: project._id }
    };
}

/** Tài liệu Workflow → bản ghi thư viện (giữ nguyên link B2 đã upload). */
export function mapDocumentToLibraryItem(doc, user, overrides = {}) {
    const title = overrides.title || doc.name || '';
    return {
        slug: slugifyTitle(title),
        itemType: ITEM_TYPES.includes(overrides.itemType) ? overrides.itemType : 'template',
        ownership: 'user',
        visibility: overrides.visibility === 'public' ? 'public' : 'private',
        owner: user._id,
        authorName: user.name || user.email || '',
        title: { vi: title, en: overrides.titleEn || title },
        summary: {
            vi: overrides.summary || doc.note || '',
            en: overrides.summaryEn || overrides.summary || doc.note || ''
        },
        content: { vi: '', en: '' },
        coverImage: '',
        category: CATEGORIES.includes(overrides.category) ? overrides.category : 'other',
        industries: Array.isArray(overrides.industries) ? overrides.industries : [],
        objectives: (overrides.objectives || []).filter(o => OBJECTIVES.includes(o)),
        kpis: (overrides.kpis || []).filter(k => KPIS.includes(k)),
        budgetTier: '',
        verification: 'unverified',
        depth: DEPTHS.includes(overrides.depth) ? overrides.depth : 'basic',
        tags: Array.isArray(overrides.tags) ? overrides.tags : [],
        metrics: doc.size ? [{ label: 'fileSize', value: doc.size }] : [],
        attachments: [{
            name: doc.name || '',
            url: doc.url || '',
            fileKey: doc.fileKey || '',
            size: doc.size || '',
            mime: doc.type || ''
        }],
        origin: { kind: 'workflow_document', refId: doc._id }
    };
}

// ─── Khoá nội dung theo credit tích luỹ ────────────────────────────────────

/**
 * Những loại giao dịch làm TĂNG credit của tài khoản. Cả nạp tiền
 * (`topup`) lẫn admin cấp tay (`manual_topup`, `bonus`) đều tính — người dùng
 * "từng sở hữu" số credit đó bất kể nguồn nào.
 *
 * `spend` và `refund` không nằm ở đây: tiêu rồi vẫn coi là đã từng sở hữu, còn
 * hoàn tiền chỉ trả lại phần đã tính một lần.
 */
export const CREDIT_IN_TYPES = ['topup', 'manual_topup', 'bonus'];

/**
 * Tổng credit một tài khoản đã từng nhận. Không dùng `user.balance` vì số dư
 * giảm dần theo mức tiêu — người đã nạp 500 rồi tiêu hết vẫn phải mở được nội
 * dung `pro`.
 */
export async function lifetimeCreditsOf(userId) {
    const [row] = await Transaction.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(String(userId)),
                status: 'completed',
                type: { $in: CREDIT_IN_TYPES }
            }
        },
        { $group: { _id: null, total: { $sum: '$credits' } } }
    ]);
    return row?.total || 0;
}

/**
 * Ai được đọc thân bài của một mục `pro`.
 *
 * `lifetimeCredits` truyền từ ngoài vào để hàm này thuần và test được; số dư
 * hiện tại được tính bù cho tài khoản cũ có credit nhưng thiếu bản ghi
 * `Transaction` tương ứng.
 */
export function hasProAccess(item, user, lifetimeCredits = 0) {
    if (item?.accessLevel !== 'pro') return true;
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (item.owner && String(item.owner) === String(user._id)) return true;
    const earned = Math.max(Number(lifetimeCredits) || 0, Number(user.balance) || 0);
    return earned >= PRO_MIN_LIFETIME_CREDITS;
}

/**
 * Bản rút gọn của một mục bị khoá: giữ phần "quảng cáo" (tiêu đề, tóm tắt, ảnh
 * bìa, phân loại, số liệu) và bỏ phần trả phí (thân bài, khối nội dung, tệp
 * đính kèm). Cắt ở server — không bao giờ gửi nội dung xuống rồi mới ẩn bằng CSS.
 */
export function redactLockedItem(item) {
    return {
        ...item,
        content: { vi: '', en: '' },
        sections: [],
        attachments: [],
        locked: true
    };
}

/**
 * Áp cổng `pro` lên một danh sách mục. Chỉ truy vấn tổng credit MỘT lần, và chỉ
 * khi trong danh sách thực sự có mục bị khoá.
 */
export async function applyProGate(items, user) {
    if (!items.some(i => i.accessLevel === 'pro')) return items;
    const lifetime = user?._id ? await lifetimeCreditsOf(user._id) : 0;
    return items.map(i => (hasProAccess(i, user, lifetime) ? i : redactLockedItem(i)));
}

// ─── Optional auth ─────────────────────────────────────────────────────────

/**
 * Gắn `req.user` nếu request có token hợp lệ, nhưng không chặn khách vãng lai.
 * Danh sách thư viện phải mở cho khách, đồng thời hiện thêm item riêng tư khi
 * người dùng đã đăng nhập.
 */
async function optionalAuth(req, _res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
    if (token) {
        try {
            const decoded = verifyToken(token);
            const user = await User.findById(decoded.userId).select('-password');
            if (user?.isActive) req.user = user;
        } catch {
            // Token hỏng/hết hạn — coi như khách, không trả lỗi
        }
    }
    next();
}

const canEdit = (item, user) =>
    user?.role === 'admin' || (item.owner && item.owner.toString() === user._id.toString());

// Danh sách không trả `content` (nặng) — chỉ trang chi tiết mới cần
const INDEX_FIELDS = '-content -sections -likes -ratings';

// ─── Routes ────────────────────────────────────────────────────────────────

// @route   GET /api/event-library/stats
// @desc    Số liệu tổng quan cho dải thống kê trên hero
// @access  Public (có tính cả item riêng tư của chính người gọi)
router.get('/stats', optionalAuth, async (req, res) => {
    try {
        const visible = buildVisibilityFilter(req.user);
        const [total, verified, byType, industries] = await Promise.all([
            EventLibraryItem.countDocuments(visible),
            EventLibraryItem.countDocuments({ $and: [visible, { verification: 'verified' }] }),
            EventLibraryItem.aggregate([
                { $match: visible },
                { $group: { _id: '$itemType', count: { $sum: 1 } } }
            ]),
            EventLibraryItem.distinct('industries', visible)
        ]);

        const typeCounts = {};
        for (const row of byType) if (row._id) typeCounts[row._id] = row.count;

        res.json({
            success: true,
            data: {
                total,
                verified,
                typeCounts,
                industryCount: industries.filter(Boolean).length
            }
        });
    } catch (error) {
        console.error('Event library stats error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   GET /api/event-library
// @desc    Danh sách có phân trang + bộ đếm cho sidebar lọc
// @access  Public
router.get('/', optionalAuth, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 12));
        const query = buildListQuery(req.query, req.user);
        const visible = buildVisibilityFilter(req.user);

        const [items, total, counts] = await Promise.all([
            EventLibraryItem.find(query)
                .select(INDEX_FIELDS)
                .sort(buildSort(req.query.sort))
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            EventLibraryItem.countDocuments(query),
            EventLibraryItem.aggregate([
                { $match: visible },
                {
                    $facet: {
                        itemTypes: [{ $group: { _id: '$itemType', count: { $sum: 1 } } }],
                        categories: [{ $group: { _id: '$category', count: { $sum: 1 } } }],
                        industries: [
                            { $unwind: '$industries' },
                            { $group: { _id: '$industries', count: { $sum: 1 } } }
                        ],
                        objectives: [
                            { $unwind: '$objectives' },
                            { $group: { _id: '$objectives', count: { $sum: 1 } } }
                        ],
                        kpis: [
                            { $unwind: '$kpis' },
                            { $group: { _id: '$kpis', count: { $sum: 1 } } }
                        ],
                        budgetTiers: [{ $group: { _id: '$budgetTier', count: { $sum: 1 } } }],
                        verifications: [{ $group: { _id: '$verification', count: { $sum: 1 } } }],
                        depths: [{ $group: { _id: '$depth', count: { $sum: 1 } } }],
                        ownerships: [{ $group: { _id: '$ownership', count: { $sum: 1 } } }]
                    }
                }
            ])
        ]);

        const toMap = (rows) => {
            const out = {};
            for (const row of rows || []) if (row._id) out[row._id] = row.count;
            return out;
        };
        const facets = counts[0] || {};

        // Card của mục `pro` vẫn hiện, nhưng nút tải phải mất với người chưa đủ
        // credit — nếu không, link B2 trong `attachments` là cửa sau vào nội dung.
        const gated = await applyProGate(items, req.user);

        res.json({
            success: true,
            data: gated,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
            filterCounts: {
                itemTypes: toMap(facets.itemTypes),
                categories: toMap(facets.categories),
                industries: toMap(facets.industries),
                objectives: toMap(facets.objectives),
                kpis: toMap(facets.kpis),
                budgetTiers: toMap(facets.budgetTiers),
                verifications: toMap(facets.verifications),
                depths: toMap(facets.depths),
                ownerships: toMap(facets.ownerships)
            }
        });
    } catch (error) {
        console.error('Event library list error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   GET /api/event-library/:slug
// @desc    Chi tiết một mục (kèm mục liên quan cùng loại)
// @access  Public — item riêng tư chỉ chủ sở hữu và admin xem được
router.get('/:slug', optionalAuth, async (req, res) => {
    try {
        const filter = { $and: [buildVisibilityFilter(req.user), { slug: req.params.slug }] };
        // Chỉ +1 view khi người xem này chưa xem mục trong thời gian nguội
        const countView = shouldCountView(viewerKey(req, req.params.slug));
        const query = countView
            ? EventLibraryItem.findOneAndUpdate(filter, { $inc: { 'stats.views': 1 } }, { new: true })
            : EventLibraryItem.findOne(filter);
        const item = await query
            .populate('ratings.user', 'name avatar')
            .lean();

        if (!item) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy nội dung' });
        }

        const related = await EventLibraryItem.find({
            $and: [
                buildVisibilityFilter(req.user),
                { itemType: item.itemType, _id: { $ne: item._id } }
            ]
        })
            .select(INDEX_FIELDS)
            .sort({ 'stats.views': -1 })
            .limit(3)
            .lean();

        // Không trả nguyên mảng `likes`/`ratings` ra client — vừa là danh sách
        // người dùng, vừa phình vô ích. Chỉ gửi trạng thái của người đang xem.
        const uid = req.user?._id ? String(req.user._id) : null;
        const myLiked = !!uid && (item.likes || []).some(l => String(l) === uid);
        const mine = uid
            ? (item.ratings || []).find(r => String(r.user?._id ?? r.user) === uid)
            : null;

        // Đánh giá kèm nhận xét = một review. Chỉ trả review CÓ nhận xét, mới
        // nhất trước; phiếu chấm suông không có gì để đọc.
        const reviews = (item.ratings || [])
            .filter(r => r.comment?.trim())
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 30)
            .map(r => ({
                score: r.score,
                comment: r.comment,
                createdAt: r.createdAt,
                author: {
                    _id: String(r.user?._id ?? r.user),
                    name: r.user?.name || '',
                    avatar: r.user?.avatar || ''
                }
            }));

        const { likes, ratings, ...safe } = item;

        // Cổng `pro`: người chưa tích luỹ đủ credit chỉ nhận phần giới thiệu.
        const lifetime = (safe.accessLevel === 'pro' && req.user?._id)
            ? await lifetimeCreditsOf(req.user._id)
            : 0;
        const unlocked = hasProAccess(safe, req.user, lifetime);
        const gatedRelated = await applyProGate(related, req.user);

        res.json({
            success: true,
            data: unlocked ? safe : redactLockedItem(safe),
            related: gatedRelated,
            reviews,
            me: { liked: myLiked, score: mine?.score ?? 0, comment: mine?.comment ?? '' },
            access: {
                level: safe.accessLevel || 'public',
                unlocked,
                requiredCredits: PRO_MIN_LIFETIME_CREDITS,
                lifetimeCredits: lifetime
            }
        });
    } catch (error) {
        console.error('Event library detail error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   POST /api/event-library/:slug/use
// @desc    Tăng đếm lượt dùng khi bấm "Dùng ngay" / "Tải về"
// @access  Public
router.post('/:slug/use', optionalAuth, async (req, res) => {
    try {
        const target = await EventLibraryItem.findOne({
            $and: [buildVisibilityFilter(req.user), { slug: req.params.slug }]
        }).select('accessLevel owner').lean();

        if (!target) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy nội dung' });
        }
        if (target.accessLevel === 'pro') {
            const lifetime = req.user?._id ? await lifetimeCreditsOf(req.user._id) : 0;
            if (!hasProAccess(target, req.user, lifetime)) {
                return res.status(403).json({
                    success: false,
                    message: `Nội dung này dành cho tài khoản đã tích luỹ từ ${PRO_MIN_LIFETIME_CREDITS} credit trở lên`
                });
            }
        }

        const updated = await EventLibraryItem.findOneAndUpdate(
            { $and: [buildVisibilityFilter(req.user), { slug: req.params.slug }] },
            { $inc: { 'stats.uses': 1 } },
            { new: true, projection: { stats: 1 } }
        ).lean();

        if (!updated) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy nội dung' });
        }
        res.json({ success: true, message: 'Đã ghi nhận', data: { stats: updated.stats } });
    } catch (error) {
        console.error('Event library use error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   POST /api/event-library/:slug/like
// @desc    Bật/tắt thích một mục
// @access  Auth
router.post('/:slug/like', authMiddleware, async (req, res) => {
    try {
        const item = await EventLibraryItem.findOne({
            $and: [buildVisibilityFilter(req.user), { slug: req.params.slug }]
        });
        if (!item) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy nội dung' });
        }

        const { likes, liked } = toggleLike(item.likes, req.user._id);
        item.likes = likes;
        item.likesCount = likes.length;
        await item.save();

        res.json({
            success: true,
            message: liked ? 'Đã thích' : 'Đã bỏ thích',
            data: { liked, likesCount: item.likesCount }
        });
    } catch (error) {
        console.error('Event library like error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   POST /api/event-library/:slug/rate
// @desc    Chấm điểm 1–5; chấm lại thì ghi đè phiếu cũ
// @access  Auth
router.post('/:slug/rate', authMiddleware, async (req, res) => {
    try {
        const score = Number(req.body?.score);
        if (!Number.isInteger(score) || score < 1 || score > 5) {
            return res.status(400).json({ success: false, message: 'Điểm phải là số nguyên từ 1 đến 5' });
        }

        const item = await EventLibraryItem.findOne({
            $and: [buildVisibilityFilter(req.user), { slug: req.params.slug }]
        });
        if (!item) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy nội dung' });
        }

        item.ratings = upsertRating(item.ratings, req.user._id, score, req.body?.comment);
        item.rating = summarizeRatings(item.ratings);
        await item.save();

        res.json({
            success: true,
            message: 'Đã ghi nhận đánh giá',
            data: { rating: item.rating, myScore: score }
        });
    } catch (error) {
        console.error('Event library rate error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   POST /api/event-library
// @desc    Tạo mục mới. Chỉ admin được tạo mục `platform` (dữ liệu của web).
// @access  Auth
router.post('/', authMiddleware, async (req, res) => {
    try {
        const body = req.body || {};
        const title = body.title?.vi || body.title?.en || '';
        if (!title) {
            return res.status(400).json({ success: false, message: 'Tiêu đề là bắt buộc' });
        }
        if (!ITEM_TYPES.includes(body.itemType)) {
            return res.status(400).json({ success: false, message: 'Loại nội dung không hợp lệ' });
        }

        const isPlatform = body.ownership === 'platform';
        if (isPlatform && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Chỉ admin được đăng nội dung của web' });
        }

        const item = await EventLibraryItem.create({
            ...body,
            sections: sanitizeSections(body.sections),
            // Khoá theo credit là công cụ vận hành của web — người dùng thường
            // không tự đặt được cho nội dung của mình.
            accessLevel: (req.user.role === 'admin' && ACCESS_LEVELS.includes(body.accessLevel))
                ? body.accessLevel
                : 'public',
            slug: slugifyTitle(title),
            ownership: isPlatform ? 'platform' : 'user',
            visibility: isPlatform ? 'public' : (body.visibility === 'public' ? 'public' : 'private'),
            owner: isPlatform ? null : req.user._id,
            authorName: body.authorName || req.user.name || '',
            origin: {
                kind: isPlatform ? (body.origin?.kind === 'crawl' ? 'crawl' : 'manual') : 'manual',
                refId: null
            },
            stats: { views: 0, uses: 0 }
        });

        res.status(201).json({ success: true, message: 'Đã tạo nội dung', data: item });
    } catch (error) {
        console.error('Event library create error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   PUT /api/event-library/:id
// @desc    Sửa mục — chủ sở hữu hoặc admin
// @access  Auth
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const item = await EventLibraryItem.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy nội dung' });
        }
        if (!canEdit(item, req.user)) {
            return res.status(403).json({ success: false, message: 'Không có quyền sửa nội dung này' });
        }

        // Những trường người dùng không được tự đổi
        const { _id, slug, ownership, owner, origin, stats, accessLevel, ...updatable } = req.body || {};
        if (req.user.role === 'admin' && ACCESS_LEVELS.includes(accessLevel)) {
            item.accessLevel = accessLevel;
        }
        if (req.user.role === 'admin' && ['platform', 'user'].includes(ownership)) {
            item.ownership = ownership;
            if (ownership === 'platform') {
                item.owner = null;
                item.visibility = 'public';
            }
        }
        if ('sections' in updatable) {
            updatable.sections = sanitizeSections(updatable.sections);
        }
        Object.assign(item, updatable);
        if (item.ownership === 'platform') item.visibility = 'public';
        await item.save();

        res.json({ success: true, message: 'Đã cập nhật', data: item });
    } catch (error) {
        console.error('Event library update error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   DELETE /api/event-library/:id
// @desc    Xóa mục — chủ sở hữu hoặc admin
// @access  Auth
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const item = await EventLibraryItem.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy nội dung' });
        }
        if (!canEdit(item, req.user)) {
            return res.status(403).json({ success: false, message: 'Không có quyền xóa nội dung này' });
        }
        await item.deleteOne();
        res.json({ success: true, message: 'Đã xóa nội dung' });
    } catch (error) {
        console.error('Event library delete error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ─── Đăng từ Workflow ──────────────────────────────────────────────────────

/** Trả về mục đã đăng trước đó từ cùng nguồn, nếu có. */
async function findExistingOrigin(kind, refId) {
    return EventLibraryItem.findOne({ 'origin.kind': kind, 'origin.refId': refId }).lean();
}

/**
 * Chỉ người tạo, thành viên đội dự án hoặc admin được đem nội dung Workflow ra
 * thư viện — mọi tài khoản đăng nhập đều đọc được `/api/workflow/projects`, nên
 * không thể dựa vào việc "nhìn thấy" để cho phép đăng.
 */
export function canPublishProject(project, user) {
    if (user.role === 'admin') return true;
    const userId = user._id.toString();
    if (project.createdBy?.toString() === userId) return true;
    return (project.team || []).some(member => String(member.id) === userId);
}

export function canPublishDocument(doc, user) {
    return user.role === 'admin' || doc.createdBy?.toString() === user._id.toString();
}

// @route   POST /api/event-library/publish/project/:projectId
// @desc    Đăng một dự án Workflow lên thư viện dưới dạng bản ghi riêng của tài khoản
// @access  Auth
router.post('/publish/project/:projectId', authMiddleware, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.projectId)) {
            return res.status(400).json({ success: false, message: 'ID dự án không hợp lệ' });
        }
        const project = await WorkflowProject.findById(req.params.projectId);
        if (!project) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy dự án' });
        }

        if (!canPublishProject(project, req.user)) {
            return res.status(403).json({ success: false, message: 'Không có quyền đăng dự án này' });
        }

        const existing = await findExistingOrigin('workflow_project', project._id);
        if (existing) {
            return res.status(409).json({
                success: false,
                message: 'Dự án này đã được đăng lên thư viện',
                data: { slug: existing.slug }
            });
        }

        const item = await EventLibraryItem.create(
            mapProjectToLibraryItem(project, req.user, req.body || {})
        );
        res.status(201).json({ success: true, message: 'Đã đăng lên thư viện', data: item });
    } catch (error) {
        console.error('Event library publish project error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// @route   POST /api/event-library/publish/document/:documentId
// @desc    Đăng một tài liệu Workflow lên thư viện (giữ nguyên file trên B2)
// @access  Auth
router.post('/publish/document/:documentId', authMiddleware, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.documentId)) {
            return res.status(400).json({ success: false, message: 'ID tài liệu không hợp lệ' });
        }
        const doc = await WorkflowDocument.findById(req.params.documentId);
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu' });
        }

        if (!canPublishDocument(doc, req.user)) {
            return res.status(403).json({ success: false, message: 'Không có quyền đăng tài liệu này' });
        }

        const existing = await findExistingOrigin('workflow_document', doc._id);
        if (existing) {
            return res.status(409).json({
                success: false,
                message: 'Tài liệu này đã được đăng lên thư viện',
                data: { slug: existing.slug }
            });
        }

        const item = await EventLibraryItem.create(
            mapDocumentToLibraryItem(doc, req.user, req.body || {})
        );
        res.status(201).json({ success: true, message: 'Đã đăng lên thư viện', data: item });
    } catch (error) {
        console.error('Event library publish document error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

export default router;
