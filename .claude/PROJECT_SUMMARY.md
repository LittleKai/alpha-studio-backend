# Project Summary
**Last Updated:** 2026-01-19 (Partner Skills, Index Cleanup)
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
│   │   ├── User.js                # User model with bcrypt
│   │   ├── Course.js              # Course model with multilingual support
│   │   ├── Job.js                 # Job listings with multilingual support
│   │   └── Partner.js             # Partner profiles with skills array
│   ├── middleware/
│   │   └── auth.js                # JWT auth + adminOnly middleware
│   └── routes/
│       ├── auth.js                # Auth API routes
│       ├── courses.js             # Course CRUD + publish/archive routes
│       ├── jobs.js                # Job CRUD + publish/close routes
│       └── partners.js            # Partner CRUD + publish/unpublish routes
├── .claude/                       # Documentation
│   ├── PROJECT_SUMMARY.md
│   ├── CONVENTIONS.md
│   ├── DATABASE.md
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
- **Collections:** 8 collections
  - `users` - User accounts with hashed passwords
  - `courses` - Course information
  - `students` - Student profiles
  - `partners` - Partner profiles
  - `projects` - User projects
  - `studio_sessions` - AI studio session history
  - `transformations` - Available transformations
  - `api_usage` - API usage tracking
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
- `server/models/User.js` - User schema and password hashing
- `server/models/Course.js` - Course schema with multilingual fields
- `server/middleware/auth.js` - JWT verification + adminOnly middleware
- `server/routes/auth.js` - All authentication endpoints
- `server/routes/courses.js` - Course CRUD and management endpoints
- `server/db/connection.js` - MongoDB connection setup
- `DATABASE.md` - Complete database schema documentation

### Environment Variables:
```env
MONGODB_URI=mongodb+srv://...       # MongoDB connection string
JWT_SECRET=your_secret_key          # JWT signing secret
PORT=3001                           # Server port (default: 3001)
NODE_ENV=development                # Environment mode
FRONTEND_URL=https://...            # Frontend URL for CORS
```

---

## 7. Recent Changes (Last 3 Sessions)

1. **2026-01-19** - Partner Skills, Index Cleanup
   - Added `skills` field to Partner model (array of strings)
   - Added `cleanupStaleIndexes()` function in `db/connection.js`
   - Auto-drops stale `userId_1` index from partners collection on startup
   - Fixed duplicate key error when creating partners
   - Partner model now supports text search on company name and descriptions

2. **2026-01-18** - Course Management API
   - Created Course model with multilingual support (VI/EN)
   - Implemented full CRUD API for courses (admin only)
   - Added publish/unpublish/archive endpoints (PATCH)
   - Added course statistics endpoint
   - Created adminOnly middleware for authorization
   - Fixed CORS to include PATCH method
   - Nested schema for modules and lessons with virtual fields

3. **2026-01-17** - Render Deployment
   - Deployed to Render (https://alpha-studio-backend.onrender.com)
   - Configured environment variables (MONGODB_URI, JWT_SECRET, FRONTEND_URL)
   - Added "server" script to package.json for Render compatibility
   - MongoDB Atlas IP whitelist configuration

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
