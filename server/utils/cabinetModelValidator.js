function isPositiveDimension(value) {
    return Number.isFinite(value) && value > 0 && value <= 10000;
}

function validatePart(part, label) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return `${label} must be an object.`;
    const required = part.tpl ? ['x', 'y', 'z'] : ['x', 'y', 'z', 'width', 'height', 'depth'];
    for (const key of required) {
        if (!Number.isFinite(part[key])) return `${label}.${key} must be a number.`;
    }
    if (part.width !== undefined && !isPositiveDimension(part.width)) return `${label}.width is invalid.`;
    if (part.height !== undefined && !isPositiveDimension(part.height)) return `${label}.height is invalid.`;
    if (part.depth !== undefined && !isPositiveDimension(part.depth)) return `${label}.depth is invalid.`;
    if (!part.tpl && (!isPositiveDimension(part.width) || !isPositiveDimension(part.height) || !isPositiveDimension(part.depth))) {
        return `${label} dimensions are invalid.`;
    }
    if (part.type !== undefined && typeof part.type !== 'string') return `${label}.type must be a string.`;
    if (part.label !== undefined && typeof part.label !== 'string') return `${label}.label must be a string.`;
    if (part.tpl !== undefined && typeof part.tpl !== 'string') return `${label}.tpl must be a string.`;
    if (part.style !== undefined && (typeof part.style !== 'object' || Array.isArray(part.style))) return `${label}.style must be an object.`;
    return null;
}

function validateRun(run, index) {
    const label = `runs[${index}]`;
    if (!run || typeof run !== 'object' || Array.isArray(run)) return `${label} must be an object.`;
    if (!run.origin || typeof run.origin !== 'object' || Array.isArray(run.origin)) return `${label}.origin must be an object.`;
    if (!Number.isFinite(run.origin.x) || !Number.isFinite(run.origin.z)) return `${label}.origin.x/z must be numbers.`;
    if (!['east', 'north', 'west', 'south'].includes(run.direction)) return `${label}.direction is invalid.`;
    if (!Array.isArray(run.modules) || run.modules.length === 0 || run.modules.length > 500) return `${label}.modules must contain 1-500 items.`;
    for (let i = 0; i < run.modules.length; i += 1) {
        const error = validatePart(run.modules[i], `${label}.modules[${i}]`);
        if (error) return error;
    }
    return null;
}

export function validateCabinetModel(model) {
    if (!model || typeof model !== 'object' || Array.isArray(model)) return { valid: false, message: 'cabinetModel must be an object.' };
    for (const key of ['width', 'height', 'depth']) {
        if (!isPositiveDimension(model[key])) return { valid: false, message: `${key} must be a valid positive number.` };
    }
    if (model.palette !== undefined && typeof model.palette !== 'string') return { valid: false, message: 'palette must be a string.' };
    if (model.inlineTemplates !== undefined && (typeof model.inlineTemplates !== 'object' || Array.isArray(model.inlineTemplates))) return { valid: false, message: 'inlineTemplates must be an object.' };
    const hasModules = Array.isArray(model.modules) && model.modules.length > 0;
    const hasRuns = Array.isArray(model.runs) && model.runs.length > 0;
    if (hasModules && hasRuns) return { valid: false, message: 'Use either modules or runs, not both.' };
    if (!hasModules && !hasRuns) return { valid: false, message: 'Model requires modules or runs.' };
    if (hasModules) {
        if (model.modules.length > 500) return { valid: false, message: 'modules must contain 1-500 items.' };
        for (let i = 0; i < model.modules.length; i += 1) {
            const error = validatePart(model.modules[i], `modules[${i}]`);
            if (error) return { valid: false, message: error };
        }
    }
    if (hasRuns) {
        if (model.runs.length > 20) return { valid: false, message: 'runs supports up to 20 items.' };
        for (let i = 0; i < model.runs.length; i += 1) {
            const error = validateRun(model.runs[i], i);
            if (error) return { valid: false, message: error };
        }
    }
    if (model.details !== undefined) {
        if (!Array.isArray(model.details) || model.details.length > 1000) return { valid: false, message: 'details must be an array of up to 1000 items.' };
        for (let i = 0; i < model.details.length; i += 1) {
            const error = validatePart(model.details[i], `details[${i}]`);
            if (error) return { valid: false, message: error };
        }
    }
    if (model.specs !== undefined && !Array.isArray(model.specs)) return { valid: false, message: 'specs must be an array.' };
    return { valid: true };
}

export { isPositiveDimension };
