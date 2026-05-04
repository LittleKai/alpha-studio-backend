import express from 'express';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/**
 * Route: POST /api/chat/generate
 * Description: Proxies chat messages to the local gcli-proxy (openclaw-server).
 * Requires Authentication.
 */
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, message: 'Invalid messages format. Expected an array of messages.' });
    }

    // Default configuration for Custom API Channel (Middle-tier)
    const requestBody = {
      messages: messages,
      sessionId: req.user ? req.user._id.toString() : null // Truyền sessionId để duy trì bối cảnh (nếu hỗ trợ)
    };

    // Use OPENCLAW_URL from env, fallback to localhost if developing locally (Custom API Server is on 18791)
    const proxyUrl = process.env.OPENCLAW_URL || 'http://localhost:18791/api/chat';

    let proxyResponse;
    try {
      proxyResponse = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
    } catch (networkError) {
      console.error('Fetch to proxyUrl failed:', networkError);
      return res.status(502).json({
        success: false,
        message: 'Trạm trung chuyển đang bị tắt hoặc mạng không ổn định. Vui lòng thử lại sau.'
      });
    }

    const responseTextRaw = await proxyResponse.text();
    let data;
    try {
      data = JSON.parse(responseTextRaw);
    } catch (parseError) {
      console.error('Failed to parse proxy response as JSON:', responseTextRaw.substring(0, 200));
      return res.status(proxyResponse.status || 502).json({
        success: false,
        message: `Lỗi kết nối từ trạm trung chuyển (Mã ${proxyResponse.status}). Proxy có thể đang bị tắt hoặc chặn.`,
      });
    }

    if (!proxyResponse.ok) {
      console.error('gcli-proxy error:', data);
      return res.status(proxyResponse.status).json({
        success: false,
        message: data.error?.message || data.message || 'Error communicating with AI service.',
      });
    }

    // Extract the AI response text from the new Custom API Channel (Middle-tier)
    const responseText = data.data?.text || data.choices?.[0]?.message?.content || '';

    return res.json({
      success: true,
      data: {
        text: responseText,
      }
    });

  } catch (error) {
    console.error('Chat endpoint error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during chat request.',
    });
  }
});

export default router;
