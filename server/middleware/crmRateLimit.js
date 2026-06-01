import rateLimit from 'express-rate-limit';

export const crmPairingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Quá nhiều yêu cầu ghép nối, vui lòng thử lại sau.' }
});

export const crmDeviceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Quá nhiều yêu cầu đăng ký thiết bị.' }
});

export const crmAiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Quá nhiều yêu cầu AI, vui lòng chậm lại.' }
});
