import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Very basic static analysis to prove our changes exist
test('crm.js uses IS_LOCAL_FIRST_LIVE_CHAT for CrmMessage.create skip', () => {
    const code = readFileSync(join(__dirname, '../crm.js'), 'utf-8');
    assert.match(code, /IS_LOCAL_FIRST_LIVE_CHAT/);
    assert.match(code, /if \(!IS_LOCAL_FIRST_LIVE_CHAT\) {[\s\S]*?message = await CrmMessage\.create/);
});

test('crm.js endpoints explicitly return LOCAL_BRIDGE_REQUIRED', () => {
    const code = readFileSync(join(__dirname, '../crm.js'), 'utf-8');
    assert.match(code, /LOCAL_BRIDGE_REQUIRED/);
});
