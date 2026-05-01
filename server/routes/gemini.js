import express from 'express';
import { GoogleGenAI, Modality } from '@google/genai';
import { authMiddleware } from '../middleware/auth.js';
import SystemSetting from '../models/SystemSetting.js';
import { decrypt } from '../utils/encryption.js';

const router = express.Router();

router.use((req, res, next) => {
    console.log('Gemini router hit:', req.method, req.path);
    next();
});

router.get('/test', (req, res) => res.json({ hello: 'world' }));

router.post('/generate', authMiddleware, async (req, res) => {
    try {
        const { model, prompt, imageParts, maskBase64, useVideoKey } = req.body;

        let apiKey = process.env.GEMINI_API_KEY;
        const settingsRaw = await SystemSetting.find({ key: { $in: ['geminiApiKey', 'videoApiKey', 'useApiForStudio'] } });
        const settings = {};
        settingsRaw.forEach(s => settings[s.key] = s.value);

        if (settings.useApiForStudio) {
             const customKey = useVideoKey ? settings.videoApiKey : settings.geminiApiKey;
             if (customKey) {
                 apiKey = decrypt(customKey);
             } else if (useVideoKey && settings.geminiApiKey) {
                 // Fallback to gemini key if video key is empty but gemini key is there
                 apiKey = decrypt(settings.geminiApiKey);
             }
        }

        if (!apiKey) {
             return res.status(400).json({ success: false, message: 'Chưa cấu hình API Key. Vui lòng thiết lập ở mục cài đặt Admin.' });
        }

        const ai = new GoogleGenAI({ apiKey });

        let fullPrompt = prompt || "";
        const parts = [];

        if (maskBase64) {
            fullPrompt = `Apply the following instruction only to the masked area of the image: "${prompt}". Preserve the unmasked area.`;
        }

        if (imageParts && imageParts.length > 0) {
            parts.push({ inlineData: { data: imageParts[0].base64, mimeType: imageParts[0].mimeType } });
        }
        if (maskBase64) {
            parts.push({ inlineData: { data: maskBase64, mimeType: 'image/png' } });
        }
        if (imageParts && imageParts.length > 1) {
            for (const img of imageParts.slice(1)) {
                parts.push({ inlineData: { data: img.base64, mimeType: img.mimeType } });
            }
        }

        if (fullPrompt) {
            parts.push({ text: fullPrompt });
        }

        // For Video we would need the experimental Modality.VIDEO if it existed, but we just use models.generateContent
        const response = await ai.models.generateContent({
            model,
            contents: { parts },
            // Video might not support responseModalities override in the exact same way as Image
            config: useVideoKey ? undefined : { responseModalities: [Modality.IMAGE] },
        });

        const result = { imageUrl: null, text: null, rawCandidates: response.candidates };
        const responseParts = response.candidates?.[0]?.content?.parts;
        if (responseParts) {
            for (const part of responseParts) {
                if (part.text) {
                    result.text = (result.text ? result.text + '\n' : '') + part.text;
                } else if (part.inlineData) {
                    const mime = part.inlineData.mimeType || (useVideoKey ? 'video/mp4' : 'image/jpeg');
                    result.imageUrl = `data:${mime};base64,${part.inlineData.data}`;
                }
            }
        }

        if (!result.imageUrl && !result.text) {
             const finishReason = response.candidates?.[0]?.finishReason;
             const safetyRatings = response.candidates?.[0]?.safetyRatings;
             let errorMessage = 'Model không trả về nội dung hợp lệ.';
             if (finishReason === 'SAFETY') {
                  const blocked = safetyRatings?.filter(r => r.blocked).map(r => r.category).join(', ');
                  errorMessage = `Yêu cầu bị chặn bởi kiểm duyệt (Trạng thái: ${blocked || 'Unknown'}).`;
             }
             return res.status(400).json({ success: false, message: errorMessage });
        }

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Gemini Generate Proxy Error:', error);

        let msg = error.message;
        try {
            const maybeJson = msg.substring(msg.indexOf('{'));
            const parsed = JSON.parse(maybeJson);
            if (parsed.error?.message) {
                if (parsed.error.status === 'RESOURCE_EXHAUSTED') {
                    msg = 'Đã vượt quá hạn mức quota API. Vui lòng đợi vài phút.';
                } else if (parsed.error.code === 500 || parsed.error.status === 'UNKNOWN') {
                    msg = 'Máy chủ AI gặp sự cố. Thử lại sau.';
                } else {
                    msg = parsed.error.message;
                }
            }
        } catch { }

        res.status(500).json({ success: false, message: msg });
    }
});

export default router;