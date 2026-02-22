# 2026-02-22 — Workflow API: Project Roles, Avatar, User Search, Delete Permissions

## Summary
Backend additions to support project member roles, project avatar, real user search for team management.

## Changes

### `server/models/WorkflowProject.js`
- `teamMemberSchema`: added `projectRole: { type: String, default: '' }`
- `workflowProjectSchema`: added `avatar: { type: String, default: '' }`

### `server/routes/workflow.js`
- Import: added `import User from '../models/User.js'`
- **NEW** `GET /api/workflow/users/search?q=xxx`:
  - Auth required
  - Searches User model by name or email (regex, case-insensitive)
  - Excludes requesting user
  - Returns 10 results max: `{ id, name, avatar, role, email, isExternal: false }`
  - Returns empty array if `q` < 2 chars
- **UPDATED** `PUT /projects/:id`: added `'avatar'` to allowed update fields
- **UPDATED** `DELETE /documents/:id`:
  - Still allows: document creator, admin
  - **NEW**: also allows project creator/manager (`projectRole === 'creator'` or `'manager'`)
  - Looks up project via `doc.projectId` to verify team membership
