# MongoDB Atlas M0 Storage Refactor Design

**Date:** 2026-06-12
**Status:** Approved
**Scope:** `alpha-studio-backend`

## Objective

Reduce MongoDB Atlas storage and index overhead while preserving current API
contracts. MongoDB stores business data, relationships, status, and file
metadata only. Binary files, media, data URLs, and base64 payloads belong in
Backblaze B2 or a local storage adapter.

## Current State

- The backend defines 52 Mongoose model files, including several files that
  register multiple collections.
- Runtime startup calls `mongoose.connect()` once, but starts HTTP listening
  without waiting for the connection and keeps five idle connections through
  `minPoolSize: 5`.
- Most media fields already contain URLs or B2 keys.
- URL-like fields accept arbitrary strings, so clients can still persist data
  URLs or base64 accidentally.
- `WebhookLog` stores full payloads and headers without retention.
- AI logs store prompts, raw responses, tool arguments, results, message
  buffers, and draft models.
- Chat, CRM message, workflow history, and embedded interior versions can grow
  without a retention or archival boundary.
- Some models duplicate engagement detail arrays and aggregate counters.
- Indexes are declared locally without a single audit/migration report.

## Architectural Decisions

### Compatibility

Existing REST paths and response shapes remain unchanged unless accepting
inline binary data would violate the new storage contract. Existing URL fields
remain URL fields. New metadata is additive.

### Storage Abstraction

Add a shared storage interface with two adapters:

- `B2StorageAdapter` for production and migrations.
- `LocalStorageAdapter` for development and tests.

The interface supports upload, delete, existence verification, and public URL
resolution. Stored metadata has this canonical shape:

```js
{
  provider: 'b2' | 'local',
  key: String,
  url: String,
  filename: String,
  mimeType: String,
  size: Number,
  checksum: String
}
```

The first refactor does not introduce a central asset collection. Existing
models continue to own their file metadata, avoiding extra lookups and API
changes on Atlas M0.

### Media Validation

Shared validators reject:

- `data:*;base64,...` strings in persisted URL/file-key fields.
- raw `Buffer` values and BSON binary values in media metadata.
- oversized inline strings that appear to contain encoded file content.

Normal HTTP(S) URLs, B2 keys, Cloudinary URLs, and approved local-storage URLs
remain valid. Routes return the existing `{ success, message, data }` envelope.

### MongoDB Connection

The application uses one process-wide Mongoose connection. Startup awaits the
connection before opening the HTTP listener. Defaults target Atlas M0:

- `maxPoolSize: 5`
- `minPoolSize: 0`
- bounded server-selection and socket timeouts
- pool values configurable through environment variables

SIGINT and SIGTERM stop accepting requests, close the HTTP server, and then
close Mongoose once.

### Retention Policy

Retention is automatic through TTL indexes where deletion is time-based and
does not require business logic:

| Data | Retention |
| --- | --- |
| Pairing sessions and temporary tokens | At their explicit expiry |
| Completed/expired queue commands | Up to 7 days |
| Technical AI, sync, and agent logs | 30 days |
| Webhook diagnostic logs | 90 days |
| CRM audit, execution, chatbot, and message history | 365 days |
| Ended cloud sessions | 365 days |
| User chat display history | 365 days |

Active queue commands and active sessions must not expire before becoming
terminal. Where a single TTL date cannot express that rule safely, application
code sets `purgeAt` only when the record becomes terminal.

Financial transactions, billing orders, subscriptions, user-owned content,
course data, deck/card data, and current project state do not receive TTL
indexes.

### Bounded Embedded History

New writes bound arrays that otherwise grow inside one MongoDB document:

- Workflow chat history, comments, expense history, and task history retain
  recent operational entries according to per-field limits.
- Interior projects keep a bounded hot version window. Versions removed from
  the hot document are exported as JSON to object storage before removal, and
  archive metadata is retained on the project.
- Interior agent logs keep resumable state only while running or paused.
  Terminal records discard large message buffers and draft snapshots.

The migration never removes embedded history unless its archive upload and
checksum verification succeeded.

### Duplicate Data

Aggregate counters used by existing APIs remain because they prevent expensive
counts. Detail arrays that duplicate separate relationship data are evaluated
by migration metrics:

- Keep counters such as `likesCount`, `bookmarksCount`, and rating aggregates.
- Do not create a new relationship collection unless an embedded array is
  large enough to threaten document growth or query performance.
- Repair mismatched counters during migration without changing API output.

### Index Strategy

Create a deterministic migration that:

1. inventories collection sizes, average document sizes, storage sizes, and
   index sizes;
2. compares actual indexes with model definitions;
3. creates required compound, partial, and TTL indexes;
4. identifies prefix-duplicate and unused-candidate indexes;
5. drops only indexes on an explicit reviewed allowlist;
6. records every action in the migration manifest.

Automatic index creation in production is not relied on for this migration.

## Migration Design

The migration command defaults to dry-run and accepts `--apply`.

### Dry Run

- scans known media fields for data URLs, base64, buffers, and malformed URLs;
- reports collection and index sizes;
- reports documents affected by retention or history limits;
- calculates intended storage keys and changes;
- writes no database or object-storage data.

### Apply

For each legacy inline file:

1. Decode and validate content.
2. Compute SHA-256 checksum.
3. Upload to B2 through the storage abstraction.
4. Verify object existence and metadata.
5. Update only the source document and field matched during scanning.
6. Record before/after values, checksum, object key, and update result in a
   JSONL rollback manifest.
7. Remove the inline value only after successful verification and update.

Updates run in small batches with bounded concurrency. Failed documents remain
unchanged and are reported. Re-running the migration is idempotent.

### Rollback

A rollback command consumes the manifest in reverse order. It restores original
MongoDB field values only when the current field still matches the migration's
after-value. Uploaded objects are deleted only after the database restore
succeeds and only when the manifest marks the object as migration-owned.

## Collection Classification

The migration produces a report with these categories:

- **Keep:** active business collections and normalized relationship data.
- **Keep with retention:** logs, commands, temporary sessions, chat history,
  and diagnostic records.
- **Archive:** old interior versions and optional long-lived operational
  history.
- **Merge candidate:** collections whose ownership and query patterns overlap;
  recommendations only in this phase.
- **Remove candidate:** empty, obsolete, or undocumented collections;
  recommendations only in this phase.

No business collection is dropped automatically.

## Logging

Routine per-record migration output is disabled. Logs contain batch progress,
counts, durations, warnings, and failures without secrets or full payloads.
Webhook headers and payloads are sanitized to remove authorization, cookies,
tokens, and unnecessary duplicate fields before persistence.

## Testing

Use Node's built-in test runner. Tests cover:

- media validation accepts supported references and rejects inline binary data;
- local and mocked B2 adapters implement the same contract;
- connection options and startup ordering;
- TTL/index definitions;
- terminal-state purge scheduling;
- webhook sanitization;
- migration dry-run performs no writes;
- apply mode is idempotent and writes rollback manifests;
- rollback uses compare-before-restore safeguards;
- history archival does not remove data before verified upload.

Run focused tests during each TDD cycle, then run all backend tests and syntax
checks before completion.

## Documentation

Update:

- `README.md` with storage providers, environment variables, upload flow, and
  migration commands;
- `.env.example` with MongoDB pool and storage settings;
- `.claude/DATABASE.md` with retention, TTL, archive metadata, and indexes;
- `.claude/PROJECT_SUMMARY.md` with current architecture and completion state;
- a generated collection audit report with keep/archive/merge/remove guidance.

## Rollout

1. Deploy validation and storage abstraction without deleting data.
2. Run migration dry-run against production and retain the report.
3. Review estimated storage changes and the index allowlist.
4. Run `--apply` with a durable manifest location.
5. Verify object counts, sampled checksums, MongoDB metrics, API health, and
   query behavior.
6. Keep manifests and object-storage lifecycle protections through the rollback
   window.

## Non-Goals

- Replacing MongoDB or Mongoose.
- Rewriting API controllers into a new architecture.
- Moving business records to object storage.
- Automatically deleting undocumented business collections.
- Introducing GridFS.
- Changing frontend behavior unrelated to preventing inline media persistence.
