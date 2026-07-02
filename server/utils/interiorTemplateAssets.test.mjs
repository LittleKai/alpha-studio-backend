import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTemplateForStorage } from './interiorTemplateAssets.js';

test('workshop template normalization maps side faces and legacy tokens', () => {
    const normalized = normalizeTemplateForStorage({
        id: 'mod-test-normalize',
        category: 'other',
        boxes: [
            { x: 0, y: 0, z: 0, w: 10, h: 10, d: 10, faces: { side: '$metal', top: '$woodLight', front: '$wood' } }
        ]
    });
    assert.equal(normalized.dsl.boxes[0].faces.left, '$handle');
    assert.equal(normalized.dsl.boxes[0].faces.right, '$handle');
    assert.equal(normalized.dsl.boxes[0].faces.top, '$woodFrontL');
    assert.equal(normalized.dsl.boxes[0].faces.front, '$woodFront');
    assert.equal(Object.hasOwn(normalized.dsl.boxes[0].faces, 'side'), false);
});
