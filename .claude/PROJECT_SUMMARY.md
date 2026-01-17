# Project Summary
**Last Updated:** 2026-01-17 (Standalone Backend Repository)
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
│   │   └── User.js                # User model with bcrypt
│   ├── middleware/
│   │   └── auth.js                # JWT auth middleware
│   └── routes/
│       └── auth.js                # Auth API routes
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
| CORS Support | ✅ Complete | index.js | Multi-origin support |

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
- `server/middleware/auth.js` - JWT verification logic
- `server/routes/auth.js` - All authentication endpoints
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

1. **2026-01-17** - Standalone Backend Repository
   - Separated from frontend monorepo
   - Created independent package.json
   - Updated CORS configuration for production
   - Created comprehensive README.md
   - Updated documentation for backend-only focus

2. **2026-01-17** - Authentication System Implementation
   - Implemented JWT authentication with bcrypt password hashing
   - Created User model with Mongoose 8.x
   - Built Express.js API routes: login, register, logout, profile
   - Added password migration script for existing users
   - **Bug Fixes:**
     - Fixed Mongoose 8+ pre-save hook (removed `next` callback)
     - Fixed login route 500 error (use updateOne for lastLogin)
     - Fixed register route duplicate key error handling

3. **2025-01-17** - Initial project setup
   - Created `.claude/` documentation structure
   - Set up MongoDB Atlas connection
   - Generated initial documentation files

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
