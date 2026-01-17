# Standalone Backend Repository
**Date:** 2026-01-17
**Type:** Architecture / Repository Setup

---

## Summary
Created standalone backend repository from the frontend monorepo. This repository now contains only the Express.js API server for the Alpha Studio platform.

## Repository Contents

### Server Structure
```
server/
├── index.js                   # Express server entry point
├── db/
│   ├── connection.js          # MongoDB Atlas connection
│   ├── init-collections.js    # Database initialization
│   ├── test-connection.js     # Connection test utility
│   └── migrate-passwords.js   # Password bcrypt migration
├── models/
│   └── User.js                # User model with bcrypt
├── middleware/
│   └── auth.js                # JWT authentication middleware
└── routes/
    └── auth.js                # Authentication routes
```

### Configuration Files Created
1. **package.json**
   - ES Modules enabled (`"type": "module"`)
   - Dependencies: express, mongoose, bcryptjs, jsonwebtoken, cors, dotenv, cookie-parser
   - Dev dependencies: nodemon
   - Scripts: start, dev, db:test, db:init, db:migrate-passwords

2. **.env.example**
   ```env
   MONGODB_URI=mongodb+srv://...
   JWT_SECRET=your_secret_key
   PORT=3001
   NODE_ENV=development
   FRONTEND_URL=http://localhost:5173
   ```

3. **.gitignore**
   - node_modules, .env, logs, IDE files

4. **README.md**
   - Complete setup instructions
   - API endpoint documentation
   - Deployment guides for Railway/Render

### Updated Files
1. **server/index.js**
   - Enhanced CORS configuration
   - Support for multiple origins (dev + production)
   - Dynamic FRONTEND_URL from environment

2. **.claude/PROJECT_SUMMARY.md**
   - Rewritten for backend-only focus
   - Removed all frontend references
   - Added API documentation section

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | No | Register new user |
| POST | `/api/auth/login` | No | Login and get token |
| POST | `/api/auth/logout` | Yes | Logout user |
| GET | `/api/auth/me` | Yes | Get current user |
| PUT | `/api/auth/profile` | Yes | Update profile |
| PUT | `/api/auth/password` | Yes | Change password |
| GET | `/api/health` | No | Health check |

## Deployment

### Railway
```bash
railway login
railway init
railway up
```

### Render
1. Connect GitHub repository
2. Set environment variables in dashboard
3. Deploy

### Required Environment Variables
- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - JWT signing secret
- `FRONTEND_URL` - Frontend URL for CORS
- `PORT` - Server port (optional, default 3001)
- `NODE_ENV` - Environment mode

## Development

### Quick Start
```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your values

# Test database
npm run db:test

# Start server
npm run dev
```

### Sample Users
| Email | Password | Role |
|-------|----------|------|
| admin@alphastudio.com | admin123456 | admin |
| student@example.com | student123 | student |

---

## Related
- Frontend repository: `../alpha-studio`
- Database documentation: `.claude/DATABASE.md`
