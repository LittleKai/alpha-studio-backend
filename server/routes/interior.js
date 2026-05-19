import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { interiorQuotaCheck, commitInteriorQuota } from '../middleware/interiorQuota.js';
import InteriorProject from '../models/InteriorProject.js';
import InteriorAnalysis from '../models/InteriorAnalysis.js';
import InteriorRender from '../models/InteriorRender.js';
import InteriorAiLog from '../models/InteriorAiLog.js';
import InteriorAgentLog from '../models/InteriorAgentLog.js';
import InteriorTemplate from '../models/InteriorTemplate.js';
import User from '../models/User.js';
import { validateTemplateStructure, extractDsl } from '../utils/templateValidator.js';
import { ToolRegistry } from '../agent-runner/tool-registry.js';
import { SkillLoader } from '../agent-runner/skill-loader.js';
import { runAgentLoop } from '../agent-runner/runner.js';
import { closeSse, setSseHeaders, writeEvent } from '../agent-runner/sse.js';
import { registerInteriorTools } from '../tools/interior/index.js';

const AI_LOG_MAX_FIELD = 64 * 1024;

function truncateForLog(value) {
    if (typeof value !== 'string') return '';
    return value.length > AI_LOG_MAX_FIELD ? `${value.slice(0, AI_LOG_MAX_FIELD)}…[truncated]` : value;
}

async function recordInteriorAiLog(entry) {
    try {
        await InteriorAiLog.create({
            ...entry,
            prompt: truncateForLog(entry.prompt),
            rawResponse: truncateForLog(entry.rawResponse),
            parsedReply: truncateForLog(entry.parsedReply),
            errorMessage: truncateForLog(entry.errorMessage)
        });
    } catch (err) {
        console.warn('[interior:log] failed to persist AI log:', err.message);
    }
}
import { callGcliDirect } from '../utils/aiProvider.js';
import { cdnUrlToPresignedDownload, uploadFile } from '../utils/b2Storage.js';

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
const INTERIOR_AGENT_CREDIT_COST = 2;
const MAX_USER_PROMPT_CHARS = 8000;
const MAX_VERSIONS_PER_PROJECT = 300;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INTERIOR_SKILLS_DIR = path.resolve(__dirname, '../../../tools/interior-design-engine/skills');
const interiorRegistry = new ToolRegistry();
const interiorSkills = new SkillLoader(INTERIOR_SKILLS_DIR);
await interiorSkills.init();
registerInteriorTools(interiorRegistry, interiorSkills);
console.log(`Interior agent ready: ${interiorRegistry.list().length} tools, ${interiorSkills.list().length} skills`);

const defaultCabinetModel = () => ({
    title: 'Tủ nội thất mới',
    subtitle: 'Model khởi tạo cho Interior Design Engine',
    units: 'cm',
    width: 240,
    height: 260,
    depth: 60,
    palette: 'wood-oak',
    modules: [
        {
            tpl: 'sliding-2door',
            x: 0,
            y: 0,
            z: 0,
            width: 240,
            height: 260,
            depth: 60,
            style: { door: 'flat', handle: 'finger-pull' }
        }
    ],
    inlineTemplates: {},
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
    const required = part.tpl ? ['x', 'y', 'z'] : ['x', 'y', 'z', 'width', 'height', 'depth'];
    for (const key of required) {
        if (!Number.isFinite(part[key])) return `${label}.${key} phải là số.`;
    }
    if (part.width !== undefined && !isPositiveDimension(part.width)) return `${label}.width có kích thước không hợp lệ.`;
    if (part.height !== undefined && !isPositiveDimension(part.height)) return `${label}.height có kích thước không hợp lệ.`;
    if (part.depth !== undefined && !isPositiveDimension(part.depth)) return `${label}.depth có kích thước không hợp lệ.`;
    if (!part.tpl && (!isPositiveDimension(part.width) || !isPositiveDimension(part.height) || !isPositiveDimension(part.depth))) {
        return `${label} có kích thước không hợp lệ.`;
    }
    if (part.type !== undefined && typeof part.type !== 'string') return `${label}.type phải là chuỗi.`;
    if (part.label !== undefined && typeof part.label !== 'string') return `${label}.label phải là chuỗi.`;
    if (part.tpl !== undefined && typeof part.tpl !== 'string') return `${label}.tpl phải là chuỗi.`;
    if (part.style !== undefined && (typeof part.style !== 'object' || Array.isArray(part.style))) return `${label}.style phải là object.`;
    return null;
}

function validateRun(run, index) {
    const label = `runs[${index}]`;
    if (!run || typeof run !== 'object' || Array.isArray(run)) return `${label} phải là object.`;
    if (!run.origin || typeof run.origin !== 'object' || Array.isArray(run.origin)) return `${label}.origin phải là object.`;
    if (!Number.isFinite(run.origin.x) || !Number.isFinite(run.origin.z)) return `${label}.origin.x/z phải là số.`;
    if (!['east', 'north', 'west', 'south'].includes(run.direction)) return `${label}.direction không hợp lệ.`;
    if (!Array.isArray(run.modules) || run.modules.length === 0 || run.modules.length > 500) {
        return `${label}.modules phải là mảng có 1-500 phần tử.`;
    }
    for (let i = 0; i < run.modules.length; i += 1) {
        const error = validatePart(run.modules[i], `${label}.modules[${i}]`);
        if (error) return error;
    }
    return null;
}

// Phase 12: When AI emits a module with `tplNew` (an inline template DSL), move
// the DSL into modelJson.inlineTemplates[id] and replace the module's tplNew
// with `tpl: id` so the engine resolves it through the inline registry. If the
// DSL fails validation, drop tplNew and let the engine fall back to legacy box
// rendering — we don't crash the whole chat turn for one bad template.
function extractInlineTemplates(cabinetModel) {
    if (!cabinetModel || typeof cabinetModel !== 'object') return { cabinetModel, newInlineIds: [], droppedTemplates: [] };
    const inlineDict = (cabinetModel.inlineTemplates && typeof cabinetModel.inlineTemplates === 'object' && !Array.isArray(cabinetModel.inlineTemplates))
        ? { ...cabinetModel.inlineTemplates }
        : {};
    const newInlineIds = [];
    const droppedTemplates = [];

    function assignId(rawId) {
        const safe = typeof rawId === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(rawId) ? rawId : null;
        const base = safe || `ai-gen-${crypto.randomBytes(3).toString('hex')}`;
        let candidate = base;
        let n = 2;
        while (inlineDict[candidate]) {
            candidate = `${base}-${n}`;
            n += 1;
            if (n > 50) return `ai-gen-${crypto.randomBytes(4).toString('hex')}`;
        }
        return candidate;
    }

    function processModule(module) {
        if (!module || typeof module !== 'object') return;
        if (!module.tplNew) return;
        const tplDsl = module.tplNew;
        const candidate = {
            id: assignId(tplDsl?.id),
            category: tplDsl?.category || 'other',
            params: tplDsl?.params || {},
            dsl: extractDsl(tplDsl)
        };
        const validation = validateTemplateStructure(candidate);
        if (!validation.valid) {
            console.warn('[interior:chat] tplNew rejected, fallback to box:', validation.message);
            droppedTemplates.push({
                id: typeof tplDsl?.id === 'string' ? tplDsl.id : '(unnamed)',
                category: tplDsl?.category || '(missing)',
                reason: validation.message || 'unknown'
            });
            delete module.tplNew;
            return;
        }
        inlineDict[candidate.id] = {
            id: candidate.id,
            version: typeof tplDsl.version === 'number' ? tplDsl.version : 1,
            category: candidate.category,
            tags: Array.isArray(tplDsl.tags) ? tplDsl.tags.slice(0, 20) : [],
            description: tplDsl.description || { vi: '', en: '' },
            name: tplDsl.name || tplDsl.description || { vi: candidate.id, en: candidate.id },
            params: candidate.params,
            style: tplDsl.style && typeof tplDsl.style === 'object' && !Array.isArray(tplDsl.style) ? tplDsl.style : {},
            ...candidate.dsl
        };
        delete module.tplNew;
        module.tpl = candidate.id;
        newInlineIds.push(candidate.id);
    }

    (cabinetModel.modules || []).forEach(processModule);
    (cabinetModel.runs || []).forEach((run) => (run.modules || []).forEach(processModule));
    (cabinetModel.details || []).forEach(processModule);

    cabinetModel.inlineTemplates = inlineDict;
    return { cabinetModel, newInlineIds, droppedTemplates };
}

function validateCabinetModel(model) {
    if (!model || typeof model !== 'object' || Array.isArray(model)) {
        return { valid: false, message: 'cabinetModel phải là object.' };
    }
    for (const key of ['width', 'height', 'depth']) {
        if (!isPositiveDimension(model[key])) return { valid: false, message: `${key} phải là số dương hợp lệ.` };
    }
    if (model.palette !== undefined && typeof model.palette !== 'string') {
        return { valid: false, message: 'palette phải là chuỗi.' };
    }
    if (model.inlineTemplates !== undefined && (typeof model.inlineTemplates !== 'object' || Array.isArray(model.inlineTemplates))) {
        return { valid: false, message: 'inlineTemplates phải là object.' };
    }
    const hasModules = Array.isArray(model.modules) && model.modules.length > 0;
    const hasRuns = Array.isArray(model.runs) && model.runs.length > 0;
    if (hasModules && hasRuns) {
        return { valid: false, message: 'Chỉ dùng một trong hai schema: modules hoặc runs, không dùng cả hai.' };
    }
    if (!hasModules && !hasRuns) {
        return { valid: false, message: 'Cần có modules hoặc runs.' };
    }
    if (hasModules) {
        if (model.modules.length > 500) return { valid: false, message: 'modules phải là mảng có 1-500 phần tử.' };
        for (let i = 0; i < model.modules.length; i += 1) {
            const error = validatePart(model.modules[i], `modules[${i}]`);
            if (error) return { valid: false, message: error };
        }
    }
    if (hasRuns) {
        if (model.runs.length > 20) return { valid: false, message: 'runs tối đa 20 phần tử.' };
        for (let i = 0; i < model.runs.length; i += 1) {
            const error = validateRun(model.runs[i], i);
            if (error) return { valid: false, message: error };
        }
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

function stripJsonComments(input) {
    let output = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        const next = input[i + 1];
        if (inString) {
            output += ch;
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            output += ch;
            continue;
        }
        if (ch === '/' && next === '/') {
            while (i < input.length && input[i] !== '\n') i += 1;
            output += '\n';
            continue;
        }
        if (ch === '/' && next === '*') {
            i += 2;
            while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
            i += 1;
            continue;
        }
        output += ch;
    }
    return output;
}

function sliceBalancedJson(input) {
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') {
            if (start === -1) start = i;
            depth += 1;
        } else if (ch === '}' && start !== -1) {
            depth -= 1;
            if (depth === 0) return input.slice(start, i + 1);
        }
    }
    return null;
}

function extractJsonBlock(rawText) {
    let cleaned = String(rawText || '').replace(/^\uFEFF/, '').trim();
    if (!cleaned) return null;
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    const balanced = sliceBalancedJson(cleaned);
    if (!balanced) return null;
    cleaned = stripJsonComments(balanced).trim();
    console.debug('[interior:json] extract', {
        rawLength: String(rawText || '').length,
        cleanedLength: cleaned.length,
        fenced: !!fenceMatch
    });
    try {
        return JSON.parse(cleaned);
    } catch {
        return null;
    }
}

function extractJsonObject(text) {
    const parsed = extractJsonBlock(text);
    if (!parsed) {
        if (!String(text || '').trim()) throw new Error('AI trả về phản hồi rỗng.');
        throw new Error('AI không trả về JSON hợp lệ.');
    }
    return parsed;
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
    '- Tay nắm: dạng âm hoặc thanh ngang. Bánh xe dưới đáy tủ kéo: cao 8-10.',
    'Toạ độ Z (trục depth): mặt sau tủ ở z=0, mặt trước ở z=depth. Tủ áp tường: mặt sau (z=0) là tường, mặt trước nhìn ra phòng.',
    'Tủ bếp ĐÔI (tủ trên + tủ dưới) cùng áp 1 tường: tủ dưới depth 55-60 đặt z=0; tủ trên depth 30-35 PHẢI đặt z = (depth_tủ_dưới - depth_tủ_trên) để mặt sau cùng đường tường. VD: tủ dưới depth 60, tủ trên depth 35 -> tủ trên z=25. KHÔNG đặt z=0 cho cả 2 vì mặt trước sẽ chồng vào nhau.',
    'Tủ áo nguyên khối: tất cả module cùng z=0, depth đồng nhất. Khoang treo/khoang kéo chỉ khác y (chiều cao) và x (vị trí ngang), không khác z.'
].join('\n');

const INTERIOR_RUNS_RULE_VI = [
    'BỐ CỤC L/U/ĐẢO/SONG SONG: Nếu user mô tả tủ chữ L, U, đảo bếp, hoặc bố cục song song, BẮT BUỘC output dùng top-level `runs:[{id, origin:{x,z}, direction:"east|north|west|south", modules:[...]}]` THAY VÌ `modules[]` ở root.',
    '- Mỗi run là một đoạn thẳng theo 1 hướng. Tủ chữ L = 2 runs (vd. run1 east + run2 north), tủ chữ U = 3 runs, đảo bếp = 1 run + 1 run riêng cho island.',
    '- `origin` là điểm gốc (góc của run đó) trong hệ tọa độ tủ tổng. Run east bắt đầu từ origin và mở rộng theo trục +x; run north theo -z; run west theo -x; run south theo +z.',
    '- TỌA ĐỘ MODULE TRONG RUN (QUAN TRỌNG): `x` là vị trí TUYỆT ĐỐI dọc theo trục đi của run, tính từ origin. KHÔNG phải offset. Module đầu run đặt `x=0`; module thứ 2 đặt `x = width của module 1`; module thứ 3 đặt `x = sum width 2 module trước`; v.v. Modules CHỒNG (stack) lên nhau ở cùng vị trí dùng cùng `x` nhưng khác `y` (chiều cao).',
    '- `y` là cao mặt đáy module so với mặt nền (cm). `z` là offset depth từ tường (tủ trên depth khác tủ dưới → z khác 0 để cùng mặt sau, xem hint Z).',
    '- `width` là chiều dài module DỌC trục run (đông/tây dùng width là theo trục X tổng; bắc/nam dùng width là theo trục Z tổng). `depth` là độ sâu (vuông góc tường).',
    '- KHÔNG dùng đồng thời `modules` ở root VÀ `runs` - chọn 1. Bố cục thẳng: dùng `modules`. Bố cục có khúc: PHẢI dùng `runs`.',
    '- Ví dụ tủ chữ L 500cm × 100cm, main run (east): 3 module liên tiếp với x=0/w=60, x=60/w=80, x=140/w=360 (tổng = 500). Module stack (vd tủ trên đặt trên fridge) dùng cùng x=60 nhưng y khác (y=190 thay vì y=0).'
].join('\n');

const INTERIOR_DIMENSION_ANCHOR_RULE_VI = [
    'QUY TẮC KÍCH THƯỚC (TUYỆT ĐỐI):',
    '- Nếu user nêu kích thước (vd. "5 mét", "260cm", "rộng 3m") -> cabinetModel.width / height / depth PHẢI ĐÚNG con số đó tính ra cm.',
    '- "5 mét" = 500. "2.6 mét" hoặc "2m6" = 260. "60 phân" = 60.',
    '- KHÔNG nhân đôi, KHÔNG chia, KHÔNG làm tròn lên 1000.',
    '- Reply text PHẢI khớp giá trị JSON: nếu reply nói "width 500" thì cabinetModel.width = 500, không phải 1000.'
].join('\n');

const INTERIOR_CATALOG_VI = `
DANH MỤC TEMPLATE (ƯU TIÊN dùng các template này thay vì tạo box thô):

| id | category | tags | params bounds | style options | mô tả |
|---|---|---|---|---|---|
| upper-2door | upper-cabinet | shaker, bar-handle | w:40-200, h:50-130, d:30-70 | door: shaker\\|flat; handle: bar\\|knob | Tủ trên 2 cánh shaker, tay nắm dọc |
| upper-glass-2door | upper-cabinet | glass, frame | w:40-200, h:50-130, d:30-70 | handle: bar\\|knob | Tủ trên 2 cánh kính sương |
| sliding-2door | wardrobe | sliding, finger-pull | w:100-300, h:150-260, d:55-65 | door: flat; track: top-bottom | Tủ áo cửa kéo 2 cánh + ray trên dưới + finger pull |
| sliding-3door | wardrobe | sliding | w:150-400, h:150-260, d:55-65 | door: flat | Tủ áo cửa kéo 3 cánh |
| ac-recess-fold | upper-cabinet | ac, fold-down | w:60-130, h:80-130, d:50-65 | (none) | Hốc máy lạnh phía trên + cánh lật dưới |
| open-bookshelf | shelf | open, bookshelf | w:80-200, h:40-120, d:25-40 | shelves: 1\\|2\\|3 | Kệ mở 1-3 ngăn (sách, đồ trưng bày) |
| l-desk-return | desk | L-shape, working | w:80-200, d:50-65 | (none) | Bàn làm việc chữ L với main + L return |

QUY TẮC:
1. Mỗi cabinet trong design: tìm template phù hợp NHẤT theo category + tags + size bounds.
2. Output module: { tpl: '<id>', x, y, z, width, height, depth, style: { door: 'shaker', handle: 'bar' } }.
3. KHÔNG match → có thể TẠO MỚI bằng "tplNew" (chỉ khi thật sự khác catalog, ưu tiên reuse trước):
   { tplNew: { id: '<kebab-case mới>', version: 1, category: '<MỘT TRONG: upper-cabinet, lower-cabinet, wardrobe, shelf, desk, void, other, base-cabinet, wall-cabinet, tall-cabinet, drawer-base, corner-cabinet, island, kitchen-other>', tags: [...], description: { vi, en }, params: { width:{min,max,default}, height:{...}, depth:{...} }, style: { door:{values:[...],default:''} }, frontSvg: [...], sideSvg: [...], planSvg: [...], isoBoxes: [...] }, x, y, z, width, height, depth, style: {...} }
   QUAN TRỌNG: category PHẢI nằm trong danh sách cố định trên. Nếu chọn sai (vd "kitchen-cabinet"), backend sẽ REJECT tplNew và module rớt về raw box xấu. Tủ bếp dưới = base-cabinet; tủ bếp trên = wall-cabinet; tủ đứng cao (pantry/tủ lạnh tower) = tall-cabinet; ngăn kéo nhiều tầng = drawer-base; tủ góc = corner-cabinet; đảo bếp = island.
   DSL grammar:
   - frontSvg/sideSvg/planSvg shape: { type: 'rect'|'line'|'text', x, y, w, h, fill, stroke, sw, rx, opacity, if } HOẶC { rect: {...} } wrapper.
   - isoBoxes item: { x, y, z, w, h, d, faces: { top, front, right, left, back, bottom } }.
   - Trường số có thể là number HOẶC chuỗi "{{ expr }}" với expr = arithmetic (+ - * / %) + so sánh (== != < <= > >=) + min/max/round/abs + identifier (params.X, style.X, $colorToken: $cab, $woodFront, $handle...).
   - Trường color: "#hex" hoặc "$tokenName". CẤM dùng eval/Function/new/[]/=> trong expression.
   - Optional "if": "{{ expr }}" để bỏ qua shape khi false.
4. Vẫn cho phép legacy box (không có tpl/tplNew) khi cần — dùng materialRef + color như cũ.
`.trim();

const INTERIOR_CATALOG_EN = `
TEMPLATE CATALOG (prefer these templates instead of raw boxes):

| id | category | tags | params bounds | style options | description |
|---|---|---|---|---|---|
| upper-2door | upper-cabinet | shaker, bar-handle | w:40-200, h:50-130, d:30-70 | door: shaker\\|flat; handle: bar\\|knob | 2-door shaker upper cabinet |
| upper-glass-2door | upper-cabinet | glass, frame | w:40-200, h:50-130, d:30-70 | handle: bar\\|knob | 2-door frosted glass upper cabinet |
| sliding-2door | wardrobe | sliding, finger-pull | w:100-300, h:150-260, d:55-65 | door: flat; track: top-bottom | 2-door sliding wardrobe with tracks and finger pulls |
| sliding-3door | wardrobe | sliding | w:150-400, h:150-260, d:55-65 | door: flat | 3-door sliding wardrobe |
| ac-recess-fold | upper-cabinet | ac, fold-down | w:60-130, h:80-130, d:50-65 | (none) | AC recess with lower fold-down door |
| open-bookshelf | shelf | open, bookshelf | w:80-200, h:40-120, d:25-40 | shelves: 1\\|2\\|3 | Open shelf with books/display objects |
| l-desk-return | desk | L-shape, working | w:80-200, d:50-65 | (none) | L-shaped desk with return |

RULES:
1. For each cabinet, choose the best matching template by category + tags + size bounds.
2. Output module: { tpl: '<id>', x, y, z, width, height, depth, style: { door: 'shaker', handle: 'bar' } }.
3. No match → you may create one via "tplNew" (only when truly different — prefer catalog first):
   { tplNew: { id: '<new kebab-case>', version: 1, category: '<ONE OF: upper-cabinet, lower-cabinet, wardrobe, shelf, desk, void, other, base-cabinet, wall-cabinet, tall-cabinet, drawer-base, corner-cabinet, island, kitchen-other>', tags: [...], description: { vi, en }, params: { width:{min,max,default}, height:{...}, depth:{...} }, style: {...}, frontSvg: [...], sideSvg: [...], planSvg: [...], isoBoxes: [...] }, x, y, z, width, height, depth, style: {...} }
   IMPORTANT: category MUST be in the fixed list above. Wrong category ("kitchen-cabinet" etc.) → backend REJECTS tplNew, module falls back to ugly raw box. Kitchen base cabinet = base-cabinet; upper kitchen = wall-cabinet; tall pantry / fridge tower = tall-cabinet; drawer stack = drawer-base; corner unit = corner-cabinet; kitchen island = island.
   DSL grammar:
   - frontSvg/sideSvg/planSvg shape: { type: 'rect'|'line'|'text', x, y, w, h, fill, stroke, sw, rx, opacity, if } OR { rect: {...} } wrapper.
   - isoBoxes item: { x, y, z, w, h, d, faces: { top, front, right, left, back, bottom } }.
   - Numeric fields may be number OR "{{ expr }}" with arithmetic + comparison + min/max/round/abs + identifiers (params.X, style.X, $colorToken: $cab, $woodFront, $handle...).
   - Color fields: "#hex" or "$tokenName". Forbid eval/Function/new/[]/=> in expressions.
   - Optional "if": "{{ expr }}" to skip shape when false.
4. Legacy raw boxes still allowed (no tpl/tplNew) with materialRef + color when needed.
`.trim();

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
    '{"reply":"Quan sát ảnh: tủ áo cánh trượt 2 cánh kính mờ, khung gỗ óc chó tối màu.\\nHiểu yêu cầu: muốn tủ áo 2 cánh trượt, 200 rộng, có ngăn kéo dưới.\\nĐã áp dụng: width 200, height 240, depth 60; thêm 2 cánh trượt; thêm 2 ngăn kéo dưới cao 25.","askForInfo":false,"cabinetModel":{"title":"Tủ áo cánh trượt","units":"cm","width":200,"height":240,"depth":60,"materials":{"board":"#8a623d"},"modules":[{"type":"panel","label":"Khoang chính","kind":"box","materialRef":"wood-oak","x":0,"y":50,"z":0,"width":200,"height":190,"depth":60,"color":"#8a623d"},{"type":"drawer-zone","label":"Ngăn kéo","kind":"box","materialRef":"wood-walnut","x":0,"y":0,"z":0,"width":200,"height":50,"depth":60,"color":"#5c3d22"}],"details":[{"type":"sliding-door","label":"Cánh trái","x":0,"y":50,"z":58,"width":100,"height":190,"depth":2,"color":"#e8f0f5"},{"type":"sliding-door","label":"Cánh phải","x":100,"y":50,"z":58,"width":100,"height":190,"depth":2,"color":"#e8f0f5"}],"specs":[["Kích thước","200 x 240 x 60 cm","Cánh trượt kính mờ"]]}}',
    '{"reply":"Hiểu yêu cầu: tủ bếp chữ L 500 x 100, có tủ đứng góc, khoang tủ lạnh, tủ dưới + tủ trên.\\nĐã áp dụng: runs[] 2 nhánh; main run east có 5 module với x tuyệt đối (0,60,140,140,140); module stack dùng cùng x, khác y.","askForInfo":false,"cabinetModel":{"title":"Tủ bếp chữ L có tủ trên","units":"cm","width":500,"height":260,"depth":60,"materials":{"board":"#c9986b"},"runs":[{"id":"main","origin":{"x":0,"z":0},"direction":"east","modules":[{"type":"tall-cabinet","label":"Tủ đứng góc","kind":"box","materialRef":"wood-oak","x":0,"y":0,"z":0,"width":60,"height":260,"depth":60,"color":"#c9986b"},{"type":"fridge-slot","label":"Khoang tủ lạnh","kind":"void","x":60,"y":0,"z":0,"width":80,"height":190,"depth":60},{"type":"base-cabinet","label":"Tủ bếp dưới","kind":"box","materialRef":"wood-oak","x":140,"y":0,"z":0,"width":360,"height":86,"depth":60,"color":"#c9986b"},{"type":"upper-cabinet","label":"Tủ bếp trên","kind":"box","materialRef":"wood-oak","x":140,"y":140,"z":25,"width":360,"height":80,"depth":35,"color":"#c9986b"},{"type":"ceiling-cabinet","label":"Tủ kịch trần","kind":"box","materialRef":"wood-oak","x":140,"y":220,"z":25,"width":360,"height":40,"depth":35,"color":"#c9986b"}]},{"id":"return","origin":{"x":0,"z":0},"direction":"north","modules":[{"type":"base-cabinet","label":"Nhánh L","kind":"box","materialRef":"wood-oak","x":0,"y":0,"z":0,"width":100,"height":86,"depth":60,"color":"#c9986b"}]}],"details":[],"specs":[["Bố cục","Chữ L 500 x 100 cm","Có tủ trên + tủ dưới"]]}}',
    '{"reply":"Hiểu yêu cầu: tủ áo chữ L có cánh kéo và tủ trên.\\nĐã áp dụng: dùng template sliding-2door cho khoang chính và upper-2door cho nhánh phụ.","askForInfo":false,"cabinetModel":{"title":"Tủ áo template","units":"cm","width":300,"height":260,"depth":180,"palette":"wood-oak","runs":[{"id":"main","origin":{"x":0,"z":0},"direction":"east","modules":[{"tpl":"sliding-2door","x":0,"y":0,"z":0,"width":220,"height":240,"depth":60,"style":{"door":"flat","handle":"finger-pull"}}]},{"id":"return","origin":{"x":220,"z":0},"direction":"north","modules":[{"tpl":"upper-2door","x":0,"y":150,"z":0,"width":120,"height":90,"depth":60,"style":{"door":"shaker","handle":"bar"}}]}],"details":[],"inlineTemplates":{},"specs":[["Template","sliding-2door + upper-2door","Ưu tiên template thay vì box thô"]]}}',
    '{"reply":"Hiểu yêu cầu: tủ đầu giường có khe đèn LED uốn cong, không có trong catalog.\\nĐã áp dụng: dùng tplNew tạo template mới \\"led-nightstand\\" với 1 khoang chính + line LED phát sáng phía trên.","askForInfo":false,"cabinetModel":{"title":"Tủ đầu giường LED","units":"cm","width":60,"height":50,"depth":40,"palette":"wood-walnut","modules":[{"tplNew":{"id":"led-nightstand","version":1,"category":"lower-cabinet","tags":["led","nightstand"],"description":{"vi":"Tủ đầu giường có khe LED","en":"Nightstand with LED strip"},"params":{"width":{"min":40,"max":80,"default":60},"height":{"min":40,"max":60,"default":50},"depth":{"min":30,"max":50,"default":40}},"style":{},"frontSvg":[{"type":"rect","x":0,"y":0,"w":"{{width}}","h":"{{height}}","fill":"$cab","stroke":"$cabDark","sw":1.2},{"type":"rect","x":4,"y":4,"w":"{{width - 8}}","h":"{{height - 12}}","rx":2,"fill":"$cabLight","stroke":"$cabEdge","sw":1},{"type":"rect","x":4,"y":"{{height - 6}}","w":"{{width - 8}}","h":2,"fill":"#fff4c4","opacity":0.85}],"sideSvg":[{"type":"rect","x":0,"y":0,"w":"{{depth}}","h":"{{height}}","fill":"$cab","stroke":"$cabDark","sw":1}],"planSvg":[{"type":"rect","x":0,"y":0,"w":"{{width}}","h":"{{depth}}","fill":"$cab","stroke":"$cabDark","sw":1}],"isoBoxes":[{"x":0,"y":0,"z":0,"w":"{{width}}","h":"{{height}}","d":"{{depth}}","faces":{"top":"$woodTop","front":"$woodFront","right":"$woodSide","left":"$woodDark","back":"$woodBack"}},{"x":2,"y":"{{height - 4}}","z":"{{depth - 0.5}}","w":"{{width - 4}}","h":2,"d":0.5,"faces":{"front":"#fff4c4"}}]},"x":0,"y":0,"z":0,"width":60,"height":50,"depth":40}],"details":[],"specs":[["tplNew","led-nightstand","Template mới do AI tạo, chờ admin duyệt"]]}}'
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
        INTERIOR_DIMENSION_ANCHOR_RULE_VI,
        replyFormat,
        askForInfoRule,
        'cabinetModel bắt buộc: width/height/depth số dương (cm), modules là mảng ≥1 phần tử, mỗi module/detail có x,y,z,width,height,depth là số.',
        INTERIOR_DOMAIN_HINTS,
        INTERIOR_RUNS_RULE_VI,
        INTERIOR_CATALOG_VI,
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
        INTERIOR_RUNS_RULE_VI,
        INTERIOR_CATALOG_VI,
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

async function deductInteriorCredit(user, cost = INTERIOR_AI_CREDIT_COST) {
    if (isUnlimited(user.role)) return { charged: false, balance: user.balance ?? 0 };
    const updated = await User.findOneAndUpdate(
        { _id: user._id, balance: { $gte: cost } },
        { $inc: { balance: -cost } },
        { new: true }
    ).select('balance');
    if (!updated) return { charged: false, rejected: true, balance: user.balance ?? 0 };
    return { charged: true, balance: updated.balance };
}

function buildAgentInitialPrompt({ message, refImageUrls, baseModel }) {
    const modelText = JSON.stringify(baseModel || {}).slice(0, 2000);
    return [
        'You are an interior design AI. You build cabinets by calling tools step by step.',
        `USER REQUEST:\n${message}`,
        `REFERENCE IMAGES: ${refImageUrls.length} URL(s): ${refImageUrls.join(', ') || 'none'}`,
        `CURRENT MODEL STATE (snapshot):\n${modelText}`,
        '',
        'RULES:',
        '1. Each turn output EXACTLY ONE JSON object on a single line: {"thought":"...","tool":"<name>","args":{...}}',
        '2. No markdown fences. No commentary outside JSON. No multiple tool calls per turn.',
        '3. Call model.preview if you need to see full state.',
        '4. Call skill.list then skill.read for unfamiliar tasks.',
        '5. Call template.suggest when unsure which catalog template to use.',
        '6. Build incrementally, one module at a time.',
        '7. End by calling model.commit with a Vietnamese reply or model.abort with a reason.',
        '8. Maximum 30 tool calls per loop.'
    ].join('\n');
}

function buildAgentSystemPrompt() {
    const tools = interiorRegistry.summary().map((tool) => `- ${tool.name}: ${tool.description}`).join('\n');
    const skills = interiorSkills.summary().map((skill) => `- ${skill.name}: ${skill.description}`).join('\n');
    return [
        'Available tools:',
        tools,
        '',
        'Available domain skills:',
        skills || '- none',
        '',
        'Return only the JSON tool-call object.'
    ].join('\n');
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

// ─── Template catalog (engine load + user commit) ────────────────────────────
//
// GET /templates returns seed + approved templates merged by templateId
// (highest version wins). Engine consumes this on init.
//
// POST /templates accepts a project ID + inline template ID; the inline DSL is
// promoted to a new InteriorTemplate row with status='pending' so admins can
// review. The inline copy stays in the project — committing only makes the
// template visible globally for future AI prompts.

async function reserveTemplateId(baseId) {
    if (!baseId || typeof baseId !== 'string') {
        baseId = `ai-gen-${Date.now().toString(36)}`;
    }
    let candidate = baseId;
    for (let n = 2; n <= 100; n += 1) {
        const exists = await InteriorTemplate.exists({ templateId: candidate });
        if (!exists) return candidate;
        candidate = `${baseId}-${n}`;
    }
    throw new Error('Could not reserve unique template id.');
}

router.get('/templates', authMiddleware, async (req, res) => {
    try {
        const requested = String(req.query.status || 'seed,approved')
            .split(',')
            .map((s) => s.trim())
            .filter((s) => ['seed', 'approved'].includes(s));
        const statusFilter = requested.length ? requested : ['seed', 'approved'];

        const rows = await InteriorTemplate.find({ status: { $in: statusFilter } })
            .sort({ category: 1, templateId: 1, version: -1 })
            .lean();

        // Dedupe by templateId — highest version wins
        const byId = new Map();
        for (const row of rows) {
            const existing = byId.get(row.templateId);
            if (!existing || row.version > existing.version) byId.set(row.templateId, row);
        }

        const templates = Array.from(byId.values()).map((row) => ({
            id: row.templateId,
            version: row.version,
            name: row.name || { vi: '', en: '' },
            description: row.description || { vi: '', en: '' },
            category: row.category,
            tags: row.tags || [],
            params: row.params || {},
            style: row.styleOptions || {},
            status: row.status,
            ...(row.dsl || {})
        }));

        return res.json({ success: true, data: { templates } });
    } catch (error) {
        console.error('Interior templates list error:', error);
        return res.status(500).json({ success: false, message: 'Không thể tải danh mục template.' });
    }
});

router.post('/templates', authMiddleware, async (req, res) => {
    try {
        const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId.trim() : '';
        const inlineTemplateId = typeof req.body?.inlineTemplateId === 'string' ? req.body.inlineTemplateId.trim() : '';
        if (!projectId || !inlineTemplateId) {
            return res.status(400).json({ success: false, message: 'Thiếu projectId hoặc inlineTemplateId.' });
        }

        const project = await findOwnedProject(projectId, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'Không tìm thấy dự án.' });

        const baseVersion = currentVersion(project);
        const inlineDict = baseVersion?.modelJson?.inlineTemplates || {};
        const inlineTpl = inlineDict[inlineTemplateId];
        if (!inlineTpl) {
            return res.status(404).json({ success: false, message: `Không tìm thấy template inline "${inlineTemplateId}".` });
        }

        const candidate = {
            id: typeof inlineTpl.id === 'string' && inlineTpl.id.trim() ? inlineTpl.id.trim() : inlineTemplateId,
            category: inlineTpl.category || 'other',
            params: inlineTpl.params || {},
            dsl: extractDsl(inlineTpl)
        };
        const validation = validateTemplateStructure(candidate);
        if (!validation.valid) {
            return res.status(400).json({ success: false, message: `Template không hợp lệ: ${validation.message}` });
        }

        const finalId = await reserveTemplateId(candidate.id);
        const created = await InteriorTemplate.create({
            templateId: finalId,
            version: 1,
            name: inlineTpl.name || { vi: '', en: '' },
            description: inlineTpl.description || { vi: '', en: '' },
            category: candidate.category,
            tags: Array.isArray(inlineTpl.tags) ? inlineTpl.tags.slice(0, 20) : [],
            params: candidate.params,
            styleOptions: inlineTpl.style && typeof inlineTpl.style === 'object' && !Array.isArray(inlineTpl.style)
                ? inlineTpl.style : {},
            dsl: candidate.dsl,
            status: 'pending',
            authorId: req.user._id,
            sourceProjectId: project._id,
            sourceInlineId: inlineTemplateId
        });

        return res.status(201).json({
            success: true,
            message: 'Đã gửi template cho admin review.',
            data: { templateId: created.templateId, _id: created._id }
        });
    } catch (error) {
        console.error('Interior templates commit error:', error);
        return res.status(500).json({ success: false, message: 'Không thể gửi template.' });
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
// Default Pro for /chat apply: cabinet model synthesis needs strong reasoning to
// (a) pick the right template + style from catalog, (b) compose valid DSL for
// tplNew, (c) avoid silent fallback to ugly raw boxes. Flash remains opt-in via
// frontend model selector for quick low-stakes edits. /analyze-image (image
// summarization) keeps Flash default — see ANALYZE_DEFAULT_MODEL below.
const INTERIOR_DEFAULT_MODEL = 'gemini-3.1-pro-preview';

router.post('/projects/:id/agent', authMiddleware, async (req, res) => {
    const startedAt = new Date();
    const steps = [];
    let project = null;
    let keepAlive = null;
    const abortController = new AbortController();
    req.on('close', () => abortController.abort());
    try {
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const rawRefImageUrls = Array.isArray(req.body?.refImageUrls)
            ? req.body.refImageUrls
            : (typeof req.body?.refImageUrl === 'string' ? [req.body.refImageUrl] : []);
        const refImageUrls = rawRefImageUrls.filter((url) => typeof url === 'string' && url.trim()).map((url) => url.trim()).slice(0, 5);
        const requestedModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
        const selectedModel = INTERIOR_ALLOWED_MODELS.includes(requestedModel) ? requestedModel : INTERIOR_DEFAULT_MODEL;
        if (!message) return res.status(400).json({ success: false, message: 'Vui lòng nhập yêu cầu thiết kế.' });
        if (message.length > MAX_USER_PROMPT_CHARS) return res.status(400).json({ success: false, message: `Yêu cầu quá dài, tối đa ${MAX_USER_PROMPT_CHARS} ký tự.` });
        if (!isUnlimited(req.user.role) && (req.user.balance || 0) < INTERIOR_AGENT_CREDIT_COST) {
            return res.status(402).json({
                success: false,
                message: `Cần ${INTERIOR_AGENT_CREDIT_COST} credit để chạy agent, hiện có ${req.user.balance || 0}.`,
                data: { cost: INTERIOR_AGENT_CREDIT_COST, balance: req.user.balance || 0 }
            });
        }
        project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'Không tìm thấy dự án.' });
        if (project.versions.length >= MAX_VERSIONS_PER_PROJECT) return res.status(409).json({ success: false, message: 'Dự án đã đạt giới hạn phiên bản.' });

        setSseHeaders(res);
        keepAlive = setInterval(() => {
            if (!res.writableEnded) res.write(':ping\n\n');
        }, 15000);

        const baseVersion = currentVersion(project);
        const baseModel = structuredClone(baseVersion?.modelJson || defaultCabinetModel());
        const ctx = {
            project,
            draftModel: baseModel,
            userPrompt: message,
            refImageUrls,
            aiModel: selectedModel,
            usage: null,
            totalTokens: 0,
            abortSignal: abortController.signal,
            beforeCommit: async () => {
                if (ctx.agentCredit) return { ok: true };
                const credit = await deductInteriorCredit(req.user, INTERIOR_AGENT_CREDIT_COST);
                if (credit.rejected) {
                    return {
                        ok: false,
                        error: `Cần ${INTERIOR_AGENT_CREDIT_COST} credit để lưu phiên bản agent, hiện có ${credit.balance}.`
                    };
                }
                ctx.agentCredit = credit;
                return { ok: true };
            }
        };

        const result = await runAgentLoop({
            initialPrompt: buildAgentInitialPrompt({ message, refImageUrls, baseModel }),
            systemPrompt: buildAgentSystemPrompt(),
            registry: interiorRegistry,
            ctx,
            maxSteps: Math.min(Math.max(Number(req.body?.maxSteps) || 30, 1), 60),
            aiCall: async ({ messages, systemPrompt }) => {
                const ai = await callGcliDirect('', { model: selectedModel, messages, systemPrompt });
                ctx.aiModel = ai.model || selectedModel;
                ctx.usage = ai.usage || ctx.usage;
                return ai;
            },
            onStep: (index, step) => {
                steps[index] = { index, ...step, result: null, latencyMs: null };
                writeEvent(res, 'step', steps[index]);
            },
            onResult: (index, toolResult, latencyMs) => {
                steps[index] = { ...(steps[index] || { index }), result: toolResult, latencyMs };
                writeEvent(res, 'step-result', { index, result: toolResult, latencyMs });
            },
            onDone: async (data) => {
                const credit = ctx.agentCredit || { charged: false, balance: req.user.balance ?? 0 };
                const serialized = await serializeProject(project);
                writeEvent(res, 'done', {
                    versionIndex: data.versionIndex,
                    finalModel: currentVersion(project)?.modelJson || null,
                    project: serialized,
                    version: serialized.versions.find((version) => version.index === data.versionIndex),
                    totalSteps: steps.filter(Boolean).length,
                    totalTokens: ctx.totalTokens || 0,
                    cost: isUnlimited(req.user.role) ? 0 : INTERIOR_AGENT_CREDIT_COST,
                    balance: credit.balance
                });
            },
            onError: (error) => {
                writeEvent(res, 'error', error);
            }
        });

        const status = result.status === 'committed' ? 'committed' : (result.status === 'maxSteps' ? 'maxSteps' : (result.status === 'aborted' ? 'aborted' : 'error'));
        await InteriorAgentLog.create({
            userId: req.user._id,
            projectId: project._id,
            startedAt,
            finishedAt: new Date(),
            status,
            stepsCount: steps.filter(Boolean).length,
            totalTokens: ctx.totalTokens || 0,
            finalReply: result.data?.reply || '',
            abortReason: result.data?.reason || result.error?.message || '',
            steps: steps.filter(Boolean)
        });
    } catch (error) {
        console.error('Interior agent error:', error);
        if (!res.headersSent) return res.status(500).json({ success: false, message: 'Không thể chạy agent thiết kế.' });
        writeEvent(res, 'error', { message: error.message || 'Không thể chạy agent thiết kế.' });
        if (project) {
            try {
                await InteriorAgentLog.create({
                    userId: req.user._id,
                    projectId: project._id,
                    startedAt,
                    finishedAt: new Date(),
                    status: 'error',
                    stepsCount: steps.filter(Boolean).length,
                    abortReason: error.message || '',
                    steps: steps.filter(Boolean)
                });
            } catch (logError) {
                console.warn('[interior:agent-log] failed:', logError.message);
            }
        }
    } finally {
        if (keepAlive) clearInterval(keepAlive);
        if (res.headersSent) closeSse(res);
    }
});

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
            const proposalPrompt = buildInteriorProposalPrompt({ message, refImageUrls, project, baseModel });
            const startedAt = Date.now();
            let aiText;
            let proposalUsage = null;
            let proposalModel = selectedModel;
            try {
                const aiResult = await callGcliDirect(
                    proposalPrompt,
                    { model: selectedModel, images: aiImageUrls }
                );
                aiText = (aiResult.text || '').trim();
                proposalUsage = aiResult.usage;
                proposalModel = aiResult.model || selectedModel;
            } catch (error) {
                console.error('Interior AI proposal error:', error.message);
                recordInteriorAiLog({
                    userId: req.user._id, projectId: project._id, stage: 'proposal',
                    model: selectedModel, prompt: proposalPrompt, refImageUrls,
                    rawResponse: '', latencyMs: Date.now() - startedAt,
                    status: 'upstream-error', errorMessage: error.message || ''
                });
                return res.status(502).json({ success: false, message: error.message || 'AI tạm thời không phản hồi.' });
            }
            if (!aiText) {
                recordInteriorAiLog({
                    userId: req.user._id, projectId: project._id, stage: 'proposal',
                    model: proposalModel, prompt: proposalPrompt, refImageUrls,
                    rawResponse: '', latencyMs: Date.now() - startedAt,
                    status: 'upstream-error', errorMessage: 'Empty AI response'
                });
                return res.status(502).json({ success: false, message: 'AI không trả về phân tích.' });
            }

            let structured;
            try {
                structured = validateProposalPayload(extractJsonObject(aiText));
            } catch (error) {
                console.error('Interior proposal JSON parse error:', error.message, aiText);
                recordInteriorAiLog({
                    userId: req.user._id, projectId: project._id, stage: 'proposal',
                    model: proposalModel, prompt: proposalPrompt, refImageUrls,
                    rawResponse: aiText, latencyMs: Date.now() - startedAt, usage: proposalUsage,
                    status: 'parse-failed', errorMessage: error.message || ''
                });
                return res.status(502).json({ success: false, message: 'AI không trả về phân tích đúng định dạng.' });
            }
            if (!structured) {
                recordInteriorAiLog({
                    userId: req.user._id, projectId: project._id, stage: 'proposal',
                    model: proposalModel, prompt: proposalPrompt, refImageUrls,
                    rawResponse: aiText, latencyMs: Date.now() - startedAt, usage: proposalUsage,
                    status: 'validation-failed', errorMessage: 'validateProposalPayload returned null'
                });
                return res.status(502).json({ success: false, message: 'AI không trả về phân tích đúng định dạng.' });
            }

            recordInteriorAiLog({
                userId: req.user._id, projectId: project._id, stage: 'proposal',
                model: proposalModel, prompt: proposalPrompt, refImageUrls,
                rawResponse: aiText, parsedReply: assembleProposalText(structured),
                latencyMs: Date.now() - startedAt, usage: proposalUsage,
                status: 'ok', errorMessage: ''
            });

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
        const applyPrompt = buildInteriorPrompt({ message, refImageUrls, project, baseModel, proposalContext });
        const applyStartedAt = Date.now();
        let aiText;
        let aiUsage = null;
        let actualModel = selectedModel;
        try {
            // Interior tool LUÔN gọi gcli trực tiếp (callGcliDirect = gcli.ggchan.dev upstream).
            // Mỗi turn đã embed full chat history + model JSON nên không cần OpenClaw session memory.
            // Nếu user bật 2-step, proposalContext được truyền vào để AI bám sát đề xuất đã xác nhận.
            const aiResult = await callGcliDirect(
                applyPrompt,
                { model: selectedModel, images: aiImageUrls }
            );
            aiText = aiResult.text;
            aiUsage = aiResult.usage;
            actualModel = aiResult.model || selectedModel;
        } catch (error) {
            console.error('Interior AI provider error:', error.message);
            recordInteriorAiLog({
                userId: req.user._id, projectId: project._id, stage: 'apply',
                model: selectedModel, prompt: applyPrompt, refImageUrls,
                rawResponse: '', latencyMs: Date.now() - applyStartedAt,
                status: 'upstream-error', errorMessage: error.message || ''
            });
            return res.status(502).json({ success: false, message: error.message || 'AI tạm thời không phản hồi.' });
        }

        let payload;
        try {
            payload = normalizeAiPayload(extractJsonObject(aiText));
        } catch (error) {
            console.error('Interior AI JSON parse error:', error.message, aiText);
            recordInteriorAiLog({
                userId: req.user._id, projectId: project._id, stage: 'apply',
                model: actualModel, prompt: applyPrompt, refImageUrls,
                rawResponse: aiText || '', latencyMs: Date.now() - applyStartedAt, usage: aiUsage,
                status: 'parse-failed', errorMessage: error.message || ''
            });
            return res.status(502).json({ success: false, message: 'AI không trả về JSON hợp lệ.' });
        }

        // Phase 12: pull AI-generated inline templates into modelJson.inlineTemplates
        // so the engine resolves them on render, and surface their ids in meta so
        // the frontend can prompt the user to commit them to the shared library.
        // Phase 12 QW3: droppedTemplates carries the rejected tplNews with reasons
        // so the frontend can show a warning banner (instead of silent fallback).
        const inlineResult = extractInlineTemplates(payload.cabinetModel);
        payload.cabinetModel = inlineResult.cabinetModel;
        const newInlineTemplateIds = inlineResult.newInlineIds;
        const droppedTemplates = inlineResult.droppedTemplates;

        const validation = validateCabinetModel(payload.cabinetModel);
        if (!validation.valid) {
            recordInteriorAiLog({
                userId: req.user._id, projectId: project._id, stage: 'apply',
                model: actualModel, prompt: applyPrompt, refImageUrls,
                rawResponse: aiText || '', parsedReply: payload.reply || '',
                latencyMs: Date.now() - applyStartedAt, usage: aiUsage,
                status: 'validation-failed', errorMessage: validation.message || ''
            });
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

        recordInteriorAiLog({
            userId: req.user._id, projectId: project._id, stage: 'apply',
            model: actualModel, versionIndex: nextIndex,
            prompt: applyPrompt, refImageUrls,
            rawResponse: aiText || '', parsedReply: payload.reply || '',
            latencyMs: Date.now() - applyStartedAt, usage: aiUsage,
            status: 'ok', errorMessage: ''
        });

        const serialized = await serializeProject(project);
        return res.json({
            success: true,
            data: {
                stage: 'apply',
                project: serialized,
                version: serialized.versions.find((version) => version.index === nextIndex),
                cost: isUnlimited(req.user.role) ? 0 : INTERIOR_AI_CREDIT_COST,
                balance: credit.balance,
                meta: {
                    newInlineTemplates: newInlineTemplateIds,
                    droppedTemplates
                }
            }
        });
    } catch (error) {
        console.error('Interior chat error:', error);
        return res.status(500).json({ success: false, message: 'Không thể xử lý yêu cầu thiết kế.' });
    }
});

// ─── Image-to-design pipeline (Phase 4) ──────────────────────────────────────
//
// Note (deviation from SPEC P4-1): SPEC body says multipart/form-data { image }.
// We follow project convention: frontend uploads via existing /api/upload/presign
// directly to B2, then posts `imageUrl` here as JSON. Avoids adding multer +
// duplicated upload logic when the presigned flow already exists.

const ANALYZE_MAX_HINTS = 1000;
const ANALYZE_MAX_REPAIRS = 2;
const ANALYZE_DEFAULT_MODEL = 'gemini-3-flash-preview';
const ANALYZE_ESCALATE_MODEL = 'gemini-3.1-pro-preview';

function sha256Hex(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function pickAnalyzeModel(override, hints) {
    if (override === 'pro') return ANALYZE_ESCALATE_MODEL;
    if (override === 'flash') return ANALYZE_DEFAULT_MODEL;
    if (typeof hints === 'string' && /\bcomplex\b/i.test(hints)) return ANALYZE_ESCALATE_MODEL;
    return ANALYZE_DEFAULT_MODEL;
}

function buildAnalyzePrompt(hints) {
    const userHints = hints && hints.trim() ? `\nUser hints: ${hints.trim()}` : '';
    return [
        'You convert interior design photos into JSON for the Interior Design Engine.',
        'Return exactly one valid JSON object. No markdown, no comments, no surrounding text.',
        'Required shape: { title, subtitle, units:"cm", width, height, depth, materials:{board}, modules:[], details:[], specs:[] } OR use top-level runs[] for L/U/island/galley layouts.',
        'IMPORTANT: If the user request cannot be represented by the current schema (complex curves or cabinet cavities not in the catalog), keep the original/main modules as much as possible and list unsupported parts in optional field meta.unsupportedRequests (string[]). Do not redraw from scratch or drop existing modules just because one detail is unsupported.',
        'MATERIAL RULES: materialRef "glass-smoked" is only for transparent glass doors or glass panels; never use it for cabinet bodies, shelves, bottoms, sides, or backs. kind "void" is only for empty openings, such as an appliance cavity or open unfinished gap; never use it for wood panels, cabinet doors, or fixed shelves. Default solid cabinet bodies and panels should use wood-oak, wood-walnut, laminate-white, or laminate-black-matte.',
        INTERIOR_CATALOG_EN,
        'RUNS: If the user describes L/U/island/galley layout, output runs:[{id, origin:{x,z}, direction:"east|north|west|south", modules:[...]}]. Example run module: {"x":0,"y":0,"z":0,"width":250,"height":90,"depth":60}. For a single straight layout, you may use old top-level modules. Do not use both modules and runs at the same time.',
        'Coordinate system: x left→right, y bottom→top, z front→back. Units = cm.',
        'Each module/detail has numeric x/y/z. Legacy raw boxes also need positive width/height/depth. Template modules use tpl plus optional width/height/depth/style. Optional model fields: palette and inlineTemplates.',
        'Match dimensions and materials from the photo. If unsure, choose practical residential cabinet defaults in cm.',
        userHints
    ].filter(Boolean).join('\n');
}

function buildRepairPrompt(prevText, validationMessage) {
    return [
        'Your previous JSON failed validation:',
        validationMessage,
        'Return the SAME design but with the validation error fixed. Only valid JSON, no commentary.',
        'Previous response:',
        prevText
    ].join('\n\n');
}

router.post('/analyze-image', authMiddleware, interiorQuotaCheck('analyze'), async (req, res) => {
    try {
        const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
        const hintsRaw = typeof req.body?.hints === 'string' ? req.body.hints.trim() : '';
        const override = req.body?.modelOverride;
        const hints = hintsRaw.slice(0, ANALYZE_MAX_HINTS);
        if (!imageUrl) return res.status(400).json({ success: false, message: 'imageUrl là bắt buộc.' });

        const cacheKey = sha256Hex(`${imageUrl}|${hints}|${override || ''}`);
        const cached = await InteriorAnalysis.findOne({ cacheKey });
        if (cached) {
            console.debug('[interior:analyze] cache hit', { cacheKeyPrefix: cacheKey.slice(0, 12) });
            return res.json({
                success: true,
                data: {
                    model: cached.modelJson,
                    suggestedModel: cached.modelJson?.title || 'wardrobe-builtin',
                    meta: { usedModel: cached.usedModel, cached: true, cacheKey }
                }
            });
        }
        console.debug('[interior:analyze] cache miss', { cacheKeyPrefix: cacheKey.slice(0, 12) });

        const chosenModel = pickAnalyzeModel(override, hints);
        const prompt = buildAnalyzePrompt(hints);
        const presigned = await cdnUrlToPresignedDownload(imageUrl);
        const aiImageUrl = presigned || imageUrl;

        let aiText = '';
        let usedModel = chosenModel;
        try {
            const startedAt = Date.now();
            const aiResult = await callGcliDirect(prompt, { model: chosenModel, images: [aiImageUrl] });
            console.debug('[interior:analyze] gemini latency', {
                model: aiResult.model || chosenModel,
                latencyMs: Date.now() - startedAt
            });
            aiText = aiResult.text || '';
            usedModel = aiResult.model || chosenModel;
        } catch (error) {
            console.error('Interior analyze AI error:', error.message);
            return res.status(502).json({ success: false, message: error.message || 'AI tạm thời không phản hồi.' });
        }

        let model = null;
        let lastError = null;
        for (let attempt = 0; attempt <= ANALYZE_MAX_REPAIRS; attempt += 1) {
            try {
                const candidate = extractJsonObject(aiText);
                const validation = validateCabinetModel(candidate);
                if (validation.valid) {
                    model = candidate;
                    break;
                }
                lastError = validation.message;
            } catch (error) {
                lastError = error.message;
            }
            if (attempt === ANALYZE_MAX_REPAIRS) break;
            console.debug('[interior:analyze] repair iteration', {
                attempt: attempt + 1,
                reason: lastError || 'Invalid JSON.'
            });
            try {
                const repairStartedAt = Date.now();
                const repair = await callGcliDirect(
                    buildRepairPrompt(aiText, lastError || 'Invalid JSON.'),
                    { model: chosenModel, images: [aiImageUrl] }
                );
                console.debug('[interior:analyze] repair latency', {
                    attempt: attempt + 1,
                    model: repair.model || chosenModel,
                    latencyMs: Date.now() - repairStartedAt
                });
                aiText = repair.text || aiText;
            } catch (error) {
                console.error('Interior analyze repair error:', error.message);
                break;
            }
        }

        if (!model) {
            return res.status(502).json({
                success: false,
                message: `AI không trả về model hợp lệ${lastError ? `: ${lastError}` : '.'}`
            });
        }

        await InteriorAnalysis.create({
            cacheKey,
            userId: req.user._id,
            imageUrl,
            hints,
            modelJson: model,
            usedModel
        });
        await commitInteriorQuota(req);

        return res.json({
            success: true,
            data: {
                model,
                suggestedModel: model.title || 'wardrobe-builtin',
                meta: { usedModel, cached: false, cacheKey }
            }
        });
    } catch (error) {
        console.error('Interior analyze-image error:', error);
        return res.status(500).json({ success: false, message: 'Không thể phân tích ảnh.' });
    }
});

router.post('/generate-render', authMiddleware, interiorQuotaCheck('render'), async (req, res) => {
    try {
        const rawModelJson = req.body?.modelJson;
        const modelJson = typeof rawModelJson === 'string' ? extractJsonBlock(rawModelJson) : rawModelJson;
        const stylePrompt = typeof req.body?.stylePrompt === 'string' ? req.body.stylePrompt.trim().slice(0, 4000) : '';
        const viewBase64 = typeof req.body?.viewBase64 === 'string' ? req.body.viewBase64 : '';

        const validation = validateCabinetModel(modelJson);
        if (!validation.valid) {
            return res.status(400).json({ success: false, message: `modelJson không hợp lệ: ${validation.message}` });
        }

        const dataUrlMatch = viewBase64.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
        if (!dataUrlMatch) {
            return res.status(400).json({ success: false, message: 'viewBase64 phải là data URL image (png/jpeg/webp).' });
        }
        const [, mime, b64] = dataUrlMatch;
        const buffer = Buffer.from(b64, 'base64');
        if (buffer.length > 12 * 1024 * 1024) {
            return res.status(413).json({ success: false, message: 'Ảnh 3D view quá lớn (>12MB).' });
        }

        const cacheKey = sha256Hex(`${req.user._id}|${stylePrompt}|${sha256Hex(b64).slice(0, 16)}|${sha256Hex(JSON.stringify(modelJson)).slice(0, 16)}`);
        const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
        const viewKey = `interior-design/conditioning/${cacheKey.slice(0, 16)}-${Date.now()}.${ext}`;
        const { publicUrl: viewUrl } = await uploadFile(viewKey, buffer, mime);

        // TODO: wire actual image-generation upstream (e.g. Imagen/Gemini image API)
        // when available. For now we persist the conditioning view + style prompt
        // and return the conditioning URL as `renderUrl` placeholder so the
        // frontend compare-slider has a working contract.
        const record = await InteriorRender.create({
            cacheKey,
            userId: req.user._id,
            stylePrompt,
            viewUrl,
            renderUrl: viewUrl,
            modelSnapshot: modelJson
        });
        await commitInteriorQuota(req);

        return res.json({
            success: true,
            data: {
                renderUrl: record.renderUrl,
                viewUrl: record.viewUrl,
                cacheKey,
                meta: { pending: true, note: 'Image generation upstream chưa kích hoạt; renderUrl trả về view 3D gốc.' }
            }
        });
    } catch (error) {
        console.error('Interior generate-render error:', error);
        return res.status(500).json({ success: false, message: 'Không thể tạo render AI.' });
    }
});

function reviewerTokenBypass(req, res, next) {
    const headerToken = typeof req.headers['x-reviewer-token'] === 'string' ? req.headers['x-reviewer-token'].trim() : '';
    const expected = (process.env.INTERIOR_LOG_REVIEWER_TOKEN || '').trim();
    if (expected && headerToken && headerToken === expected) {
        req.reviewerBypass = true;
        return next();
    }
    return authMiddleware(req, res, () => adminOnly(req, res, next));
}

router.get('/admin/logs', reviewerTokenBypass, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const filter = {};
        if (typeof req.query.projectId === 'string' && mongoose.Types.ObjectId.isValid(req.query.projectId)) {
            filter.projectId = req.query.projectId;
        }
        if (typeof req.query.userId === 'string' && mongoose.Types.ObjectId.isValid(req.query.userId)) {
            filter.userId = req.query.userId;
        }
        if (req.query.stage === 'proposal' || req.query.stage === 'apply') {
            filter.stage = req.query.stage;
        }
        if (typeof req.query.status === 'string' && ['ok', 'parse-failed', 'validation-failed', 'upstream-error'].includes(req.query.status)) {
            filter.status = req.query.status;
        }
        const logs = await InteriorAiLog.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('userId', 'name email')
            .lean();
        return res.json({ success: true, data: { logs } });
    } catch (error) {
        console.error('Interior admin logs error:', error);
        return res.status(500).json({ success: false, message: 'Không thể tải log AI.' });
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
