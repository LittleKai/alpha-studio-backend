/**
 * Làm sạch mảng khối thân bài (`sections`) gửi lên từ trình đăng.
 *
 * Dùng chung cho `/api/event-library` (đủ 8 kind) và `/api/articles` với bài
 * dịch vụ (chỉ 4 kind giới thiệu) — xem `SERVICE_SECTION_KINDS`.
 */

// Số khối tối đa mỗi mục và số phần tử tối đa trong một khối — chặn payload
// khổng lồ làm phình document (giới hạn 16MB của Mongo).
export const MAX_SECTIONS = 30;
export const MAX_ROWS = 50;

/** Tập kind rút gọn cho bài dịch vụ: chỉ vài khối giới thiệu. */
export const SERVICE_SECTION_KINDS = ['richText', 'bulletGroups', 'steps', 'gallery'];

function asArray(value) {
    return Array.isArray(value) ? value.slice(0, MAX_ROWS) : [];
}

function str(value) {
    return typeof value === 'string' ? value : (value == null ? '' : String(value));
}

/** Chỉ giữ lại field thuộc về `kind` của khối; bỏ mọi thứ khác. */
const SECTION_FIELDS = {
    richText: (s) => ({ ...(s.htmlEn ? { htmlEn: String(s.htmlEn) } : {}), html: String(s.html || '') }),
    keyValue: (s) => ({
        rows: asArray(s.rows).map(r => ({ label: str(r.label), value: str(r.value) })),
        ...(Array.isArray(s.rowsEn) && s.rowsEn.length ? { rowsEn: asArray(s.rowsEn).map(r => ({ label: str(r.label), value: str(r.value) })) } : {})
    }),
    metrics: (s) => ({
        metrics: asArray(s.metrics).map(m => ({ label: str(m.label), value: str(m.value), note: str(m.note) })),
        ...(Array.isArray(s.metricsEn) && s.metricsEn.length ? { metricsEn: asArray(s.metricsEn).map(m => ({ label: str(m.label), value: str(m.value), note: str(m.note) })) } : {})
    }),
    bulletGroups: (s) => ({
        groups: asArray(s.groups).map(g => ({
            title: str(g.title),
            items: asArray(g.items).map(str).filter(Boolean)
        })),
        ...(Array.isArray(s.groupsEn) && s.groupsEn.length ? { groupsEn: asArray(s.groupsEn).map(g => ({
            title: str(g.title),
            items: asArray(g.items).map(str).filter(Boolean)
        })) } : {})
    }),
    steps: (s) => ({
        steps: asArray(s.steps).map(st => ({ title: str(st.title), desc: str(st.desc) })),
        ...(Array.isArray(s.stepsEn) && s.stepsEn.length ? { stepsEn: asArray(s.stepsEn).map(st => ({ title: str(st.title), desc: str(st.desc) })) } : {})
    }),
    quote: (s) => ({ quote: str(s.quote), quoteBy: str(s.quoteBy), ...(s.quoteEn ? { quoteEn: str(s.quoteEn) } : {}), ...(s.quoteByEn ? { quoteByEn: str(s.quoteByEn) } : {}) }),
    gallery: (s) => ({ images: asArray(s.images).map(str).filter(Boolean) }),
    linkedItems: (s) => ({
        links: asArray(s.links).map(l => ({ slug: str(l.slug), label: str(l.label) })),
        ...(Array.isArray(s.linksEn) && s.linksEn.length ? { linksEn: asArray(s.linksEn).map(l => ({ slug: str(l.slug), label: str(l.label) })) } : {})
    })
};

/**
 * Chuẩn hoá `sections`: bỏ khối có `kind` lạ (hoặc ngoài `allowedKinds` nếu
 * truyền vào), cắt field không thuộc kind đó, và giới hạn kích thước.
 *
 * @param {unknown} sections
 * @param {string[]|null} allowedKinds  null = cho phép cả 8 kind.
 */
export function sanitizeSections(sections, allowedKinds = null) {
    const allowed = Array.isArray(allowedKinds) ? new Set(allowedKinds) : null;
    return (Array.isArray(sections) ? sections : [])
        .filter(s => s && SECTION_FIELDS[s.kind] && (!allowed || allowed.has(s.kind)))
        .slice(0, MAX_SECTIONS)
        .map(s => ({
            kind: s.kind,
            title: str(s.title),
            ...(s.titleEn ? { titleEn: str(s.titleEn) } : {}),
            ...SECTION_FIELDS[s.kind](s)
        }));
}
