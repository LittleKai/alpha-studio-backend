# 2026-02-13: Admin Reset Password + Simplified Password Change

## Changes Made

### Admin Reset Password (routes/admin.js)
- Added `POST /api/admin/users/:id/reset-password`
- Generates random 8-digit number (10000000-99999999)
- Hashes with bcrypt (12 rounds) via `bcrypt.genSalt(12)` + `bcrypt.hash()`
- Uses `User.updateOne()` to avoid triggering pre-save password rehash
- Returns plain-text password in response for admin to share

### Simplified Password Change (routes/auth.js)
- Modified `PUT /api/auth/password` to only require `currentPassword` and `newPassword`
- Removed verification code check logic (passwordResetCode, passwordResetExpires)
- The `POST /api/auth/send-password-code` endpoint kept in code but no longer used by frontend

## Files Modified
1. `server/routes/admin.js` - Added reset-password endpoint + bcrypt import
2. `server/routes/auth.js` - Simplified PUT /password endpoint
