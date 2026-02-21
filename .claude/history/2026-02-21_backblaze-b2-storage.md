# 2026-02-21 - Backblaze B2 File Storage

## Summary
Added Backblaze B2 support for video and file uploads via presigned URLs. Frontend uploads directly to B2 (no backend proxy), keeping Cloudinary for images.

## Changes Made

### New Files
- `server/utils/b2Storage.js` — B2 S3 client + `generatePresignedUploadUrl(key, contentType, expiresIn)` + `deleteFile(key)`
- `server/routes/upload.js` — `POST /presign` (auth required) + `DELETE /file` (admin only)

### Modified Files
- `server/index.js` — imported `uploadRoutes` and mounted at `/api/upload`
- `.env` — added B2 env vars (B2_ENDPOINT, B2_REGION, B2_ACCESS_KEY_ID, B2_SECRET_ACCESS_KEY, B2_BUCKET_NAME, CDN_BASE_URL)

### Dependencies Added
- `@aws-sdk/client-s3` v3
- `@aws-sdk/s3-request-presigner` v3

## API Design

### POST /api/upload/presign (auth required)
```json
// Request
{ "filename": "lecture.mp4", "contentType": "video/mp4", "folder": "courses/videos" }

// Response
{
  "success": true,
  "data": {
    "presignedUrl": "https://s3.us-west-004.backblazeb2.com/...",
    "publicUrl": "https://f004.backblazeb2.com/file/bucket/courses/videos/1706000000-lecture.mp4",
    "fileKey": "courses/videos/1706000000-lecture.mp4"
  }
}
```

### DELETE /api/upload/file (admin only)
```json
{ "fileKey": "courses/videos/1706000000-lecture.mp4" }
```

## Security Notes
- `forcePathStyle: true` required for B2 S3-compatible API
- Content-type whitelist: `video/*`, `application/pdf`, `application/msword`, `application/vnd.*`, `application/zip`, etc.
- Filename sanitized (lowercase, alphanumeric + dots/hyphens)
- Presigned URL expires in 15 minutes (900 seconds)

## Required B2 Setup
1. Create Public bucket
2. CORS rules: allowedOrigins include `https://alphastudio.vercel.app` and `http://localhost:5173`
3. Create Application Key with read/write access
4. Set env vars (endpoint from B2 Settings → Endpoints)
