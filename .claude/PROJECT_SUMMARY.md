# Project Summary

**Phase 15 Follow-up (2026-05-27):** VocabFlip private storage integration. Added MongoDB schemas `VocabPrivateDeck` and `VocabPrivateFlashcard` and implemented private deck & flashcard CRUD + search REST routes to route VocabFlip storage through the backend for web users (kIsWeb=true).

**Phase 15 Follow-up (2026-05-22):** Interior template validation now whitelists curved `boxes[]` primitives: regular box, `roundedBox`, and `cylinder`. Unknown primitive types are rejected at import/edit time. Seed script was rerun and MongoDB now includes `cab-base-rounded-end@1` as a `seed` template with rounded/cylindrical geometry.

**Phase 15 Follow-up (2026-05-21):** Interior agent tools now fill known template `width`/`height`/`depth` defaults before preview/commit, preventing tpl modules such as kitchen base/wall/corner cabinets from inheriting the whole model height/depth when the AI omits dimensions. Default Interior project Vietnamese strings were corrected from mojibake to UTF-8.

**Phase 14 Update (2026-05-20):** Interior template validation now accepts `boxes`/legacy `isoBoxes` only and rejects `frontSvg`/`sideSvg`/`planSvg` with a clear error. The interior agent prompt and `template.create` tests now document and verify boxes-only templates.

**Phase 14 Update (2026-05-20):** Added direct interior template import endpoint for the static Interior Component Workshop. `POST /api/interior/templates/import` accepts selected template DSL objects, validates them with `validateTemplateStructure`, creates a new `InteriorTemplate` version per template, and imports as `approved` for admin/mod users or `pending` for regular users.
If selected templates already match the latest library version, the endpoint returns success with `skipped` instead of failing with HTTP 400.

**Phase 13 Update (2026-05-20):** Interior Agent Harness added. Generic extractable runner code lives in `server/agent-runner/` (`ToolRegistry`, `SkillLoader`, SSE helpers, JSON protocol parser, loop runner). Interior domain tools live in `server/tools/interior/` with 15 registered tools. New `POST /api/interior/projects/:id/agent` streams SSE steps and commits through `model.commit`; `InteriorAgentLog` stores step logs with 30-day TTL. Agent flow costs 2 credits on commit and coexists with legacy `/chat`.

**Phase 12 Update (2026-05-19):** Backend now hosts the self-extending interior template library. New model `InteriorTemplate` (status: seed/pending/approved/deprecated). New endpoints: `GET /api/interior/templates` (engine catalog load, returns seed+approved deduped by highest version), `POST /api/interior/templates` (user commits a project inline template to pending), and `/api/admin/interior-templates` CRUD (list/getOne/approve/reject/edit/deprecate). `/api/interior/projects/:id/chat` now extracts AI-emitted `tplNew` blocks into `modelJson.inlineTemplates[id]`, replaces with `tpl: id`, and surfaces created ids in `data.meta.newInlineTemplates`. DSL validation lives in `server/utils/templateValidator.js` (AST whitelist mirror of the engine `expression.js`). Seed script `scripts/seed-interior-templates.mjs` upserts the 7 built-in templates from `tools/interior-design-engine/src/templates/` (idempotent).

**Phase 11 Update (2026-05-19):** `server/routes/interior.js` now validates the compact template contract: top-level `palette`, optional `inlineTemplates`, and module/detail items using either legacy `width/height/depth` boxes or `tpl/style` template references. The default project model uses `sliding-2door` with `palette: "wood-oak"`, and `/api/interior` prompts include the built-in template catalog while no longer promoting CSG hints.
**Last Updated:** 2026-05-27 (VocabFlip private storage)
**Updated By:** Claude Code

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
├── server/
│   ├── index.js                   # Express server entry point
│   ├── db/
│   │   ├── connection.js          # MongoDB connection
│   │   ├── init-collections.js    # Database initialization
│   │   ├── test-connection.js     # Connection test script
│   │   └── migrate-passwords.js   # Password hashing migration
│   ├── models/
│   │   ├── User.js                # User model with bcrypt + balance field
│   │   ├── Course.js              # Course model with multilingual support + lesson videoUrl/documents
│   │   ├── Enrollment.js          # Course enrollment with progress tracking
│   │   ├── Review.js              # Course reviews with ratings
│   │   ├── Job.js                 # Job listings with multilingual support
│   │   ├── Partner.js             # Partner profiles with skills array
│   │   ├── Transaction.js         # Payment transactions (topup, spend, etc.)
│   │   ├── WebhookLog.js          # Casso webhook logging
│   │   ├── Prompt.js              # Shared prompts with multiple contents, ratings
│   │   ├── Resource.js            # Resource hub with file upload (50MB)
│   │   ├── Comment.js             # Comments for prompts/resources
│   │   ├── Article.js             # Articles for About & Services pages (bilingual)
│   │   ├── HostMachine.js         # Cloud host machine registry
│   │   ├── CloudSession.js        # Cloud desktop sessions
│   │   ├── InteriorAiLog.js       # Raw AI request/response per Interior /chat call (TTL 30 days)
│   │   ├── WorkflowProject.js     # Workflow projects (team, tasks, chatHistory, expenseLog)
│   │   ├── WorkflowDocument.js    # Workflow documents (file metadata, status, comments)
│   │   ├── FeaturedStudent.js     # Featured students (userId ref, order, label, hired)
│   │   └── ChatMessage.js         # AI consultation chat history (userId, role, content) — display only; OpenClaw maintains session memory via x-openclaw-session-key
│   ├── middleware/
│   │   └── auth.js                # JWT auth + adminOnly + modOnly middleware
│   └── routes/
│       ├── auth.js                # Auth API routes
│       ├── courses.js             # Course CRUD + publish/archive routes
│       ├── jobs.js                # Job CRUD + publish/close routes
│       ├── partners.js            # Partner CRUD + publish/unpublish routes
│       ├── payment.js             # Payment API (create, confirm, cancel, webhook)
│       ├── admin.js               # Admin API (users, transactions, webhook management)
│       ├── prompts.js             # Prompts API (CRUD, like, bookmark, rate, download)
│       ├── resources.js           # Resources API (CRUD, like, bookmark, rate, download)
│       ├── comments.js            # Comments API for prompts/resources
│       ├── enrollments.js         # Course enrollment API (enroll, progress, check)
│       ├── reviews.js             # Course reviews API (CRUD, like, helpful, rating distribution)
│       ├── articles.js            # Articles API (CRUD, publish/unpublish, public + admin)
│       ├── cloud.js              # Cloud desktop API (connect, disconnect, admin machines/sessions, heartbeat)
│       ├── upload.js             # B2 presigned URL endpoint (POST /presign, DELETE /file)
│       ├── workflow.js           # Workflow API (CRUD projects + documents, auth required)
│       ├── featuredStudents.js   # Featured students API (public GET, admin CRUD + reorder)
│       └── chat.js               # AI consultation API (auth required) — GET /history, POST /send, DELETE /history; forwards to OpenClaw via OPENCLAW_URL
│   └── utils/
│       └── b2Storage.js          # B2 S3 client + generatePresignedUploadUrl + deleteFile + listAllFiles (paginated)

├── .claude/                       # Documentation
│   ├── PROJECT_SUMMARY.md
│   ├── CONVENTIONS.md
│   ├── DATABASE.md
│   ├── INSTRUCTIONS_FOR_CLAUDE.md
│   └── history/
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

### API Routes
```
/api
├── /auth
│   ├── POST /register    # User registration
│   ├── POST /login       # User login
│   ├── POST /logout      # Logout (clears cookie)
│   ├── GET  /me          # Get current user (auth required)
│   ├── PUT  /profile     # Update profile (auth required)
│   └── PUT  /password    # Change password (auth required)
├── /courses (admin only)
│   ├── GET    /           # List courses (pagination, filters, search)
│   ├── GET    /stats      # Course statistics
│   ├── GET    /:id        # Get single course
│   ├── POST   /           # Create course
│   ├── PUT    /:id        # Update course
│   ├── DELETE /:id        # Delete course
│   ├── PATCH  /:id/publish    # Publish course
│   ├── PATCH  /:id/unpublish  # Unpublish course
│   └── PATCH  /:id/archive    # Archive course
├── /jobs (admin for write, public for read)
│   ├── GET    /           # List jobs (pagination, filters, search)
│   ├── GET    /stats      # Job statistics
│   ├── GET    /:id        # Get single job
│   ├── POST   /           # Create job (admin)
│   ├── PUT    /:id        # Update job (admin)
│   ├── DELETE /:id        # Delete job (admin)
│   ├── PATCH  /:id/publish    # Publish job (admin)
│   └── PATCH  /:id/close      # Close job (admin)
├── /partners (admin for write, public for read)
│   ├── GET    /           # List partners (pagination, filters, search)
│   ├── GET    /stats      # Partner statistics
│   ├── GET    /:id        # Get single partner
│   ├── POST   /           # Create partner (admin)
│   ├── PUT    /:id        # Update partner (admin)
│   ├── DELETE /:id        # Delete partner (admin)
│   ├── PATCH  /:id/publish    # Publish partner (admin)
│   └── PATCH  /:id/unpublish  # Unpublish partner (admin)
├── /payment
│   ├── GET    /pricing           # Get credit packages (public)
│   ├── GET    /bank-info         # Get bank info (public)
│   ├── POST   /create            # Create payment request (auth)
│   ├── POST   /confirm/:id       # Confirm payment (auth)
│   ├── DELETE /cancel/:id        # Cancel payment (auth)
│   ├── GET    /history           # Get payment history (auth)
│   ├── GET    /pending           # Get pending payments (auth)
│   ├── GET    /status/:id        # Check payment status (auth)
│   ├── POST   /webhook           # Casso webhook (no auth)
│   ├── POST   /verify            # Admin verify payment (admin)
│   └── GET    /admin/transactions # Admin get all transactions (admin)
├── /admin (admin only)
│   ├── GET    /users             # List users with search
│   ├── GET    /users/:id         # Get user details + stats
│   ├── GET    /users/:id/transactions  # Get user transactions
│   ├── POST   /users/:id/topup   # Manual top-up
│   ├── GET    /transactions      # List all transactions
│   ├── POST   /transactions/check-timeout  # Check timeout transactions
│   ├── GET    /webhook-logs      # List webhook logs
│   ├── GET    /webhook-logs/:id  # Get webhook log detail
│   ├── POST   /webhook-logs/:id/reprocess  # Reprocess webhook
│   ├── POST   /webhook-logs/:id/assign-user  # Assign user to webhook
│   ├── POST   /webhook-logs/:id/ignore  # Ignore webhook
│   ├── GET    /stats             # Dashboard statistics
│   ├── GET    /storage/orphaned  # List B2 files not referenced in MongoDB (super admin only)
│   └── DELETE /storage/orphaned  # Delete orphaned B2 file by key (super admin only)
├── /prompts
│   ├── GET    /                  # List prompts (pagination, filters, search)
│   ├── GET    /featured          # Get featured prompts
│   ├── GET    /my/created        # Get user's created prompts (auth)
│   ├── GET    /my/bookmarked     # Get user's bookmarked prompts (auth)
│   ├── GET    /:slug             # Get single prompt by slug
│   ├── POST   /                  # Create prompt (auth)
│   ├── PUT    /:id               # Update prompt (auth, owner)
│   ├── DELETE /:id               # Delete prompt (auth, owner)
│   ├── POST   /:id/like          # Toggle like (auth)
│   ├── POST   /:id/bookmark      # Toggle bookmark (auth)
│   ├── POST   /:id/download      # Track download (auth)
│   ├── POST   /:id/rate          # Rate 1-5 stars (auth)
│   ├── PATCH  /:id/hide          # Hide content (mod/admin)
│   ├── PATCH  /:id/unhide        # Restore content (mod/admin)
│   └── PATCH  /:id/feature       # Toggle featured (admin)
├── /resources
│   ├── GET    /                  # List resources (pagination, filters, search)
│   ├── GET    /featured          # Get featured resources
│   ├── GET    /my/created        # Get user's created resources (auth)
│   ├── GET    /my/bookmarked     # Get user's bookmarked resources (auth)
│   ├── GET    /:slug             # Get single resource by slug
│   ├── POST   /                  # Create resource (auth)
│   ├── PUT    /:id               # Update resource (auth, owner)
│   ├── DELETE /:id               # Delete resource (auth, owner)
│   ├── POST   /:id/like          # Toggle like (auth)
│   ├── POST   /:id/bookmark      # Toggle bookmark (auth)
│   ├── POST   /:id/download      # Track download + get file URL (auth)
│   ├── POST   /:id/rate          # Rate 1-5 stars (auth)
│   ├── PATCH  /:id/hide          # Hide content (mod/admin)
│   ├── PATCH  /:id/unhide        # Restore content (mod/admin)
│   └── PATCH  /:id/feature       # Toggle featured (admin)
├── /comments
│   ├── GET    /                  # Get comments for target (prompt/resource)
│   ├── POST   /                  # Create comment (auth)
│   ├── PUT    /:id               # Update comment (auth, owner)
│   ├── DELETE /:id               # Delete comment (auth, owner/mod)
│   └── POST   /:id/like          # Toggle like on comment (auth)
├── /enrollments (auth required)
│   ├── GET    /my-courses        # Get user's enrolled courses
│   ├── GET    /check/:courseId   # Check enrollment status
│   ├── POST   /:courseId         # Enroll in course
│   ├── GET    /:courseId/progress    # Get enrollment progress
│   ├── PUT    /:courseId/progress    # Update lesson progress
│   └── DELETE /:courseId         # Unenroll from course
├── /reviews
│   ├── GET    /course/:courseId  # Get reviews for course (with rating distribution)
│   ├── GET    /my-review/:courseId   # Get user's review (auth)
│   ├── POST   /:courseId         # Create review (auth)
│   ├── PUT    /:reviewId         # Update review (auth, owner)
│   ├── DELETE /:reviewId         # Delete review (auth, owner/admin)
│   ├── POST   /:reviewId/helpful # Toggle helpful mark (auth)
│   └── POST   /:reviewId/reply   # Admin reply to review (admin)
├── /articles (public read, mod/admin write)
│   ├── GET    /             # List published articles (filter: category, search, pagination)
│   ├── GET    /admin/list   # List all articles inc. drafts (mod/admin)
│   ├── POST   /             # Create article (mod/admin)
│   ├── PUT    /:id          # Update article (mod/admin)
│   ├── DELETE /:id          # Delete article (mod/admin)
│   ├── PATCH  /:id/publish  # Publish article (mod/admin)
│   ├── PATCH  /:id/unpublish # Unpublish article (mod/admin)
│   └── GET    /:slug        # Get single article by slug (public)
├── /cloud
│   ├── POST   /connect           # Connect to cloud desktop (auth)
│   ├── POST   /disconnect        # Disconnect from cloud desktop (auth)
│   ├── GET    /session           # Get active session (auth)
│   ├── POST   /heartbeat         # Agent heartbeat (secret-based)
│   ├── GET    /admin/machines    # List machines (admin)
│   ├── POST   /admin/machines    # Register machine (admin)
│   ├── PUT    /admin/machines/:id    # Update machine (admin)
│   ├── PATCH  /admin/machines/:id/toggle  # Toggle machine (admin)
│   ├── GET    /admin/sessions    # List sessions (admin)
│   └── POST   /admin/sessions/:id/force-end  # Force end session (admin)
├── /upload
│   ├── POST   /presign           # Generate B2 presigned upload URL (auth)
│   └── DELETE /file              # Delete file from B2 (admin)
├── /interior
│   ├── GET    /projects                    # List user's interior projects (auth)
│   ├── POST   /projects                    # Create project (auth)
│   ├── GET    /projects/:id                # Get project (auth, owner)
│   ├── PATCH  /projects/:id                # Rename project (auth, owner)
│   ├── DELETE /projects/:id                # Soft delete project (auth, owner)
│   ├── POST   /projects/:id/chat           # AI chat — proposal or apply stage (auth, charges credit)
│   ├── POST   /projects/:id/rollback       # Move currentVersionIndex to target version (auth, owner)
│   ├── POST   /analyze-image               # Image → design model JSON (auth + quota)
│   ├── POST   /generate-render             # 3D view + style prompt → render placeholder (auth + quota)
│   ├── POST   /workshop/components/delete  # Local/dev Workshop source JSON delete + bundle regen (localhost only)
│   └── GET    /admin/logs                  # List InteriorAiLog (auth + adminOnly); filters projectId/userId/stage/status
├── /workflow
│   │   ├── GET    /projects          # List user's projects (auth)
│   │   ├── POST   /projects          # Create project (auth)
│   │   ├── PUT    /projects/:id      # Update project (auth, creator/admin)
│   │   ├── DELETE /projects/:id      # Delete project + docs (auth, creator/admin)
│   │   ├── GET    /users/search      # Search users by name (auth)
│   │   ├── GET    /users/:id         # Get user public profile (auth)
│   │   ├── GET    /documents         # List user's docs, ?projectId=xxx (auth)
│   │   ├── POST   /documents         # Create document record (auth)
│   │   ├── PUT    /documents/:id     # Update document (auth, creator/admin)
│   │   └── DELETE /documents/:id     # Delete document (auth, creator/admin)
├── /chat (auth required)
│   ├── GET    /history          # User's chat history (?limit=50, max 200, oldest→newest)
│   ├── POST   /send             # Send single message → save user msg + forward to OpenClaw + save reply
│   └── DELETE /history          # Clear user's chat history (DB only; OpenClaw session memory persists)
└── /health               # Health check endpoint
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
| User Registration | ✅ Complete | routes/auth.js | Email + password validation |
| User Login | ✅ Complete | routes/auth.js | JWT token generation |
| User Logout | ✅ Complete | routes/auth.js | Cookie clearing |
| Get Current User | ✅ Complete | routes/auth.js | Protected route |
| Update Profile | ✅ Complete | routes/auth.js | Name update |
| Change Password | ✅ Complete | routes/auth.js | Old password verification |
| Health Check | ✅ Complete | index.js | API status endpoint |
| Password Hashing | ✅ Complete | models/User.js | bcrypt with 12 rounds |
| JWT Middleware | ✅ Complete | middleware/auth.js | Token verification |
| Admin Middleware | ✅ Complete | middleware/auth.js | Role-based authorization |
| CORS Support | ✅ Complete | index.js | Multi-origin + PATCH method |
| Course CRUD | ✅ Complete | routes/courses.js | Create, Read, Update, Delete |
| Course Publishing | ✅ Complete | routes/courses.js | Publish, Unpublish, Archive |
| Course Statistics | ✅ Complete | routes/courses.js | Aggregated stats endpoint |
| Multilingual Courses | ✅ Complete | models/Course.js | VI/EN title and description |
| Course Modules/Lessons | ✅ Complete | models/Course.js | Nested schema structure |
| Job CRUD | ✅ Complete | routes/jobs.js | Create, Read, Update, Delete |
| Job Publishing | ✅ Complete | routes/jobs.js | Publish, Close |
| Job Statistics | ✅ Complete | routes/jobs.js | Aggregated stats endpoint |
| Partner CRUD | ✅ Complete | routes/partners.js | Create, Read, Update, Delete |
| Partner Publishing | ✅ Complete | routes/partners.js | Publish, Unpublish |
| Partner Statistics | ✅ Complete | routes/partners.js | Aggregated stats endpoint |
| Partner Skills | ✅ Complete | models/Partner.js | String array for skills |
| Stale Index Cleanup | ✅ Complete | db/connection.js | Auto-drops stale indexes on startup |
| Payment System | ✅ Complete | routes/payment.js, models/Transaction.js | Credit packages, VietQR, Casso webhook |
| Webhook Logging | ✅ Complete | models/WebhookLog.js | Stores all incoming webhooks for debugging |
| Admin Management | ✅ Complete | routes/admin.js | Users, transactions, webhook management |
| Manual Top-up | ✅ Complete | routes/admin.js | Admin can top-up users manually |
| Webhook Assignment | ✅ Complete | routes/admin.js | Admin can assign unmatched webhooks to users |
| Transaction Timeout | ✅ Complete | routes/admin.js | Auto-timeout after 5 min without webhook match |
| Share Prompts API | ✅ Complete | routes/prompts.js, models/Prompt.js | CRUD, like, bookmark, rate, download, featured, moderation |
| Resource Hub API | ✅ Complete | routes/resources.js, models/Resource.js | CRUD, file upload (50MB), like, bookmark, rate, download |
| Comments API | ✅ Complete | routes/comments.js, models/Comment.js | Comments for prompts/resources with likes |
| Course Enrollment API | ✅ Complete | routes/enrollments.js, models/Enrollment.js | Enroll with credit deduction for paid courses; Transaction recorded; progress tracking |
| Course Reviews API | ✅ Complete | routes/reviews.js, models/Review.js | CRUD, rating distribution, helpful votes, admin reply |
| Lesson Video/Documents | ✅ Complete | models/Course.js | videoUrl and documents array per lesson |
| Article CMS | ✅ Complete | models/Article.js, routes/articles.js | Bilingual articles for About & Services pages, admin CRUD |
| Cloud Desktop API | ✅ Complete | models/HostMachine.js, models/CloudSession.js, routes/cloud.js | User connect/disconnect, admin machine/session management, agent heartbeat, cron cleanup |
| B2 Presigned Upload | ✅ Complete | routes/upload.js, utils/b2Storage.js | Generate presigned PUT URL for browser-direct upload to Backblaze B2; `listAllFiles()` for bucket enumeration |
| Workflow Projects API | ✅ Complete | models/WorkflowProject.js, routes/workflow.js | CRUD projects with team, tasks, chatHistory, expenseLog — auth required; GET /projects shows all non-completed for users |
| Workflow Documents API | ✅ Complete | models/WorkflowDocument.js, routes/workflow.js | CRUD document records with status, comments, note — auth required; GET ?projectId returns all project docs to members |
├── /workflow
│   │   ├── GET    /projects          # List user's projects (auth)
│   │   ├── POST   /projects          # Create project (auth)
│   │   ├── PUT    /projects/:id      # Update project (auth, creator/admin)
│   │   ├── DELETE /projects/:id      # Delete project + docs (auth, creator/admin)
│   │   ├── GET    /users/search      # Search users by name (auth)
│   │   ├── GET    /users/:id         # Get user public profile (auth)
│   │   ├── GET    /documents         # List user's docs, ?projectId=xxx (auth)
│   │   ├── POST   /documents         # Create document record (auth)
│   │   ├── PUT    /documents/:id     # Update document (auth, creator/admin)
│   │   └── DELETE /documents/:id     # Delete document (auth, creator/admin)
├── /chat (auth required)
│   ├── GET    /history          # User's chat history (?limit=50, max 200, oldest→newest)
│   ├── POST   /send             # Send single message → save user msg + forward to OpenClaw + save reply
│   └── DELETE /history          # Clear user's chat history (DB only; OpenClaw session memory persists)
└── /health               # Health check endpoint
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
| User Registration | ✅ Complete | routes/auth.js | Email + password validation |
| User Login | ✅ Complete | routes/auth.js | JWT token generation |
| User Logout | ✅ Complete | routes/auth.js | Cookie clearing |
| Get Current User | ✅ Complete | routes/auth.js | Protected route |
| Update Profile | ✅ Complete | routes/auth.js | Name update |
| Change Password | ✅ Complete | routes/auth.js | Old password verification |
| Health Check | ✅ Complete | index.js | API status endpoint |
| Password Hashing | ✅ Complete | models/User.js | bcrypt with 12 rounds |
| JWT Middleware | ✅ Complete | middleware/auth.js | Token verification |
| Admin Middleware | ✅ Complete | middleware/auth.js | Role-based authorization |
| CORS Support | ✅ Complete | index.js | Multi-origin + PATCH method |
| Course CRUD | ✅ Complete | routes/courses.js | Create, Read, Update, Delete |
| Course Publishing | ✅ Complete | routes/courses.js | Publish, Unpublish, Archive |
| Course Statistics | ✅ Complete | routes/courses.js | Aggregated stats endpoint |
| Multilingual Courses | ✅ Complete | models/Course.js | VI/EN title and description |
| Course Modules/Lessons | ✅ Complete | models/Course.js | Nested schema structure |
| Job CRUD | ✅ Complete | routes/jobs.js | Create, Read, Update, Delete |
| Job Publishing | ✅ Complete | routes/jobs.js | Publish, Close |
| Job Statistics | ✅ Complete | routes/jobs.js | Aggregated stats endpoint |
| Partner CRUD | ✅ Complete | routes/partners.js | Create, Read, Update, Delete |
| Partner Publishing | ✅ Complete | routes/partners.js | Publish, Unpublish |
| Partner Statistics | ✅ Complete | routes/partners.js | Aggregated stats endpoint |
| Partner Skills | ✅ Complete | models/Partner.js | String array for skills |
| Stale Index Cleanup | ✅ Complete | db/connection.js | Auto-drops stale indexes on startup |
| Payment System | ✅ Complete | routes/payment.js, models/Transaction.js | Credit packages, VietQR, Casso webhook |
| Webhook Logging | ✅ Complete | models/WebhookLog.js | Stores all incoming webhooks for debugging |
| Admin Management | ✅ Complete | routes/admin.js | Users, transactions, webhook management |
| Manual Top-up | ✅ Complete | routes/admin.js | Admin can top-up users manually |
| Webhook Assignment | ✅ Complete | routes/admin.js | Admin can assign unmatched webhooks to users |
| Transaction Timeout | ✅ Complete | routes/admin.js | Auto-timeout after 5 min without webhook match |
| Share Prompts API | ✅ Complete | routes/prompts.js, models/Prompt.js | CRUD, like, bookmark, rate, download, featured, moderation |
| Resource Hub API | ✅ Complete | routes/resources.js, models/Resource.js | CRUD, file upload (50MB), like, bookmark, rate, download |
| Comments API | ✅ Complete | routes/comments.js, models/Comment.js | Comments for prompts/resources with likes |
| Course Enrollment API | ✅ Complete | routes/enrollments.js, models/Enrollment.js | Enroll with credit deduction for paid courses; Transaction recorded; progress tracking |
| Course Reviews API | ✅ Complete | routes/reviews.js, models/Review.js | CRUD, rating distribution, helpful votes, admin reply |
| Lesson Video/Documents | ✅ Complete | models/Course.js | videoUrl and documents array per lesson |
| Article CMS | ✅ Complete | models/Article.js, routes/articles.js | Bilingual articles for About & Services pages, admin CRUD |
| Cloud Desktop API | ✅ Complete | models/HostMachine.js, models/CloudSession.js, routes/cloud.js | User connect/disconnect, admin machine/session management, agent heartbeat, cron cleanup |
| B2 Presigned Upload | ✅ Complete | routes/upload.js, utils/b2Storage.js | Generate presigned PUT URL for browser-direct upload to Backblaze B2; `listAllFiles()` for bucket enumeration |
| Workflow Projects API | ✅ Complete | models/WorkflowProject.js, routes/workflow.js | CRUD projects with team, tasks, chatHistory, expenseLog — auth required; GET /projects shows all non-completed for users |
| Workflow Documents API | ✅ Complete | models/WorkflowDocument.js, routes/workflow.js | CRUD document records with status, comments, note — auth required; GET ?projectId returns all project docs to members |
| Workflow User Profile API | ✅ Complete | routes/workflow.js | GET /users/:id returns public profile (name, avatar, role, email, phone, bio, skills, location, socials) — auth required |
| Storage Cleanup API | ✅ Complete | routes/admin.js, utils/b2Storage.js | Lists all B2 files; cross-references WorkflowDocument/Resource (file+previewImages)/Course (videoUrl+documents)/Prompt (exampleImages); returns `data` (orphaned) + `referencedFiles` each with `source`, `uploader`, `referenced` — super admin only |
| Studio Usage Tracking (legacy) | ✅ Complete | models/User.js, routes/studio.js | `studioUsage: {date, count}` on User; GET /studio/usage + POST /studio/use; 3 free uses/day; admin/mod unlimited |
| Flow Image/Video Generation | ✅ Complete (Phase 2) | models/{FlowServer,StudioGeneration,User}.js, routes/studio.js, routes/cloud.js | `POST /studio/image/generate` (5/day), `POST /studio/video/generate` (1/day), `GET /studio/media/:genId/:idx` (B2 redirect or agent proxy stream), `POST /studio/save/:genId/:idx` (B2 upload), `GET /studio/history`; agent register+heartbeat via `/cloud/flow-heartbeat` + admin CRUD `/cloud/admin/flow-servers`; cron marks flow-server offline >2min |
| AI Consultation Chat | ✅ Complete | models/ChatMessage.js, routes/chat.js, routes/settings.js, utils/aiProvider.js, server/context/alpha-studio-bot | `POST /chat/send` saves user msg then routes via admin setting `useOpenClawForChat`: OpenClaw (`OPENCLAW_URL`, session memory) by default, or direct gcli (`GCLI_DIRECT_URL`) with bundled Alpha Studio workspace context and up to 3 previous MongoDB chat messages. `GET /chat/history` display history; `DELETE /chat/history` clears DB history. |
| VocabFlip Integration | ✅ Complete (Phase 15) | models/Vocab.js, routes/vocab.js | MongoDB-backed public library (decks, flashcards, ratings, import links, profile, feedback, sync notification stubs) & private cloud storage CRUD for web users (`VocabPrivateDeck`, `VocabPrivateFlashcard` models, `/my-decks` routes); VocabFlip media upload uses existing B2 presign flow |
| Interior Design AI API | ✅ Complete | models/InteriorProject.js, routes/interior.js, utils/aiProvider.js, routes/chat.js | Auth-gated `/api/interior` project CRUD, AI chat, version persistence, rollback, manual cabinetModel validation, 1-credit charge per valid AI response, admin/mod bypass. Reuses `useOpenClawForChat` provider toggle shared with `/api/chat/send`. |
| Interior AI Prompt v2 + 2-step | ✅ Complete | routes/interior.js, models/User.js, models/InteriorProject.js, routes/auth.js, utils/templateValidator.js | (A) Prompt v2: few-shot, domain hints (kích thước/vật liệu chuẩn VN), Phase 10 strict dimension anchor, `/chat` `runs[]` rule for L/U/island/parallel layouts, z-axis wall-depth convention, forced reply format "Quan sát ảnh/Hiểu yêu cầu/Đã áp dụng", lower askForInfo threshold. Phase 14 template instructions require `boxes` only for new `tplNew` payloads, while validator accepts legacy `isoBoxes` and rejects SVG view fields. (B) Opt-in `User.preferences.interiorTwoStepConfirm` (set via `PUT /auth/profile`). When ON, `POST /interior/projects/:id/chat` accepts `stage='proposal'\|'apply'`: proposal returns plain-text analysis (1 credit, no version), apply consumes `proposalText` as context (1 credit, creates version). Total 2 credit/lần khi bật. |
| Interior Image-to-Design (Phase 4+) | ✅ Complete | routes/interior.js (+/analyze-image, +/generate-render), middleware/interiorQuota.js, models/{InteriorAnalysis,InteriorRender,InteriorQuota}.js, routes/admin.js (orphan scan) | `POST /interior/analyze-image` (auth + 5/24h quota): JSON body `{imageUrl, hints, modelOverride}`, sha256 cache (24h TTL), Gemini Flash 3 default → Pro 3.1 escalate, 2-attempt JSON repair loop, returns `{model, suggestedModel, meta}`. Prompt teaches Phase 8 `runs[]` for L/U/island/galley layouts and Phase 7 `csgHints[]`; validator accepts either legacy `modules[]` or new `runs[]`, not both. Default project model now uses an opaque solid panel template instead of transparent zone modules. |
| Interior Component Workshop Cleanup | ✅ Complete | routes/interior.js, tools/interior-component-workshop/component-library.js | `POST /api/interior/workshop/components/delete` deletes selected local Workshop `components/<id>.json` files and regenerates `data/template-bundle.js`. It is enabled only in local/dev (or `INTERIOR_WORKSHOP_DELETE_ENABLED=true`) and only accepts loopback requests from no origin, `Origin: null`, localhost, or 127.0.0.1; no Bearer token is required for this local cleanup endpoint. |
| Interior Workshop File-Origin CORS | ✅ Complete | server/index.js | `Origin: null` from `file://` workshop pages is now treated as an allowed CORS origin instead of logging `CORS blocked origin: null`. Local workshop origins on localhost/127.0.0.1 are also explicitly allowed. |
| Interior AI Log Viewer | ✅ Complete | models/InteriorAiLog.js, routes/interior.js, scripts/dump-interior-log.mjs | Every `/api/interior/projects/:id/chat` call (both `proposal` and `apply` stages) records raw prompt, ref images, raw AI response, parsed reply, latency, usage, status (`ok`/`parse-failed`/`validation-failed`/`upstream-error`), errorMessage. TTL 30 days. `GET /api/interior/admin/logs?projectId=&userId=&stage=&status=&limit=` accepts EITHER (auth + adminOnly) OR header `x-reviewer-token: $INTERIOR_LOG_REVIEWER_TOKEN` (reviewer bypass for ops/debug). Direct dump: `node scripts/dump-interior-log.mjs <projectId>`. |

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
2. Create/update entry in `docs/bug-fixes/CHANGELOG.md`
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

---

## 7. Recent Changes (Last 3 Sessions)

1. **2026-05-22** - Interior curved template primitive validation
   - **Validator** `server/utils/templateValidator.js`: Accepts only regular boxes, `roundedBox`, and `cylinder` inside `boxes[]`; rejects unsupported primitive types and invalid cylinder axes before import/admin edit.
   - **Tests** `server/utils/__tests__/templateValidator.test.mjs`: Covers accepted curved primitives and rejection of freeform path-style primitives.
   - **Seed library**: `npm run seed:interior-templates` upserted 14 templates, including `cab-base-rounded-end@1` with `roundedBox` body/front and `cylinder` knob.

1. **2026-05-21** - Interior agent dimension defaults + UTF-8 text fix
   - **Agent tools** `server/tools/interior/common.js`, `module-add.js`, `module-update.js`, `model-commit.js`: Known template modules now auto-fill missing `width`/`height`/`depth` from seed template defaults. This prevents `tpl` kitchen base/wall/corner cabinets from rendering as full-height/full-depth blocks when AI omits dimensions.
   - **Seed script** `scripts/seed-interior-templates.mjs`: Writes boxes-only template DSL from `tpl.boxes` so reseeding preserves the Phase 14 component library contract.
   - **Tests** `server/tools/interior/__tests__/tools.test.mjs`: Added coverage for base cabinet defaults, wall cabinet missing-depth fill, and commit-time default fill.
   - **Interior route** `server/routes/interior.js`: Corrected default project title/specs/name/reply Vietnamese strings from mojibake to valid UTF-8.
   - **Data repair**: Project `6a0ef1d40fb2810566f8dbf8` received a new corrected version at index 2; old versions remain intact.

1. **2026-05-21** - Interior Workshop backend cleanup endpoint
   - **Interior route** `server/routes/interior.js`: Added `POST /api/interior/workshop/components/delete` for local/dev Workshop cleanup. It validates kebab-case IDs, deletes only files inside `tools/interior-component-workshop/components`, regenerates `data/template-bundle.js`, and accepts loopback/null-origin/localhost requests without Bearer token.
   - **Workshop UI** `tools/interior-component-workshop/component-library.js`: Import/delete flows now call the backend cleanup endpoint instead of a separate helper server.
   - **Verification**: `node --check` passes for backend `server/routes/interior.js` and updated Workshop scripts.

1. **2026-05-22** - Interior Workshop file-origin CORS
   - **Server CORS** `server/index.js`: Added explicit allow handling for `Origin: null` from `file://` Workshop pages plus localhost/127.0.0.1 Workshop origins. This removes misleading `CORS blocked origin: null` warnings while preserving the existing permissive dev behavior.
   - **Verification**: `node --check server/index.js` passes.

1. **2026-05-18** - Interior Phase 8 runs prompt
   - **Analyze prompt** `server/routes/interior.js`: Added `runs[]` instructions for L/U/island/galley layouts with `{id, origin:{x,z}, direction, modules}`.
   - **Validation**: `validateCabinetModel` now accepts either legacy `modules[]` or new `runs[]`, rejects using both, and validates each run direction/origin/modules.
   - **Database docs**: `DATABASE.md` documents that InteriorProject/InteriorAnalysis `modelJson` can store `runs[]`.

1. **2026-05-16** - Bundled direct bot context for production
   - **Bundled context** `server/context/alpha-studio-bot/{IDENTITY.md,SOUL.md,venue.md}`: Copied the Alpha Studio bot workspace files into the backend image path so Fly.io production can read them even though `tools/openclaw-server/workspaces/alpha-studio` is not present in the backend Docker context.
   - **Provider context** `server/utils/aiProvider.js`: Direct gcli bot reads only the bundled `server/context/alpha-studio-bot` context. The loaded context is cached for 60 seconds and injected as a system prompt when `useOpenClawForChat=false`.
   - **Direct history** `server/routes/chat.js`: Direct gcli requests include up to 3 previous MongoDB chat messages plus the current user message.
   - **Env template** `.env.example`: No bot context path env is required; production uses the bundled backend context.
   - **Verification**: `node --check` passes for `server/utils/aiProvider.js` and `server/routes/chat.js`.

1. **2026-05-15** - Interior AI prompt v2, 2-step confirm, B2 presigned bypass for gcli
   - **CDN bypass for AI fetch** `server/utils/b2Storage.js` + `server/routes/interior.js`: Added `cdnUrlToPresignedDownload(url, expiresIn=14400)` helper that strips `CDN_BASE_URL` prefix and returns a presigned B2 download URL pointing at `*.backblazeb2.com` directly. Interior chat route now resolves `refImageUrls` through `resolveImageUrlsForAi()` (with per-URL try/catch fallback) before passing to `callGcliDirect.images` — works around Cloudflare 525 SNI mismatch on `cdn.giaiphapsangtao.com` so gcli upstream can actually fetch the user's reference images. CDN URLs remain stored in MongoDB unchanged; only the AI-facing URL is rewritten.

1. **2026-05-15** - Interior AI prompt upgrade + opt-in 2-step confirm
   - **Prompt v2** `server/routes/interior.js`: Added `INTERIOR_DOMAIN_HINTS` (kích thước/vật liệu chuẩn VN), `INTERIOR_REPLY_FORMAT` (forced "Quan sát ảnh / Hiểu yêu cầu / Đã áp dụng"), `INTERIOR_FEW_SHOT` (1 compact JSON example), explicit `askForInfo` rule (when image vague / prompt too short / missing dimension+function+material).
   - **2-step confirm**: New `buildInteriorProposalPrompt` for analysis-only stage; `POST /api/interior/projects/:id/chat` accepts `stage='proposal'|'apply'` + `proposalText`. Proposal: AI returns plain-text analysis, charges 1 credit, no version saved. Apply with `proposalText`: passes proposal as context to JSON generation, charges 1 credit, saves version → 2 credit total khi user opt-in.
   - **User preference** `server/models/User.js`: Added `preferences.interiorTwoStepConfirm: Boolean default false`; exposed via `PUT /api/auth/profile` (`routes/auth.js`).
   - **InteriorVersion schema** `server/models/InteriorProject.js`: Added `proposalText: String maxlength 4000` for audit of which proposal led to which version.
   - **Verification**: `node --check` passes for `interior.js`, `InteriorProject.js`, `User.js`, `auth.js`.

1. **2026-05-15** - Interior Design AI API
   - **AI provider utility** `server/utils/aiProvider.js`: Extracted OpenClaw/gcli routing and `useOpenClawForChat` lookup for reuse by chat and interior design routes.
   - **Interior model** `server/models/InteriorProject.js`: Stores owner, project name, current version index, soft-delete flag, and version snapshots with `modelJson`, prompt, AI reply, ref image URL, and rollback metadata.
   - **Interior routes** `server/routes/interior.js`: Added project list/create/read/update/delete, `POST /projects/:id/chat`, and `POST /projects/:id/rollback`; validates AI JSON manually and charges 1 credit only after valid output.
   - **Server mount** `server/index.js`: Mounted `/api/interior`.
   - **Verification**: `node --check` passes for `aiProvider.js`, `InteriorProject.js`, `interior.js`, `chat.js`, and `index.js`.

1. **2026-05-15** - Admin AI chat provider toggle
   - **Settings** `server/routes/settings.js`: Added `useOpenClawForChat` key with default `true`.
   - **Chat routing** `server/routes/chat.js`: `POST /api/chat/send` now reads `useOpenClawForChat`; default path keeps OpenClaw session context, direct path calls OpenAI-compatible gcli via `GCLI_DIRECT_URL`.
   - **Env template** `.env.example`: Added `OPENCLAW_URL`, `GCLI_DIRECT_URL`, and `GCLI_DIRECT_MODEL` placeholders.
   - **Verification**: `node --check server/routes/chat.js` and `node --check server/routes/settings.js` pass.

1. **2026-05-07** - AI Consultation Chat with Persistent History
   - **New model** `server/models/ChatMessage.js`: `userId` (ref User, indexed), `role` ('user' | 'assistant'), `content` (max 16000 chars), `timestamps`. Compound indexes `{userId:1, createdAt:1}` and `{userId:1, createdAt:-1}` for history queries.
   - **Replaced** `server/routes/chat.js` (old `POST /generate { messages[] }` proxy → new auth-gated history-aware routes):
     - `GET  /api/chat/history?limit=N` — returns user's recent ChatMessages (default 50, max 200, oldest→newest order). Used by FE to render chat history.
     - `POST /api/chat/send { content }` — saves user message → forwards single `{messages:[user]}` payload to `OPENCLAW_URL` with `sessionId: req.user._id.toString()` (OpenClaw maintains conversation context per-session via `x-openclaw-session-key`) → saves assistant reply → returns `{ userMessage, assistantMessage }`. Returns 502 with userMessage preserved if OpenClaw fails.
     - `DELETE /api/chat/history` — clears user's ChatMessage docs from MongoDB. **Note:** OpenClaw session memory persists (no documented HTTP API to reset session); document-only display reset.
   - Architecture: Frontend just displays history; OpenClaw is single source of truth for conversation context. Per-user isolation via `req.user._id` as session key.
   - Env: `OPENCLAW_URL` already in `.env` (`https://openclaw.giaiphapsangtao.com/api/chat`); fallback `http://localhost:18791/api/chat` for local dev.

2. **2026-05-04** - OpenClaw API Channel Integration (superseded by 2026-05-07)
   - `server/routes/chat.js`: Updated proxy logic to call the new Middle-tier `api-server.js` on `http://localhost:18791/api/chat` instead of directly contacting the local `gcli-proxy`.
   - Injected `sessionId: req.user._id` for authenticated requests to ensure the Gateway can maintain bối cảnh per-user, and adjusted the text extraction path.

1. **2026-05-01** - Encrypted Gemini API keys in database
   - `utils/encryption.js`: Created utility for AES-256-CBC encryption/decryption
   - `settings.js`: Added encryption when saving `geminiApiKey` and `videoApiKey`. Returning mapped strings (`********`) on the `GET` request to prevent leaking to the admin UI.
   - `gemini.js`: Decrypted keys before use when calling Google Gemini API

1. **2026-04-30** - Fixed Studio history media URL loading (ERR_CONNECTION_CLOSED)
   - `server/routes/studio.js`: Updated `GET /api/studio/media/:genId/:itemIdx` endpoint to generate short-lived B2 presigned download URLs for saved items instead of redirecting directly to the Vercel-bound CDN. This fixes images and videos failing to load in StudioHistoryDrawer because the bucket is configured as private and the alias didn't proxy the files correctly.

1. **2026-04-23** - Plan 3 Phase 2: Flow pipeline backend integration
   - **New models**:
     - `FlowServer.js`: name, machineId (unique), agentUrl, secret, status (available|degraded|offline), tokenValid, tokenExpiresAt, projectId, lastPingAt, enabled
     - `StudioGeneration.js`: userId, flowServerId, type (image|video), model, prompt, aspectRatio, count, hasReferenceImage, items[] (filename, ext, size, seed, mediaId, saved, b2Key, b2Url, savedAt), expiresAt (+48h default)
   - **User.js**: Added `studioUsage.imageCount`, `studioUsage.videoCount` (kept `count` for legacy)
   - **studio.js** — New endpoints (all authMiddleware):
     - `GET /usage`: returns `{ image: {used,limit,remaining}, video: {...}, legacy: {...}, unlimited? }`
     - `POST /image/generate`: 5/day, validates model (imagen4|banana2|banana-pro) + ratio, consumes quota + refunds on agent error, picks random available+tokenValid FlowServer, forwards to `/api/studio/image`, persists StudioGeneration, returns serialized items with `previewUrl: /api/studio/media/:genId/:idx`
     - `POST /video/generate`: 1/day, validates model (veo|veo-r2v) + ratio, requires referenceImage for veo-r2v
     - `GET /media/:genId/:idx`: ownership check → if saved redirect 302 to B2 CDN; else stream bytes from flow agent via `Readable.fromWeb`
     - `POST /save/:genId/:idx`: downloads from agent, uploads to B2 via new `uploadFile(key, buffer, contentType)` helper, stores `items[idx].{saved,b2Key,b2Url,savedAt}`
     - `GET /history?limit=20&type=image|video`: user's recent gens
   - **cloud.js** — New endpoints:
     - `POST /flow-heartbeat`: x-agent-secret auth, updates FlowServer status/tokenValid/tokenExpiresAt/projectId/lastPingAt
     - `GET/POST/PUT/PATCH/DELETE /admin/flow-servers[/:id][/toggle]`: admin CRUD mirroring HostMachine pattern
     - `POST /admin/flow-servers/:id/sync`: sync auto-fill API projects directly from Agent
     - `DELETE /admin/flow-servers/:id/projects/:projectId`: remote disconnect an active Flow Project ID
   - **b2Storage.js**: Added `uploadFile(key, body, contentType)` — server-side bytes → B2 via PutObjectCommand
   - **index.js**:
     - Cron every 60s: mark FlowServer offline + tokenValid=false if lastPingAt > 2 min (parallel to HostMachine)
     - Cron every 30min: delete StudioGeneration where expiresAt < now AND no item.saved=true (preserves B2 artifacts)
   - **admin.js** — GET /storage/orphaned: added scan of `StudioGeneration.items[].b2Key` (only items with `saved: true`)

1. **2026-02-24** - Course purchase; User role enum fix; Localized instructor.bio
   - `models/User.js`: Added `'mod'` to `role` enum (`['student', 'partner', 'mod', 'admin']`); fixes 500 error when saving any mod-role user (topup, password change, balance deduction, etc.)
   - `models/Course.js`: Changed `instructor.bio` from `type: String` → `{ vi: String, en: String }` to match frontend LocalizedString format
   - `routes/enrollments.js`: Import `User` + `Transaction`; paid course enrollment now checks `user.balance >= finalPrice`, deducts balance, creates `Transaction` (`type: 'spend'`, `serviceType: 'course'`, `paymentMethod: 'system'`, `status: 'completed'`); insufficient balance returns `{ requiresTopup: true, required, current }`

1. **2026-02-23** - Storage Cleanup orphaned checker fixes + referencedFiles response
   - `admin.js` — GET /storage/orphaned:
     - Fixed Resource query: `createdBy` → `author` (correct field name in Resource model)
     - Added `Prompt` import; added scan of `Prompt.exampleImages[].publicId / url`
     - Added scan of `Resource.previewImages[].publicId / url` (was only checking `file`)
     - Fixed Course scan: added `lesson.videoUrl` extraction (was only scanning `lesson.documents[]`)
     - Refactored: `toFileObj(f, referenced)` helper builds both lists with `uploader`, `uploadedAt`, `source`, `referenced` fields
     - Response now includes `referencedFiles: [...]` alongside `data` (orphaned); both carry `source` and `referenced` flags

1. **2026-02-22** - Storage Cleanup API, User Public Profile, B2 listAllFiles
   - `b2Storage.js`: Added `ListObjectsV2Command` import; added `listAllFiles()` with pagination loop (handles large buckets via `ContinuationToken`)
   - `workflow.js` — GET /projects: Restored `{ status: { $ne: 'completed' } }` for regular users (all non-completed visible to everyone)
   - `workflow.js` — GET /users/:id: New endpoint returning user public profile (`name, avatar, role, email, phone, bio, skills, location, socials`); placed after `/users/search` to avoid route conflict
   - `admin.js` — Added `SUPER_ADMIN_EMAIL = 'aduc5525@gmail.com'`; added `extractB2Key(url)` helper; added imports for `WorkflowDocument`, `Resource`, `Course`, `listAllFiles`, `deleteFile`
   - `admin.js` — GET /storage/orphaned: Lists all B2 files via `listAllFiles()`, builds `usedKeys` Set from 3 collections (WorkflowDocument.fileKey, Resource.file.publicId, Course lesson documents), returns array of orphaned files with uploader info
   - `admin.js` — DELETE /storage/orphaned: Takes `{ key }` from request body, calls `deleteFile(key)` — both endpoints 403 if not super admin

1. **2026-02-22** - Workflow API: Project Visibility, Note Field, Member Doc Access (2nd pass)
   - `WorkflowDocument.js`: Added `note: { type: String, default: '' }` field
   - `workflow.js` — GET /projects: Admin sees all; others see all non-completed + own/member completed (`$or: [status≠completed, createdBy, team.id]`)
   - `workflow.js` — DELETE /projects: Admin-only (403 otherwise) + `status === 'completed'` required (400 if planning/active)
   - `workflow.js` — GET /documents with `?projectId`: Checks team membership (team.id / createdBy / admin/mod), returns ALL project docs (was filtering by createdBy)
   - `workflow.js` — PUT /documents: Added `note` to allowed update fields; auth updated to also allow project creator/manager

2. **2026-02-22** - Workflow Projects & Documents API
   - Created `server/models/WorkflowProject.js`: subdocuments (expenseLog, tasks, team, chatHistory, tasks) with `_id: false` + `toJSON: { virtuals: true }`
   - Created `server/models/WorkflowDocument.js`: file metadata (name, type, size, uploadDate, uploader, status, url, projectId, comments) + `toJSON: { virtuals: true }`
   - Created `server/routes/workflow.js`: 8 endpoints (4 projects + 4 documents), all `authMiddleware`-protected, creator-or-admin authorization
   - Mounted `/api/workflow` in server/index.js

3. **2026-02-12** - Article CMS for About & Services Pages
   - Created Article model (models/Article.js):
     - Bilingual title, excerpt, content (vi/en)
     - slug (auto-generated from Vietnamese title)
     - category: 'about' | 'services'
     - status: draft/published/archived
     - author (ref User), order, isFeatured, tags
     - Indexes: category+status+order, slug (unique), text search
   - Created Articles API (routes/articles.js):
     - Public: GET / (list published), GET /:slug (detail)
     - Admin/Mod: GET /admin/list, POST /, PUT /:id, DELETE /:id
     - PATCH /:id/publish, PATCH /:id/unpublish
     - Route ordering: /admin/list before /:slug to avoid conflicts
   - Registered article routes in server/index.js

2. **2026-01-24** - Course Enrollment & Reviews APIs
   - Updated Course model (models/Course.js):
     - Added `videoUrl` field to lesson schema for video URL input
     - Added `documents` array to lesson schema with name, url, type, size
   - Created Enrollment model (models/Enrollment.js):
     - Tracks user enrollment in courses
     - Progress tracking (completedLessons array with watchedDuration, lastPosition)
     - Current lesson tracking (moduleId, lessonId)
     - Status: active, completed, cancelled
   - Created Review model (models/Review.js):
     - Rating 1-5 stars with comment
     - Helpful count with users array
     - Admin reply support
     - Status: approved, pending, rejected
     - Verified purchase flag
   - Created Enrollments API (routes/enrollments.js):
     - GET /my-courses - list enrolled courses with course details
     - GET /check/:courseId - check enrollment status
     - POST /:courseId - enroll in course
     - GET /:courseId/progress - get enrollment progress
     - PUT /:courseId/progress - update lesson progress (completed, watchedDuration)
     - DELETE /:courseId - unenroll
   - Created Reviews API (routes/reviews.js):
     - GET /course/:courseId - get reviews with rating distribution
     - GET /my-review/:courseId - get user's review
     - POST /:courseId - create review
     - PUT /:reviewId - update review
     - DELETE /:reviewId - delete review
     - POST /:reviewId/helpful - toggle helpful
     - POST /:reviewId/reply - admin reply
   - Fixed rating distribution aggregation: proper mongoose.Types.ObjectId conversion
   - Updated server/index.js to register new routes

2. **2026-01-23** - Share Prompts & Resource Hub APIs
   - Created Prompt model with:
     - Bilingual title/description (vi/en)
     - Multiple prompt contents (promptContents array with label + content)
     - Legacy single promptContent support for backward compatibility
     - Notes field (max 5000 chars)
     - Categories: image-generation, text-generation, code, workflow, other
     - Platforms: midjourney, stable-diffusion, dalle, comfyui, chatgpt, claude, other
     - Example images with input/output types
     - Engagement: likes, bookmarks, downloads, views, comments count
     - Rating system (1-5 stars with average calculation)
     - Status: published, hidden, archived
     - Featured flag, moderation fields
   - Created Resource model with:
     - Bilingual title/description
     - Resource types: template, dataset, design-asset, project-file, 3d-model, font, other
     - File upload (url, publicId, filename, format, size up to 50MB, mimeType)
     - Thumbnail and preview images
     - Compatible software array
     - Same engagement/rating system as Prompts
   - Created Comment model for both prompts and resources
   - Full API routes for prompts: CRUD, like, bookmark, download, rate, hide/unhide, feature
   - Full API routes for resources: same as prompts + file download tracking
   - Search support: regex search in title, description, content, tags, promptContents
   - Bugfix: Added promptContents support in POST/PUT routes (was only checking legacy promptContent)

3. **2026-01-22** - Payment System with Casso Webhook V2

---

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

## 9. Sample Users

After running `npm run db:init` and `npm run db:migrate-passwords`:

| Email | Password | Role |
|-------|----------|------|
| admin@alphastudio.com | admin123456 | admin |
| student@example.com | student123 | student |

---

**NOTE TO CLAUDE CODE:**
Read this file FIRST before making any changes.
Update Section 4, 5, 7 after each session.
