# Alpha Studio Backend API

Express.js REST API with MongoDB and JWT authentication for the Alpha Studio AI Academy Platform.

**Production:** https://alpha-studio-backend.fly.dev

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
- `FRONTEND_URLS` / `CORS_ORIGINS` - Optional comma or space separated extra browser origins
- `STORAGE_PROVIDER` - `b2` in production, `local` for development only

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

## File And Media Storage

MongoDB stores metadata, object keys, public/download URLs, status, and data
relationships only. It must not store file bytes, BSON binary media, data URLs,
or raw base64 payloads.

The upload contract is:

1. The client requests a presigned upload URL from the API.
2. The client uploads bytes directly to Backblaze B2.
3. The API receives and persists only the URL, key, filename, MIME type, size,
   checksum, and business metadata.
4. Model validation rejects data URLs, media-shaped base64, Buffers, and BSON
   binary values.
5. `STORAGE_PROVIDER=local` uses `LOCAL_STORAGE_ROOT` for development and tests
   only; production should use `STORAGE_PROVIDER=b2`.

Interior project versions keep the newest 20 versions in MongoDB. Older
versions are checksum-verified JSON objects in storage; MongoDB keeps archive
metadata and hydrates the original API response when projects are read.

## MongoDB Atlas M0 Operations

Application startup uses one Mongoose connection lifecycle with an M0-friendly
pool (`maxPoolSize=5`, `minPoolSize=0`) and `autoIndex=false`. Index changes are
explicit maintenance operations.

Dry-run media scan:

```bash
npm run db:m0:migrate
```

Apply media migration after reviewing dry-run output. Back up the database and
keep the manifest with the database backup:

```bash
npm run db:m0:migrate -- --apply --manifest .data/migrations/mongodb-m0-2026-06-12.jsonl
```

Audit collections and indexes:

```bash
npm run db:m0:audit -- --output .data/audits/mongodb-m0
npm run db:m0:audit -- --apply-indexes --output .data/audits/mongodb-m0-after
```

Rollback defaults to dry-run. Apply rollback only with the exact manifest from
the matching migration:

```bash
npm run db:m0:rollback -- --manifest .data/migrations/mongodb-m0-2026-06-12.jsonl
npm run db:m0:rollback -- --apply --manifest .data/migrations/mongodb-m0-2026-06-12.jsonl
```

Apply mode writes separate `*.failures.jsonl` and `*.rollback.jsonl` result
files. Verify object checksums, failure/conflict counts, API reads, TTL indexes,
and Atlas storage metrics before deleting any backup. Business collections are
never auto-dropped; merge/remove candidates require a separate reviewed
migration.

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
FRONTEND_URL=https://giaiphapsangtao.com
# Optional extra origins, comma or space separated
FRONTEND_URLS=https://www.giaiphapsangtao.com
```

The backend also has built-in CORS defaults for
`https://giaiphapsangtao.com`, `https://www.giaiphapsangtao.com`, and the
legacy Vercel domain. Keep Fly.io secrets aligned with the active frontend
domains so browser preflight requests receive `Access-Control-Allow-Origin`.

## Related

- **Frontend Repository:** [alpha-studio](https://github.com/yourusername/alpha-studio)
- **Documentation:** See `.claude/` folder

## License

ISC
# alpha-studio-backend
