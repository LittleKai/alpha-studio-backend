# Project Summary

*Latest Session: Security audit & hardening — `JWT_SECRET`/`ENCRYPTION_KEY` giờ bắt buộc ở production (không còn fallback hardcode, dev/test dùng key ngẫu nhiên ephemeral), toàn bộ npm vulnerabilities đã vá (nodemailer 9, mongoose, fast-xml-parser, path-to-regexp, ws...), `callOpenClaw` hỗ trợ gửi `x-api-token` (env `OPENCLAW_API_TOKEN`) khi OpenClaw api-server bật auth.*

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
│   ├── POST   /generate-render             # 3D view + style prompt → Gemini image render with fallback (auth + quota)
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
- Production defaults: `https://giaiphapsangtao.com`, `https://www.giaiphapsangtao.com`, `https://alphastudio.vercel.app`
- Extra production/staging origins: `FRONTEND_URL`, `FRONTEND_URL_PROD`, `FRONTEND_URLS`, or `CORS_ORIGINS`
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
- Production defaults: `https://giaiphapsangtao.com`, `https://www.giaiphapsangtao.com`, `https://alphastudio.vercel.app`
- Extra production/staging origins: `FRONTEND_URL`, `FRONTEND_URL_PROD`, `FRONTEND_URLS`, or `CORS_ORIGINS`
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
| VocabFlip Integration | ✅ Complete (Phase 15) | models/Vocab.js, routes/vocab.js, scripts/release-vocabflip-to-b2.js | MongoDB-backed public/private deck storage remains in `routes/vocab.js`; release metadata is exposed at `GET /api/vocab/releases/latest` with `vocab_latest_release` override and B2 fallback. Release automation builds VocabFlip APK, Windows ZIP, and Web assets, uploads binaries to `vocabflip-app/releases/`, and updates `vocabflip-app/version.json`. |
| Interior Design AI API | ✅ Complete | models/InteriorProject.js, routes/interior.js, utils/aiProvider.js, routes/chat.js | Auth-gated `/api/interior` project CRUD, AI chat, version persistence, rollback, manual cabinetModel validation, 1-credit charge per valid AI response, admin/mod bypass. Reuses `useOpenClawForChat` provider toggle shared with `/api/chat/send`. |
| Interior AI Prompt v2 + 2-step | ✅ Complete | routes/interior.js, models/User.js, models/InteriorProject.js, routes/auth.js, utils/templateValidator.js, utils/interiorCatalogPrompt.js, utils/interiorTemplateAssets.js, utils/interiorModelGeometry.js | (A) Prompt v2: few-shot, domain hints (kích thước/vật liệu chuẩn VN), Phase 10 strict dimension anchor, `/chat` `runs[]` rule for L/U/island/parallel layouts, z-axis wall-depth convention, forced reply format "Quan sát ảnh/Hiểu yêu cầu/Đã áp dụng", lower askForInfo threshold. Phase B builds `/chat`, proposal, and agent catalog sections from `InteriorTemplate` seed/approved DB rows with 5-minute cache, auto-seeds built-ins + workshop components at startup, normalizes workshop face aliases, and uses template-first few-shot examples. Phase C adds renderable palette/token guidance, per-module `style.colors` prompt rules, unknown `$token` validation for import/tplNew, tplNew normalization through the same ingest helper, and updated agent `model.setPalette` support for new palettes. Phase D applies `tpl` dimensions from DB/inline `params.default`, attaches non-blocking geometry warnings (run length, bounds, overlap, upper-vs-lower z), retries `/chat` apply once with a focused repair prompt when warnings exist, and returns warning/repair metadata while saving schema-valid models. Phase E adds detail-density rules to chat/proposal/agent/analyze prompts so modules include visible fronts, handles, countertops/backsplashes, wardrobe rods/shelves, sliding tracks/rollers, and glass shelves. Phase 14 template instructions require `boxes` only for new `tplNew` payloads, while validator accepts legacy `isoBoxes` and rejects SVG view fields. (B) Opt-in `User.preferences.interiorTwoStepConfirm` (set via `PUT /auth/profile`). When ON, `POST /interior/projects/:id/chat` accepts `stage='proposal'\|'apply'`: proposal returns plain-text analysis (1 credit, no version), apply consumes `proposalText` as context (1 credit, creates version). Total 2 credit/lần khi bật. |
| Interior Image-to-Design (Phase 4+) | ✅ Complete | routes/interior.js (+/analyze-image, +/generate-render), middleware/interiorQuota.js, models/{InteriorAnalysis,InteriorRender,InteriorQuota}.js, routes/admin.js (orphan scan) | `POST /interior/analyze-image` (auth + 5/24h quota): JSON body `{imageUrl, hints, modelOverride}`, sha256 cache (24h TTL), Gemini Flash 3 default → Pro 3.1 escalate, 2-attempt JSON repair loop, returns `{model, suggestedModel, meta}`. Prompt teaches Phase 8 `runs[]` for L/U/island/galley layouts and detail-density rules; validator accepts either legacy `modules[]` or new `runs[]`, not both. `POST /interior/generate-render` validates `modelJson`, stores the iso PNG conditioning image, calls Gemini image generation (`INTERIOR_IMAGE_API_KEY`/`GEMINI_API_KEY` or Admin Gemini key), uploads generated output to B2, persists `InteriorRender`, and falls back to the conditioning URL with `meta.pending=true` if no key/upstream failure occurs. Default project model now uses an opaque solid panel template instead of transparent zone modules. |
| Interior Assets Bundle (Fly deploy) | ✅ Complete | scripts/sync-interior-assets.mjs, server/assets/interior/{templates,workshop,skills}, utils/interiorTemplateAssets.js, routes/interior.js, package.json | Docker image chỉ COPY `server/`, nên seed/skills đọc từ `tools/` bị thiếu trên Fly. `npm run sync:interior-assets` copy 14 template + manifest, 42 workshop component, 6 agent skill vào `server/assets/interior/`. Runtime ưu tiên `tools/` (dev), fallback assets bundle (deploy). **Chạy lại sync trước mỗi lần deploy nếu template/component/skill thay đổi.** |
| Interior Run Coordinate Unification | ✅ Complete | utils/interiorModelGeometry.js, routes/interior.js (INTERIOR_RUNS_RULE_VI + few-shot), engine `src/core/model.js`, skills kitchen-l-shape/kitchen-galley | Quy ước thống nhất mọi hướng run: module `x` = vị trí DỌC trục run từ origin, `z` = offset vuông góc từ tường (engine trước đây dùng z làm trục đi cho north/south → nhánh L render ra ngoài model). Occupied-length check giờ chỉ cảnh báo overshoot với model đa run (undershoot hợp lệ vì khối góc thuộc run kia). Few-shot chữ L viết lại: return run `south` origin {0,0} chứa corner, main run east origin {x:100} — verified 0 geometry warnings + in-bounds + no overlaps. |
| Interior Component Workshop Cleanup | ✅ Complete | routes/interior.js, tools/interior-component-workshop/component-library.js | `POST /api/interior/workshop/components/delete` deletes selected local Workshop `components/<id>.json` files and regenerates `data/template-bundle.js`. It is enabled only in local/dev (or `INTERIOR_WORKSHOP_DELETE_ENABLED=true`) and only accepts loopback requests from no origin, `Origin: null`, localhost, or 127.0.0.1; no Bearer token is required for this local cleanup endpoint. |
| Interior Workshop File-Origin CORS | ✅ Complete | server/index.js | `Origin: null` from `file://` workshop pages is now treated as an allowed CORS origin instead of logging `CORS blocked origin: null`. Local workshop origins on localhost/127.0.0.1 are also explicitly allowed. |
| Interior AI Log Viewer | ✅ Complete | models/InteriorAiLog.js, routes/interior.js, scripts/dump-interior-log.mjs | Every `/api/interior/projects/:id/chat` call (both `proposal` and `apply` stages) records raw prompt, ref images, raw AI response, parsed reply, latency, usage, status (`ok`/`parse-failed`/`validation-failed`/`upstream-error`), errorMessage. TTL 30 days. `GET /api/interior/admin/logs?projectId=&userId=&stage=&status=&limit=` accepts EITHER (auth + adminOnly) OR header `x-reviewer-token: $INTERIOR_LOG_REVIEWER_TOKEN` (reviewer bypass for ops/debug). Direct dump: `node scripts/dump-interior-log.mjs <projectId>`. |
| CRM Facebook Messenger Channel (Phase 2) | ✅ Complete | models/CrmChannelIntegration.js, routes/channelWebhooks.js (mounted `/api/crm`), routes/crm.js (`POST /agent/channels/register`) | Cloud owns Meta webhook only: `GET/POST /api/crm/facebook/webhook` verifies `hub.verify_token` (GET) and `X-Hub-Signature-256` against the per-device `CrmChannelIntegration.appSecret` (encrypted at rest, POST), writes a durable `CrmConversation`/`CrmMessage` backup, then creates a `CrmAgentCommand{type:'channel.message.relay', payload:{channel:'facebook_page', event}}` so the desktop agent relays it into its **local SQLite** store (chat data storage requirement — cloud is a durable backup, not the source of truth). `POST /agent/channels/register` (`agentAuthMiddleware`, called automatically by the local bridge's settings-save flow) upserts `CrmChannelIntegration{channel, externalAccountId, appId, verifyToken, appSecret, enabled}` per device — the Facebook page access token itself is never sent to the cloud; outbound sends go straight from the local agent to the Graph API. |
| CRM TikTok Messaging Channel (Phase 3) | ✅ Complete (placeholder, pending real API verification) | routes/channelWebhooks.js (mounted `/api/crm`) | Mirrors the Facebook Messenger channel exactly: `GET/POST /api/crm/tiktok/webhook` verifies a token handshake (GET) and an `x-tiktok-signature` HMAC-SHA256 against the per-device `CrmChannelIntegration.appSecret` (POST, same encrypted-at-rest storage and `channel:'tiktok'` enum value as Facebook), writes the same durable `CrmConversation`/`CrmMessage` backup, then creates a `CrmAgentCommand{type:'channel.message.relay', payload:{channel:'tiktok', event}}`. Registration reuses the existing channel-agnostic `POST /agent/channels/register` route — no backend changes were needed there. The webhook payload field names (`account_id`, `messages[]`, `sender_id`/`recipient_id`, `x-tiktok-signature` header) are explicitly-commented unverified placeholders mirroring Facebook's shape; re-check them against real TikTok Business Messaging API docs once credentials are available. |
| CRM Multi-Account Channel Registry | ✅ Complete | routes/crm.js (`GET /api/crm/agent/channels`, `DELETE /api/crm/agent/channels/:id`) | Channel-agnostic list/deregister pair over `CrmChannelIntegration`, both `agentAuthMiddleware` (device-secret, called by the local bridge, not the Flutter app directly). `GET` returns every integration row for `req.crmDevice.userId` (`id`, `channel`, `externalAccountId`, `appId`, `enabled`), letting one user run multiple Facebook Pages/TikTok accounts side by side — each gets its own `CrmChannelIntegration` document keyed by `(userId, channel, externalAccountId)`. `DELETE /:id` removes one integration scoped to `userId` (404 if not owned/found); the local bridge calls this when a Page/account is removed from Facebook/TikTok settings, which also stops that account's webhook traffic from creating new `CrmAgentCommand`s. |
| CRM Instagram Direct Messaging Channel (Giai đoạn G) | ✅ Complete | models/CrmChannelIntegration.js (`channel` enum + `'instagram'`), routes/channelWebhooks.js (mounted `/api/crm`) | Rides the same real, already-verified Meta Graph API as the Facebook channel (same App/App Secret, same `X-Hub-Signature-256` scheme, same `entry[].messaging[]` shape) — distinguished only by `object:"instagram"` in the webhook payload, unlike TikTok this has no placeholder uncertainty. `GET/POST /api/crm/instagram/webhook` verifies `hub.verify_token` (GET) and `X-Hub-Signature-256` against the per-device `CrmChannelIntegration.appSecret` (POST), writes a durable `CrmConversation`/`CrmMessage` backup, then creates a `CrmAgentCommand{type:'channel.message.relay', payload:{channel:'instagram', event}}`. Registration reuses the existing channel-agnostic `POST /agent/channels/register` route — no backend changes were needed there. |
| CRM WhatsApp Cloud API Channel (Giai đoạn H) | ✅ Complete | models/CrmChannelIntegration.js (`channel` enum + `'whatsapp'`), routes/channelWebhooks.js (mounted `/api/crm`) | Also rides the Meta Graph API (same App/App Secret, same `X-Hub-Signature-256` scheme), but the webhook payload shape is `entry[].changes[].value.messages[]` (WhatsApp Business Account format) rather than Messenger/IG's `entry[].messaging[]`. `GET/POST /api/crm/whatsapp/webhook` verifies `hub.verify_token` (GET) and `X-Hub-Signature-256` against the per-device `CrmChannelIntegration.appSecret` (POST), writes a durable `CrmConversation`/`CrmMessage` backup, then creates a `CrmAgentCommand{type:'channel.message.relay', payload:{channel:'whatsapp', event}}`. Registration reuses the existing channel-agnostic `POST /agent/channels/register` route. Product decision: the 24h customer-service messaging window is warn-only on the Flutter UI side (`enforce24hWindow` toggle) — the backend and local agent apply no hard block, matching the existing unenforced pattern for Facebook/Instagram/TikTok. |
| CRM Telegram Bot API Channel (Giai đoạn I) | ✅ Complete | models/CrmChannelIntegration.js (`channel` enum + `'telegram'`, `botToken` field), routes/channelWebhooks.js (mounted `/api/crm`) | No Meta involvement — Telegram webhook payloads are simple `{update_id, message: {...}}` JSON with no HMAC signature scheme; instead Telegram sends an `x-telegram-bot-api-secret-token` header (set at `setWebhook` time) which `POST /api/crm/telegram/webhook/:botId` compares against the stored per-device `verifyToken`. There is no GET verify handshake (unlike the Meta channels) — Telegram has no such concept. Verified requests create a `CrmAgentCommand{type:'channel.message.relay', payload:{channel:'telegram', event}}`. Unlike the Meta channels, webhook registration is not manual: the local bridge calls Telegram's `getMe` (resolve numeric bot id/username) and `setWebhook` (register the callback URL + generated `secret_token`) automatically when a bot's Bot Token is saved. Registration with the cloud reuses the existing channel-agnostic `POST /agent/channels/register` route, sending `botToken`+`verifyToken` (no `appSecret` — Telegram has no equivalent concept). |
| CRM Webchat Widget Channel (Giai đoạn L) | ✅ Complete | `utils/webchatEventHub.js` (in-process SSE hub), `routes/webchatPublic.js` (mounted at `/api/public/webchat`, CORS-open for arbitrary embedding sites), `server/public/webchat/widget.js` (static file served at `/webchat/widget.js`), `routes/crm.js` (agent relay branch), `models/CrmChannelIntegration.js` (`channel` enum + `'webchat'`) | The only channel with no external provider/OAuth/webhook-signature scheme at all — the browser widget talks directly to this backend. `GET /api/public/webchat/:widgetId/config` returns the widget's display name/welcome message/color for rendering; `GET /:widgetId/messages` returns history by `sessionToken`; `POST /:widgetId/messages` accepts a guest message (IP + session rate-limited, 429 on abuse), writes it via the shared `upsertConversationFromInbound` (same helper used by every other channel) and forwards it to the CRM operator via `CrmAgentCommand{type:'channel.message.relay', payload:{channel:'webchat', event}}`; `GET /:widgetId/events` is an SSE stream (via `webchatEventHub`) that pushes the operator's replies back down to the guest's browser in near-real-time. `routes/crm.js`'s agent-relay branch publishes outbound webchat replies onto `webchatEventHub` (separate from `crmEventHub`, which drives the Flutter Live Chat side). Registration reuses the existing channel-agnostic `POST /agent/channels/register` route. Text-only MVP — no image/file attachment support yet. |

---

### Recent CRM Subscription Note

- New user registration (`POST /api/auth/register`) creates a one-time `crm_trial` subscription: 14 days, 100 included AI requests, 0 used, 0 extra, `entitlementType: trial`.
- `CrmSubscription` has `entitlementType` and `trialStartedAt`; partial unique index `unique_trial_subscription_per_user` prevents a second trial for the same user.
- CRM checkout/billing fulfillment preserves the historical trial record; upgrading from trial closes that trial and creates a separate `entitlementType: paid` subscription, while paid renewals extend the paid record in place.

### Group AI Summary (structured + incremental, privacy-first)

- **Backend does NOT store group message content.** The `events/message` ingest no longer creates `CrmGroupMessage` (only updates `CrmZaloGroup.lastMessageAt`). The Flutter client reads messages from the operator's **local** store and sends them in the request body; they are used transiently for AI only and never persisted.
- `POST /crm/groups/:id/summarize` accepts `{ messages:[{senderName,content,sentAt}], scope, goals[], prompt, industry, autoCreateTasks, saveConfig }`. Messages come from `req.body` (sorted, phone-redacted, capped 400); incremental watermark (latest summary `coveredTo`) is applied client-side. `CrmGroupMessage` model still exists but is no longer written (legacy `/groups/:id/messages` + `/checkpoints` now return empty).
- AI returns structured JSON parsed by `utils/crmGroupSummary.js` (`buildGroupSummaryPromptV2` + `parseGroupSummaryJson`, prose fallback). `CrmGroupSummary` gained `coveredFrom/coveredTo/messageCount`.
- Opportunities/risks/questions/actionItems become `CrmGroupInsight` upserted by `dedupKey` (`dedupKeyForItem`, normalized diacritics) — already-`done`/`dismissed` items are not recreated, giving skip-done continuity. Follow-up insights → tasks via `POST /crm/tasks` (`relatedType:'insight'`, `insightId`).
- Per-group wizard config persists on `CrmZaloGroup.summaryConfig` (Mixed) via `PUT /crm/groups/:id/manage`.
- `GET /crm/tasks` now also `.populate('groupId', 'name accountId groupId')` so care tasks carry the linked Zalo group (name + accountId + groupId) for display and the client's "Mở Live Chat" deep-link.
- **Summary model is a LOCAL client preference** (stored in Flutter `SystemSettings.summaryAiModel`, no cloud setting/endpoint): the client sends `aiModel` in the summarize body; the route validates via `normalizeSummaryAiModel` (allowed: `gemini-3.1-pro` default, `gemini-2.5-pro`, `gemini-3-flash`) and passes `model` + `quotaUnits` (`getChatbotModelQuotaUnits`: pro-3.1 = 2 units, others = 1).
- Each summarize writes a `CrmChatbotLog` (`kind:'group_summary'`, `tokenIn`/`tokenOut` from `CrmAiUsage`) so it shows in the chatbot "Nhật ký phản hồi". `CrmChatbotLog` gained `kind`/`tokenIn`/`tokenOut`.
- `GET /crm/analytics/ai-tokens?from=&to=` aggregates `CrmAiUsage` daily token in/out (prompt/completion) for the overview chart.

### CRM Realtime (SSE) for Mobile/Web clients

- `server/utils/crmEventHub.js`: in-memory per-userId SSE hub (`subscribe(userId,res)`, `publish(userId,eventName,payload)`, 25s ping heartbeat, max 5 connections/user). Single Fly.io instance only — needs Redis pub/sub if scaled horizontally.
- `GET /crm/events/subscribe` (`authMiddleware`-based `sseAuthMiddleware` that also accepts `?token=` for EventSource/web, `requireActiveSubscription`): sends `hello` (serverTime + active devices) then streams `message.new`, `message.status`, `conversation.updated`, `device.status`, `pairing.completed`.
- Broadcast points: `POST /agent/events/message` (message.new + conversation.updated), `POST /agent/commands/:id/result` for `zalo.message.send` (message.status, reuses the existing `CrmMessage` status update), `POST /conversations/:id/send`+`/send-attachment` (message.status queued), `POST /pairing/confirm` (pairing.completed).
- `CrmDevice` heartbeat gained `agentStatus`/`zaloAccounts`/`queueDepth`/`lastHeartbeatAt`; `POST /agent/heartbeat` publishes `device.status` on transition. A 30s `setInterval` in `server/index.js` marks devices offline (and publishes) after 60s without a heartbeat.
- `POST /agent/commands/next` now long-polls: body `waitMs` (capped 25000ms) holds the request until a command is created for that device (`createAgentCommand()` helper wraps `CrmAgentCommand.create` + wakes the waiter) or the timeout elapses; omitting `waitMs` keeps the old immediate-return behavior.
- Desktop Windows app is unaffected — it still uses its local bridge SSE, not this cloud channel. This cloud SSE + long-poll pair targets mobile/web clients that have no local bridge (see `tools/alpha-crm/docs/specs/mobile-web-completion-tasklist.md`).
- **BE-6 (outbound message sync):** `upsertConversationFromInbound` (used by `POST /agent/events/message`) now tells inbound vs outbound apart via `event.senderId === accountId` (the agent always sets this for its own sends) instead of hardcoding `direction: 'inbound'`. Outbound: `unreadCount` is never incremented. No separate `/agent/events/outbound-message` endpoint was added (deviation from the original task doc): reusing the same endpoint with direction auto-detection was simpler and avoided duplicating ~150 lines of conversation-upsert/managed-group logic. `GET /conversations/:id/messages` no longer returns `LOCAL_BRIDGE_REQUIRED`; it returns whatever's synced plus `meta.syncScope` (`'full'` or `'user-full-group-metadata'`).
- **1:1 full-content sync (option (b), post-review):** the desktop agent reports **full content for 1:1 threads even in local-first mode**, so `upsertConversationFromInbound` stores every full event that reaches it (metadata-only `localFirst:true` events still return early — only **managed groups** stay metadata/preview-only on the cloud). Full-event validation allows empty `content` when `messageType !== 'text'` (media events can have an empty extracted string). The metadata branch's `$inc unreadCount` respects an explicit `unreadCountDelta: 0` (self-sent message) instead of `|| 1`-ing it back to an increment.
- **Long-poll disconnect hardening:** `/agent/commands/next` registers `req.on('close')` while parked and re-checks `req.destroyed`/`res.writableEnded` before claiming, so a command created while the agent's connection already died stays `queued` for the next poll instead of being marked `sent` into a dead socket (previously stranded until the 1h TTL).
- **BE-7 (mobile command-authorization review, closes Task 1.3-security):** audited every route that creates a `CrmAgentCommand` (`/conversations/:id/send`, `/send-attachment`, `/messages/:messageId/recall`, `/campaigns/:id/start`, `/campaigns/:id/cancel`) — all require `authMiddleware` + `requireActiveSubscription`, and each independently re-fetches its target (`CrmConversation`/`CrmCampaign`/`CrmDevice`) scoped to `userId: req.user._id` before calling `createAgentCommand()`, which itself trusts the caller's `userId`/`deviceId` with no independent re-check. Cross-user access returns **404** (not 403) so a user can't distinguish "not yours" from "doesn't exist" — a deliberate anti-enumeration choice, not a gap (the tasklist's DoD phrasing said "test 403"; 404 is the stricter, correct behavior here). **Decision: no per-command JWT signature needed** — the agent already authenticates via `x-agent-secret` + `deviceId` (`agentAuthMiddleware`), and every command a device can claim was already scoped to that device's owner at creation time; adding per-command signing would duplicate protection the ownership check already provides. Added `crmMessageSendLimiter` (30 req/min) to `/conversations/:id/send` and `/send-attachment` — the only unthrottled command-creating routes reachable directly from a mobile/web client (campaigns already require human approval + are lower-frequency by nature).

## 5. Known Issues & TODOs

### High Priority
- [x] Rate limiting: implemented per-route in `server/middleware/crmRateLimit.js` (pairing, device register, AI chat, CRM message send). Not a global/all-routes limiter — add new limiters there as new abuse-prone routes are added.
- [ ] Input sanitization could be improved
- [ ] **gcli model codes (tạm thời):** model `-preview` của gcli hiện không khả dụng. `utils/aiProvider.js` có `GCLI_MODEL_CODE_MAP` dịch tên UI (`gemini-2.5-flash`, `gemini-3-flash`, `gemini-3.5-flash`, `gemini-3.1-pro`) → mã `假流式-agy-*-low` ngay tại `callGcliDirect` (choke point duy nhất cho mọi tool: chat/crm/interior/ai). Khi gọi đến `gemini-3-flash-preview` và `gemini-3.1-pro-preview`, có tỷ lệ 20% sẽ dùng `假流式-agy-gemini-3-flash-low` và `假流式-agy-gemini-3.1-pro-low` (có thể tắt qua `disableLowModelFallback: true` hoặc `enableLowModelFallback: false` trong options gọi API, mặc định luôn bật). Khôi phục: sửa value trong map về mã `-preview`.

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
2. Follow naming conventions in CONVENTIONS.md
3. Use ES Module syntax (import/export)
4. Handle errors consistently with try/catch
5. Return consistent JSON response format: `{ success, message, data? }`

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
MONGODB_MAX_POOL_SIZE=5
MONGODB_MIN_POOL_SIZE=0
JWT_SECRET=your_secret_key          # JWT signing secret
PORT=3001                           # Server port (default: 3001)
NODE_ENV=development                # Environment mode
FRONTEND_URL=https://...            # Frontend URL for CORS
CASSO_WEBHOOK_SECRET=your_secret    # Casso webhook verification secret
# Backblaze B2
STORAGE_PROVIDER=b2
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_REGION=us-west-004
B2_ACCESS_KEY_ID=your_key_id
B2_SECRET_ACCESS_KEY=your_app_key
B2_BUCKET_NAME=your_bucket_name
CDN_BASE_URL=https://f004.backblazeb2.com/file/your_bucket_name
OPENCLAW_URL=http://localhost:18791/api/chat
GCLI_DIRECT_URL=http://localhost:18790/v1/chat/completions
GCLI_DIRECT_MODEL=gemini-2.5-flash
GEMINI_API_KEY=...                   # Gemini SDK fallback for image generation routes
INTERIOR_IMAGE_API_KEY=...           # Optional override used by /interior/generate-render
INTERIOR_IMAGE_MODEL=gemini-2.5-flash-image
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
npm run db:m0:migrate          # Dry-run inline media scan
npm run db:m0:audit            # Live collection/index audit
npm run db:m0:rollback -- --manifest <path>  # Dry-run rollback
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


