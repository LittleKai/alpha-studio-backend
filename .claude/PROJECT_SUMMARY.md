# Project Summary

**Phase 5 CRM Hardening (2026-06-02):** CRM billing checkout now accepts both legacy `credits` and canonical `credit` payment methods. Agent command polling expires stale queued commands, returns only non-expired work, rejects duplicate terminal result writes, and command models now include `expiresAt` plus idempotency indexing. Added append-only `CrmAuditLog` admin timeline endpoint (`GET /api/crm/admin/audit-logs`) and safe rerunnable CRM index script `scripts/migrate-crm-indexes.mjs`.

**Phase 1/2 CRM Update (2026-06-01):** Alpha CRM SaaS Foundation and Windows agent bridge. Added Mongoose models (`CrmSubscription`, `CrmDevice`, `CrmPairingSession`, `CrmAgentCommand`, `CrmBillingOrder`, `CrmAiUsage`, `CrmCustomer`, `CrmContact`, `CrmTemplate`, `CrmCampaign`, `CrmExecutionLog`). Mounted route namespace `/api/crm` with full catalog, checkout, pairing, data CRUD, quota-enforced AI Chat, administrative endpoints, and agent endpoints for heartbeat, command polling, and command results. Extended Casso bank transfer webhooks for direct CRM billing order fulfillment. CRM bank/admin order fulfillment now runs through a MongoDB transaction helper so order claim, entitlement write, transaction record, and `paid` status commit or roll back together. CRM campaigns now validate user-owned templates/recipients before queueing Windows-agent execution and keep background campaign commands `running` until final agent results arrive.

**Phase 15 Follow-up (2026-05-27):** VocabFlip private storage integration. Added MongoDB schemas `VocabPrivateDeck` and `VocabPrivateFlashcard` and implemented private deck & flashcard CRUD + search REST routes to route VocabFlip storage through the backend for web users (kIsWeb=true).

**Phase 15 Follow-up (2026-05-22):** Interior template validation now whitelists curved `boxes[]` primitives: regular box, `roundedBox`, and `cylinder`. Unknown primitive types are rejected at import/edit time. Seed script was rerun and MongoDB now includes `cab-base-rounded-end@1` as a `seed` template with rounded/cylindrical geometry.

**Phase 15 Follow-up (2026-05-21):** Interior agent tools now fill known template `width`/`height`/`depth` defaults before preview/commit, preventing tpl modules such as kitchen base/wall/corner cabinets from inheriting the whole model height/depth when the AI omits dimensions. Default Interior project Vietnamese strings were corrected from mojibake to UTF-8.

**Phase 14 Update (2026-05-20):** Interior template validation now accepts `boxes`/legacy `isoBoxes` only and rejects `frontSvg`/`sideSvg`/`planSvg` with a clear error. The interior agent prompt and `template.create` tests now document and verify boxes-only templates.

**Phase 14 Update (2026-05-20):** Added direct interior template import endpoint for the static Interior Component Workshop. `POST /api/interior/templates/import` accepts selected template DSL objects, validates them with `validateTemplateStructure`, creates a new `InteriorTemplate` version per template, and imports as `approved` for admin/mod users or `pending` for regular users.
If selected templates already match the latest library version, the endpoint returns success with `skipped` instead of failing with HTTP 400.

**Phase 13 Update (2026-05-20):** Interior Agent Harness added. Generic extractable runner code lives in `server/agent-runner/` (`ToolRegistry`, `SkillLoader`, SSE helpers, JSON protocol parser, loop runner). Interior domain tools live in `server/tools/interior/` with 15 registered tools. New `POST /api/interior/projects/:id/agent` streams SSE steps and commits through `model.commit`; `InteriorAgentLog` stores step logs with 30-day TTL. Agent flow costs 2 credits on commit and coexists with legacy `/chat`.

**Phase 12 Update (2026-05-19):** Backend now hosts the self-extending interior template library. New model `InteriorTemplate` (status: seed/pending/approved/deprecated). New endpoints: `GET /api/interior/templates` (engine catalog load, returns seed+approved deduped by highest version), `POST /api/interior/templates` (user commits a project inline template to pending), and `/api/admin/interior-templates` CRUD (list/getOne/approve/reject/edit/deprecate). `/api/interior/projects/:id/chat` now extracts AI-emitted `tplNew` blocks into `modelJson.inlineTemplates[id]`, replaces with `tpl: id`, and surfaces created ids in `data.meta.newInlineTemplates`. DSL validation lives in `server/utils/templateValidator.js` (AST whitelist mirror of the engine `expression.js`). Seed script `scripts/seed-interior-templates.mjs` upserts the 7 built-in templates from `tools/interior-design-engine/src/templates/` (idempotent).

**Phase 11 Update (2026-05-19):** `server/routes/interior.js` now validates the compact template contract: top-level `palette`, optional `inlineTemplates`, and module/detail items using either legacy `width/height/depth` boxes or `tpl/style` template references. The default project model uses `sliding-2door` with `palette: "wood-oak"`, and `/api/interior` prompts include the built-in template catalog while no longer promoting CSG hints.
**Last Updated:** 2026-06-02 (Phase 5: CRM hardening and audit timeline)
**Updated By:** Antigravity (Advanced AI Coding Assistant)


---

## 1. Project Overview
- **Name:** Alpha Studio Backend
- **Type:** REST API Backend for AI Academy Platform
- **Tech Stack:**
  - Node.js 18+ (ES Modules)
  - Express.js 5.x
  - MongoDB Atlas (Cloud Database)
  - Mongoose 8.x (ODM)
  - JWT (jsonwebtoken) + bcrypt
- **Deployment:** Fly.io (https://alpha-studio-backend.fly.dev)
- **Frontend:** Separate repository - [alpha-studio](../alpha-studio) (https://alphastudio.vercel.app)

---

## 2. Current Architecture

### File Structure
```
alpha-studio-backend/
â”œâ”€â”€ server/
â”‚   â”œâ”€â”€ index.js                   # Express server entry point
â”‚   â”œâ”€â”€ db/
â”‚   â”‚   â”œâ”€â”€ connection.js          # MongoDB connection
â”‚   â”‚   â”œâ”€â”€ init-collections.js    # Database initialization
â”‚   â”‚   â”œâ”€â”€ test-connection.js     # Connection test script
â”‚   â”‚   â””â”€â”€ migrate-passwords.js   # Password hashing migration
â”‚   â”œâ”€â”€ models/
â”‚   â”‚   â”œâ”€â”€ User.js                # User model with bcrypt + balance field
â”‚   â”‚   â”œâ”€â”€ Course.js              # Course model with multilingual support + lesson videoUrl/documents
â”‚   â”‚   â”œâ”€â”€ Enrollment.js          # Course enrollment with progress tracking
â”‚   â”‚   â”œâ”€â”€ Review.js              # Course reviews with ratings
â”‚   â”‚   â”œâ”€â”€ Job.js                 # Job listings with multilingual support
â”‚   â”‚   â”œâ”€â”€ Partner.js             # Partner profiles with skills array
â”‚   â”‚   â”œâ”€â”€ Transaction.js         # Payment transactions (topup, spend, etc.)
â”‚   â”‚   â”œâ”€â”€ WebhookLog.js          # Casso webhook logging
â”‚   â”‚   â”œâ”€â”€ Prompt.js              # Shared prompts with multiple contents, ratings
â”‚   â”‚   â”œâ”€â”€ Resource.js            # Resource hub with file upload (50MB)
â”‚   â”‚   â”œâ”€â”€ Comment.js             # Comments for prompts/resources
â”‚   â”‚   â”œâ”€â”€ Article.js             # Articles for About & Services pages (bilingual)
â”‚   â”‚   â”œâ”€â”€ HostMachine.js         # Cloud host machine registry
â”‚   â”‚   â”œâ”€â”€ CloudSession.js        # Cloud desktop sessions
â”‚   â”‚   â”œâ”€â”€ InteriorAiLog.js       # Raw AI request/response per Interior /chat call (TTL 30 days)
â”‚   â”‚   â”œâ”€â”€ WorkflowProject.js     # Workflow projects (team, tasks, chatHistory, expenseLog)
â”‚   â”‚   â”œâ”€â”€ WorkflowDocument.js    # Workflow documents (file metadata, status, comments)
â”‚   â”‚   â”œâ”€â”€ FeaturedStudent.js     # Featured students (userId ref, order, label, hired)
â”‚   â”‚   â””â”€â”€ ChatMessage.js         # AI consultation chat history (userId, role, content) â€” display only; OpenClaw maintains session memory via x-openclaw-session-key
â”‚   â”œâ”€â”€ middleware/
â”‚   â”‚   â””â”€â”€ auth.js                # JWT auth + adminOnly + modOnly middleware
â”‚   â””â”€â”€ routes/
â”‚       â”œâ”€â”€ auth.js                # Auth API routes
â”‚       â”œâ”€â”€ courses.js             # Course CRUD + publish/archive routes
â”‚       â”œâ”€â”€ jobs.js                # Job CRUD + publish/close routes
â”‚       â”œâ”€â”€ partners.js            # Partner CRUD + publish/unpublish routes
â”‚       â”œâ”€â”€ payment.js             # Payment API (create, confirm, cancel, webhook)
â”‚       â”œâ”€â”€ admin.js               # Admin API (users, transactions, webhook management)
â”‚       â”œâ”€â”€ prompts.js             # Prompts API (CRUD, like, bookmark, rate, download)
â”‚       â”œâ”€â”€ resources.js           # Resources API (CRUD, like, bookmark, rate, download)
â”‚       â”œâ”€â”€ comments.js            # Comments API for prompts/resources
â”‚       â”œâ”€â”€ enrollments.js         # Course enrollment API (enroll, progress, check)
â”‚       â”œâ”€â”€ reviews.js             # Course reviews API (CRUD, like, helpful, rating distribution)
â”‚       â”œâ”€â”€ articles.js            # Articles API (CRUD, publish/unpublish, public + admin)
â”‚       â”œâ”€â”€ cloud.js              # Cloud desktop API (connect, disconnect, admin machines/sessions, heartbeat)
â”‚       â”œâ”€â”€ upload.js             # B2 presigned URL endpoint (POST /presign, DELETE /file)
â”‚       â”œâ”€â”€ workflow.js           # Workflow API (CRUD projects + documents, auth required)
â”‚       â”œâ”€â”€ featuredStudents.js   # Featured students API (public GET, admin CRUD + reorder)
â”‚       â””â”€â”€ chat.js               # AI consultation API (auth required) â€” GET /history, POST /send, DELETE /history; forwards to OpenClaw via OPENCLAW_URL
â”‚   â””â”€â”€ utils/
â”‚       â””â”€â”€ b2Storage.js          # B2 S3 client + generatePresignedUploadUrl + deleteFile + listAllFiles (paginated)

â”œâ”€â”€ .claude/                       # Documentation
â”‚   â”œâ”€â”€ PROJECT_SUMMARY.md
â”‚   â”œâ”€â”€ CONVENTIONS.md
â”‚   â”œâ”€â”€ DATABASE.md
â”‚   â”œâ”€â”€ INSTRUCTIONS_FOR_CLAUDE.md
â”‚   â””â”€â”€ history/
â”œâ”€â”€ package.json
â”œâ”€â”€ .env.example
â”œâ”€â”€ .gitignore
â””â”€â”€ README.md
```

### API Routes
```
/api
â”œâ”€â”€ /auth
â”‚   â”œâ”€â”€ POST /register    # User registration
â”‚   â”œâ”€â”€ POST /login       # User login
â”‚   â”œâ”€â”€ POST /logout      # Logout (clears cookie)
â”‚   â”œâ”€â”€ GET  /me          # Get current user (auth required)
â”‚   â”œâ”€â”€ PUT  /profile     # Update profile (auth required)
â”‚   â””â”€â”€ PUT  /password    # Change password (auth required)
â”œâ”€â”€ /courses (admin only)
â”‚   â”œâ”€â”€ GET    /           # List courses (pagination, filters, search)
â”‚   â”œâ”€â”€ GET    /stats      # Course statistics
â”‚   â”œâ”€â”€ GET    /:id        # Get single course
â”‚   â”œâ”€â”€ POST   /           # Create course
â”‚   â”œâ”€â”€ PUT    /:id        # Update course
â”‚   â”œâ”€â”€ DELETE /:id        # Delete course
â”‚   â”œâ”€â”€ PATCH  /:id/publish    # Publish course
â”‚   â”œâ”€â”€ PATCH  /:id/unpublish  # Unpublish course
â”‚   â””â”€â”€ PATCH  /:id/archive    # Archive course
â”œâ”€â”€ /jobs (admin for write, public for read)
â”‚   â”œâ”€â”€ GET    /           # List jobs (pagination, filters, search)
â”‚   â”œâ”€â”€ GET    /stats      # Job statistics
â”‚   â”œâ”€â”€ GET    /:id        # Get single job
â”‚   â”œâ”€â”€ POST   /           # Create job (admin)
â”‚   â”œâ”€â”€ PUT    /:id        # Update job (admin)
â”‚   â”œâ”€â”€ DELETE /:id        # Delete job (admin)
â”‚   â”œâ”€â”€ PATCH  /:id/publish    # Publish job (admin)
â”‚   â””â”€â”€ PATCH  /:id/close      # Close job (admin)
â”œâ”€â”€ /partners (admin for write, public for read)
â”‚   â”œâ”€â”€ GET    /           # List partners (pagination, filters, search)
â”‚   â”œâ”€â”€ GET    /stats      # Partner statistics
â”‚   â”œâ”€â”€ GET    /:id        # Get single partner
â”‚   â”œâ”€â”€ POST   /           # Create partner (admin)
â”‚   â”œâ”€â”€ PUT    /:id        # Update partner (admin)
â”‚   â”œâ”€â”€ DELETE /:id        # Delete partner (admin)
â”‚   â”œâ”€â”€ PATCH  /:id/publish    # Publish partner (admin)
â”‚   â””â”€â”€ PATCH  /:id/unpublish  # Unpublish partner (admin)
â”œâ”€â”€ /payment
â”‚   â”œâ”€â”€ GET    /pricing           # Get credit packages (public)
â”‚   â”œâ”€â”€ GET    /bank-info         # Get bank info (public)
â”‚   â”œâ”€â”€ POST   /create            # Create payment request (auth)
â”‚   â”œâ”€â”€ POST   /confirm/:id       # Confirm payment (auth)
â”‚   â”œâ”€â”€ DELETE /cancel/:id        # Cancel payment (auth)
â”‚   â”œâ”€â”€ GET    /history           # Get payment history (auth)
â”‚   â”œâ”€â”€ GET    /pending           # Get pending payments (auth)
â”‚   â”œâ”€â”€ GET    /status/:id        # Check payment status (auth)
â”‚   â”œâ”€â”€ POST   /webhook           # Casso webhook (no auth)
â”‚   â”œâ”€â”€ POST   /verify            # Admin verify payment (admin)
â”‚   â””â”€â”€ GET    /admin/transactions # Admin get all transactions (admin)
â”œâ”€â”€ /admin (admin only)
â”‚   â”œâ”€â”€ GET    /users             # List users with search
â”‚   â”œâ”€â”€ GET    /users/:id         # Get user details + stats
â”‚   â”œâ”€â”€ GET    /users/:id/transactions  # Get user transactions
â”‚   â”œâ”€â”€ POST   /users/:id/topup   # Manual top-up
â”‚   â”œâ”€â”€ GET    /transactions      # List all transactions
â”‚   â”œâ”€â”€ POST   /transactions/check-timeout  # Check timeout transactions
â”‚   â”œâ”€â”€ GET    /webhook-logs      # List webhook logs
â”‚   â”œâ”€â”€ GET    /webhook-logs/:id  # Get webhook log detail
â”‚   â”œâ”€â”€ POST   /webhook-logs/:id/reprocess  # Reprocess webhook
â”‚   â”œâ”€â”€ POST   /webhook-logs/:id/assign-user  # Assign user to webhook
â”‚   â”œâ”€â”€ POST   /webhook-logs/:id/ignore  # Ignore webhook
â”‚   â”œâ”€â”€ GET    /stats             # Dashboard statistics
â”‚   â”œâ”€â”€ GET    /storage/orphaned  # List B2 files not referenced in MongoDB (super admin only)
â”‚   â””â”€â”€ DELETE /storage/orphaned  # Delete orphaned B2 file by key (super admin only)
â”œâ”€â”€ /prompts
â”‚   â”œâ”€â”€ GET    /                  # List prompts (pagination, filters, search)
â”‚   â”œâ”€â”€ GET    /featured          # Get featured prompts
â”‚   â”œâ”€â”€ GET    /my/created        # Get user's created prompts (auth)
â”‚   â”œâ”€â”€ GET    /my/bookmarked     # Get user's bookmarked prompts (auth)
â”‚   â”œâ”€â”€ GET    /:slug             # Get single prompt by slug
â”‚   â”œâ”€â”€ POST   /                  # Create prompt (auth)
â”‚   â”œâ”€â”€ PUT    /:id               # Update prompt (auth, owner)
â”‚   â”œâ”€â”€ DELETE /:id               # Delete prompt (auth, owner)
â”‚   â”œâ”€â”€ POST   /:id/like          # Toggle like (auth)
â”‚   â”œâ”€â”€ POST   /:id/bookmark      # Toggle bookmark (auth)
â”‚   â”œâ”€â”€ POST   /:id/download      # Track download (auth)
â”‚   â”œâ”€â”€ POST   /:id/rate          # Rate 1-5 stars (auth)
â”‚   â”œâ”€â”€ PATCH  /:id/hide          # Hide content (mod/admin)
â”‚   â”œâ”€â”€ PATCH  /:id/unhide        # Restore content (mod/admin)
â”‚   â””â”€â”€ PATCH  /:id/feature       # Toggle featured (admin)
â”œâ”€â”€ /resources
â”‚   â”œâ”€â”€ GET    /                  # List resources (pagination, filters, search)
â”‚   â”œâ”€â”€ GET    /featured          # Get featured resources
â”‚   â”œâ”€â”€ GET    /my/created        # Get user's created resources (auth)
â”‚   â”œâ”€â”€ GET    /my/bookmarked     # Get user's bookmarked resources (auth)
â”‚   â”œâ”€â”€ GET    /:slug             # Get single resource by slug
â”‚   â”œâ”€â”€ POST   /                  # Create resource (auth)
â”‚   â”œâ”€â”€ PUT    /:id               # Update resource (auth, owner)
â”‚   â”œâ”€â”€ DELETE /:id               # Delete resource (auth, owner)
â”‚   â”œâ”€â”€ POST   /:id/like          # Toggle like (auth)
â”‚   â”œâ”€â”€ POST   /:id/bookmark      # Toggle bookmark (auth)
â”‚   â”œâ”€â”€ POST   /:id/download      # Track download + get file URL (auth)
â”‚   â”œâ”€â”€ POST   /:id/rate          # Rate 1-5 stars (auth)
â”‚   â”œâ”€â”€ PATCH  /:id/hide          # Hide content (mod/admin)
â”‚   â”œâ”€â”€ PATCH  /:id/unhide        # Restore content (mod/admin)
â”‚   â””â”€â”€ PATCH  /:id/feature       # Toggle featured (admin)
â”œâ”€â”€ /comments
â”‚   â”œâ”€â”€ GET    /                  # Get comments for target (prompt/resource)
â”‚   â”œâ”€â”€ POST   /                  # Create comment (auth)
â”‚   â”œâ”€â”€ PUT    /:id               # Update comment (auth, owner)
â”‚   â”œâ”€â”€ DELETE /:id               # Delete comment (auth, owner/mod)
â”‚   â””â”€â”€ POST   /:id/like          # Toggle like on comment (auth)
â”œâ”€â”€ /enrollments (auth required)
â”‚   â”œâ”€â”€ GET    /my-courses        # Get user's enrolled courses
â”‚   â”œâ”€â”€ GET    /check/:courseId   # Check enrollment status
â”‚   â”œâ”€â”€ POST   /:courseId         # Enroll in course
â”‚   â”œâ”€â”€ GET    /:courseId/progress    # Get enrollment progress
â”‚   â”œâ”€â”€ PUT    /:courseId/progress    # Update lesson progress
â”‚   â””â”€â”€ DELETE /:courseId         # Unenroll from course
â”œâ”€â”€ /reviews
â”‚   â”œâ”€â”€ GET    /course/:courseId  # Get reviews for course (with rating distribution)
â”‚   â”œâ”€â”€ GET    /my-review/:courseId   # Get user's review (auth)
â”‚   â”œâ”€â”€ POST   /:courseId         # Create review (auth)
â”‚   â”œâ”€â”€ PUT    /:reviewId         # Update review (auth, owner)
â”‚   â”œâ”€â”€ DELETE /:reviewId         # Delete review (auth, owner/admin)
â”‚   â”œâ”€â”€ POST   /:reviewId/helpful # Toggle helpful mark (auth)
â”‚   â””â”€â”€ POST   /:reviewId/reply   # Admin reply to review (admin)
â”œâ”€â”€ /articles (public read, mod/admin write)
â”‚   â”œâ”€â”€ GET    /             # List published articles (filter: category, search, pagination)
â”‚   â”œâ”€â”€ GET    /admin/list   # List all articles inc. drafts (mod/admin)
â”‚   â”œâ”€â”€ POST   /             # Create article (mod/admin)
â”‚   â”œâ”€â”€ PUT    /:id          # Update article (mod/admin)
â”‚   â”œâ”€â”€ DELETE /:id          # Delete article (mod/admin)
â”‚   â”œâ”€â”€ PATCH  /:id/publish  # Publish article (mod/admin)
â”‚   â”œâ”€â”€ PATCH  /:id/unpublish # Unpublish article (mod/admin)
â”‚   â””â”€â”€ GET    /:slug        # Get single article by slug (public)
â”œâ”€â”€ /cloud
â”‚   â”œâ”€â”€ POST   /connect           # Connect to cloud desktop (auth)
â”‚   â”œâ”€â”€ POST   /disconnect        # Disconnect from cloud desktop (auth)
â”‚   â”œâ”€â”€ GET    /session           # Get active session (auth)
â”‚   â”œâ”€â”€ POST   /heartbeat         # Agent heartbeat (secret-based)
â”‚   â”œâ”€â”€ GET    /admin/machines    # List machines (admin)
â”‚   â”œâ”€â”€ POST   /admin/machines    # Register machine (admin)
â”‚   â”œâ”€â”€ PUT    /admin/machines/:id    # Update machine (admin)
â”‚   â”œâ”€â”€ PATCH  /admin/machines/:id/toggle  # Toggle machine (admin)
â”‚   â”œâ”€â”€ GET    /admin/sessions    # List sessions (admin)
â”‚   â””â”€â”€ POST   /admin/sessions/:id/force-end  # Force end session (admin)
â”œâ”€â”€ /upload
â”‚   â”œâ”€â”€ POST   /presign           # Generate B2 presigned upload URL (auth)
â”‚   â””â”€â”€ DELETE /file              # Delete file from B2 (admin)
â”œâ”€â”€ /interior
â”‚   â”œâ”€â”€ GET    /projects                    # List user's interior projects (auth)
â”‚   â”œâ”€â”€ POST   /projects                    # Create project (auth)
â”‚   â”œâ”€â”€ GET    /projects/:id                # Get project (auth, owner)
â”‚   â”œâ”€â”€ PATCH  /projects/:id                # Rename project (auth, owner)
â”‚   â”œâ”€â”€ DELETE /projects/:id                # Soft delete project (auth, owner)
â”‚   â”œâ”€â”€ POST   /projects/:id/chat           # AI chat â€” proposal or apply stage (auth, charges credit)
â”‚   â”œâ”€â”€ POST   /projects/:id/rollback       # Move currentVersionIndex to target version (auth, owner)
â”‚   â”œâ”€â”€ POST   /analyze-image               # Image â†’ design model JSON (auth + quota)
â”‚   â”œâ”€â”€ POST   /generate-render             # 3D view + style prompt â†’ render placeholder (auth + quota)
â”‚   â”œâ”€â”€ POST   /workshop/components/delete  # Local/dev Workshop source JSON delete + bundle regen (localhost only)
â”‚   â””â”€â”€ GET    /admin/logs                  # List InteriorAiLog (auth + adminOnly); filters projectId/userId/stage/status
â”œâ”€â”€ /workflow
â”‚   â”‚   â”œâ”€â”€ GET    /projects          # List user's projects (auth)
â”‚   â”‚   â”œâ”€â”€ POST   /projects          # Create project (auth)
â”‚   â”‚   â”œâ”€â”€ PUT    /projects/:id      # Update project (auth, creator/admin)
â”‚   â”‚   â”œâ”€â”€ DELETE /projects/:id      # Delete project + docs (auth, creator/admin)
â”‚   â”‚   â”œâ”€â”€ GET    /users/search      # Search users by name (auth)
â”‚   â”‚   â”œâ”€â”€ GET    /users/:id         # Get user public profile (auth)
â”‚   â”‚   â”œâ”€â”€ GET    /documents         # List user's docs, ?projectId=xxx (auth)
â”‚   â”‚   â”œâ”€â”€ POST   /documents         # Create document record (auth)
â”‚   â”‚   â”œâ”€â”€ PUT    /documents/:id     # Update document (auth, creator/admin)
â”‚   â”‚   â””â”€â”€ DELETE /documents/:id     # Delete document (auth, creator/admin)
â”œâ”€â”€ /chat (auth required)
â”‚   â”œâ”€â”€ GET    /history          # User's chat history (?limit=50, max 200, oldestâ†’newest)
â”‚   â”œâ”€â”€ POST   /send             # Send single message â†’ save user msg + forward to OpenClaw + save reply
â”‚   â””â”€â”€ DELETE /history          # Clear user's chat history (DB only; OpenClaw session memory persists)
â””â”€â”€ /health               # Health check endpoint
```

---

## 3. Key Decisions & Patterns

### Authentication System
- **Password Security:** bcrypt with 12 salt rounds
- **Token:** JWT with 7-day expiration
- **Storage:** httpOnly cookie + Authorization header support
- **Middleware:** `authMiddleware` for protected routes

### Database Architecture (MongoDB Atlas)
- **Connection:** MongoDB Atlas Cloud (Cluster0)
- **Database Name:** `alpha-studio`
- **Collections:** 13 collections
  - `users` - User accounts with hashed passwords + balance
  - `courses` - Course information
  - `students` - Student profiles
  - `partners` - Partner profiles
  - `projects` - User projects
  - `studio_sessions` - AI studio session history
  - `transformations` - Available transformations
  - `api_usage` - API usage tracking
  - `transactions` - Payment transactions (topup, spend, refund, manual_topup, bonus)
  - `webhooklogs` - Casso webhook logs for debugging/reprocessing
  - `prompts` - Shared prompts with multiple contents, ratings, engagement
  - `resources` - Resource hub files with metadata and engagement
  - `comments` - Comments for prompts and resources
- **Documentation:** See DATABASE.md for detailed schema

### CORS Configuration
- Development: localhost:3000, localhost:5173, 127.0.0.1:5173
- Production: Set via `FRONTEND_URL` environment variable
- Supports credentials for cookie-based auth
- Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS

### Admin Authorization
- **adminOnly middleware:** Checks `user.role === 'admin'`
- **Protected routes:** All /api/courses/* endpoints
- Returns 403 Forbidden for non-admin users

### Error Handling
- Centralized error middleware
- User-friendly error messages
- Duplicate key detection (MongoDB code 11000)
- Mongoose validation error handling

---

## 4. Active Features & Status

| Feature | Status | Files Involved | Notes |
|---------|--------|----------------|-------|
| User Registration | âœ… Complete | routes/auth.js | Email + password validation |
| User Login | âœ… Complete | routes/auth.js | JWT token generation |
| User Logout | âœ… Complete | routes/auth.js | Cookie clearing |
| Get Current User | âœ… Complete | routes/auth.js | Protected route |
| Update Profile | âœ… Complete | routes/auth.js | Name update |
| Change Password | âœ… Complete | routes/auth.js | Old password verification |
| Health Check | âœ… Complete | index.js | API status endpoint |
| Password Hashing | âœ… Complete | models/User.js | bcrypt with 12 rounds |
| JWT Middleware | âœ… Complete | middleware/auth.js | Token verification |
| Admin Middleware | âœ… Complete | middleware/auth.js | Role-based authorization |
| CORS Support | âœ… Complete | index.js | Multi-origin + PATCH method |
| Course CRUD | âœ… Complete | routes/courses.js | Create, Read, Update, Delete |
| Course Publishing | âœ… Complete | routes/courses.js | Publish, Unpublish, Archive |
| Course Statistics | âœ… Complete | routes/courses.js | Aggregated stats endpoint |
| Multilingual Courses | âœ… Complete | models/Course.js | VI/EN title and description |
| Course Modules/Lessons | âœ… Complete | models/Course.js | Nested schema structure |
| Job CRUD | âœ… Complete | routes/jobs.js | Create, Read, Update, Delete |
| Job Publishing | âœ… Complete | routes/jobs.js | Publish, Close |
| Job Statistics | âœ… Complete | routes/jobs.js | Aggregated stats endpoint |
| Partner CRUD | âœ… Complete | routes/partners.js | Create, Read, Update, Delete |
| Partner Publishing | âœ… Complete | routes/partners.js | Publish, Unpublish |
| Partner Statistics | âœ… Complete | routes/partners.js | Aggregated stats endpoint |
| Partner Skills | âœ… Complete | models/Partner.js | String array for skills |
| Stale Index Cleanup | âœ… Complete | db/connection.js | Auto-drops stale indexes on startup |
| Payment System | âœ… Complete | routes/payment.js, models/Transaction.js | Credit packages, VietQR, Casso webhook |
| Webhook Logging | âœ… Complete | models/WebhookLog.js | Stores all incoming webhooks for debugging |
| Admin Management | âœ… Complete | routes/admin.js | Users, transactions, webhook management |
| Manual Top-up | âœ… Complete | routes/admin.js | Admin can top-up users manually |
| Webhook Assignment | âœ… Complete | routes/admin.js | Admin can assign unmatched webhooks to users |
| Transaction Timeout | âœ… Complete | routes/admin.js | Auto-timeout after 5 min without webhook match |
| Share Prompts API | âœ… Complete | routes/prompts.js, models/Prompt.js | CRUD, like, bookmark, rate, download, featured, moderation |
| Resource Hub API | âœ… Complete | routes/resources.js, models/Resource.js | CRUD, file upload (50MB), like, bookmark, rate, download |
| Comments API | âœ… Complete | routes/comments.js, models/Comment.js | Comments for prompts/resources with likes |
| Course Enrollment API | âœ… Complete | routes/enrollments.js, models/Enrollment.js | Enroll with credit deduction for paid courses; Transaction recorded; progress tracking |
| Course Reviews API | âœ… Complete | routes/reviews.js, models/Review.js | CRUD, rating distribution, helpful votes, admin reply |
| Lesson Video/Documents | âœ… Complete | models/Course.js | videoUrl and documents array per lesson |
| Article CMS | âœ… Complete | models/Article.js, routes/articles.js | Bilingual articles for About & Services pages, admin CRUD |
| Cloud Desktop API | âœ… Complete | models/HostMachine.js, models/CloudSession.js, routes/cloud.js | User connect/disconnect, admin machine/session management, agent heartbeat, cron cleanup |
| B2 Presigned Upload | âœ… Complete | routes/upload.js, utils/b2Storage.js | Generate presigned PUT URL for browser-direct upload to Backblaze B2; `listAllFiles()` for bucket enumeration |
| Workflow Projects API | âœ… Complete | models/WorkflowProject.js, routes/workflow.js | CRUD projects with team, tasks, chatHistory, expenseLog â€” auth required; GET /projects shows all non-completed for users |
| Workflow Documents API | âœ… Complete | models/WorkflowDocument.js, routes/workflow.js | CRUD document records with status, comments, note â€” auth required; GET ?projectId returns all project docs to members |
â”œâ”€â”€ /workflow
â”‚   â”‚   â”œâ”€â”€ GET    /projects          # List user's projects (auth)
â”‚   â”‚   â”œâ”€â”€ POST   /projects          # Create project (auth)
â”‚   â”‚   â”œâ”€â”€ PUT    /projects/:id      # Update project (auth, creator/admin)
â”‚   â”‚   â”œâ”€â”€ DELETE /projects/:id      # Delete project + docs (auth, creator/admin)
â”‚   â”‚   â”œâ”€â”€ GET    /users/search      # Search users by name (auth)
â”‚   â”‚   â”œâ”€â”€ GET    /users/:id         # Get user public profile (auth)
â”‚   â”‚   â”œâ”€â”€ GET    /documents         # List user's docs, ?projectId=xxx (auth)
â”‚   â”‚   â”œâ”€â”€ POST   /documents         # Create document record (auth)
â”‚   â”‚   â”œâ”€â”€ PUT    /documents/:id     # Update document (auth, creator/admin)
â”‚   â”‚   â””â”€â”€ DELETE /documents/:id     # Delete document (auth, creator/admin)
â”œâ”€â”€ /chat (auth required)
â”‚   â”œâ”€â”€ GET    /history          # User's chat history (?limit=50, max 200, oldestâ†’newest)
â”‚   â”œâ”€â”€ POST   /send             # Send single message â†’ save user msg + forward to OpenClaw + save reply
â”‚   â””â”€â”€ DELETE /history          # Clear user's chat history (DB only; OpenClaw session memory persists)
â””â”€â”€ /health               # Health check endpoint
```

---

## 3. Key Decisions & Patterns

### Authentication System
- **Password Security:** bcrypt with 12 salt rounds
- **Token:** JWT with 7-day expiration
- **Storage:** httpOnly cookie + Authorization header support
- **Middleware:** `authMiddleware` for protected routes

### Database Architecture (MongoDB Atlas)
- **Connection:** MongoDB Atlas Cloud (Cluster0)
- **Database Name:** `alpha-studio`
- **Collections:** 13 collections
  - `users` - User accounts with hashed passwords + balance
  - `courses` - Course information
  - `students` - Student profiles
  - `partners` - Partner profiles
  - `projects` - User projects
  - `studio_sessions` - AI studio session history
  - `transformations` - Available transformations
  - `api_usage` - API usage tracking
  - `transactions` - Payment transactions (topup, spend, refund, manual_topup, bonus)
  - `webhooklogs` - Casso webhook logs for debugging/reprocessing
  - `prompts` - Shared prompts with multiple contents, ratings, engagement
  - `resources` - Resource hub files with metadata and engagement
  - `comments` - Comments for prompts and resources
- **Documentation:** See DATABASE.md for detailed schema

### CORS Configuration
- Development: localhost:3000, localhost:5173, 127.0.0.1:5173
- Production: Set via `FRONTEND_URL` environment variable
- Supports credentials for cookie-based auth
- Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS

### Admin Authorization
- **adminOnly middleware:** Checks `user.role === 'admin'`
- **Protected routes:** All /api/courses/* endpoints
- Returns 403 Forbidden for non-admin users

### Error Handling
- Centralized error middleware
- User-friendly error messages
- Duplicate key detection (MongoDB code 11000)
- Mongoose validation error handling

---

## 4. Active Features & Status

| Feature | Status | Files Involved | Notes |
|---------|--------|----------------|-------|
| User Registration | âœ… Complete | routes/auth.js | Email + password validation |
| User Login | âœ… Complete | routes/auth.js | JWT token generation |
| User Logout | âœ… Complete | routes/auth.js | Cookie clearing |
| Get Current User | âœ… Complete | routes/auth.js | Protected route |
| Update Profile | âœ… Complete | routes/auth.js | Name update |
| Change Password | âœ… Complete | routes/auth.js | Old password verification |
| Health Check | âœ… Complete | index.js | API status endpoint |
| Password Hashing | âœ… Complete | models/User.js | bcrypt with 12 rounds |
| JWT Middleware | âœ… Complete | middleware/auth.js | Token verification |
| Admin Middleware | âœ… Complete | middleware/auth.js | Role-based authorization |
| CORS Support | âœ… Complete | index.js | Multi-origin + PATCH method |
| Course CRUD | âœ… Complete | routes/courses.js | Create, Read, Update, Delete |
| Course Publishing | âœ… Complete | routes/courses.js | Publish, Unpublish, Archive |
| Course Statistics | âœ… Complete | routes/courses.js | Aggregated stats endpoint |
| Multilingual Courses | âœ… Complete | models/Course.js | VI/EN title and description |
| Course Modules/Lessons | âœ… Complete | models/Course.js | Nested schema structure |
| Job CRUD | âœ… Complete | routes/jobs.js | Create, Read, Update, Delete |
| Job Publishing | âœ… Complete | routes/jobs.js | Publish, Close |
| Job Statistics | âœ… Complete | routes/jobs.js | Aggregated stats endpoint |
| Partner CRUD | âœ… Complete | routes/partners.js | Create, Read, Update, Delete |
| Partner Publishing | âœ… Complete | routes/partners.js | Publish, Unpublish |
| Partner Statistics | âœ… Complete | routes/partners.js | Aggregated stats endpoint |
| Partner Skills | âœ… Complete | models/Partner.js | String array for skills |
| Stale Index Cleanup | âœ… Complete | db/connection.js | Auto-drops stale indexes on startup |
| Payment System | âœ… Complete | routes/payment.js, models/Transaction.js | Credit packages, VietQR, Casso webhook |
| Webhook Logging | âœ… Complete | models/WebhookLog.js | Stores all incoming webhooks for debugging |
| Admin Management | âœ… Complete | routes/admin.js | Users, transactions, webhook management |
| Manual Top-up | âœ… Complete | routes/admin.js | Admin can top-up users manually |
| Webhook Assignment | âœ… Complete | routes/admin.js | Admin can assign unmatched webhooks to users |
| Transaction Timeout | âœ… Complete | routes/admin.js | Auto-timeout after 5 min without webhook match |
| Share Prompts API | âœ… Complete | routes/prompts.js, models/Prompt.js | CRUD, like, bookmark, rate, download, featured, moderation |
| Resource Hub API | âœ… Complete | routes/resources.js, models/Resource.js | CRUD, file upload (50MB), like, bookmark, rate, download |
| Comments API | âœ… Complete | routes/comments.js, models/Comment.js | Comments for prompts/resources with likes |
| Course Enrollment API | âœ… Complete | routes/enrollments.js, models/Enrollment.js | Enroll with credit deduction for paid courses; Transaction recorded; progress tracking |
| Course Reviews API | âœ… Complete | routes/reviews.js, models/Review.js | CRUD, rating distribution, helpful votes, admin reply |
| Lesson Video/Documents | âœ… Complete | models/Course.js | videoUrl and documents array per lesson |
| Article CMS | âœ… Complete | models/Article.js, routes/articles.js | Bilingual articles for About & Services pages, admin CRUD |
| Cloud Desktop API | âœ… Complete | models/HostMachine.js, models/CloudSession.js, routes/cloud.js | User connect/disconnect, admin machine/session management, agent heartbeat, cron cleanup |
| B2 Presigned Upload | âœ… Complete | routes/upload.js, utils/b2Storage.js | Generate presigned PUT URL for browser-direct upload to Backblaze B2; `listAllFiles()` for bucket enumeration |
| Workflow Projects API | âœ… Complete | models/WorkflowProject.js, routes/workflow.js | CRUD projects with team, tasks, chatHistory, expenseLog â€” auth required; GET /projects shows all non-completed for users |
| Workflow Documents API | âœ… Complete | models/WorkflowDocument.js, routes/workflow.js | CRUD document records with status, comments, note â€” auth required; GET ?projectId returns all project docs to members |
| Workflow User Profile API | âœ… Complete | routes/workflow.js | GET /users/:id returns public profile (name, avatar, role, email, phone, bio, skills, location, socials) â€” auth required |
| Storage Cleanup API | âœ… Complete | routes/admin.js, utils/b2Storage.js | Lists all B2 files; cross-references WorkflowDocument/Resource (file+previewImages)/Course (videoUrl+documents)/Prompt (exampleImages); returns `data` (orphaned) + `referencedFiles` each with `source`, `uploader`, `referenced` â€” super admin only |
| Studio Usage Tracking (legacy) | âœ… Complete | models/User.js, routes/studio.js | `studioUsage: {date, count}` on User; GET /studio/usage + POST /studio/use; 3 free uses/day; admin/mod unlimited |
| Flow Image/Video Generation | âœ… Complete (Phase 2) | models/{FlowServer,StudioGeneration,User}.js, routes/studio.js, routes/cloud.js | `POST /studio/image/generate` (5/day), `POST /studio/video/generate` (1/day), `GET /studio/media/:genId/:idx` (B2 redirect or agent proxy stream), `POST /studio/save/:genId/:idx` (B2 upload), `GET /studio/history`; agent register+heartbeat via `/cloud/flow-heartbeat` + admin CRUD `/cloud/admin/flow-servers`; cron marks flow-server offline >2min |
| AI Consultation Chat | âœ… Complete | models/ChatMessage.js, routes/chat.js, routes/settings.js, utils/aiProvider.js, server/context/alpha-studio-bot | `POST /chat/send` saves user msg then routes via admin setting `useOpenClawForChat`: OpenClaw (`OPENCLAW_URL`, session memory) by default, or direct gcli (`GCLI_DIRECT_URL`) with bundled Alpha Studio workspace context and up to 3 previous MongoDB chat messages. `GET /chat/history` display history; `DELETE /chat/history` clears DB history. |
| VocabFlip Integration | âœ… Complete (Phase 15) | models/Vocab.js, routes/vocab.js | MongoDB-backed public library (decks, flashcards, ratings, import links, profile, feedback, sync notification stubs) & private cloud storage CRUD for web users (`VocabPrivateDeck`, `VocabPrivateFlashcard` models, `/my-decks` routes); VocabFlip media upload uses existing B2 presign flow |
| Interior Design AI API | âœ… Complete | models/InteriorProject.js, routes/interior.js, utils/aiProvider.js, routes/chat.js | Auth-gated `/api/interior` project CRUD, AI chat, version persistence, rollback, manual cabinetModel validation, 1-credit charge per valid AI response, admin/mod bypass. Reuses `useOpenClawForChat` provider toggle shared with `/api/chat/send`. |
| Interior AI Prompt v2 + 2-step | âœ… Complete | routes/interior.js, models/User.js, models/InteriorProject.js, routes/auth.js, utils/templateValidator.js | (A) Prompt v2: few-shot, domain hints (kĂ­ch thÆ°á»›c/váº­t liá»‡u chuáº©n VN), Phase 10 strict dimension anchor, `/chat` `runs[]` rule for L/U/island/parallel layouts, z-axis wall-depth convention, forced reply format "Quan sĂ¡t áº£nh/Hiá»ƒu yĂªu cáº§u/ÄĂ£ Ă¡p dá»¥ng", lower askForInfo threshold. Phase 14 template instructions require `boxes` only for new `tplNew` payloads, while validator accepts legacy `isoBoxes` and rejects SVG view fields. (B) Opt-in `User.preferences.interiorTwoStepConfirm` (set via `PUT /auth/profile`). When ON, `POST /interior/projects/:id/chat` accepts `stage='proposal'\|'apply'`: proposal returns plain-text analysis (1 credit, no version), apply consumes `proposalText` as context (1 credit, creates version). Total 2 credit/láº§n khi báº­t. |
| Interior Image-to-Design (Phase 4+) | âœ… Complete | routes/interior.js (+/analyze-image, +/generate-render), middleware/interiorQuota.js, models/{InteriorAnalysis,InteriorRender,InteriorQuota}.js, routes/admin.js (orphan scan) | `POST /interior/analyze-image` (auth + 5/24h quota): JSON body `{imageUrl, hints, modelOverride}`, sha256 cache (24h TTL), Gemini Flash 3 default â†’ Pro 3.1 escalate, 2-attempt JSON repair loop, returns `{model, suggestedModel, meta}`. Prompt teaches Phase 8 `runs[]` for L/U/island/galley layouts and Phase 7 `csgHints[]`; validator accepts either legacy `modules[]` or new `runs[]`, not both. Default project model now uses an opaque solid panel template instead of transparent zone modules. |
| Interior Component Workshop Cleanup | âœ… Complete | routes/interior.js, tools/interior-component-workshop/component-library.js | `POST /api/interior/workshop/components/delete` deletes selected local Workshop `components/<id>.json` files and regenerates `data/template-bundle.js`. It is enabled only in local/dev (or `INTERIOR_WORKSHOP_DELETE_ENABLED=true`) and only accepts loopback requests from no origin, `Origin: null`, localhost, or 127.0.0.1; no Bearer token is required for this local cleanup endpoint. |
| Interior Workshop File-Origin CORS | âœ… Complete | server/index.js | `Origin: null` from `file://` workshop pages is now treated as an allowed CORS origin instead of logging `CORS blocked origin: null`. Local workshop origins on localhost/127.0.0.1 are also explicitly allowed. |
| Interior AI Log Viewer | âœ… Complete | models/InteriorAiLog.js, routes/interior.js, scripts/dump-interior-log.mjs | Every `/api/interior/projects/:id/chat` call (both `proposal` and `apply` stages) records raw prompt, ref images, raw AI response, parsed reply, latency, usage, status (`ok`/`parse-failed`/`validation-failed`/`upstream-error`), errorMessage. TTL 30 days. `GET /api/interior/admin/logs?projectId=&userId=&stage=&status=&limit=` accepts EITHER (auth + adminOnly) OR header `x-reviewer-token: $INTERIOR_LOG_REVIEWER_TOKEN` (reviewer bypass for ops/debug). Direct dump: `node scripts/dump-interior-log.mjs <projectId>`. |

---

## 5. Known Issues & TODOs

### High Priority
- [ ] Rate limiting not implemented
- [ ] Input sanitization could be improved

### Medium Priority
- [ ] Forgot password / password reset not implemented
- [ ] Email verification not implemented
- [ ] No testing framework configured
- [ ] No ESLint/Prettier configuration

### Low Priority
- [ ] API documentation (Swagger/OpenAPI)
- [ ] Request logging to file
- [ ] Database indexes optimization

---

## 6. Important Context for Claude

### When making changes:
1. Always update this file's "Last Updated" timestamp
3. Follow naming conventions in CONVENTIONS.md
4. Use ES Module syntax (import/export)
5. Handle errors consistently with try/catch
6. Return consistent JSON response format: `{ success, message, data? }`

### Critical Files (read before major changes):
- `server/models/User.js` - User schema and password hashing + balance field
- `server/models/Course.js` - Course schema with multilingual fields
- `server/models/Transaction.js` - Payment transaction schema
- `server/models/WebhookLog.js` - Webhook log schema
- `server/middleware/auth.js` - JWT verification + adminOnly middleware
- `server/routes/auth.js` - All authentication endpoints
- `server/routes/courses.js` - Course CRUD and management endpoints
- `server/routes/payment.js` - Payment API and Casso webhook handler
- `server/routes/admin.js` - Admin management endpoints
- `server/db/connection.js` - MongoDB connection setup
- `DATABASE.md` - Complete database schema documentation

### Environment Variables:
```env
MONGODB_URI=mongodb+srv://...       # MongoDB connection string
JWT_SECRET=your_secret_key          # JWT signing secret
PORT=3001                           # Server port (default: 3001)
NODE_ENV=development                # Environment mode
FRONTEND_URL=https://...            # Frontend URL for CORS
CASSO_WEBHOOK_SECRET=your_secret    # Casso webhook verification secret
# Backblaze B2
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_REGION=us-west-004
B2_ACCESS_KEY_ID=your_key_id
B2_SECRET_ACCESS_KEY=your_app_key
B2_BUCKET_NAME=your_bucket_name
CDN_BASE_URL=https://f004.backblazeb2.com/file/your_bucket_name
OPENCLAW_URL=http://localhost:18791/api/chat
GCLI_DIRECT_URL=http://localhost:18790/v1/chat/completions
GCLI_DIRECT_MODEL=gemini-2.5-flash
```


## 7. Quick Commands
## 8. Quick Commands
```bash
# Development
npm run dev          # Start with nodemon (auto-reload)
npm start            # Start production server

# Database
npm run db:test      # Test MongoDB connection
npm run db:init      # Initialize database with sample data
npm run db:migrate-passwords  # Hash existing plain-text passwords
```

---

## 8. Sample Users

After running `npm run db:init` and `npm run db:migrate-passwords`:

| Email | Password | Role |
|-------|----------|------|
| admin@alphastudio.com | admin123456 | admin |
| student@example.com | student123 | student |

---

**NOTE TO CLAUDE CODE:**
Read this file FIRST before making any changes.
Update active features status and TODOs after each session.


