import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(join(__dirname, '../crm.js'), 'utf8');
const logSource = readFileSync(
    join(__dirname, '../../models/CrmChatbotLog.js'),
    'utf8'
);

test('agent chatbot config, generate, and audit routes exist', () => {
    assert.match(routeSource, /router\.get\('\/agent\/chatbot\/config'/);
    assert.match(routeSource, /'\/agent\/chatbot\/generate'/);
    assert.match(routeSource, /router\.post\('\/agent\/chatbot\/audit'/);
});

test('agent inbound route only persists metadata and never generates a reply', () => {
    const block = routeSource.match(
        /router\.post\('\/agent\/events\/message'[\s\S]*?\n\}\);/
    )?.[0] || '';
    assert.match(block, /upsertConversationFromInbound/);
    assert.doesNotMatch(block, /runCrmAiWithQuota|sendMessage|CrmAgentCommand/);
});

test('local-first metadata contract does not require content', () => {
    assert.match(routeSource, /isMetadataOnly = event\.localFirst === true/);
    assert.match(routeSource, /\(!isMetadataOnly && !content\)/);
    assert.match(routeSource, /metadataOnly: true/);
});

test('chatbot audit log has an idempotent owner-scoped index', () => {
    assert.match(logSource, /idempotencyKey/);
    assert.match(
        logSource,
        /\{ userId: 1, idempotencyKey: 1 \}[\s\S]*unique: true/
    );
});
