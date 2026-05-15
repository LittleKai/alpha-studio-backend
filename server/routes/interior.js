import express from 'express';
import mongoose from 'mongoose';
import { authMiddleware } from '../middleware/auth.js';
import InteriorProject from '../models/InteriorProject.js';
import User from '../models/User.js';
import { callGcliDirect } from '../utils/aiProvider.js';
import { cdnUrlToPresignedDownload } from '../utils/b2Storage.js';

// CDN URLs (Cloudflare in front of B2) currently 525 due to SNI mismatch on free
// plan — both AI upstream fetches and browser <img> tags fail. We replace each
// CDN URL with a presigned B2 download URL (direct to *.backblazeb2.com) when
// serializing for AI input AND when serializing project for the frontend.
// Falls back to the original URL if presigning fails or URL is not from our CDN.
async function presignImageUrls(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return [];
    return Promise.all(urls.map(async (url) => {
        try {
            const presigned = await cdnUrlToPresignedDownload(url);
            return presigned || url;
        } catch (err) {
            console.warn('[interior] presign failed, falling back to CDN URL:', err.message);
            return url;
        }
    }));
}

const router = express.Router();

const INTERIOR_AI_CREDIT_COST = 1;
const MAX_USER_PROMPT_CHARS = 8000;
const MAX_VERSIONS_PER_PROJECT = 300;

const defaultCabinetModel = () => ({
    title: 'Tủ nội thất mới',
    subtitle: 'Model khởi tạo cho Interior Design Engine',
    units: 'cm',
    width: 240,
    height: 260,
    depth: 60,
    materials: { board: '#c9986b' },
    modules: [
        {
            type: 'cabinet-zone',
            label: 'Khoang tủ chính',
            x: 0,
            y: 0,
            z: 0,
            width: 240,
            height: 260,
            depth: 60,
            color: '#c9986b',
            opacity: 0.28
        }
    ],
    details: [
        {
            type: 'back-panel',
            label: 'Hậu tủ',
            x: 0,
            y: 0,
            z: 0,
            width: 240,
            height: 260,
            depth: 1.8,
            color: '#8a623d',
            layer: 1,
            hideLabel: true
        },
        {
            type: 'left-side',
            x: 0,
            y: 0,
            z: 0,
            width: 2,
            height: 260,
            depth: 60,
            color: '#9a6b44',
            layer: 2,
            hideLabel: true
        },
        {
            type: 'right-side',
            x: 238,
            y: 0,
            z: 0,
            width: 2,
            height: 260,
            depth: 60,
            color: '#9a6b44',
            layer: 2,
            hideLabel: true
        }
    ],
    specs: [
        ['Kích thước tổng', '240 x 260 x 60 cm', 'Có thể chỉnh bằng AI chat']
    ]
});

function isUnlimited(role) {
    return role === 'admin' || role === 'mod';
}

async function serializeProject(project) {
    const raw = typeof project.toObject === 'function' ? project.toObject() : project;
    const versions = await Promise.all((raw.versions || []).map(async (version) => ({
        ...version,
        _id: version._id?.toString?.() || version._id,
        refImageUrls: await presignImageUrls(version.refImageUrls)
    })));
    return {
        ...raw,
        _id: raw._id?.toString?.() || raw._id,
        userId: raw.userId?.toString?.() || raw.userId,
        versions
    };
}

function currentVersion(project) {
    return project.versions.find((version) => version.index === project.currentVersionIndex)
        || project.versions[project.versions.length - 1];
}

function isPositiveDimension(value) {
    return Number.isFinite(value) && value > 0 && value <= 10000;
}

function validatePart(part, label) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) {
        return `${label} phải là object.`;
    }
    const required = ['x', 'y', 'z', 'width', 'height', 'depth'];
    for (const key of required) {
        if (!Number.isFinite(part[key])) return `${label}.${key} phải là số.`;
    }
    if (!isPositiveDimension(part.width) || !isPositiveDimension(part.height) || !isPositiveDimension(part.depth)) {
        return `${label} có kích thước không hợp lệ.`;
    }
    if (part.type !== undefined && typeof part.type !== 'string') return `${label}.type phải là chuỗi.`;
    if (part.label !== undefined && typeof part.label !== 'string') return `${label}.label phải là chuỗi.`;
    return null;
}

function validateCabinetModel(model) {
    if (!model || typeof model !== 'object' || Array.isArray(model)) {
        return { valid: false, message: 'cabinetModel phải là object.' };
    }
    for (const key of ['width', 'height', 'depth']) {
        if (!isPositiveDimension(model[key])) return { valid: false, message: `${key} phải là số dương hợp lệ.` };
    }
    if (!Array.isArray(model.modules) || model.modules.length === 0 || model.modules.length > 500) {
        return { valid: false, message: 'modules phải là mảng có 1-500 phần tử.' };
    }
    for (let i = 0; i < model.modules.length; i += 1) {
        const error = validatePart(model.modules[i], `modules[${i}]`);
        if (error) return { valid: false, message: error };
    }
    if (model.details !== undefined) {
        if (!Array.isArray(model.details) || model.details.length > 1000) {
            return { valid: false, message: 'details phải là mảng tối đa 1000 phần tử.' };
        }
        for (let i = 0; i < model.details.length; i += 1) {
            const error = validatePart(model.details[i], `details[${i}]`);
            if (error) return { valid: false, message: error };
        }
    }
    if (model.specs !== undefined && !Array.isArray(model.specs)) {
        return { valid: false, message: 'specs phải là mảng.' };
    }
    return { valid: true };
}

function extractJsonObject(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('AI trả về phản hồi rỗng.');
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
    try {
        return JSON.parse(candidate);
    } catch {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) throw new Error('AI không trả về JSON hợp lệ.');
        return JSON.parse(candidate.slice(start, end + 1));
    }
}

function normalizeAiPayload(raw) {
    if (raw.cabinetModel) {
        return {
            reply: typeof raw.reply === 'string' ? raw.reply : '',
            askForInfo: raw.askForInfo === true,
            cabinetModel: raw.cabinetModel
        };
    }
    return {
        reply: typeof raw.aiReply === 'string' ? raw.aiReply : '',
        askForInfo: raw.askForInfo === true,
        cabinetModel: raw.modelJson || raw.model || raw
    };
}

const INTERIOR_DOMAIN_HINTS = [
    'Quy ước thiết kế nội thất Việt Nam (cm):',
    '- Tủ áo cao thông thường 220-280, sâu 55-60. Tủ bếp dưới cao 80-86, sâu 55-60. Tủ bếp trên cao 70-90, sâu 30-35.',
    '- Ngăn treo áo dài: cao 110-130. Ngăn treo áo ngắn: 90-100. Ngăn xếp: cao 30-40. Ngăn giày: cao 20-25.',
    '- Cánh tủ chuẩn rộng 40-50 cho cánh đôi, 50-60 cho cánh đơn. Bản lề âm 35mm.',
    '- Vật liệu phổ biến: MFC vân gỗ #c9986b (sồi), #8a623d (óc chó), #d4b896 (sồi sáng), #4a3326 (đen gỗ); Acrylic bóng #ffffff, #1a1a1a, #c41e3a; Kính trắng trong #e8f0f5.',
    '- Tay nắm: dạng âm hoặc thanh ngang. Bánh xe dưới đáy tủ kéo: cao 8-10.'
].join('\n');

const INTERIOR_REPLY_FORMAT_WITH_IMAGE = [
    'reply BẮT BUỘC bắt đầu bằng 3 dòng theo đúng format này (giữ nguyên label tiếng Việt):',
    '"Quan sát ảnh: <mô tả ngắn những gì thấy trong ảnh — style, màu, vật liệu, bố cục>.',
    'Hiểu yêu cầu: <diễn giải lại ý đồ user bằng 1-2 câu>.',
    'Đã áp dụng: <liệt kê 2-4 thay đổi cụ thể trên cabinetModel — kích thước/màu/module thêm-sửa-xóa>."',
    'Sau 3 dòng đó có thể thêm chú thích thiết kế nếu cần.'
].join('\n');

const INTERIOR_REPLY_FORMAT_NO_IMAGE = [
    'reply BẮT BUỘC bắt đầu bằng 2 dòng theo đúng format này (giữ nguyên label tiếng Việt):',
    '"Hiểu yêu cầu: <diễn giải lại ý đồ user bằng 1-2 câu>.',
    'Đã áp dụng: <liệt kê 2-4 thay đổi cụ thể trên cabinetModel — kích thước/màu/module thêm-sửa-xóa>."',
    'Sau 2 dòng đó có thể thêm chú thích thiết kế nếu cần. KHÔNG bịa nội dung ảnh vì không có ảnh.'
].join('\n');

const INTERIOR_FEW_SHOT = [
    'Ví dụ output JSON HỢP LỆ (compact):',
    '{"reply":"Quan sát ảnh: tủ áo cánh trượt 2 cánh kính mờ, khung gỗ óc chó tối màu.\\nHiểu yêu cầu: muốn tủ áo 2 cánh trượt, 200 rộng, có ngăn kéo dưới.\\nĐã áp dụng: width 200, height 240, depth 60; thêm 2 cánh trượt; thêm 2 ngăn kéo dưới cao 25.","askForInfo":false,"cabinetModel":{"title":"Tủ áo cánh trượt","units":"cm","width":200,"height":240,"depth":60,"materials":{"board":"#8a623d"},"modules":[{"type":"cabinet-zone","label":"Khoang chính","x":0,"y":50,"z":0,"width":200,"height":190,"depth":60,"color":"#8a623d","opacity":0.3},{"type":"drawer-zone","label":"Ngăn kéo","x":0,"y":0,"z":0,"width":200,"height":50,"depth":60,"color":"#5c3d22","opacity":0.4}],"details":[{"type":"sliding-door","label":"Cánh trái","x":0,"y":50,"z":58,"width":100,"height":190,"depth":2,"color":"#e8f0f5"},{"type":"sliding-door","label":"Cánh phải","x":100,"y":50,"z":58,"width":100,"height":190,"depth":2,"color":"#e8f0f5"}],"specs":[["Kích thước","200 x 240 x 60 cm","Cánh trượt kính mờ"]]}}'
].join('\n');

function buildInteriorPrompt({ message, refImageUrls, project, baseModel, proposalContext = '' }) {
    const hasImages = refImageUrls.length > 0;
    const recent = project.versions
        .slice(-8)
        .filter((version) => version.userPrompt || version.aiReply)
        .map((version) => `V${version.index} USER: ${version.userPrompt || '(rollback)'}\nAI: ${version.aiReply || ''}`)
        .join('\n\n');

    const refImageNote = hasImages
        ? `Người dùng đính kèm ${refImageUrls.length} ảnh tham chiếu (đính kèm cùng prompt này — hãy quan sát kỹ trước khi sinh model).`
        : 'Lần này KHÔNG có ảnh tham chiếu — KHÔNG bịa hay đề cập ảnh trong reply.';

    const replyFormat = hasImages ? INTERIOR_REPLY_FORMAT_WITH_IMAGE : INTERIOR_REPLY_FORMAT_NO_IMAGE;

    const askForInfoRule = [
        'Đặt askForInfo=true (giữ nguyên cabinetModel hiện tại, reply là câu hỏi) NẾU:',
        hasImages ? '- Ảnh quá mờ/không liên quan/không xác định được loại tủ.' : null,
        '- Yêu cầu user dưới 5 từ và không có ảnh.',
        '- Không xác định được ít nhất 1 trong 3: kích thước, chức năng tủ (áo/bếp/sách...), vật liệu/màu.',
        'Ngược lại askForInfo=false và sinh cabinetModel.'
    ].filter(Boolean).join('\n');

    const proposalNote = proposalContext
        ? `Đã có proposal user xác nhận từ bước phân tích trước (hãy bám sát):\n${proposalContext}`
        : '';

    return [
        'Bạn là trợ lý thiết kế nội thất cho Alpha Studio (chuyên về tủ và nội thất Việt Nam).',
        'Nhiệm vụ: tạo hoặc chỉnh cabinetModel JSON cho Interior Design Engine.',
        'Chỉ trả về JSON thuần (không markdown, không ```), schema: {"reply": string, "askForInfo": boolean, "cabinetModel": object}.',
        replyFormat,
        askForInfoRule,
        'cabinetModel bắt buộc: width/height/depth số dương (cm), modules là mảng ≥1 phần tử, mỗi module/detail có x,y,z,width,height,depth là số.',
        INTERIOR_DOMAIN_HINTS,
        INTERIOR_FEW_SHOT,
        refImageNote,
        recent ? `Lịch sử gần đây:\n${recent}` : 'Chưa có lịch sử chat.',
        `cabinetModel hiện tại:\n${JSON.stringify(baseModel)}`,
        proposalNote,
        `Yêu cầu mới của người dùng:\n${message}`
    ].filter(Boolean).join('\n\n');
}

function buildInteriorProposalPrompt({ message, refImageUrls, project, baseModel }) {
    const hasImages = refImageUrls.length > 0;
    const recent = project.versions
        .slice(-6)
        .filter((version) => version.userPrompt || version.aiReply)
        .map((version) => `V${version.index} USER: ${version.userPrompt || '(rollback)'}\nAI: ${version.aiReply || ''}`)
        .join('\n\n');

    const refImageNote = hasImages
        ? `Người dùng đính kèm ${refImageUrls.length} ảnh tham chiếu (đính kèm cùng prompt này — hãy quan sát rất kỹ).`
        : 'Lần này KHÔNG có ảnh tham chiếu — bỏ qua phần phân tích ảnh.';

    const observationField = hasImages
        ? '  "observation": "string — mô tả ảnh: style, vật liệu, màu, bố cục, kích thước ước tính. Tối đa 250 từ.",'
        : '  "observation": "" (chuỗi rỗng — KHÔNG bịa nội dung ảnh vì không có ảnh),';

    return [
        'Bạn là trợ lý thiết kế nội thất cho Alpha Studio.',
        'Đây là BƯỚC PHÂN TÍCH (chưa tạo cabinetModel). Mục tiêu: giúp user review/chỉnh đề xuất + trả lời câu hỏi clarify trước khi sinh JSON ở bước sau.',
        'Trả về JSON THUẦN (không markdown ```, không text ngoài JSON) theo schema:',
        '{',
        observationField,
        '  "understanding": "string — diễn giải lại ý đồ user bằng 2-3 câu. Tối đa 100 từ.",',
        '  "proposedChanges": ["string", ...] — mảng 3-6 thay đổi cụ thể trên cabinetModel hiện tại (kích thước W x H x D, màu HEX, module thêm/sửa/xóa). Mỗi item một câu ngắn.,',
        '  "questions": [ { "question": "string", "options": ["string", ...] } , ... ]',
        '}',
        '- questions: 0-3 câu hỏi để clarify. CHỈ hỏi khi thật sự cần (kích thước cụ thể, vật liệu, vị trí, số ngăn...). Mỗi câu có 2-4 options gợi ý, NÊN có 1 option "Để AI tự quyết" hoặc tương tự. Nếu không cần hỏi → questions: [].',
        '- Tất cả text phải bằng tiếng Việt.',
        '- KHÔNG sinh cabinetModel ở bước này.',
        INTERIOR_DOMAIN_HINTS,
        refImageNote,
        recent ? `Lịch sử gần đây:\n${recent}` : 'Chưa có lịch sử chat.',
        `cabinetModel hiện tại:\n${JSON.stringify(baseModel)}`,
        `Yêu cầu mới của người dùng:\n${message}`
    ].join('\n\n');
}

function validateProposalPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const observation = typeof raw.observation === 'string' ? raw.observation.trim().slice(0, 4000) : '';
    const understanding = typeof raw.understanding === 'string' ? raw.understanding.trim().slice(0, 2000) : '';
    const proposedChanges = Array.isArray(raw.proposedChanges)
        ? raw.proposedChanges
            .filter((s) => typeof s === 'string' && s.trim())
            .map((s) => s.trim().slice(0, 500))
            .slice(0, 10)
        : [];
    const questions = Array.isArray(raw.questions)
        ? raw.questions
            .map((q) => {
                if (!q || typeof q !== 'object') return null;
                const question = typeof q.question === 'string' ? q.question.trim().slice(0, 400) : '';
                if (!question) return null;
                const options = Array.isArray(q.options)
                    ? q.options
                        .filter((o) => typeof o === 'string' && o.trim())
                        .map((o) => o.trim().slice(0, 200))
                        .slice(0, 6)
                    : [];
                return { question, options };
            })
            .filter(Boolean)
            .slice(0, 5)
        : [];
    if (!observation && !understanding && proposedChanges.length === 0) return null;
    return { observation, understanding, proposedChanges, questions };
}

function assembleProposalText(structured) {
    if (!structured) return '';
    const lines = [];
    if (structured.observation) lines.push(`Quan sát ảnh: ${structured.observation}`);
    if (structured.understanding) lines.push(`Hiểu yêu cầu: ${structured.understanding}`);
    if (structured.proposedChanges?.length) {
        lines.push('Đề xuất thay đổi:');
        structured.proposedChanges.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
    }
    if (structured.questions?.length) {
        lines.push('Câu hỏi xác nhận:');
        structured.questions.forEach((q, i) => {
            lines.push(`Q${i + 1}: ${q.question}`);
            if (q.options.length) lines.push(`   Options: ${q.options.join(' / ')}`);
        });
    }
    return lines.join('\n');
}

async function findOwnedProject(projectId, userId) {
    if (!mongoose.Types.ObjectId.isValid(projectId)) return null;
    return InteriorProject.findOne({ _id: projectId, userId, isDeleted: false });
}

async function deductInteriorCredit(user) {
    if (isUnlimited(user.role)) return { charged: false, balance: user.balance ?? 0 };
    const updated = await User.findOneAndUpdate(
        { _id: user._id, balance: { $gte: INTERIOR_AI_CREDIT_COST } },
        { $inc: { balance: -INTERIOR_AI_CREDIT_COST } },
        { new: true }
    ).select('balance');
    if (!updated) return { charged: false, rejected: true, balance: user.balance ?? 0 };
    return { charged: true, balance: updated.balance };
}

router.get('/projects', authMiddleware, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const query = { userId: req.user._id, isDeleted: false };
        const [projects, total] = await Promise.all([
            InteriorProject.find(query).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            InteriorProject.countDocuments(query)
        ]);
        return res.json({
            success: true,
            data: {
                projects: await Promise.all(projects.map(serializeProject)),
                pagination: { page, limit, total, pages: Math.ceil(total / limit) }
            }
        });
    } catch (error) {
        console.error('Interior list projects error:', error);
        return res.status(500).json({ success: false, message: 'Không thể tải danh sách dự án.' });
    }
});

router.post('/projects', authMiddleware, async (req, res) => {
    try {
        const name = typeof req.body?.name === 'string' && req.body.name.trim()
            ? req.body.name.trim().slice(0, 120)
            : 'Dự án nội thất mới';
        const modelJson = defaultCabinetModel();
        const project = await InteriorProject.create({
            userId: req.user._id,
            name,
            currentVersionIndex: 0,
            versions: [{
                index: 0,
                parentIndex: null,
                userPrompt: '',
                modelJson,
                aiReply: 'Model khởi tạo.',
                askForInfo: false
            }]
        });
        return res.status(201).json({ success: true, data: { project: await serializeProject(project) } });
    } catch (error) {
        console.error('Interior create project error:', error);
        return res.status(500).json({ success: false, message: 'Không thể tạo dự án.' });
    }
});

router.get('/projects/:id', authMiddleware, async (req, res) => {
    try {
        const project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'Không tìm thấy dự án.' });
        return res.json({ success: true, data: { project: await serializeProject(project) } });
    } catch (error) {
        console.error('Interior get project error:', error);
        return res.status(500).json({ success: false, message: 'Không thể tải dự án.' });
    }
});

router.patch('/projects/:id', authMiddleware, async (req, res) => {
    try {
        const project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'Không tìm thấy dự án.' });
        if (typeof req.body?.name === 'string') {
            const name = req.body.name.trim();
            if (!name) return res.status(400).json({ success: false, message: 'Tên dự án không hợp lệ.' });
            project.name = name.slice(0, 120);
        }
        await project.save();
        return res.json({ success: true, data: { project: await serializeProject(project) } });
    } catch (error) {
        console.error('Interior update project error:', error);
        return res.status(500).json({ success: false, message: 'Không thể cập nhật dự án.' });
    }
});

router.delete('/projects/:id', authMiddleware, async (req, res) => {
    try {
        const project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'Không tìm thấy dự án.' });
        project.isDeleted = true;
        await project.save();
        return res.json({ success: true, data: { deleted: true } });
    } catch (error) {
        console.error('Interior delete project error:', error);
        return res.status(500).json({ success: false, message: 'Không thể xóa dự án.' });
    }
});

const INTERIOR_ALLOWED_MODELS = ['gemini-3-flash-preview', 'gemini-3.1-pro-preview'];
const INTERIOR_DEFAULT_MODEL = 'gemini-3-flash-preview';

router.post('/projects/:id/chat', authMiddleware, async (req, res) => {
    try {
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const rawRefImageUrls = Array.isArray(req.body?.refImageUrls)
            ? req.body.refImageUrls
            : (typeof req.body?.refImageUrl === 'string' ? [req.body.refImageUrl] : []);
        const refImageUrls = rawRefImageUrls
            .filter((u) => typeof u === 'string' && u.trim())
            .map((u) => u.trim())
            .slice(0, 5);
        const expectedCurrentVersionIndex = Number.isInteger(req.body?.expectedCurrentVersionIndex)
            ? req.body.expectedCurrentVersionIndex
            : null;
        const requestedModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
        const selectedModel = INTERIOR_ALLOWED_MODELS.includes(requestedModel)
            ? requestedModel
            : INTERIOR_DEFAULT_MODEL;
        const stage = req.body?.stage === 'proposal' ? 'proposal' : 'apply';
        const proposalContext = typeof req.body?.proposalText === 'string'
            ? req.body.proposalText.trim().slice(0, 4000)
            : '';

        if (!message) return res.status(400).json({ success: false, message: 'Vui lòng nhập yêu cầu thiết kế.' });
        if (message.length > MAX_USER_PROMPT_CHARS) {
            return res.status(400).json({ success: false, message: `Yêu cầu quá dài, tối đa ${MAX_USER_PROMPT_CHARS} ký tự.` });
        }
        if (!isUnlimited(req.user.role) && (req.user.balance || 0) < INTERIOR_AI_CREDIT_COST) {
            return res.status(402).json({
                success: false,
                message: `Cần ${INTERIOR_AI_CREDIT_COST} credit để gọi AI, hiện có ${req.user.balance || 0}.`,
                data: { cost: INTERIOR_AI_CREDIT_COST, balance: req.user.balance || 0 }
            });
        }

        const project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'Không tìm thấy dự án.' });
        if (project.versions.length >= MAX_VERSIONS_PER_PROJECT) {
            return res.status(409).json({ success: false, message: 'Dự án đã đạt giới hạn phiên bản.' });
        }
        if (expectedCurrentVersionIndex !== null && project.currentVersionIndex !== expectedCurrentVersionIndex) {
            return res.status(409).json({
                success: false,
                message: 'Dự án đã có phiên bản mới hơn. Vui lòng tải lại trước khi gửi.',
                data: { project: await serializeProject(project) }
            });
        }

        const baseVersion = currentVersion(project);
        const baseModel = baseVersion?.modelJson || defaultCabinetModel();

        // ─── STAGE: PROPOSAL ──────────────────────────────────────────
        // Bước phân tích: AI trả JSON structured {observation, understanding, proposedChanges[], questions[]}.
        // Frontend mở dialog cho user review/chỉnh + trả lời câu hỏi.
        // Trừ 1 credit (user đã bật 2-step và biết sẽ tốn 2 credit tổng).
        if (stage === 'proposal') {
            const aiImageUrls = await presignImageUrls(refImageUrls);
            let aiText;
            let proposalUsage = null;
            let proposalModel = selectedModel;
            try {
                const aiResult = await callGcliDirect(
                    buildInteriorProposalPrompt({ message, refImageUrls, project, baseModel }),
                    { model: selectedModel, images: aiImageUrls }
                );
                aiText = (aiResult.text || '').trim();
                proposalUsage = aiResult.usage;
                proposalModel = aiResult.model || selectedModel;
            } catch (error) {
                console.error('Interior AI proposal error:', error.message);
                return res.status(502).json({ success: false, message: error.message || 'AI tạm thời không phản hồi.' });
            }
            if (!aiText) {
                return res.status(502).json({ success: false, message: 'AI không trả về phân tích.' });
            }

            let structured;
            try {
                structured = validateProposalPayload(extractJsonObject(aiText));
            } catch (error) {
                console.error('Interior proposal JSON parse error:', error.message, aiText);
                return res.status(502).json({ success: false, message: 'AI không trả về phân tích đúng định dạng.' });
            }
            if (!structured) {
                return res.status(502).json({ success: false, message: 'AI không trả về phân tích đúng định dạng.' });
            }

            const credit = await deductInteriorCredit(req.user);
            if (credit.rejected) {
                return res.status(402).json({
                    success: false,
                    message: `Cần ${INTERIOR_AI_CREDIT_COST} credit để gọi AI, hiện có ${credit.balance}.`,
                    data: { cost: INTERIOR_AI_CREDIT_COST, balance: credit.balance }
                });
            }
            return res.json({
                success: true,
                data: {
                    stage: 'proposal',
                    proposalText: assembleProposalText(structured),
                    structured,
                    refImageUrls,
                    message,
                    aiModel: proposalModel,
                    usage: proposalUsage,
                    cost: isUnlimited(req.user.role) ? 0 : INTERIOR_AI_CREDIT_COST,
                    balance: credit.balance
                }
            });
        }

        // ─── STAGE: APPLY (default) ───────────────────────────────────
        const aiImageUrls = await presignImageUrls(refImageUrls);
        let aiText;
        let aiUsage = null;
        let actualModel = selectedModel;
        try {
            // Interior tool LUÔN gọi gcli trực tiếp (callGcliDirect = gcli.ggchan.dev upstream).
            // Mỗi turn đã embed full chat history + model JSON nên không cần OpenClaw session memory.
            // Nếu user bật 2-step, proposalContext được truyền vào để AI bám sát đề xuất đã xác nhận.
            const aiResult = await callGcliDirect(
                buildInteriorPrompt({ message, refImageUrls, project, baseModel, proposalContext }),
                { model: selectedModel, images: aiImageUrls }
            );
            aiText = aiResult.text;
            aiUsage = aiResult.usage;
            actualModel = aiResult.model || selectedModel;
        } catch (error) {
            console.error('Interior AI provider error:', error.message);
            return res.status(502).json({ success: false, message: error.message || 'AI tạm thời không phản hồi.' });
        }

        let payload;
        try {
            payload = normalizeAiPayload(extractJsonObject(aiText));
        } catch (error) {
            console.error('Interior AI JSON parse error:', error.message, aiText);
            return res.status(502).json({ success: false, message: 'AI không trả về JSON hợp lệ.' });
        }

        const validation = validateCabinetModel(payload.cabinetModel);
        if (!validation.valid) {
            return res.status(502).json({ success: false, message: `AI trả về model không hợp lệ: ${validation.message}` });
        }

        const credit = await deductInteriorCredit(req.user);
        if (credit.rejected) {
            return res.status(402).json({
                success: false,
                message: `Cần ${INTERIOR_AI_CREDIT_COST} credit để gọi AI, hiện có ${credit.balance}.`,
                data: { cost: INTERIOR_AI_CREDIT_COST, balance: credit.balance }
            });
        }

        // Git-like branching: nếu user đã rollback (currentVersionIndex < max),
        // thì truncate các version "future" trước khi push để giữ chuỗi linear.
        const currentIdx = project.currentVersionIndex;
        if (project.versions.some((v) => v.index > currentIdx)) {
            project.versions = project.versions.filter((v) => v.index <= currentIdx);
        }
        const nextIndex = project.versions.length > 0
            ? Math.max(...project.versions.map((version) => version.index)) + 1
            : 0;
        project.versions.push({
            index: nextIndex,
            parentIndex: project.currentVersionIndex,
            userPrompt: message,
            refImageUrls,
            modelJson: payload.cabinetModel,
            aiReply: payload.reply || 'Đã cập nhật model thiết kế.',
            askForInfo: payload.askForInfo === true,
            aiModel: actualModel,
            usage: aiUsage,
            proposalText: proposalContext || undefined
        });
        project.currentVersionIndex = nextIndex;
        await project.save();

        const serialized = await serializeProject(project);
        return res.json({
            success: true,
            data: {
                stage: 'apply',
                project: serialized,
                version: serialized.versions.find((version) => version.index === nextIndex),
                cost: isUnlimited(req.user.role) ? 0 : INTERIOR_AI_CREDIT_COST,
                balance: credit.balance
            }
        });
    } catch (error) {
        console.error('Interior chat error:', error);
        return res.status(500).json({ success: false, message: 'Không thể xử lý yêu cầu thiết kế.' });
    }
});

router.post('/projects/:id/rollback', authMiddleware, async (req, res) => {
    try {
        const project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'Không tìm thấy dự án.' });

        const targetVersionId = typeof req.body?.targetVersionId === 'string' ? req.body.targetVersionId : '';
        const targetVersionIndex = Number.isInteger(req.body?.targetVersionIndex) ? req.body.targetVersionIndex : null;
        const target = project.versions.find((version) => (
            (targetVersionId && version._id?.toString() === targetVersionId)
            || (targetVersionIndex !== null && version.index === targetVersionIndex)
        ));
        if (!target) return res.status(404).json({ success: false, message: 'Không tìm thấy phiên bản cần khôi phục.' });

        // Git-like rollback: chỉ di chuyển con trỏ currentVersionIndex về target.
        // Versions sau target vẫn được giữ — frontend filter chat theo currentVersionIndex.
        // Nếu user gửi prompt mới sau rollback, route /chat sẽ truncate versions > currentVersionIndex.
        project.currentVersionIndex = target.index;
        await project.save();
        return res.json({ success: true, data: { project: await serializeProject(project) } });
    } catch (error) {
        console.error('Interior rollback error:', error);
        return res.status(500).json({ success: false, message: 'Không thể khôi phục phiên bản.' });
    }
});

export default router;
