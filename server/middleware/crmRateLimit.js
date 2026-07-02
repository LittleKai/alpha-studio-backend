import rateLimit from 'express-rate-limit';

export const crmPairingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Quá nhiều yêu cầu ghép nối, vui lòng thử lại sau.' }
});

export const crmDeviceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 100, // 100 requests (development-friendly)
  message: { success: false, message: 'Quá nhiều yêu cầu đăng ký thiết bị.' }
});

export const crmAiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Quá nhiều yêu cầu AI, vui lòng chậm lại.' }
});

// Remote Live Chat sends (mobile/web -> cloud command queue -> Desktop Agent).
// Caps at ~1 message/2s sustained, well above normal chat pace but low enough
// to block a compromised/scripted client from flooding the agent's send queue.
export const crmMessageSendLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Gửi tin quá nhanh, vui lòng chậm lại.' }
});
