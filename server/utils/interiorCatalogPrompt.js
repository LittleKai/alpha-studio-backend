import InteriorTemplate from '../models/InteriorTemplate.js';

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const CATALOG_STATUSES = ['seed', 'approved'];
const CATALOG_MAX_ROWS = 60;

let catalogCache = {
    expiresAt: 0,
    rows: null
};

function textForLang(value, language) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && !Array.isArray(value)) {
        return value[language] || value.vi || value.en || '';
    }
    return '';
}

function escapeCell(value) {
    return String(value || '')
        .replace(/\r?\n/g, ' ')
        .replace(/\|/g, '\\|')
        .trim();
}

function compactParams(params = {}) {
    const aliases = {
        width: 'w',
        height: 'h',
        depth: 'd',
        radius: 'r',
        length: 'len',
        thick: 'thick'
    };
    const parts = [];
    for (const [key, def] of Object.entries(params || {})) {
        if (!def || typeof def !== 'object') continue;
        const label = aliases[key] || key;
        if (Number.isFinite(def.min) && Number.isFinite(def.max)) {
            parts.push(`${label}:${def.min}-${def.max}`);
        } else if (def.default !== undefined) {
            parts.push(`${label}:default ${def.default}`);
        }
        if (parts.length >= 6) break;
    }
    return parts.join(', ') || '(none)';
}

function compactStyle(styleOptions = {}) {
    const parts = [];
    for (const [key, def] of Object.entries(styleOptions || {})) {
        if (Array.isArray(def?.values)) parts.push(`${key}: ${def.values.slice(0, 6).join('|')}`);
        else if (def?.default !== undefined) parts.push(`${key}: default ${def.default}`);
        else if (Array.isArray(def)) parts.push(`${key}: ${def.slice(0, 6).join('|')}`);
        if (parts.length >= 5) break;
    }
    return parts.join('; ') || '(none)';
}

function words(value) {
    return new Set(String(value || '').toLowerCase().split(/[^a-z0-9\u00c0-\u1ef9-]+/i).filter(Boolean));
}

function scoreTemplate(row, message) {
    const wanted = words(message);
    if (!wanted.size) return 0;
    const hay = words([
        row.templateId,
        row.category,
        ...(row.tags || []),
        textForLang(row.name, 'vi'),
        textForLang(row.description, 'vi'),
        textForLang(row.description, 'en')
    ].join(' '));
    let score = 0;
    for (const word of wanted) {
        if (hay.has(word)) score += 1;
    }
    return score;
}

function rankRows(rows, message, maxRows) {
    return rows
        .map((row, index) => ({ row, index, score: scoreTemplate(row, message) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, maxRows)
        .map((item) => item.row);
}

function rules(language) {
    if (language === 'en') {
        return [
            'RULES:',
            '1. For each cabinet/furniture module, choose the best matching template by category + tags + size bounds before using raw boxes.',
            '2. Output module: { tpl: "<id>", x, y, z, width, height, depth, style: {...} }.',
            '3. For per-module colors, use style.colors, e.g. { front:"#1a2b44", body:"#ffffff", handle:"#c9a354" }. Supported token/semantic keys include front, body, top, side, back, handle, metal, fabric, stone, ceramic, plant, led, accent, accent2.',
            '4. No match -> tplNew is allowed only when truly different from the catalog. tplNew category must be one of the fixed backend categories.',
            '5. DSL boxes may use arithmetic/comparison expressions (== != === !== < <= > >=) and optional "if". Use two shapes with "if" instead of ternary "? :".',
            '6. Legacy raw boxes are still allowed for one-off details, but catalog templates should be the default.'
        ].join('\n');
    }
    return [
        'QUY TAC:',
        '1. Moi module tu/noi that: chon template phu hop nhat theo category + tags + size bounds truoc khi dung raw box.',
        '2. Output module: { tpl: "<id>", x, y, z, width, height, depth, style: {...} }.',
        '3. Mau rieng tung module: dung style.colors, vi du { front:"#1a2b44", body:"#ffffff", handle:"#c9a354" }. Key ho tro: front, body, top, side, back, handle, metal, fabric, stone, ceramic, plant, led, accent, accent2.',
        '4. Khong match -> chi dung tplNew khi that su khac catalog. Category tplNew phai nam trong danh sach backend co dinh.',
        '5. DSL boxes co the dung arithmetic/comparison (== != === !== < <= > >=) va optional "if". Dung 2 shape voi "if" thay vi ternary "? :".',
        '6. Raw box legacy van duoc phep cho chi tiet le, nhung catalog template la mac dinh uu tien.'
    ].join('\n');
}

export function formatCatalogPromptSection(rows, { message = '', language = 'vi', maxRows = CATALOG_MAX_ROWS } = {}) {
    const selected = rankRows(rows || [], message, maxRows);
    const title = language === 'en'
        ? 'TEMPLATE CATALOG FROM DATABASE (seed + approved; prefer these over raw boxes):'
        : 'DANH MUC TEMPLATE TU DATABASE (seed + approved; uu tien hon raw box):';
    const descriptionHeader = language === 'en' ? 'description' : 'mo ta';
    const lines = [
        title,
        '',
        '| id | category | tags | params bounds | style options | ' + descriptionHeader + ' |',
        '|---|---|---|---|---|---|'
    ];
    for (const row of selected) {
        const description = textForLang(row.description, language) || textForLang(row.name, language) || row.templateId;
        lines.push([
            row.templateId,
            row.category,
            (row.tags || []).slice(0, 8).join(', '),
            compactParams(row.params),
            compactStyle(row.styleOptions),
            description
        ].map(escapeCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
    if (!selected.length) {
        lines.push('| (empty) | (none) | (none) | (none) | (none) | Catalog DB has no seed/approved templates yet. |');
    }
    lines.push('', rules(language));
    return lines.join('\n');
}

async function loadCatalogRows() {
    const now = Date.now();
    if (catalogCache.rows && catalogCache.expiresAt > now) return catalogCache.rows;

    const rows = await InteriorTemplate.find({ status: { $in: CATALOG_STATUSES } })
        .sort({ category: 1, templateId: 1, version: -1 })
        .lean();
    const byId = new Map();
    for (const row of rows) {
        const existing = byId.get(row.templateId);
        if (!existing || row.version > existing.version) byId.set(row.templateId, row);
    }
    catalogCache = {
        rows: Array.from(byId.values()),
        expiresAt: now + CATALOG_CACHE_TTL_MS
    };
    return catalogCache.rows;
}

export async function buildCatalogPromptSection(options = {}) {
    const rows = await loadCatalogRows();
    return formatCatalogPromptSection(rows, options);
}

export function clearCatalogPromptCache() {
    catalogCache = { expiresAt: 0, rows: null };
}
