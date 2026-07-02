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
const ALLOWED_VIEWS = ['boxes', 'isoBoxes'];
const SVG_VIEWS = ['frontSvg', 'sideSvg', 'planSvg'];
const ALLOWED_PRIMITIVE_TYPES = new Set(['box', 'roundedBox', 'cylinder']);
const ALLOWED_CYLINDER_AXES = new Set(['x', 'y', 'z']);
const TEMPLATE_COLOR_TOKENS = new Set([
    'accent', 'accent2', 'bg',
    'cab', 'cabDark', 'cabEdge', 'cabLight', 'ceramic',
    'deskEdge', 'deskSide', 'deskTop', 'dim', 'dimLine',
    'fabric', 'fabricDark',
    'glass', 'glassBorder',
    'handle', 'handleEdge',
    'ledWarm',
    'metal', 'metalDark',
    'plantGreen',
    'stone', 'stoneDark',
    'wood', 'woodBack', 'woodDark', 'woodFront', 'woodFrontL', 'woodLight', 'woodSide', 'woodTop'
]);

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

function collectColorTokens(value) {
    if (typeof value !== 'string') return [];
    const tokens = [];
    const regex = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
    let match;
    while ((match = regex.exec(value)) !== null) tokens.push(match[1]);
    return tokens;
}

function validateDsl(dsl) {
    if (!dsl || typeof dsl !== 'object' || Array.isArray(dsl)) {
        return { valid: false, message: 'DSL must be an object.' };
    }
    for (const view of SVG_VIEWS) {
        if (dsl[view] !== undefined) {
            return { valid: false, message: "SVG view fields no longer supported. Use 'boxes' array only." };
        }
    }
    for (const view of ALLOWED_VIEWS) {
        const list = dsl[view];
        if (list === undefined) continue;
        if (!Array.isArray(list)) {
            return { valid: false, message: `${view} must be an array.` };
        }
        if (list.length > 200) {
            return { valid: false, message: `${view} max 200 shapes.` };
        }
        for (let i = 0; i < list.length; i += 1) {
            const shape = list[i];
            if (!shape || typeof shape !== 'object' || Array.isArray(shape)) {
                return { valid: false, message: `${view}[${i}] must be an object.` };
            }
            const primitiveType = shape.type || 'box';
            if (!ALLOWED_PRIMITIVE_TYPES.has(primitiveType)) {
                return { valid: false, message: `Unsupported primitive type in ${view}[${i}]: ${primitiveType}` };
            }
            if (primitiveType === 'cylinder' && shape.axis !== undefined && !ALLOWED_CYLINDER_AXES.has(shape.axis)) {
                return { valid: false, message: `Unsupported cylinder axis in ${view}[${i}]: ${shape.axis}` };
            }
            let badExpr = null;
            let badToken = null;
            walkShapeValues(shape, (value) => {
                if (badExpr) return;
                if (value.includes('{{') && !validateExpression(value)) badExpr = value;
                if (!badToken) {
                    badToken = collectColorTokens(value).find((token) => !TEMPLATE_COLOR_TOKENS.has(token)) || null;
                }
            });
            if (badExpr) {
                return { valid: false, message: `Invalid expression in ${view}[${i}]: ${badExpr.slice(0, 80)}` };
            }
            if (badToken) {
                return { valid: false, message: `Unknown color token in ${view}[${i}]: $${badToken}` };
            }
        }
    }
    if (!ALLOWED_VIEWS.some((view) => Array.isArray(dsl[view]) && dsl[view].length > 0)) {
        return { valid: false, message: "At least one non-empty 'boxes' array is required." };
    }
    return { valid: true };
}

function validateParams(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
        return { valid: false, message: 'params must be an object.' };
    }
    const keys = Object.keys(params);
    if (keys.length > 30) return { valid: false, message: 'params max 30 fields.' };
    for (const key of keys) {
        const def = params[key];
        if (!def || typeof def !== 'object') continue;
        if (def.min !== undefined && !Number.isFinite(def.min)) return { valid: false, message: `params.${key}.min must be a number.` };
        if (def.max !== undefined && !Number.isFinite(def.max)) return { valid: false, message: `params.${key}.max must be a number.` };
        if (def.default !== undefined && !Number.isFinite(def.default) && typeof def.default !== 'string') {
            return { valid: false, message: `params.${key}.default is invalid.` };
        }
    }
    return { valid: true };
}

export function validateTemplateStructure(tpl) {
    if (!tpl || typeof tpl !== 'object' || Array.isArray(tpl)) {
        return { valid: false, message: 'Template must be an object.' };
    }
    if (typeof tpl.id !== 'string' || !ID_REGEX.test(tpl.id)) {
        return { valid: false, message: 'Template id is missing or not kebab-case.' };
    }
    if (!tpl.category || !TEMPLATE_CATEGORIES.has(tpl.category)) {
        return { valid: false, message: `Invalid category. Allowed: ${[...TEMPLATE_CATEGORIES].join(', ')}.` };
    }
    if (tpl.tags !== undefined && !Array.isArray(tpl.tags)) {
        return { valid: false, message: 'tags must be an array of strings.' };
    }
    const paramsCheck = validateParams(tpl.params || {});
    if (!paramsCheck.valid) return paramsCheck;
    const dslHost = tpl.dsl && typeof tpl.dsl === 'object' && !Array.isArray(tpl.dsl) ? tpl.dsl : tpl;
    return validateDsl(dslHost);
}

export function extractDsl(tpl) {
    if (!tpl || typeof tpl !== 'object') return {};
    const source = tpl.dsl && typeof tpl.dsl === 'object' && !Array.isArray(tpl.dsl) ? tpl.dsl : tpl;
    return {
        boxes: Array.isArray(source.boxes) ? source.boxes : (Array.isArray(source.isoBoxes) ? source.isoBoxes : [])
    };
}

export { validateDsl, validateExpression, TEMPLATE_CATEGORIES, TEMPLATE_COLOR_TOKENS };
