import express from 'express';
import SystemSetting from '../models/SystemSetting.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { encrypt } from '../utils/encryption.js';

const router = express.Router();

const PUBLIC_KEYS = [
    'useApiForStudio',
    'useApiForImage',
    'useApiForEdit',
    'useApiForVideo',
    'useOpenClawForChat',
    'gcliBotModel'
];

const GCLI_BOT_ALLOWED_MODELS = ['gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-pro'];
const GCLI_BOT_DEFAULT_MODEL = 'gemini-3-flash-preview';

router.get('/public', async (req, res) => {
    try {
        const settings = await SystemSetting.find({ key: { $in: PUBLIC_KEYS } });
        
        const data = {};
        settings.forEach(s => {
            data[s.key] = s.value;
        });

        // Set defaults if missing
        if (data.useApiForStudio === undefined) data.useApiForStudio = false;
        if (data.useApiForImage === undefined) data.useApiForImage = false;
        if (data.useApiForEdit === undefined) data.useApiForEdit = false;
        if (data.useApiForVideo === undefined) data.useApiForVideo = false;
        if (data.useOpenClawForChat === undefined) data.useOpenClawForChat = true;
        if (!GCLI_BOT_ALLOWED_MODELS.includes(data.gcliBotModel)) data.gcliBotModel = GCLI_BOT_DEFAULT_MODEL;

        res.json({ success: true, data });
    } catch (error) {
        console.error('Get public settings error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

router.get('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const settings = await SystemSetting.find();
        
        const data = {};
        settings.forEach(s => {
            data[s.key] = s.value;
        });

        if (data.useApiForStudio === undefined) data.useApiForStudio = false;
        if (data.useApiForImage === undefined) data.useApiForImage = false;
        if (data.useApiForEdit === undefined) data.useApiForEdit = false;
        if (data.useApiForVideo === undefined) data.useApiForVideo = false;
        if (data.useOpenClawForChat === undefined) data.useOpenClawForChat = true;
        if (!GCLI_BOT_ALLOWED_MODELS.includes(data.gcliBotModel)) data.gcliBotModel = GCLI_BOT_DEFAULT_MODEL;
        if (data.geminiApiKey === undefined) data.geminiApiKey = '';
        else if (data.geminiApiKey) data.geminiApiKey = '********';
        if (data.videoApiKey === undefined) data.videoApiKey = '';
        else if (data.videoApiKey) data.videoApiKey = '********';

        res.json({ success: true, data });
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

router.post('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { settings } = req.body;
        
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ success: false, message: 'Invalid settings data' });
        }

        for (const [key, value] of Object.entries(settings)) {
            if ((key === 'geminiApiKey' || key === 'videoApiKey') && value === '********') {
                continue;
            }

            if (key === 'gcliBotModel' && !GCLI_BOT_ALLOWED_MODELS.includes(value)) {
                return res.status(400).json({ success: false, message: `gcliBotModel không hợp lệ.` });
            }

            let finalValue = value;
            if (key === 'geminiApiKey' || key === 'videoApiKey') {
                finalValue = encrypt(value);
            }

            await SystemSetting.findOneAndUpdate(
                { key },
                { value: finalValue },
                { upsert: true, new: true }
            );
        }

        res.json({ success: true, message: 'Đã lưu cấu hình' });
    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

export default router;
