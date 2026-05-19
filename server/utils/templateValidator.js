// Lightweight backend validator for the Interior Design Engine JSON DSL.
// Mirrors the AST whitelist constraints enforced by the browser engine
// (tools/interior-design-engine/src/template-engine/expression.js).
//
// Used to validate:
// 1. User-submitted commits via POST /api/interior/templates.
// 2. AI-emitted tplNew payloads inside POST /api/interior/projects/:id/chat.
// 3. Admin edits of existing templates via POST /api/admin/interior-templates/:id/edit.

const DISALLOWED = /\b(eval|Function|new|require|import|process|globalThis|window|self)\b|=>|;|`|\[|\]|(?<![=!<>])=(?!=)/;
const ALLOWED_INNER = /^[a-zA-Z0-9_$.+\-*/%()\s,'"<>=!&|]+$/;

const TEMPLATE_CATEGORIES = new Set([
    // General
    'upper-cabinet', 'lower-cabinet', 'wardrobe', 'shelf', 'desk', 'void', 'other',
    // Kitchen-specific
    'base-cabinet', 'wall-cabinet', 'tall-cabinet', 'drawer-base', 'corner-cabinet', 'island', 'kitchen-other'
]);
const ID_REGEX = /^[a-z][a-z0-9-]{1,63}$/;
const REQUIRED_VIEWS = ['frontSvg', 'sideSvg', 'planSvg', 'isoBoxes'];

function validateExpression(value) {
    if (typeof value !== 'string') return true;
    if (!value.includes('{{')) return true;
    if (DISALLOWED.test(value)) return false;
    const inner = value.replace(/^\s*\{\{|\}\}\s*$/g, '').trim();
    if (!inner) return false;
    if (!ALLOWED_INNER.test(inner)) return false;
    return true;
}

function walkShapeValues(shape, visitor) {
    if (shape == null || typeof shape !== 'object') return;
    for (const value of Object.values(shape)) {
        if (value == null) continue;
        if (typeof value === 'string') visitor(value);
        else if (Array.isArray(value)) value.forEach((item) => walkShapeValues(item, visitor));
        else if (typeof value === 'object') walkShapeValues(value, visitor);
    }
}

function validateDsl(dsl) {
    if (!dsl || typeof dsl !== 'object' || Array.isArray(dsl)) {
        return { valid: false, message: 'DSL phải là object.' };
    }
    for (const view of REQUIRED_VIEWS) {
        const list = dsl[view];
        if (list === undefined) continue;
        if (!Array.isArray(list)) {
            return { valid: false, message: `${view} phải là mảng.` };
        }
        if (list.length > 200) {
            return { valid: false, message: `${view} tối đa 200 shape.` };
        }
        for (let i = 0; i < list.length; i += 1) {
            const shape = list[i];
            if (!shape || typeof shape !== 'object' || Array.isArray(shape)) {
                return { valid: false, message: `${view}[${i}] phải là object.` };
            }
            let badExpr = null;
            walkShapeValues(shape, (value) => {
                if (badExpr) return;
                if (value.includes('{{') && !validateExpression(value)) badExpr = value;
            });
            if (badExpr) {
                return { valid: false, message: `Biểu thức không hợp lệ trong ${view}[${i}]: ${badExpr.slice(0, 80)}` };
            }
        }
    }
    if (!REQUIRED_VIEWS.some((view) => Array.isArray(dsl[view]) && dsl[view].length > 0)) {
        return { valid: false, message: 'Phải có ít nhất một view (frontSvg/sideSvg/planSvg/isoBoxes).' };
    }
    return { valid: true };
}

function validateParams(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
        return { valid: false, message: 'params phải là object.' };
    }
    const keys = Object.keys(params);
    if (keys.length > 30) return { valid: false, message: 'params tối đa 30 trường.' };
    for (const key of keys) {
        const def = params[key];
        if (!def || typeof def !== 'object') continue;
        if (def.min !== undefined && !Number.isFinite(def.min)) return { valid: false, message: `params.${key}.min phải là số.` };
        if (def.max !== undefined && !Number.isFinite(def.max)) return { valid: false, message: `params.${key}.max phải là số.` };
        if (def.default !== undefined && !Number.isFinite(def.default) && typeof def.default !== 'string') {
            return { valid: false, message: `params.${key}.default không hợp lệ.` };
        }
    }
    return { valid: true };
}

export function validateTemplateStructure(tpl) {
    if (!tpl || typeof tpl !== 'object' || Array.isArray(tpl)) {
        return { valid: false, message: 'Template phải là object.' };
    }
    if (typeof tpl.id !== 'string' || !ID_REGEX.test(tpl.id)) {
        return { valid: false, message: 'Template id thiếu hoặc không đúng kebab-case.' };
    }
    if (!tpl.category || !TEMPLATE_CATEGORIES.has(tpl.category)) {
        return { valid: false, message: `category không hợp lệ. Cho phép: ${[...TEMPLATE_CATEGORIES].join(', ')}.` };
    }
    if (tpl.tags !== undefined && !Array.isArray(tpl.tags)) {
        return { valid: false, message: 'tags phải là mảng chuỗi.' };
    }
    const paramsCheck = validateParams(tpl.params || {});
    if (!paramsCheck.valid) return paramsCheck;
    const dslHost = tpl.dsl && typeof tpl.dsl === 'object' && !Array.isArray(tpl.dsl) ? tpl.dsl : tpl;
    return validateDsl(dslHost);
}

export function extractDsl(tpl) {
    if (!tpl || typeof tpl !== 'object') return {};
    if (tpl.dsl && typeof tpl.dsl === 'object' && !Array.isArray(tpl.dsl)) return tpl.dsl;
    return {
        frontSvg: Array.isArray(tpl.frontSvg) ? tpl.frontSvg : [],
        sideSvg: Array.isArray(tpl.sideSvg) ? tpl.sideSvg : [],
        planSvg: Array.isArray(tpl.planSvg) ? tpl.planSvg : [],
        isoBoxes: Array.isArray(tpl.isoBoxes) ? tpl.isoBoxes : []
    };
}

export { validateDsl, validateExpression, TEMPLATE_CATEGORIES };
