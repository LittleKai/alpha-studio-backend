import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCatalogPromptSection } from './interiorCatalogPrompt.js';

function row(id, tags = []) {
    return {
        templateId: id,
        version: 1,
        category: 'other',
        tags,
        params: { width: { min: 10, max: 20, default: 15 } },
        styleOptions: { handle: { values: ['bar', 'knob'] } },
        description: { vi: `Mo ta ${id}`, en: `Description ${id}` }
    };
}

test('catalog prompt prioritizes relevant rows and caps output', () => {
    const rows = Array.from({ length: 70 }, (_, index) => row(`tpl-${index}`, index === 69 ? ['rounded', 'sink'] : []));
    const prompt = formatCatalogPromptSection(rows, { message: 'can bo goc rounded sink', maxRows: 10 });
    const tableRows = prompt.split('\n').filter((line) => line.startsWith('| tpl-'));
    assert.equal(tableRows.length, 10);
    assert.match(tableRows[0], /tpl-69/);
    assert.match(prompt, /Use two shapes with "if" instead of ternary|Dung 2 shape voi "if"/);
    assert.match(prompt, /style\.colors/);
});
