import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTemplateStructure } from '../templateValidator.js';

test('validateTemplateStructure accepts roundedBox and cylinder primitives', () => {
    const result = validateTemplateStructure({
        id: 'primitive-template',
        category: 'base-cabinet',
        params: {},
        boxes: [
            { type: 'roundedBox', x: 0, y: 0, z: 0, w: 80, h: 86, d: 60, radius: 8 },
            { type: 'cylinder', x: 20, y: 40, z: 62, radius: 2, length: 3, axis: 'z' }
        ]
    });
    assert.equal(result.valid, true);
});

test('validateTemplateStructure rejects unknown box primitive types', () => {
    const result = validateTemplateStructure({
        id: 'bad-primitive-template',
        category: 'base-cabinet',
        params: {},
        boxes: [{ type: 'freeformPath', d: 'M0 0 L10 10' }]
    });
    assert.equal(result.valid, false);
    assert.match(result.message, /Unsupported primitive type/);
});
