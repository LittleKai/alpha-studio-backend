# 2026-05-13 — Admin Project Pool Seeding Input

## What
Added support for Admins to manually seed `projectIds` directly from the Cloud Admin Tab UI when creating or editing a Flow Server. 

## Why
Instead of expecting the end-user to manually input Google Flow `FLOW_PROJECT_ID` instances on the generative Studio UI interface (which is poor UX and redundant), the backend architecture supports rotating over an automated pool of project IDs.
However, previously the pool could only be seeded through backend terminal files or `acc1.env`. This change brings the control into the Admin Dashboard (`CloudAdminTab.tsx`), permitting the site managers to input a comma-separated string of initial Project UUIDs. The backend parses this list natively into the `FlowServer.projectIds` schema.

## Changes
- **`alpha-studio-backend/server/routes/cloud.js`:** The `POST` and `PUT` endpoints for `/admin/flow-servers` look for a new `initialProjectIds` text payload. It effectively splits, trims, and overwrites `FlowServer.projectIds` with the seeds, preceding the automatic background pooling mechanisms.
- **`alpha-studio/src/services/cloudService.ts`:** Mapped `initialProjectIds?: string` across Flow Server models and API calls.
- **`alpha-studio/src/components/admin/CloudAdminTab.tsx`:** Added the explicit "Project IDs (comma separated)" textbox dynamically visible when a super admin modifies Flow Agent settings.
