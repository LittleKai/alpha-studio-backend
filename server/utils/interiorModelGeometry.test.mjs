import test from 'node:test';
import assert from 'node:assert/strict';
import {
    appendModelWarnings,
    applyTemplateDimensionDefaults,
    collectTemplateDimensionDefaults,
    validateInteriorGeometry
} from './interiorModelGeometry.js';

test('applies template dimension defaults from params.default', () => {
    const defaults = collectTemplateDimensionDefaults([
        {
            templateId: 'wall-cabinet-2door',
            params: {
                width: { default: 80 },
                height: { default: 70 },
                depth: { default: 35 }
            }
        }
    ]);
    const model = {
        width: 80,
        height: 240,
        depth: 60,
        modules: [{ tpl: 'wall-cabinet-2door', x: 0, y: 145, z: 25 }]
    };

    const result = applyTemplateDimensionDefaults(model, defaults);

    assert.equal(result.applied, 3);
    assert.deepEqual(model.modules[0], {
        tpl: 'wall-cabinet-2door',
        x: 0,
        y: 145,
        z: 25,
        width: 80,
        height: 70,
        depth: 35
    });
    assert.deepEqual(result.warnings, []);
});

test('warns when a template module has missing dimensions and no defaults', () => {
    const model = {
        width: 80,
        height: 240,
        depth: 60,
        modules: [{ tpl: 'unknown-template', x: 0, y: 0, z: 0 }]
    };

    const result = applyTemplateDimensionDefaults(model, new Map());

    assert.equal(result.applied, 0);
    assert.match(result.warnings[0], /missing width, height, depth/);
});

test('geometry validation warns when occupied run length differs from model width', () => {
    const model = {
        width: 200,
        height: 240,
        depth: 60,
        modules: [
            { type: 'base-cabinet', x: 0, y: 0, z: 0, width: 90, height: 86, depth: 60 },
            { type: 'base-cabinet', x: 90, y: 0, z: 0, width: 80, height: 86, depth: 60 }
        ]
    };

    const warnings = validateInteriorGeometry(model);

    assert.ok(warnings.some((warning) => warning.includes('occupied length is 170cm, expected 200cm')));
});

test('geometry validation warns for out-of-bounds modules', () => {
    const model = {
        width: 120,
        height: 240,
        depth: 60,
        modules: [
            { type: 'base-cabinet', x: 80, y: 0, z: 0, width: 50, height: 86, depth: 60 }
        ]
    };

    const warnings = validateInteriorGeometry(model);

    assert.ok(warnings.some((warning) => warning.includes('out of bounds')));
});

test('geometry validation warns for overlapping modules in the same run and y range', () => {
    const model = {
        width: 160,
        height: 240,
        depth: 60,
        modules: [
            { type: 'base-cabinet', label: 'A', x: 0, y: 0, z: 0, width: 100, height: 86, depth: 60 },
            { type: 'base-cabinet', label: 'B', x: 80, y: 0, z: 0, width: 80, height: 86, depth: 60 }
        ]
    };

    const warnings = validateInteriorGeometry(model);

    assert.ok(warnings.some((warning) => warning.includes('A overlaps B')));
});

test('geometry validation warns when upper cabinet z does not align with lower depth', () => {
    const model = {
        width: 200,
        height: 240,
        depth: 60,
        runs: [
            {
                id: 'main',
                origin: { x: 0, z: 0 },
                direction: 'east',
                modules: [
                    { tpl: 'base-cabinet-2door', x: 10, y: 0, z: 0, width: 180, height: 86, depth: 60 },
                    { tpl: 'wall-cabinet-2door', x: 10, y: 145, z: 0, width: 180, height: 80, depth: 35 }
                ]
            }
        ]
    };

    const warnings = validateInteriorGeometry(model);

    assert.ok(warnings.some((warning) => warning.includes('z should be 25cm')));
});

test('appendModelWarnings deduplicates model validation warnings', () => {
    const model = { _validationWarnings: ['A'] };

    const warnings = appendModelWarnings(model, ['A', 'B']);

    assert.deepEqual(warnings, ['A', 'B']);
    assert.deepEqual(model._validationWarnings, ['A', 'B']);
});
