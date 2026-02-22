# 2026-02-22 — Workflow Projects & Documents API

## Summary
Created MongoDB-backed API for WorkflowDashboard: Projects and Documents with full CRUD, auth-protected.

## Files Created

### `server/models/WorkflowProject.js`
- Subdocument schemas (no `_id`): expenseEntry, task, teamMember, comment
- Main fields: name, client, description, department, status, startDate, deadline, budget, expenses, expenseLog[], team[], progress, chatHistory[], tasks[], createdBy (ref User)
- `toJSON: { virtuals: true }` → exposes `id` virtual

### `server/models/WorkflowDocument.js`
- Comment subdocument schema (no `_id`)
- Main fields: name, type, size, uploadDate, uploader, status, url, fileKey, isProject, projectId (ref WorkflowProject), comments[], createdBy (ref User)
- `toJSON: { virtuals: true }` → exposes `id` virtual

### `server/routes/workflow.js`
8 endpoints, all require `authMiddleware`:

**Projects:**
- `GET  /projects`     → list user's projects (createdBy filter), sort createdAt desc
- `POST /projects`     → create, set createdBy = req.user._id
- `PUT  /projects/:id` → full update (creator or admin)
- `DELETE /projects/:id` → delete project + all its documents (creator or admin)

**Documents:**
- `GET  /documents`     → list user's docs, optional `?projectId=xxx`
- `POST /documents`     → create, set createdBy = req.user._id
- `PUT  /documents/:id` → update (status, comments, etc.) — creator or admin
- `DELETE /documents/:id` → delete — creator or admin

## Files Modified

### `server/index.js`
- Added `import workflowRoutes from './routes/workflow.js'`
- Added `app.use('/api/workflow', workflowRoutes)`

## Notes
- Authorization: `resource.createdBy.toString() === user._id.toString() || user.role === 'admin'`
- DELETE /projects also deletes all associated WorkflowDocument records
- No pagination (small dataset per user)
