import crypto from 'node:crypto';

export const PALETTES = new Set(['wood-oak', 'wood-walnut', 'laminate-white', 'dark-modern']);
export const DIRECTIONS = new Set(['east', 'north', 'west', 'south']);

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
    });
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
