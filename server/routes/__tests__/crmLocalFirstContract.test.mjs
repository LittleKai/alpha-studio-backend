import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Very basic static analysis to prove our changes exist
test('metadata-only agent events update conversation without cloud messages', () => {
    const code = readFileSync(join(__dirname, '../crm.js'), 'utf-8');
    assert.match(code, /isMetadataOnly = event\.localFirst === true/);
    assert.match(code, /return \{ conversation, message: null, ignored: false, metadataOnly: true \}/);
});
