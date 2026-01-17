# Render Deployment Configuration
**Date:** 2026-01-17
**Type:** Deployment / Configuration

---

## Summary
Deployed backend API to Render with MongoDB Atlas integration.

## Production URL
https://alpha-studio-backend.onrender.com

## Render Configuration

### Environment Variables
| Key | Value |
|-----|-------|
| `MONGODB_URI` | `mongodb+srv://aduc5525:***@cluster0.c1mdcyv.mongodb.net/alpha-studio?retryWrites=true&w=majority&appName=Cluster0` |
| `JWT_SECRET` | `alpha_studio_jwt_***` |
| `FRONTEND_URL` | `https://alphastudio.vercel.app` |
| `GEMINI_API_KEY` | `AIzaSyC3SCrar3EW92GIwQGjUd13Ebcn22swQoM` |

### Start Command
```
npm start
```

### Deploy Hook
```
https://api.render.com/deploy/srv-d5lp3im3jp1c739koq60?key=aCkiDk_92mM
```

## Changes Made

### package.json
Added "server" script as alias for "start":
```json
"scripts": {
    "start": "node server/index.js",
    "server": "node server/index.js",
    ...
}
```

### Documentation Updated
- `.claude/PROJECT_SUMMARY.md` - Added production URL
- `README.md` - Added production URL

## Issues Encountered & Solutions

### 1. Missing "server" script
- **Error:** `npm error Missing script: "server"`
- **Solution:** Changed Render start command to `npm start`

### 2. MongoDB IP Whitelist
- **Error:** `Could not connect to any servers in your MongoDB Atlas cluster`
- **Solution:** Add `0.0.0.0/0` to MongoDB Atlas Network Access (allow all IPs)

## MongoDB Atlas Configuration
- **Cluster:** Cluster0
- **Database:** alpha-studio
- **Network Access:** Must whitelist Render IPs or use 0.0.0.0/0

---

## Related
- Frontend deployment: See alpha-studio history
- Repository: https://github.com/LittleKai/alpha-studio-backend
