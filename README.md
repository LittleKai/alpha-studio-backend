# Alpha Studio Backend API

Express.js REST API with MongoDB and JWT authentication for the Alpha Studio AI Academy Platform.

## Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express.js 5.x
- **Database:** MongoDB Atlas
- **ODM:** Mongoose 8.x
- **Authentication:** JWT + bcrypt

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and update the values:

```bash
cp .env.example .env
```

Required variables:
- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `FRONTEND_URL` - Frontend URL for CORS

### 3. Test database connection

```bash
npm run db:test
```

### 4. Initialize database

```bash
npm run db:init
npm run db:migrate-passwords
```

### 5. Start server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server runs on `http://localhost:3001` by default.

## API Endpoints

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | No | Register new user |
| POST | `/api/auth/login` | No | Login and get token |
| POST | `/api/auth/logout` | Yes | Logout user |
| GET | `/api/auth/me` | Yes | Get current user |
| PUT | `/api/auth/profile` | Yes | Update profile |
| PUT | `/api/auth/password` | Yes | Change password |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |

## Sample Users

After running migrations:

| Email | Password | Role |
|-------|----------|------|
| admin@alphastudio.com | admin123456 | admin |
| student@example.com | student123 | student |

## Project Structure

```
alpha-studio-backend/
├── server/
│   ├── index.js           # Express app entry
│   ├── db/
│   │   ├── connection.js  # MongoDB connection
│   │   ├── init-collections.js
│   │   ├── test-connection.js
│   │   └── migrate-passwords.js
│   ├── models/
│   │   └── User.js        # User model
│   ├── middleware/
│   │   └── auth.js        # JWT middleware
│   └── routes/
│       └── auth.js        # Auth routes
├── .claude/               # Documentation
├── package.json
├── .env.example
└── README.md
```

## Deployment

### Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

Set environment variables in Railway dashboard.

### Render

1. Push to GitHub
2. Connect repository on render.com
3. Set environment variables
4. Deploy

### Environment Variables for Production

```env
MONGODB_URI=your_production_mongodb_uri
JWT_SECRET=your_secure_random_string
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://your-frontend-domain.vercel.app
```

## Related

- **Frontend Repository:** [alpha-studio](https://github.com/yourusername/alpha-studio)
- **Documentation:** See `.claude/` folder

## License

ISC
# alpha-studio-backend
