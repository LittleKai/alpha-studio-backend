# Project Summary
**Last Updated:** 2026-02-22 (workflow.js: GET /users/:id; admin.js: storage cleanup (orphaned B2 files); b2Storage.js: listAllFiles)
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
- **Deployment:** Render (https://alpha-studio-backend.onrender.com)
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
│   │   ├── WorkflowProject.js     # Workflow projects (team, tasks, chatHistory, expenseLog)
│   │   └── WorkflowDocument.js    # Workflow documents (file metadata, status, comments)
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
│       └── workflow.js           # Workflow API (CRUD projects + documents, auth required)
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
| Course Enrollment API | ✅ Complete | routes/enrollments.js, models/Enrollment.js | Enroll, progress tracking, lesson completion |
| Course Reviews API | ✅ Complete | routes/reviews.js, models/Review.js | CRUD, rating distribution, helpful votes, admin reply |
| Lesson Video/Documents | ✅ Complete | models/Course.js | videoUrl and documents array per lesson |
| Article CMS | ✅ Complete | models/Article.js, routes/articles.js | Bilingual articles for About & Services pages, admin CRUD |
| Cloud Desktop API | ✅ Complete | models/HostMachine.js, models/CloudSession.js, routes/cloud.js | User connect/disconnect, admin machine/session management, agent heartbeat, cron cleanup |
| B2 Presigned Upload | ✅ Complete | routes/upload.js, utils/b2Storage.js | Generate presigned PUT URL for browser-direct upload to Backblaze B2; `listAllFiles()` for bucket enumeration |
| Workflow Projects API | ✅ Complete | models/WorkflowProject.js, routes/workflow.js | CRUD projects with team, tasks, chatHistory, expenseLog — auth required; GET /projects shows all non-completed for users |
| Workflow Documents API | ✅ Complete | models/WorkflowDocument.js, routes/workflow.js | CRUD document records with status, comments, note — auth required; GET ?projectId returns all project docs to members |
| Workflow User Profile API | ✅ Complete | routes/workflow.js | GET /users/:id returns public profile (name, avatar, role, email, phone, bio, skills, location, socials) — auth required |
| Storage Cleanup API | ✅ Complete | routes/admin.js, utils/b2Storage.js | Lists all B2 files; cross-references with WorkflowDocument/Resource/Course; returns orphaned files; DELETE by key — super admin (aduc5525@gmail.com) only |

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
2. Create new history entry in `.claude/history/`
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
```

---

## 7. Recent Changes (Last 3 Sessions)

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
Create history entry with details of changes made.
