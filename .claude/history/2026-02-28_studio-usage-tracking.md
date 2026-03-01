# 2026-02-28 — Studio Usage Tracking API

## Summary
Added backend support for tracking per-user daily studio usage (3 free uses/day).

## Files Changed

### `server/models/User.js`
- Added `studioUsage: { date: String, count: Number }` field
- `date` stored as 'YYYY-MM-DD' UTC string; resets automatically when date changes

### `server/routes/studio.js` (NEW)
- `GET /api/studio/usage` (auth required) — returns `{ used, limit, remaining }` for today
- `POST /api/studio/use` (auth required) — checks daily limit; increments count; returns 429 if limit exceeded
- Admin/mod users → returns `{ unlimited: true }` with no limit enforced
- `DAILY_LIMIT = 3`

### `server/index.js`
- Imported `studioRoutes`
- Mounted at `/api/studio`
