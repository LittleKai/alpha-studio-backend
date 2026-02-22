# 2026-02-23 — Featured Students API

## Changes Made

### New Model
- `server/models/FeaturedStudent.js`:
  ```js
  { userId: ObjectId (ref User, unique), order: Number, label: String, hired: Boolean }
  ```
  - Index on `order` for sorted queries

### New Route File
- `server/routes/featuredStudents.js` — mounted at `/api/featured-students`:
  | Method | Path | Auth | Description |
  |--------|------|------|-------------|
  | GET | `/` | None | Public list for landing page (populated user fields) |
  | GET | `/admin` | admin | Full list with email, role, hasFeaturedWork |
  | POST | `/` | admin | Add user (body: `{ userId }`) |
  | PUT | `/:userId` | admin | Update label/hired |
  | PUT | `/reorder/save` | admin | Reorder (body: `{ orderedIds: string[] }`) |
  | DELETE | `/:userId` | admin | Remove |
  - Public `GET /` defined BEFORE `router.use(adminOnly)` to allow unauthenticated access
  - `toPublicShape()` helper maps DB entry + populated User → landing page format

### Modified
- `server/index.js` — Added import + `app.use('/api/featured-students', featuredStudentsRoutes)`
- `server/routes/workflow.js` — `GET /users/:id` now includes `backgroundImage` in `.select()` and response

## Notes
- Order of route registration matters: `/admin` GET must be defined before `router.use(adminOnly)` because Express matches by definition order
- `hasFeaturedWork` computed from `u.featuredWorks?.length > 0`
- `toPublicShape` maps `image = user.avatar`, `role = entry.label || user.role`, `work = featuredWorks[0].image`
