import crypto from 'node:crypto';

export const PALETTES = new Set(['wood-oak', 'wood-walnut', 'laminate-white', 'dark-modern']);
export const DIRECTIONS = new Set(['east', 'north', 'west', 'south']);
const TEMPLATE_DIMENSION_DEFAULTS = {
    'ac-recess-fold': { width: 86, height: 90, depth: 60 },
    'base-cabinet-2door': { width: 80, height: 86, depth: 60 },
    'base-drawer-stack': { width: 60, height: 86, depth: 60 },
    'corner-cabinet': { width: 90, height: 86, depth: 90 },
    'l-desk-return': { width: 138, height: 75, depth: 55 },
    'open-bookshelf': { width: 138, height: 80, depth: 35 },
    'sink-base': { width: 90, height: 86, depth: 60 },
    'sliding-2door': { width: 138, height: 186, depth: 60 },
    'sliding-3door': { width: 210, height: 220, depth: 60 },
    'tall-cabinet': { width: 70, height: 220, depth: 60 },
    'upper-2door': { width: 95, height: 90, depth: 60 },
    'upper-glass-2door': { width: 95, height: 90, depth: 60 },
    'wall-cabinet-2door': { width: 80, height: 75, depth: 35 }
};

export function ok() {
    return { valid: true };
}

export function invalid(message) {
    return { valid: false, errors: [message] };
}

export function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isPositiveNumber(value) {
    return Number.isFinite(value) && value > 0 && value <= 10000;
}

export function ensureDraft(model) {
    model.inlineTemplates = isObject(model.inlineTemplates) ? model.inlineTemplates : {};
    if (!Array.isArray(model.runs) || model.runs.length === 0) {
        const modules = Array.isArray(model.modules) ? model.modules : [];
        model.runs = [{ id: 'default', origin: { x: 0, z: 0 }, direction: 'east', modules }];
        delete model.modules;
    }
    model.runs.forEach((run, index) => {
        run.id = run.id || `run-${index + 1}`;
        run.origin = isObject(run.origin) ? run.origin : { x: 0, z: 0 };
        run.direction = DIRECTIONS.has(run.direction) ? run.direction : 'east';
        run.modules = Array.isArray(run.modules) ? run.modules : [];
        // Stamp IDs onto any module that lacks one. This covers legacy modules
        // coming from the default project model or earlier /chat-generated
        // versions — AI can only reference modules by id (module.update,
        // module.remove). Without this, model.preview returns id-less modules
        // and AI loops trying to figure out how to address them.
        run.modules.forEach((module) => {
            if (module && typeof module === 'object' && !module.id) {
                module.id = makeId('mod');
            }
        });
    });
    if (Array.isArray(model.details)) {
        model.details.forEach((detail) => {
            if (detail && typeof detail === 'object' && !detail.id) {
                detail.id = makeId('det');
            }
        });
    }
    return model;
}

export function applyTemplateDimensionDefaults(module) {
    if (!isObject(module) || typeof module.tpl !== 'string') return module;
    const defaults = TEMPLATE_DIMENSION_DEFAULTS[module.tpl];
    if (!defaults) return module;
    for (const key of ['width', 'height', 'depth']) {
        if (module[key] === undefined && isPositiveNumber(defaults[key])) {
            module[key] = defaults[key];
        }
    }
    return module;
}

export function applyTemplateDefaultsToModel(model) {
    ensureDraft(model);
    for (const run of model.runs) {
        for (const module of run.modules) {
            applyTemplateDimensionDefaults(module);
        }
    }
    return model;
}

export function findRun(ctx, runId) {
    ensureDraft(ctx.draftModel);
    return ctx.draftModel.runs.find((run) => run.id === runId) || null;
}

export function findModule(ctx, moduleId) {
    ensureDraft(ctx.draftModel);
    for (const run of ctx.draftModel.runs) {
        const index = run.modules.findIndex((module) => module.id === moduleId);
        if (index !== -1) return { run, module: run.modules[index], index };
    }
    return null;
}

export function moduleStats(model) {
    ensureDraft(model);
    const modules = model.runs.flatMap((run) => run.modules);
    return {
        moduleCount: modules.length,
        runCount: model.runs.length,
        inlineTemplateCount: Object.keys(model.inlineTemplates || {}).length,
        templateModuleCount: modules.filter((module) => module.tpl || module.tplInline).length
    };
}

export function makeId(prefix) {
    return `${prefix}-${crypto.randomBytes(3).toString('hex')}`;
}

export function cleanPatch(patch) {
    const allowed = ['tpl', 'tplInline', 'x', 'y', 'z', 'width', 'height', 'depth', 'style', 'label', 'kind', 'materialRef', 'color'];
    const output = {};
    for (const key of allowed) {
        if (patch[key] !== undefined) output[key] = patch[key];
    }
    return output;
}
