const DIMENSION_KEYS = ['width', 'height', 'depth'];
const RUN_DIRECTIONS = new Set(['east', 'north', 'west', 'south']);
const GEOMETRY_TOLERANCE_CM = 2;

function finiteNumber(value) {
    return Number.isFinite(value) ? value : null;
}

function positiveNumber(value) {
    return Number.isFinite(value) && value > 0 ? value : null;
}

function labelFor(item, fallback) {
    return item?.id || item?.label || item?.tpl || item?.type || fallback;
}

function extractDefault(params, key) {
    const config = params && typeof params === 'object' ? params[key] : null;
    if (!config || typeof config !== 'object') return null;
    return positiveNumber(config.default);
}

export function collectTemplateDimensionDefaults(definitions) {
    const defaults = new Map();
    const list = Array.isArray(definitions)
        ? definitions
        : Object.values(definitions || {});

    list.forEach((template) => {
        if (!template || typeof template !== 'object') return;
        const id = template.templateId || template.id;
        if (typeof id !== 'string' || defaults.has(id)) return;
        const params = template.params || {};
        const entry = {};
        DIMENSION_KEYS.forEach((key) => {
            const value = extractDefault(params, key);
            if (value != null) entry[key] = value;
        });
        if (Object.keys(entry).length > 0) defaults.set(id, entry);
    });

    return defaults;
}

export function collectTemplateIds(model) {
    const ids = new Set();
    allModuleLists(model).forEach(({ modules }) => {
        modules.forEach((item) => {
            if (typeof item?.tpl === 'string') ids.add(item.tpl);
        });
    });
    return Array.from(ids);
}

export function appendModelWarnings(model, warnings) {
    if (!model || typeof model !== 'object') return [];
    const merged = Array.from(new Set([
        ...(Array.isArray(model._validationWarnings) ? model._validationWarnings : []),
        ...(Array.isArray(warnings) ? warnings.filter(Boolean) : [])
    ]));
    if (merged.length > 0) model._validationWarnings = merged;
    return merged;
}

export function applyTemplateDimensionDefaults(model, templateDefaults) {
    const warnings = [];
    let applied = 0;

    allModuleLists(model).forEach(({ modules, path }) => {
        modules.forEach((item, index) => {
            if (!item || typeof item !== 'object' || typeof item.tpl !== 'string') return;
            const defaults = templateDefaults instanceof Map ? templateDefaults.get(item.tpl) : templateDefaults?.[item.tpl];
            const missing = [];
            DIMENSION_KEYS.forEach((key) => {
                if (positiveNumber(item[key]) != null) return;
                const fallback = defaults ? positiveNumber(defaults[key]) : null;
                if (fallback != null) {
                    item[key] = fallback;
                    applied += 1;
                } else {
                    missing.push(key);
                }
            });
            if (missing.length > 0) {
                warnings.push(`Template dimensions: ${path}[${index}] "${labelFor(item, item.tpl)}" is missing ${missing.join(', ')} and no template defaults were found.`);
            }
        });
    });

    return { model, warnings, applied };
}

function allModuleLists(model) {
    if (!model || typeof model !== 'object') return [];
    const lists = [];
    if (Array.isArray(model.modules)) {
        lists.push({
            id: 'modules',
            expectedLength: positiveNumber(model.width),
            run: { id: 'modules', origin: { x: 0, z: 0 }, direction: 'east', modules: model.modules },
            modules: model.modules,
            path: 'modules'
        });
    }
    if (Array.isArray(model.runs)) {
        model.runs.forEach((run, index) => {
            if (!run || typeof run !== 'object' || !Array.isArray(run.modules)) return;
            const direction = RUN_DIRECTIONS.has(run.direction) ? run.direction : 'east';
            lists.push({
                id: run.id || `run-${index + 1}`,
                expectedLength: direction === 'north' || direction === 'south'
                    ? positiveNumber(model.depth)
                    : positiveNumber(model.width),
                run: { ...run, direction },
                modules: run.modules,
                path: `runs[${index}].modules`
            });
        });
    }
    return lists;
}

function resolveRunCoord(run, moduleIndex, item) {
    const modules = Array.isArray(run.modules) ? run.modules : [];
    const current = item || modules[moduleIndex] || {};
    const direction = RUN_DIRECTIONS.has(run.direction) ? run.direction : 'east';
    const origin = run.origin || {};
    const localX = finiteNumber(current.x) ?? 0;
    const localY = finiteNumber(current.y) ?? 0;
    const localZ = finiteNumber(current.z) ?? 0;
    const originX = finiteNumber(origin.x) ?? 0;
    const originZ = finiteNumber(origin.z) ?? 0;
    // Mirrors engine model.js resolveRunCoord: `x` is the position ALONG the
    // run axis for every direction, `z` is the perpendicular depth offset from
    // the run's wall line. Auto-offset by module order when no explicit x.
    const hasExplicitAlong = modules.some((module) => Number.isFinite(module?.x) && module.x > 0);
    const along = (hasExplicitAlong
        ? 0
        : modules.slice(0, moduleIndex).reduce((sum, module) => sum + (positiveNumber(module?.width) || 0), 0)) + localX;
    if (direction === 'north') return { x: originX + localZ, y: localY, z: originZ - along, _runDirection: direction };
    if (direction === 'west') return { x: originX - along, y: localY, z: originZ + localZ, _runDirection: direction };
    if (direction === 'south') return { x: originX + localZ, y: localY, z: originZ + along, _runDirection: direction };
    return { x: originX + along, y: localY, z: originZ + localZ, _runDirection: direction };
}

function itemFootprint(item) {
    const direction = item._runDirection || 'east';
    if (direction === 'north') {
        return { minX: item.x, maxX: item.x + item.depth, minZ: item.z - item.width, maxZ: item.z };
    }
    if (direction === 'west') {
        return { minX: item.x - item.width, maxX: item.x, minZ: item.z, maxZ: item.z + item.depth };
    }
    if (direction === 'south') {
        return { minX: item.x, maxX: item.x + item.depth, minZ: item.z, maxZ: item.z + item.width };
    }
    return { minX: item.x, maxX: item.x + item.width, minZ: item.z, maxZ: item.z + item.depth };
}

function axisRange(item, footprint) {
    const direction = item._runDirection || 'east';
    return direction === 'north' || direction === 'south'
        ? [footprint.minZ, footprint.maxZ]
        : [footprint.minX, footprint.maxX];
}

function unionLength(intervals) {
    const sorted = intervals
        .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
        .sort((a, b) => a[0] - b[0]);
    if (sorted.length === 0) return null;
    let total = 0;
    let [currentStart, currentEnd] = sorted[0];
    sorted.slice(1).forEach(([start, end]) => {
        if (start <= currentEnd) {
            currentEnd = Math.max(currentEnd, end);
            return;
        }
        total += currentEnd - currentStart;
        currentStart = start;
        currentEnd = end;
    });
    return total + currentEnd - currentStart;
}

function overlaps(aMin, aMax, bMin, bMax, tolerance) {
    return Math.min(aMax, bMax) - Math.max(aMin, bMin) > tolerance;
}

function classifyCabinet(item) {
    const text = [
        item.tpl,
        item.type,
        item.kind,
        item.label,
        item.category,
        ...(Array.isArray(item.tags) ? item.tags : [])
    ].filter(Boolean).join(' ').toLowerCase();
    const isUpper = /\b(upper|wall|ceiling|ac|overhead)\b/.test(text)
        || (positiveNumber(item.y) != null && item.y >= 120 && positiveNumber(item.depth) != null && item.depth <= 45);
    const isLower = /\b(base|lower|sink|drawer|corner)\b/.test(text)
        || (positiveNumber(item.y) != null && item.y <= 10 && positiveNumber(item.height) != null && item.height <= 110);
    return { isUpper, isLower };
}

function preparedRunItems(list) {
    return list.modules.map((item, index) => {
        const width = positiveNumber(item?.width);
        const height = positiveNumber(item?.height);
        const depth = positiveNumber(item?.depth);
        if (width == null || height == null || depth == null) return null;
        const coord = resolveRunCoord(list.run, index, item);
        const resolved = { ...item, ...coord, width, height, depth, _path: `${list.path}[${index}]` };
        const footprint = itemFootprint(resolved);
        return {
            raw: item,
            resolved,
            footprint,
            axis: axisRange(resolved, footprint),
            label: labelFor(item, `${list.path}[${index}]`),
            classInfo: classifyCabinet(item)
        };
    }).filter(Boolean);
}

export function validateInteriorGeometry(model, options = {}) {
    const tolerance = positiveNumber(options.toleranceCm) || GEOMETRY_TOLERANCE_CM;
    const warnings = [];
    const modelWidth = positiveNumber(model?.width);
    const modelHeight = positiveNumber(model?.height);
    const modelDepth = positiveNumber(model?.depth);
    if (modelWidth == null || modelHeight == null || modelDepth == null) return warnings;

    // For L/U/multi-wall layouts a single run legitimately covers only part of
    // the model span (the corner block belongs to the other run), so undershoot
    // is only reported for single-run / legacy straight layouts.
    const lists = allModuleLists(model);
    const multiRun = lists.length > 1;

    lists.forEach((list) => {
        const items = preparedRunItems(list);
        const intervals = items.map((item) => item.axis);
        const occupiedLength = unionLength(intervals);
        if (occupiedLength != null && list.expectedLength != null) {
            const diff = occupiedLength - list.expectedLength;
            if (diff > tolerance) {
                warnings.push(`Geometry: ${list.id} occupied length is ${occupiedLength}cm, exceeding expected ${list.expectedLength}cm (diff ${Math.round(diff)}cm).`);
            } else if (!multiRun && Math.abs(diff) > tolerance) {
                warnings.push(`Geometry: ${list.id} occupied length is ${occupiedLength}cm, expected ${list.expectedLength}cm (diff ${Math.round(Math.abs(diff))}cm).`);
            }
        }

        items.forEach((item) => {
            const top = item.resolved.y + item.resolved.height;
            if (
                item.footprint.minX < -tolerance
                || item.footprint.maxX > modelWidth + tolerance
                || item.footprint.minZ < -tolerance
                || item.footprint.maxZ > modelDepth + tolerance
                || item.resolved.y < -tolerance
                || top > modelHeight + tolerance
            ) {
                warnings.push(`Geometry: ${item.label} is out of bounds (${Math.round(item.footprint.minX)}..${Math.round(item.footprint.maxX)} x, ${Math.round(item.resolved.y)}..${Math.round(top)} y, ${Math.round(item.footprint.minZ)}..${Math.round(item.footprint.maxZ)} z) for model ${modelWidth}x${modelHeight}x${modelDepth}cm.`);
            }
        });

        for (let i = 0; i < items.length; i += 1) {
            for (let j = i + 1; j < items.length; j += 1) {
                const a = items[i];
                const b = items[j];
                if (
                    overlaps(a.resolved.y, a.resolved.y + a.resolved.height, b.resolved.y, b.resolved.y + b.resolved.height, tolerance)
                    && overlaps(a.footprint.minX, a.footprint.maxX, b.footprint.minX, b.footprint.maxX, tolerance)
                    && overlaps(a.footprint.minZ, a.footprint.maxZ, b.footprint.minZ, b.footprint.maxZ, tolerance)
                ) {
                    warnings.push(`Geometry: ${a.label} overlaps ${b.label} in ${list.id}.`);
                }
            }
        }

        const lowers = items.filter((item) => item.classInfo.isLower);
        const uppers = items.filter((item) => item.classInfo.isUpper);
        uppers.forEach((upper) => {
            lowers.forEach((lower) => {
                if (!overlaps(upper.axis[0], upper.axis[1], lower.axis[0], lower.axis[1], tolerance)) return;
                if (upper.resolved.y < lower.resolved.y + lower.resolved.height - tolerance) return;
                const expectedZ = lower.raw.depth - upper.raw.depth;
                if (Number.isFinite(expectedZ) && Math.abs((upper.raw.z || 0) - expectedZ) > tolerance) {
                    warnings.push(`Geometry: ${upper.label} z should be ${expectedZ}cm relative to ${lower.label} on ${list.id}; got ${upper.raw.z || 0}cm.`);
                }
            });
        });
    });

    return Array.from(new Set(warnings));
}
