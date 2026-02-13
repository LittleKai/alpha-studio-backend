# Email Verification for Password Change
**Date:** 2026-02-13

## Changes Made

### New Files
- `server/utils/email.js` - Nodemailer Gmail SMTP transporter + sendPasswordVerificationCode()

### Modified Files
- `server/models/User.js` - Added passwordResetCode (String) and passwordResetExpires (Date) fields
- `server/routes/auth.js` - Added send-password-code route, modified password route to require code
- `package.json` - Added nodemailer dependency
- `.env` - Added EMAIL_USER and EMAIL_PASS placeholders

## API Changes

### POST /api/auth/send-password-code (NEW)
- **Auth:** Required (Bearer token)
- **Rate limit:** 60 seconds between requests
- **Action:** Generates 6-digit code, stores in user document, sends via Gmail
- **Response:** `{ success: true, data: { email: "ad***@gmail.com" } }`
- **Code expiry:** 10 minutes

### PUT /api/auth/password (MODIFIED)
- **Breaking change:** Now requires `code` parameter in addition to `currentPassword` and `newPassword`
- **Body:** `{ currentPassword, newPassword, code }`
- **Validates:** verification code match + expiry + current password + new password length
- **Clears:** passwordResetCode and passwordResetExpires after successful change

## Environment Variables
- `EMAIL_USER` - Gmail address for sending emails
- `EMAIL_PASS` - Gmail App Password (not regular password)
