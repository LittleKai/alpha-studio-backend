# 2026-02-22 — Workflow Backend: Project Visibility, Note Field, Doc Access

## Summary
4 backend changes to support new workflow features.

## Changes

### `server/models/WorkflowDocument.js`
- Added `note: { type: String, default: '' }`

### `server/routes/workflow.js`
- **GET /projects**:
  - Admin → all projects (`{}` query)
  - Others → `{ $or: [status != completed, createdBy, team.id] }` (see all ongoing + own completed)
- **DELETE /projects**:
  - Requires `req.user.role === 'admin'` (403 otherwise)
  - Requires `project.status === 'completed'` (400 if not completed)
  - Cannot delete planning projects
- **GET /documents** with `?projectId`:
  - Checks if user is member of project (team.id or createdBy or admin/mod)
  - Returns ALL documents for that project (not filtered by createdBy)
  - Without projectId → returns own docs only (unchanged)
- **PUT /documents**:
  - Added `note` to allowed update fields
  - Auth now also allows project creator/manager (not just owner/admin)
