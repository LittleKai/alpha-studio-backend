# MongoDB Atlas M0 Storage Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep binary/media outside MongoDB, reduce retained log/history and index storage, and make the backend operate safely on Atlas M0 without breaking existing API response shapes.

**Architecture:** Add focused shared modules for retention, media validation, storage, and migration instead of restructuring existing routes. Existing URL fields remain intact; object storage adapters handle bytes, model/route guards reject inline media, TTL uses explicit `purgeAt` where business expiry differs from deletion, and archived interior versions are hydrated before API responses.

**Tech Stack:** Node.js 18+, ES modules, Express 5, Mongoose 8, Node built-in test runner, AWS SDK S3 client for Backblaze B2.

---

## File Map

**New shared modules**

- `server/config/database.js`: parse and validate Atlas M0 pool settings.
- `server/db/lifecycle.js`: singleton connect/disconnect and readiness state.
- `server/storage/index.js`: select B2 or local adapter.
- `server/storage/b2StorageAdapter.js`: object-storage implementation using existing B2 helpers.
- `server/storage/localStorageAdapter.js`: development/test implementation.
- `server/storage/storageMetadata.js`: checksum, key generation, canonical metadata.
- `server/validation/inlineMedia.js`: recursive detection and Mongoose validation helper.
- `server/retention/policy.js`: retention durations and `purgeAt` calculations.
- `server/retention/interiorVersionArchive.js`: archive and hydrate interior version chunks.
- `server/utils/webhookSanitizer.js`: redact and compact webhook diagnostic data.
- `server/migrations/m0/mediaFields.js`: known media field registry.
- `server/migrations/m0/scan.js`: collection/media/index inventory.
- `server/migrations/m0/apply.js`: idempotent uploads and conditional updates.
- `server/migrations/m0/manifest.js`: JSONL manifest writer/reader.
- `server/migrations/m0/rollback.js`: guarded reverse migration.
- `scripts/migrate-mongodb-m0.mjs`: dry-run/apply CLI.
- `scripts/rollback-mongodb-m0.mjs`: rollback CLI.
- `scripts/audit-mongodb-m0.mjs`: collection classification/index audit CLI.

**New tests**

- `test/database-config.test.js`
- `test/database-lifecycle.test.js`
- `test/storage-adapters.test.js`
- `test/inline-media.test.js`
- `test/retention.test.js`
- `test/webhook-sanitizer.test.js`
- `test/interior-version-archive.test.js`
- `test/mongodb-m0-migration.test.js`
- `test/mongodb-m0-rollback.test.js`
- `test/mongodb-m0-audit.test.js`

**Runtime files modified**

- `server/index.js`
- `server/db/connection.js`
- `server/utils/b2Storage.js`
- `server/routes/payment.js`
- `server/routes/cloud.js`
- `server/routes/chat.js`
- `server/routes/crm.js`
- `server/routes/interior.js`
- `server/routes/workflow.js`
- `server/tools/interior/model-commit.js`
- media-owning models under `server/models/`
- retention models under `server/models/`

**Documentation/config modified**

- `package.json`
- `.env.example`
- `README.md`
- `.claude/DATABASE.md`
- `.claude/PROJECT_SUMMARY.md`
- `docs/database/MONGODB_M0_COLLECTION_AUDIT.md`

### Task 1: Add Test Harness and Shared Policy Constants

**Files:**
- Create: `alpha-studio-backend/server/config/database.js`
- Create: `alpha-studio-backend/server/retention/policy.js`
- Create: `alpha-studio-backend/test/database-config.test.js`
- Create: `alpha-studio-backend/test/retention.test.js`
- Modify: `alpha-studio-backend/package.json`

- [ ] **Step 1: Write failing configuration tests**

```js
// test/database-config.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMongoOptions } from '../server/config/database.js';

test('uses Atlas M0-friendly pool defaults', () => {
  assert.deepEqual(buildMongoOptions({}), {
    maxPoolSize: 5,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxIdleTimeMS: 60000,
  });
});

test('rejects a minimum pool larger than maximum pool', () => {
  assert.throws(
    () => buildMongoOptions({ MONGODB_MAX_POOL_SIZE: '2', MONGODB_MIN_POOL_SIZE: '3' }),
    /MIN_POOL_SIZE/
  );
});
```

- [ ] **Step 2: Write failing retention tests**

```js
// test/retention.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RETENTION_MS,
  terminalPurgeAt,
  compactTerminalAgentState,
} from '../server/retention/policy.js';

test('calculates queue purge seven days after terminal time', () => {
  const finishedAt = new Date('2026-06-12T00:00:00.000Z');
  assert.equal(
    terminalPurgeAt('queue', finishedAt).toISOString(),
    '2026-06-19T00:00:00.000Z'
  );
});

test('removes resumable payload from terminal agent logs', () => {
  assert.deepEqual(compactTerminalAgentState({
    status: 'committed',
    messages: [{ role: 'user', content: 'large' }],
    draftModel: { modules: [] },
  }), {
    status: 'committed',
    messages: [],
    draftModel: null,
  });
});

test('retention constants match approved policy', () => {
  assert.equal(RETENTION_MS.technicalLog, 30 * 24 * 60 * 60 * 1000);
  assert.equal(RETENTION_MS.webhook, 90 * 24 * 60 * 60 * 1000);
  assert.equal(RETENTION_MS.crmHistory, 365 * 24 * 60 * 60 * 1000);
});
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
npm.cmd test -- test/database-config.test.js test/retention.test.js
```

Expected: FAIL because the imported modules do not exist.

- [ ] **Step 4: Implement policy modules**

```js
// server/config/database.js
function positiveInt(env, name, fallback, { allowZero = false } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be ${allowZero ? 'zero or ' : ''}a positive integer`);
  }
  return value;
}

export function buildMongoOptions(env = process.env) {
  const maxPoolSize = positiveInt(env, 'MONGODB_MAX_POOL_SIZE', 5);
  const minPoolSize = positiveInt(env, 'MONGODB_MIN_POOL_SIZE', 0, { allowZero: true });
  if (minPoolSize > maxPoolSize) {
    throw new Error('MONGODB_MIN_POOL_SIZE cannot exceed MONGODB_MAX_POOL_SIZE');
  }
  return {
    maxPoolSize,
    minPoolSize,
    serverSelectionTimeoutMS: positiveInt(env, 'MONGODB_SERVER_SELECTION_TIMEOUT_MS', 5000),
    socketTimeoutMS: positiveInt(env, 'MONGODB_SOCKET_TIMEOUT_MS', 45000),
    maxIdleTimeMS: positiveInt(env, 'MONGODB_MAX_IDLE_TIME_MS', 60000),
  };
}
```

```js
// server/retention/policy.js
const DAY = 24 * 60 * 60 * 1000;

export const RETENTION_MS = Object.freeze({
  queue: 7 * DAY,
  technicalLog: 30 * DAY,
  webhook: 90 * DAY,
  crmHistory: 365 * DAY,
  cloudSession: 365 * DAY,
  chatHistory: 365 * DAY,
});

export function terminalPurgeAt(kind, terminalAt = new Date()) {
  const duration = RETENTION_MS[kind];
  if (!duration) throw new Error(`Unknown retention kind: ${kind}`);
  return new Date(new Date(terminalAt).getTime() + duration);
}

export function compactTerminalAgentState(update) {
  if (!['committed', 'aborted', 'error'].includes(update.status)) return update;
  return { ...update, messages: [], draftModel: null };
}
```

- [ ] **Step 5: Add test scripts**

```json
"scripts": {
  "test": "node --test",
  "test:mongodb-m0": "node --test test/*mongodb-m0*.test.js test/storage-adapters.test.js test/inline-media.test.js test/retention.test.js",
  "check": "node --check server/index.js"
}
```

Preserve all existing scripts while adding these entries.

- [ ] **Step 6: Run tests and verify GREEN**

Run:

```powershell
npm.cmd test -- test/database-config.test.js test/retention.test.js
```

Expected: 5 tests pass.

- [ ] **Step 7: Commit**

```powershell
git add package.json server/config/database.js server/retention/policy.js test/database-config.test.js test/retention.test.js
git commit -m "test: add MongoDB M0 policy harness"
```

### Task 2: Add Storage Adapter Contract

**Files:**
- Create: `alpha-studio-backend/server/storage/storageMetadata.js`
- Create: `alpha-studio-backend/server/storage/localStorageAdapter.js`
- Create: `alpha-studio-backend/server/storage/b2StorageAdapter.js`
- Create: `alpha-studio-backend/server/storage/index.js`
- Create: `alpha-studio-backend/test/storage-adapters.test.js`
- Modify: `alpha-studio-backend/server/utils/b2Storage.js`

- [ ] **Step 1: Write failing adapter contract tests**

```js
// test/storage-adapters.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStorageAdapter } from '../server/storage/localStorageAdapter.js';
import { B2StorageAdapter } from '../server/storage/b2StorageAdapter.js';

test('local adapter uploads, verifies, resolves, and deletes bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'alpha-storage-'));
  const adapter = new LocalStorageAdapter({ root, publicBaseUrl: 'http://localhost/files' });
  const result = await adapter.put({
    key: 'migration/test.txt',
    body: Buffer.from('hello'),
    contentType: 'text/plain',
    filename: 'test.txt',
  });
  assert.equal(result.provider, 'local');
  assert.equal(await adapter.exists(result.key), true);
  assert.equal(await readFile(path.join(root, result.key), 'utf8'), 'hello');
  await adapter.delete(result.key);
  assert.equal(await adapter.exists(result.key), false);
  await rm(root, { recursive: true, force: true });
});

test('B2 adapter delegates to injected object operations', async () => {
  const calls = [];
  const adapter = new B2StorageAdapter({
    putObject: async (input) => { calls.push(['put', input]); return { key: input.key, publicUrl: `https://cdn/${input.key}` }; },
    headObject: async (key) => ({ exists: key === 'a.txt', size: 5 }),
    deleteObject: async (key) => calls.push(['delete', key]),
  });
  const result = await adapter.put({ key: 'a.txt', body: Buffer.from('hello'), contentType: 'text/plain', filename: 'a.txt' });
  assert.equal(result.checksum.length, 64);
  assert.equal(await adapter.exists('a.txt'), true);
  await adapter.delete('a.txt');
  assert.equal(calls.at(-1)[0], 'delete');
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node --test test/storage-adapters.test.js
```

Expected: FAIL because storage adapter modules do not exist.

- [ ] **Step 3: Implement metadata and adapters**

`storageMetadata.js` must export:

```js
import crypto from 'node:crypto';

export function sha256(body) {
  return crypto.createHash('sha256').update(body).digest('hex');
}

export function buildStorageMetadata({ provider, key, url, filename, mimeType, size, body }) {
  return { provider, key, url, filename, mimeType, size, checksum: sha256(body) };
}

export function migrationObjectKey({ collection, documentId, fieldPath, checksum, extension }) {
  return `migrations/mongodb-m0/${collection}/${documentId}/${fieldPath.replaceAll('.', '-')}-${checksum.slice(0, 16)}${extension}`;
}
```

`LocalStorageAdapter` must use `fs/promises`, reject paths escaping its root,
write via a temporary file plus rename, and return canonical metadata.

`B2StorageAdapter` must accept injected operations for tests and default to
`uploadFile`, `headFile`, and `deleteFile` from `utils/b2Storage.js`.

`storage/index.js` must export:

```js
export function createStorage(env = process.env) {
  if ((env.STORAGE_PROVIDER || 'b2') === 'local') {
    return new LocalStorageAdapter({
      root: env.LOCAL_STORAGE_ROOT || './.data/storage',
      publicBaseUrl: env.LOCAL_STORAGE_PUBLIC_URL || 'http://localhost:3001/storage',
    });
  }
  return new B2StorageAdapter();
}
```

- [ ] **Step 4: Add B2 existence verification**

Add `HeadObjectCommand` import and:

```js
export async function headFile(key) {
  try {
    const response = await getS3().send(new HeadObjectCommand({
      Bucket: process.env.B2_BUCKET_NAME,
      Key: key,
    }));
    return { exists: true, size: response.ContentLength ?? null, contentType: response.ContentType ?? null };
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') {
      return { exists: false, size: null, contentType: null };
    }
    throw error;
  }
}
```

- [ ] **Step 5: Run adapter tests**

Run:

```powershell
node --test test/storage-adapters.test.js
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```powershell
git add server/storage server/utils/b2Storage.js test/storage-adapters.test.js
git commit -m "feat: add object storage abstraction"
```

### Task 3: Reject Inline Media Before MongoDB Persistence

**Files:**
- Create: `alpha-studio-backend/server/validation/inlineMedia.js`
- Create: `alpha-studio-backend/test/inline-media.test.js`
- Modify: `alpha-studio-backend/server/models/User.js`
- Modify: `alpha-studio-backend/server/models/Course.js`
- Modify: `alpha-studio-backend/server/models/Prompt.js`
- Modify: `alpha-studio-backend/server/models/Resource.js`
- Modify: `alpha-studio-backend/server/models/WorkflowProject.js`
- Modify: `alpha-studio-backend/server/models/WorkflowDocument.js`
- Modify: `alpha-studio-backend/server/models/InteriorProject.js`
- Modify: `alpha-studio-backend/server/models/InteriorAnalysis.js`
- Modify: `alpha-studio-backend/server/models/InteriorRender.js`
- Modify: `alpha-studio-backend/server/models/StudioGeneration.js`
- Modify: `alpha-studio-backend/server/models/Vocab.js`
- Modify: `alpha-studio-backend/server/models/CrmMessage.js`
- Modify: `alpha-studio-backend/server/index.js`

- [ ] **Step 1: Write failing recursive validation tests**

```js
// test/inline-media.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InlineMediaError,
  assertNoInlineMedia,
  noInlineMediaPlugin,
} from '../server/validation/inlineMedia.js';

test('accepts URLs and object keys', () => {
  assert.doesNotThrow(() => assertNoInlineMedia({
    avatar: 'https://cdn.example/avatar.png',
    fileKey: 'resources/file.zip',
  }));
});

test('rejects nested data URLs, buffers, and BSON-like binary', () => {
  assert.throws(() => assertNoInlineMedia({ attachments: [{ url: 'data:image/png;base64,AAAA' }] }), InlineMediaError);
  assert.throws(() => assertNoInlineMedia({ image: Buffer.from('x') }), InlineMediaError);
  assert.throws(() => assertNoInlineMedia({ audio: { _bsontype: 'Binary', buffer: Buffer.from('x') } }), InlineMediaError);
});

test('ignores ordinary long text fields', () => {
  assert.doesNotThrow(() => assertNoInlineMedia({ content: 'A'.repeat(100_000) }));
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node --test test/inline-media.test.js
```

Expected: FAIL because validation module does not exist.

- [ ] **Step 3: Implement recursive validator and plugin**

The module must:

- detect `Buffer`, `Uint8Array`, BSON Binary, and `data:*;base64`;
- inspect only media-like paths matching
  `/(url|key|file|image|audio|video|avatar|thumbnail|attachment|media|background)/i`
  for base64-looking plain strings;
- cap recursion depth and handle cycles;
- throw `InlineMediaError` with `code = 'INLINE_MEDIA_NOT_ALLOWED'` and the field path;
- expose `noInlineMediaPlugin(schema)` using `schema.pre('validate')`.

```js
export function noInlineMediaPlugin(schema) {
  schema.pre('validate', function validateInlineMedia() {
    assertNoInlineMedia(this.toObject({ depopulate: true, virtuals: false }));
  });
}
```

- [ ] **Step 4: Apply plugin to media-owning schemas**

Import and call `schema.plugin(noInlineMediaPlugin)` on the listed models.
For `Vocab.js`, apply it to public/private deck, flashcard, and profile schemas.
Do not apply it to AI request payloads that are never persisted.

- [ ] **Step 5: Map validation errors to the existing API envelope**

Before the generic error handler in `server/index.js`, add:

```js
if (err?.code === 'INLINE_MEDIA_NOT_ALLOWED') {
  return res.status(422).json({
    success: false,
    message: `Inline file/media is not allowed at ${err.path}. Upload it first and store its URL.`,
  });
}
```

- [ ] **Step 6: Run tests and syntax checks**

Run:

```powershell
node --test test/inline-media.test.js
node --check server/index.js
node --check server/models/Vocab.js
```

Expected: tests pass and syntax checks exit 0.

- [ ] **Step 7: Commit**

```powershell
git add server/validation server/models server/index.js test/inline-media.test.js
git commit -m "feat: prevent inline media persistence"
```

### Task 4: Make MongoDB Connection and Server Lifecycle M0-Safe

**Files:**
- Create: `alpha-studio-backend/server/db/lifecycle.js`
- Create: `alpha-studio-backend/test/database-lifecycle.test.js`
- Modify: `alpha-studio-backend/server/db/connection.js`
- Modify: `alpha-studio-backend/server/index.js`

- [ ] **Step 1: Write failing singleton/lifecycle tests**

Use injected fake Mongoose and HTTP server objects:

```js
test('deduplicates concurrent connect calls', async () => {
  let calls = 0;
  const fake = { connection: { readyState: 0 }, connect: async () => { calls += 1; fake.connection.readyState = 1; } };
  const lifecycle = createDatabaseLifecycle({ mongoose: fake, uri: 'mongodb://test', options: {} });
  await Promise.all([lifecycle.connect(), lifecycle.connect()]);
  assert.equal(calls, 1);
});

test('shutdown closes HTTP server before MongoDB', async () => {
  const order = [];
  await shutdown({
    server: { close: (done) => { order.push('http'); done(); } },
    disconnect: async () => order.push('mongo'),
  });
  assert.deepEqual(order, ['http', 'mongo']);
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node --test test/database-lifecycle.test.js
```

Expected: FAIL because lifecycle exports do not exist.

- [ ] **Step 3: Implement singleton lifecycle**

`createDatabaseLifecycle` holds one in-flight promise, returns immediately when
ready state is connected, resets the promise after a failed connection, and
exposes `connect`, `disconnect`, and `isReady`.

`server/db/connection.js` becomes a thin singleton:

```js
const lifecycle = createDatabaseLifecycle({
  mongoose,
  uri: process.env.MONGODB_URI,
  options: buildMongoOptions(process.env),
  afterConnect: cleanupStaleIndexes,
});

export const connectDB = () => lifecycle.connect();
export const disconnectDB = () => lifecycle.disconnect();
export const isDatabaseReady = () => lifecycle.isReady();
export default connectDB;
```

- [ ] **Step 4: Refactor startup ordering**

Move listener creation into exported `startServer()`:

```js
export async function startServer() {
  await connectDB();
  await configureBucketCors();
  const server = app.listen(PORT, onListening);
  server.setTimeout(15 * 60 * 1000);
  registerShutdownHandlers(server);
  return server;
}

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((error) => {
    console.error('Server startup failed:', error);
    process.exitCode = 1;
  });
}
```

Health readiness must return 503 when Mongoose is not ready while preserving
`/api/health` as liveness.

- [ ] **Step 5: Run tests and checks**

Run:

```powershell
node --test test/database-lifecycle.test.js test/database-config.test.js
node --check server/db/connection.js
node --check server/index.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add server/db server/index.js test/database-lifecycle.test.js
git commit -m "refactor: harden MongoDB connection lifecycle"
```

### Task 5: Add TTL Fields and Indexes Without Deleting Active Records

**Files:**
- Modify: `server/models/WebhookLog.js`
- Modify: `server/models/ChatMessage.js`
- Modify: `server/models/CrmAuditLog.js`
- Modify: `server/models/CrmExecutionLog.js`
- Modify: `server/models/CrmChatbotLog.js`
- Modify: `server/models/CrmMessage.js`
- Modify: `server/models/CrmGroupMessage.js`
- Modify: `server/models/CrmAgentCommand.js`
- Modify: `server/models/CloudSession.js`
- Modify: `server/models/InteriorAiLog.js`
- Modify: `server/models/InteriorAgentLog.js`
- Modify: `test/retention.test.js`

- [ ] **Step 1: Extend failing tests to inspect schema indexes**

Assert:

- Webhook `createdAt` TTL is 90 days.
- CRM history `createdAt` TTL is 365 days.
- Chat history `createdAt` TTL is 365 days.
- `CrmAgentCommand.purgeAt` and `CloudSession.purgeAt` have
  `{ expireAfterSeconds: 0 }`.
- `CrmAgentCommand.expiresAt` is not a TTL index.

Use `Model.schema.indexes()` and compare key/options pairs.

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node --test test/retention.test.js
```

Expected: FAIL on missing or incorrect TTL definitions.

- [ ] **Step 3: Implement TTL schema changes**

Use fixed-duration `createdAt` TTL only for immutable history/log records:

```js
schema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_MS.crmHistory / 1000 });
```

For commands and sessions add:

```js
purgeAt: { type: Date, default: null }
schema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
```

Remove TTL options from `CrmAgentCommand.expiresAt`; it remains the command
execution deadline. Preserve existing lookup indexes and remove exact duplicate
single-field indexes where a schema path `index: true` already creates the same
index.

- [ ] **Step 4: Verify model tests**

Run:

```powershell
node --test test/retention.test.js
```

Expected: all retention/index assertions pass.

- [ ] **Step 5: Commit**

```powershell
git add server/models test/retention.test.js
git commit -m "feat: add safe MongoDB retention indexes"
```

### Task 6: Wire Terminal Retention and Compact Large Agent Logs

**Files:**
- Modify: `server/routes/crm.js`
- Modify: `server/routes/cloud.js`
- Modify: `server/index.js`
- Modify: `server/routes/interior.js`
- Create: `test/terminal-retention.test.js`

- [ ] **Step 1: Write failing helper tests**

Extract pure update builders:

```js
assert.deepEqual(buildTerminalCommandUpdate('succeeded', finishedAt), {
  status: 'succeeded',
  finishedAt,
  purgeAt: new Date(finishedAt.getTime() + RETENTION_MS.queue),
});
```

Test cloud terminal updates and interior terminal compaction similarly.

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node --test test/terminal-retention.test.js
```

Expected: FAIL because builders do not exist.

- [ ] **Step 3: Implement and use terminal update builders**

- CRM command result writes set `purgeAt` only for
  `succeeded|failed|cancelled|expired`.
- Command creation keeps `purgeAt: null`.
- Cloud disconnect, force-end, machine-offline, and error paths set `purgeAt`
  365 days after `endedAt`.
- Interior terminal updates pass through `compactTerminalAgentState`.
- Paused/running interior logs retain `messages` and `draftModel`.

- [ ] **Step 4: Run focused tests and syntax checks**

Run:

```powershell
node --test test/terminal-retention.test.js test/retention.test.js
node --check server/routes/crm.js
node --check server/routes/cloud.js
node --check server/routes/interior.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add server/routes server/index.js test/terminal-retention.test.js
git commit -m "feat: schedule terminal record cleanup"
```

### Task 7: Sanitize Webhook Logs and Remove Noisy Payload Logging

**Files:**
- Create: `server/utils/webhookSanitizer.js`
- Create: `test/webhook-sanitizer.test.js`
- Modify: `server/routes/payment.js`

- [ ] **Step 1: Write failing sanitizer tests**

```js
test('redacts secrets and keeps required transaction metadata', () => {
  const result = sanitizeWebhook({
    headers: { authorization: 'Bearer secret', cookie: 'x=1', 'user-agent': 'Casso' },
    payload: { data: { reference: 'BANK1', amount: 100000, description: 'ALPHAABC123' }, huge: 'x'.repeat(50_000) },
  });
  assert.equal(result.headers.authorization, '[REDACTED]');
  assert.equal(result.headers.cookie, '[REDACTED]');
  assert.equal(result.headers['user-agent'], 'Casso');
  assert.equal(result.payload.data.reference, 'BANK1');
  assert.ok(JSON.stringify(result.payload).length < 20_000);
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node --test test/webhook-sanitizer.test.js
```

Expected: FAIL because sanitizer does not exist.

- [ ] **Step 3: Implement sanitizer**

Recursively redact keys matching
`authorization|cookie|token|secret|password|signature|api[-_]?key`, cap string
lengths, array lengths, object depth, and total serialized size. Preserve Casso
transaction fields used for diagnosis.

- [ ] **Step 4: Replace payment webhook persistence/logging**

- Remove full header/body `console.log`.
- Log one structured summary with bank transaction id, amount, and status.
- Pass sanitized payload/headers to every `WebhookLog.create` and constructor.
- Continue storing the canonical transaction details in `parsedData`.

- [ ] **Step 5: Run tests and syntax check**

Run:

```powershell
node --test test/webhook-sanitizer.test.js
node --check server/routes/payment.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add server/utils/webhookSanitizer.js server/routes/payment.js test/webhook-sanitizer.test.js
git commit -m "refactor: compact webhook diagnostics"
```

### Task 8: Bound Workflow Arrays and Archive Interior Versions

**Files:**
- Create: `server/retention/interiorVersionArchive.js`
- Create: `test/interior-version-archive.test.js`
- Modify: `server/models/WorkflowProject.js`
- Modify: `server/models/WorkflowDocument.js`
- Modify: `server/models/InteriorProject.js`
- Modify: `server/routes/interior.js`
- Modify: `server/tools/interior/model-commit.js`

- [ ] **Step 1: Write failing workflow-bound tests**

Export pure helpers and assert:

```js
assert.equal(limitWorkflowHistory({ chatHistory: Array(600).fill(entry) }).chatHistory.length, 500);
assert.equal(limitWorkflowHistory({ expenseLog: Array(1100).fill(entry) }).expenseLog.length, 1000);
assert.equal(limitDocumentComments(Array(600).fill(entry)).length, 500);
```

Limits:

- `chatHistory`: 500
- `expenseLog`: 1000
- `tasks`: 1000
- document `comments`: 500

- [ ] **Step 2: Write failing archive safety tests**

Use an injected fake storage adapter and project object:

- no versions are removed when upload throws;
- no versions are removed when `exists()` is false;
- verified archive keeps the latest 20 versions hot;
- archive metadata records key, checksum, index range, count, and size;
- hydration returns archived plus hot versions sorted by `index`.

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
node --test test/interior-version-archive.test.js
```

Expected: FAIL because archive helpers do not exist.

- [ ] **Step 4: Implement workflow bounds**

Use schema `pre('validate')` hooks that retain the newest entries with
`array.slice(-limit)`. This applies to create and save paths without changing
route response shapes.

- [ ] **Step 5: Add interior archive metadata**

Add `_id: false` subdocuments:

```js
versionArchives: [{
  provider: String,
  key: String,
  url: String,
  checksum: String,
  fromIndex: Number,
  toIndex: Number,
  count: Number,
  size: Number,
  createdAt: Date,
}]
```

- [ ] **Step 6: Implement verified archive/hydration**

`archiveInteriorVersions({ project, storage, hotLimit: 20 })`:

1. selects only versions older than the hot window;
2. serializes a deterministic JSON payload;
3. uploads and verifies existence;
4. appends archive metadata;
5. removes archived versions only after verification.

`hydrateInteriorVersions({ project, storage })` reads archives, verifies
checksum, combines archived/hot versions, removes duplicate indexes, and sorts.

- [ ] **Step 7: Wire archive before version writes and hydrate detail reads**

Both `server/routes/interior.js` and `server/tools/interior/model-commit.js`
must call archive after a successful version append but before final save. API
routes returning project detail must replace the serialized `versions` field
with hydrated versions so clients see the old shape.

- [ ] **Step 8: Run focused tests/checks**

Run:

```powershell
node --test test/interior-version-archive.test.js
node --check server/routes/interior.js
node --check server/tools/interior/model-commit.js
```

Expected: pass.

- [ ] **Step 9: Commit**

```powershell
git add server/retention server/models/WorkflowProject.js server/models/WorkflowDocument.js server/models/InteriorProject.js server/routes/interior.js server/tools/interior/model-commit.js test/interior-version-archive.test.js
git commit -m "feat: bound and archive project history"
```

### Task 9: Build Dry-Run and Apply Migration

**Files:**
- Create: `server/migrations/m0/mediaFields.js`
- Create: `server/migrations/m0/manifest.js`
- Create: `server/migrations/m0/scan.js`
- Create: `server/migrations/m0/apply.js`
- Create: `scripts/migrate-mongodb-m0.mjs`
- Create: `test/mongodb-m0-migration.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing dry-run tests**

Use fake collection/storage dependencies. Verify:

- scanner finds nested data URL and Buffer fields;
- dry-run returns planned actions but performs zero uploads/updates;
- output includes collection, document id, field path, byte size, MIME type,
  checksum, and intended key.

- [ ] **Step 2: Write failing apply/idempotency tests**

Verify:

- apply uploads, verifies, conditionally updates, and appends one manifest line;
- second apply sees the URL and performs no write;
- upload failure leaves MongoDB unchanged;
- conditional update mismatch records a conflict and leaves the object for
  rollback cleanup.

- [ ] **Step 3: Run test and verify RED**

Run:

```powershell
node --test test/mongodb-m0-migration.test.js
```

Expected: FAIL because migration modules do not exist.

- [ ] **Step 4: Define known media field registry**

Include current fields from:

- User avatar/background/featured works/attachments
- Course thumbnail/instructor avatar/lesson videos/documents
- Prompt example images
- Resource file/thumbnail/preview images
- Workflow project avatar/document URL and key
- Interior reference/view/render URLs
- Studio generation B2 fields
- Vocab deck/profile/card image fields
- CRM message attachments

Each entry specifies collection, field glob, filename hint, and whether an
existing string is expected to be a URL or key.

- [ ] **Step 5: Implement scanner and manifest**

The scanner must stream cursors with projections, avoid loading whole
collections, recursively expand array field globs, and decode data URLs only
after size validation.

Manifest JSONL entries must contain:

```js
{
  migration: 'mongodb-m0-v1',
  collection,
  documentId,
  fieldPath,
  beforeValue,
  afterValue,
  object: { provider, key, url, checksum, size, migrationOwned: true },
  appliedAt
}
```

- [ ] **Step 6: Implement apply with bounded concurrency**

Default batch size `25`, concurrency `2`. Use an update filter containing
`_id` and the exact old field value. Exit non-zero if any action fails, but
continue processing other documents and write a failure report.

- [ ] **Step 7: Implement CLI**

Supported commands:

```powershell
npm.cmd run db:m0:migrate
npm.cmd run db:m0:migrate -- --apply --manifest .data/migrations/mongodb-m0-2026-06-12.jsonl
```

Dry-run is the default. `--apply` requires an explicit manifest path and
configured object storage.

- [ ] **Step 8: Run migration tests**

Run:

```powershell
node --test test/mongodb-m0-migration.test.js
```

Expected: all pass.

- [ ] **Step 9: Commit**

```powershell
git add server/migrations scripts/migrate-mongodb-m0.mjs test/mongodb-m0-migration.test.js package.json
git commit -m "feat: add safe MongoDB media migration"
```

### Task 10: Add Guarded Rollback

**Files:**
- Create: `server/migrations/m0/rollback.js`
- Create: `scripts/rollback-mongodb-m0.mjs`
- Create: `test/mongodb-m0-rollback.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing rollback tests**

Verify:

- entries are processed in reverse order;
- restore filter requires the current field to equal `afterValue`;
- object deletion occurs only after successful DB restore;
- conflict leaves DB and object unchanged;
- objects with `migrationOwned: false` are never deleted.

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node --test test/mongodb-m0-rollback.test.js
```

Expected: FAIL because rollback module does not exist.

- [ ] **Step 3: Implement rollback and CLI**

Command:

```powershell
npm.cmd run db:m0:rollback -- --manifest .data/migrations/mongodb-m0-2026-06-12.jsonl
```

Rollback defaults to dry-run and requires `--apply` to change data. It writes a
separate rollback result JSONL file and never mutates the original manifest.

- [ ] **Step 4: Run tests**

Run:

```powershell
node --test test/mongodb-m0-rollback.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add server/migrations/m0/rollback.js scripts/rollback-mongodb-m0.mjs test/mongodb-m0-rollback.test.js package.json
git commit -m "feat: add guarded MongoDB migration rollback"
```

### Task 11: Add Collection and Index Audit/Migration

**Files:**
- Create: `server/migrations/m0/audit.js`
- Create: `server/migrations/m0/indexPlan.js`
- Create: `scripts/audit-mongodb-m0.mjs`
- Create: `test/mongodb-m0-audit.test.js`
- Create: `docs/database/MONGODB_M0_COLLECTION_AUDIT.md`
- Modify: `package.json`
- Modify: `server/db/connection.js`

- [ ] **Step 1: Write failing classification/index tests**

Test deterministic categories:

- business collections -> `keep`;
- TTL/log collections -> `keep-with-retention`;
- interior archive metadata -> `archive`;
- empty unknown collections -> `remove-candidate`;
- overlapping legacy collections -> `merge-candidate`.

Test duplicate-index detection only marks exact duplicates or indexes whose
leading fields and options make a smaller index redundant. Unique, partial,
text, sparse, and TTL indexes are never auto-dropped by prefix inference.

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node --test test/mongodb-m0-audit.test.js
```

Expected: FAIL because audit modules do not exist.

- [ ] **Step 3: Implement collection statistics audit**

Use `listCollections`, `$collStats`/`collStats` where available, `estimatedDocumentCount`,
and `indexes()`. Gracefully report unsupported metrics on Atlas permissions.
Output JSON and Markdown with document count, logical size, storage size,
average object size, index size, classification, reason, and recommendation.

- [ ] **Step 4: Implement reviewed index plan**

Create required TTL/compound indexes idempotently. Drop only names listed in:

```js
export const APPROVED_INDEX_DROPS = Object.freeze([
  { collection: 'partners', name: 'userId_1', reason: 'legacy field removed' },
]);
```

Move the current startup stale-index deletion out of normal application startup
and into this explicit migration. Runtime startup must never mutate indexes.

- [ ] **Step 5: Add CLI and baseline report**

Commands:

```powershell
npm.cmd run db:m0:audit
npm.cmd run db:m0:audit -- --apply-indexes
```

The committed Markdown report documents every known collection from current
models and marks database-only unknown collections as requiring a live audit.
No collection-drop command is implemented.

- [ ] **Step 6: Run audit tests**

Run:

```powershell
node --test test/mongodb-m0-audit.test.js
```

Expected: pass.

- [ ] **Step 7: Commit**

```powershell
git add server/migrations/m0 scripts/audit-mongodb-m0.mjs test/mongodb-m0-audit.test.js docs/database package.json server/db/connection.js
git commit -m "feat: add MongoDB collection and index audit"
```

### Task 12: Update Environment and Operational Documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `.claude/DATABASE.md`
- Modify: `.claude/PROJECT_SUMMARY.md`

- [ ] **Step 1: Document environment variables**

Add:

```env
MONGODB_MAX_POOL_SIZE=5
MONGODB_MIN_POOL_SIZE=0
MONGODB_SERVER_SELECTION_TIMEOUT_MS=5000
MONGODB_SOCKET_TIMEOUT_MS=45000
MONGODB_MAX_IDLE_TIME_MS=60000

STORAGE_PROVIDER=b2
B2_ENDPOINT=
B2_REGION=us-west-004
B2_ACCESS_KEY_ID=
B2_SECRET_ACCESS_KEY=
B2_BUCKET_NAME=
CDN_BASE_URL=

# Development/test alternative
LOCAL_STORAGE_ROOT=./.data/storage
LOCAL_STORAGE_PUBLIC_URL=http://localhost:3001/storage
```

- [ ] **Step 2: Document upload and persistence contract**

README must state:

1. client requests a presigned URL;
2. client uploads directly to B2;
3. API receives only URL/key/metadata;
4. data URLs/base64/Buffers are rejected;
5. local adapter is for development only.

- [ ] **Step 3: Document migration and rollback runbook**

Include exact dry-run, apply, audit, and rollback commands; manifest backup
requirements; expected output paths; verification checklist; and warning that
business collections are never auto-dropped.

- [ ] **Step 4: Update database and project summaries**

Correct existing documentation drift, add `purgeAt`, TTL durations, archive
metadata, storage abstraction, pool defaults, scripts, and set `Last Updated`
to `2026-06-12`.

- [ ] **Step 5: Validate docs and commit**

Run:

```powershell
rg -n "base64|STORAGE_PROVIDER|db:m0:migrate|purgeAt|Last Updated" README.md .env.example .claude/DATABASE.md .claude/PROJECT_SUMMARY.md
git diff --check
```

Expected: all required topics found; no whitespace errors.

Commit:

```powershell
git add .env.example README.md .claude/DATABASE.md .claude/PROJECT_SUMMARY.md
git commit -m "docs: document MongoDB M0 storage operations"
```

### Task 13: Full Verification and Production Dry Run

**Files:**
- Modify only if verification exposes defects.

- [ ] **Step 1: Run all automated tests**

Run:

```powershell
npm.cmd test
```

Expected: exit 0 with zero failed tests.

- [ ] **Step 2: Run syntax checks on all changed JavaScript**

Run:

```powershell
$files = git diff --name-only HEAD~12 -- '*.js' '*.mjs'
foreach ($file in $files) { node --check $file; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

Expected: exit 0.

- [ ] **Step 3: Run migration dry-run**

Run:

```powershell
npm.cmd run db:m0:migrate
```

Expected: no writes, summary of inline media candidates, and exit 0. If network
access is blocked, rerun with user approval outside the sandbox. Do not run
`--apply` against production without preserving the generated manifest.

- [ ] **Step 4: Run collection/index audit**

Run:

```powershell
npm.cmd run db:m0:audit
```

Expected: generated JSON/Markdown report, no index or collection mutations.

- [ ] **Step 5: Smoke test startup and health**

Start backend with the configured environment, then verify:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
Invoke-RestMethod http://localhost:3001/api/ready
```

Expected: both return success after MongoDB is connected.

- [ ] **Step 6: Review migration safety artifacts**

Confirm:

- dry-run did not create object-storage writes;
- no business collection is listed for automatic deletion;
- TTL indexes do not target active queue/session records;
- apply requires an explicit manifest;
- rollback compare-before-restore tests pass;
- current API response fields remain present.

- [ ] **Step 7: Inspect final diff and status**

Run:

```powershell
git diff --check
git status --short
git log --oneline -15
```

Expected: only intended files changed and all implementation commits visible.
