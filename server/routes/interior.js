import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import path from 'node:path';
import fs from 'node:fs/promises';
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
import { ensureDraft as ensureInteriorDraft } from '../tools/interior/common.js';

const AI_LOG_MAX_FIELD = 64 * 1024;

function truncateForLog(value) {
    if (typeof value !== 'string') return '';
    return value.length > AI_LOG_MAX_FIELD ? `${value.slice(0, AI_LOG_MAX_FIELD)}â€¦[truncated]` : value;
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
// plan â€” both AI upstream fetches and browser <img> tags fail. We replace each
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
const INTERIOR_WORKSHOP_DIR = path.resolve(__dirname, '../../../tools/interior-component-workshop');
const INTERIOR_WORKSHOP_COMPONENTS_DIR = path.join(INTERIOR_WORKSHOP_DIR, 'components');
const INTERIOR_WORKSHOP_BUNDLE_PATH = path.join(INTERIOR_WORKSHOP_DIR, 'data', 'template-bundle.js');
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
        return `${label} pháº£i lĂ  object.`;
    }
    const required = part.tpl ? ['x', 'y', 'z'] : ['x', 'y', 'z', 'width', 'height', 'depth'];
    for (const key of required) {
        if (!Number.isFinite(part[key])) return `${label}.${key} pháº£i lĂ  sá»‘.`;
    }
    if (part.width !== undefined && !isPositiveDimension(part.width)) return `${label}.width cĂ³ kĂ­ch thÆ°á»›c khĂ´ng há»£p lá»‡.`;
    if (part.height !== undefined && !isPositiveDimension(part.height)) return `${label}.height cĂ³ kĂ­ch thÆ°á»›c khĂ´ng há»£p lá»‡.`;
    if (part.depth !== undefined && !isPositiveDimension(part.depth)) return `${label}.depth cĂ³ kĂ­ch thÆ°á»›c khĂ´ng há»£p lá»‡.`;
    if (!part.tpl && (!isPositiveDimension(part.width) || !isPositiveDimension(part.height) || !isPositiveDimension(part.depth))) {
        return `${label} cĂ³ kĂ­ch thÆ°á»›c khĂ´ng há»£p lá»‡.`;
    }
    if (part.type !== undefined && typeof part.type !== 'string') return `${label}.type pháº£i lĂ  chuá»—i.`;
    if (part.label !== undefined && typeof part.label !== 'string') return `${label}.label pháº£i lĂ  chuá»—i.`;
    if (part.tpl !== undefined && typeof part.tpl !== 'string') return `${label}.tpl pháº£i lĂ  chuá»—i.`;
    if (part.style !== undefined && (typeof part.style !== 'object' || Array.isArray(part.style))) return `${label}.style pháº£i lĂ  object.`;
    return null;
}

function validateRun(run, index) {
    const label = `runs[${index}]`;
    if (!run || typeof run !== 'object' || Array.isArray(run)) return `${label} pháº£i lĂ  object.`;
    if (!run.origin || typeof run.origin !== 'object' || Array.isArray(run.origin)) return `${label}.origin pháº£i lĂ  object.`;
    if (!Number.isFinite(run.origin.x) || !Number.isFinite(run.origin.z)) return `${label}.origin.x/z pháº£i lĂ  sá»‘.`;
    if (!['east', 'north', 'west', 'south'].includes(run.direction)) return `${label}.direction khĂ´ng há»£p lá»‡.`;
    if (!Array.isArray(run.modules) || run.modules.length === 0 || run.modules.length > 500) {
        return `${label}.modules pháº£i lĂ  máº£ng cĂ³ 1-500 pháº§n tá»­.`;
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
// rendering â€” we don't crash the whole chat turn for one bad template.
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
        return { valid: false, message: 'cabinetModel pháº£i lĂ  object.' };
    }
    for (const key of ['width', 'height', 'depth']) {
        if (!isPositiveDimension(model[key])) return { valid: false, message: `${key} pháº£i lĂ  sá»‘ dÆ°Æ¡ng há»£p lá»‡.` };
    }
    if (model.palette !== undefined && typeof model.palette !== 'string') {
        return { valid: false, message: 'palette pháº£i lĂ  chuá»—i.' };
    }
    if (model.inlineTemplates !== undefined && (typeof model.inlineTemplates !== 'object' || Array.isArray(model.inlineTemplates))) {
        return { valid: false, message: 'inlineTemplates pháº£i lĂ  object.' };
    }
    const hasModules = Array.isArray(model.modules) && model.modules.length > 0;
    const hasRuns = Array.isArray(model.runs) && model.runs.length > 0;
    if (hasModules && hasRuns) {
        return { valid: false, message: 'Chá»‰ dĂ¹ng má»™t trong hai schema: modules hoáº·c runs, khĂ´ng dĂ¹ng cáº£ hai.' };
    }
    if (!hasModules && !hasRuns) {
        return { valid: false, message: 'Cáº§n cĂ³ modules hoáº·c runs.' };
    }
    if (hasModules) {
        if (model.modules.length > 500) return { valid: false, message: 'modules pháº£i lĂ  máº£ng cĂ³ 1-500 pháº§n tá»­.' };
        for (let i = 0; i < model.modules.length; i += 1) {
            const error = validatePart(model.modules[i], `modules[${i}]`);
            if (error) return { valid: false, message: error };
        }
    }
    if (hasRuns) {
        if (model.runs.length > 20) return { valid: false, message: 'runs tá»‘i Ä‘a 20 pháº§n tá»­.' };
        for (let i = 0; i < model.runs.length; i += 1) {
            const error = validateRun(model.runs[i], i);
            if (error) return { valid: false, message: error };
        }
    }
    if (model.details !== undefined) {
        if (!Array.isArray(model.details) || model.details.length > 1000) {
            return { valid: false, message: 'details pháº£i lĂ  máº£ng tá»‘i Ä‘a 1000 pháº§n tá»­.' };
        }
        for (let i = 0; i < model.details.length; i += 1) {
            const error = validatePart(model.details[i], `details[${i}]`);
            if (error) return { valid: false, message: error };
        }
    }
    if (model.specs !== undefined && !Array.isArray(model.specs)) {
        return { valid: false, message: 'specs pháº£i lĂ  máº£ng.' };
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
        if (!String(text || '').trim()) throw new Error('AI tráº£ vá» pháº£n há»“i rá»—ng.');
        throw new Error('AI khĂ´ng tráº£ vá» JSON há»£p lá»‡.');
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
    'Quy Æ°á»›c thiáº¿t káº¿ ná»™i tháº¥t Viá»‡t Nam (cm):',
    '- Tá»§ Ă¡o cao thĂ´ng thÆ°á»ng 220-280, sĂ¢u 55-60. Tá»§ báº¿p dÆ°á»›i cao 80-86, sĂ¢u 55-60. Tá»§ báº¿p trĂªn cao 70-90, sĂ¢u 30-35.',
    '- NgÄƒn treo Ă¡o dĂ i: cao 110-130. NgÄƒn treo Ă¡o ngáº¯n: 90-100. NgÄƒn xáº¿p: cao 30-40. NgÄƒn giĂ y: cao 20-25.',
    '- CĂ¡nh tá»§ chuáº©n rá»™ng 40-50 cho cĂ¡nh Ä‘Ă´i, 50-60 cho cĂ¡nh Ä‘Æ¡n. Báº£n lá» Ă¢m 35mm.',
    '- Váº­t liá»‡u phá»• biáº¿n: MFC vĂ¢n gá»— #c9986b (sá»“i), #8a623d (Ă³c chĂ³), #d4b896 (sá»“i sĂ¡ng), #4a3326 (Ä‘en gá»—); Acrylic bĂ³ng #ffffff, #1a1a1a, #c41e3a; KĂ­nh tráº¯ng trong #e8f0f5.',
    '- Tay náº¯m: dáº¡ng Ă¢m hoáº·c thanh ngang. BĂ¡nh xe dÆ°á»›i Ä‘Ă¡y tá»§ kĂ©o: cao 8-10.',
    'Toáº¡ Ä‘á»™ Z (trá»¥c depth): máº·t sau tá»§ á»Ÿ z=0, máº·t trÆ°á»›c á»Ÿ z=depth. Tá»§ Ă¡p tÆ°á»ng: máº·t sau (z=0) lĂ  tÆ°á»ng, máº·t trÆ°á»›c nhĂ¬n ra phĂ²ng.',
    'Tá»§ báº¿p ÄĂ”I (tá»§ trĂªn + tá»§ dÆ°á»›i) cĂ¹ng Ă¡p 1 tÆ°á»ng: tá»§ dÆ°á»›i depth 55-60 Ä‘áº·t z=0; tá»§ trĂªn depth 30-35 PHáº¢I Ä‘áº·t z = (depth_tá»§_dÆ°á»›i - depth_tá»§_trĂªn) Ä‘á»ƒ máº·t sau cĂ¹ng Ä‘Æ°á»ng tÆ°á»ng. VD: tá»§ dÆ°á»›i depth 60, tá»§ trĂªn depth 35 -> tá»§ trĂªn z=25. KHĂ”NG Ä‘áº·t z=0 cho cáº£ 2 vĂ¬ máº·t trÆ°á»›c sáº½ chá»“ng vĂ o nhau.',
    'Tá»§ Ă¡o nguyĂªn khá»‘i: táº¥t cáº£ module cĂ¹ng z=0, depth Ä‘á»“ng nháº¥t. Khoang treo/khoang kĂ©o chá»‰ khĂ¡c y (chiá»u cao) vĂ  x (vá»‹ trĂ­ ngang), khĂ´ng khĂ¡c z.'
].join('\n');

const INTERIOR_RUNS_RULE_VI = [
    'Bá» Cá»¤C L/U/Äáº¢O/SONG SONG: Náº¿u user mĂ´ táº£ tá»§ chá»¯ L, U, Ä‘áº£o báº¿p, hoáº·c bá»‘ cá»¥c song song, Báº®T BUá»˜C output dĂ¹ng top-level `runs:[{id, origin:{x,z}, direction:"east|north|west|south", modules:[...]}]` THAY VĂŒ `modules[]` á»Ÿ root.',
    '- Má»—i run lĂ  má»™t Ä‘oáº¡n tháº³ng theo 1 hÆ°á»›ng. Tá»§ chá»¯ L = 2 runs (vd. run1 east + run2 north), tá»§ chá»¯ U = 3 runs, Ä‘áº£o báº¿p = 1 run + 1 run riĂªng cho island.',
    '- `origin` lĂ  Ä‘iá»ƒm gá»‘c (gĂ³c cá»§a run Ä‘Ă³) trong há»‡ tá»a Ä‘á»™ tá»§ tá»•ng. Run east báº¯t Ä‘áº§u tá»« origin vĂ  má»Ÿ rá»™ng theo trá»¥c +x; run north theo -z; run west theo -x; run south theo +z.',
    '- Tá»ŒA Äá»˜ MODULE TRONG RUN (QUAN TRá»ŒNG): `x` lĂ  vá»‹ trĂ­ TUYá»†T Äá»I dá»c theo trá»¥c Ä‘i cá»§a run, tĂ­nh tá»« origin. KHĂ”NG pháº£i offset. Module Ä‘áº§u run Ä‘áº·t `x=0`; module thá»© 2 Ä‘áº·t `x = width cá»§a module 1`; module thá»© 3 Ä‘áº·t `x = sum width 2 module trÆ°á»›c`; v.v. Modules CHá»’NG (stack) lĂªn nhau á»Ÿ cĂ¹ng vá»‹ trĂ­ dĂ¹ng cĂ¹ng `x` nhÆ°ng khĂ¡c `y` (chiá»u cao).',
    '- `y` lĂ  cao máº·t Ä‘Ă¡y module so vá»›i máº·t ná»n (cm). `z` lĂ  offset depth tá»« tÆ°á»ng (tá»§ trĂªn depth khĂ¡c tá»§ dÆ°á»›i â†’ z khĂ¡c 0 Ä‘á»ƒ cĂ¹ng máº·t sau, xem hint Z).',
    '- `width` lĂ  chiá»u dĂ i module Dá»ŒC trá»¥c run (Ä‘Ă´ng/tĂ¢y dĂ¹ng width lĂ  theo trá»¥c X tá»•ng; báº¯c/nam dĂ¹ng width lĂ  theo trá»¥c Z tá»•ng). `depth` lĂ  Ä‘á»™ sĂ¢u (vuĂ´ng gĂ³c tÆ°á»ng).',
    '- KHĂ”NG dĂ¹ng Ä‘á»“ng thá»i `modules` á»Ÿ root VĂ€ `runs` - chá»n 1. Bá»‘ cá»¥c tháº³ng: dĂ¹ng `modules`. Bá»‘ cá»¥c cĂ³ khĂºc: PHáº¢I dĂ¹ng `runs`.',
    '- VĂ­ dá»¥ tá»§ chá»¯ L 500cm Ă— 100cm, main run (east): 3 module liĂªn tiáº¿p vá»›i x=0/w=60, x=60/w=80, x=140/w=360 (tá»•ng = 500). Module stack (vd tá»§ trĂªn Ä‘áº·t trĂªn fridge) dĂ¹ng cĂ¹ng x=60 nhÆ°ng y khĂ¡c (y=190 thay vĂ¬ y=0).'
].join('\n');

const INTERIOR_DIMENSION_ANCHOR_RULE_VI = [
    'QUY Táº®C KĂCH THÆ¯á»C (TUYá»†T Äá»I):',
    '- Náº¿u user nĂªu kĂ­ch thÆ°á»›c (vd. "5 mĂ©t", "260cm", "rá»™ng 3m") -> cabinetModel.width / height / depth PHáº¢I ÄĂNG con sá»‘ Ä‘Ă³ tĂ­nh ra cm.',
    '- "5 mĂ©t" = 500. "2.6 mĂ©t" hoáº·c "2m6" = 260. "60 phĂ¢n" = 60.',
    '- KHĂ”NG nhĂ¢n Ä‘Ă´i, KHĂ”NG chia, KHĂ”NG lĂ m trĂ²n lĂªn 1000.',
    '- Reply text PHáº¢I khá»›p giĂ¡ trá»‹ JSON: náº¿u reply nĂ³i "width 500" thĂ¬ cabinetModel.width = 500, khĂ´ng pháº£i 1000.'
].join('\n');

const INTERIOR_CATALOG_VI = `
DANH Má»¤C TEMPLATE (Æ¯U TIĂN dĂ¹ng cĂ¡c template nĂ y thay vĂ¬ táº¡o box thĂ´):

| id | category | tags | params bounds | style options | mĂ´ táº£ |
|---|---|---|---|---|---|
| upper-2door | upper-cabinet | shaker, bar-handle | w:40-200, h:50-130, d:30-70 | door: shaker\\|flat; handle: bar\\|knob | Tá»§ trĂªn 2 cĂ¡nh shaker, tay náº¯m dá»c |
| upper-glass-2door | upper-cabinet | glass, frame | w:40-200, h:50-130, d:30-70 | handle: bar\\|knob | Tá»§ trĂªn 2 cĂ¡nh kĂ­nh sÆ°Æ¡ng |
| sliding-2door | wardrobe | sliding, finger-pull | w:100-300, h:150-260, d:55-65 | door: flat; track: top-bottom | Tá»§ Ă¡o cá»­a kĂ©o 2 cĂ¡nh + ray trĂªn dÆ°á»›i + finger pull |
| sliding-3door | wardrobe | sliding | w:150-400, h:150-260, d:55-65 | door: flat | Tá»§ Ă¡o cá»­a kĂ©o 3 cĂ¡nh |
| ac-recess-fold | upper-cabinet | ac, fold-down | w:60-130, h:80-130, d:50-65 | (none) | Há»‘c mĂ¡y láº¡nh phĂ­a trĂªn + cĂ¡nh láº­t dÆ°á»›i |
| open-bookshelf | shelf | open, bookshelf | w:80-200, h:40-120, d:25-40 | shelves: 1\\|2\\|3 | Ká»‡ má»Ÿ 1-3 ngÄƒn (sĂ¡ch, Ä‘á»“ trÆ°ng bĂ y) |
| l-desk-return | desk | L-shape, working | w:80-200, d:50-65 | (none) | BĂ n lĂ m viá»‡c chá»¯ L vá»›i main + L return |

QUY Táº®C:
1. Má»—i cabinet trong design: tĂ¬m template phĂ¹ há»£p NHáº¤T theo category + tags + size bounds.
2. Output module: { tpl: '<id>', x, y, z, width, height, depth, style: { door: 'shaker', handle: 'bar' } }.
3. KHĂ”NG match â†’ cĂ³ thá»ƒ Táº O Má»I báº±ng "tplNew" (chá»‰ khi tháº­t sá»± khĂ¡c catalog, Æ°u tiĂªn reuse trÆ°á»›c):
   { tplNew: { id: '<kebab-case má»›i>', version: 1, category: '<Má»˜T TRONG: upper-cabinet, lower-cabinet, wardrobe, shelf, desk, void, other, base-cabinet, wall-cabinet, tall-cabinet, drawer-base, corner-cabinet, island, kitchen-other>', tags: [...], description: { vi, en }, params: { width:{min,max,default}, height:{...}, depth:{...} }, style: { door:{values:[...],default:''} }, boxes: [...] }, x, y, z, width, height, depth, style: {...} }
   QUAN TRá»ŒNG: category PHáº¢I náº±m trong danh sĂ¡ch cá»‘ Ä‘á»‹nh trĂªn. Náº¿u chá»n sai (vd "kitchen-cabinet"), backend sáº½ REJECT tplNew vĂ  module rá»›t vá» raw box xáº¥u. Tá»§ báº¿p dÆ°á»›i = base-cabinet; tá»§ báº¿p trĂªn = wall-cabinet; tá»§ Ä‘á»©ng cao (pantry/tá»§ láº¡nh tower) = tall-cabinet; ngÄƒn kĂ©o nhiá»u táº§ng = drawer-base; tá»§ gĂ³c = corner-cabinet; Ä‘áº£o báº¿p = island.
   DSL grammar:
   - boxes item: { x, y, z, w, h, d, faces: { top, front, right, left, back, bottom }, opacity }.
   - TrÆ°á»ng sá»‘ cĂ³ thá»ƒ lĂ  number HOáº¶C chuá»—i "{{ expr }}" vá»›i expr = arithmetic (+ - * / %) + so sĂ¡nh (== != < <= > >=) + min/max/round/abs + identifier (params.X, style.X, $colorToken: $cab, $woodFront, $handle...).
   - TrÆ°á»ng color: "#hex" hoáº·c "$tokenName". Cáº¤M dĂ¹ng eval/Function/new/[]/=> trong expression.
   - Optional "if": "{{ expr }}" Ä‘á»ƒ bá» qua shape khi false.
4. Váº«n cho phĂ©p legacy box (khĂ´ng cĂ³ tpl/tplNew) khi cáº§n â€” dĂ¹ng materialRef + color nhÆ° cÅ©.
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
3. No match â†’ you may create one via "tplNew" (only when truly different â€” prefer catalog first):
   { tplNew: { id: '<new kebab-case>', version: 1, category: '<ONE OF: upper-cabinet, lower-cabinet, wardrobe, shelf, desk, void, other, base-cabinet, wall-cabinet, tall-cabinet, drawer-base, corner-cabinet, island, kitchen-other>', tags: [...], description: { vi, en }, params: { width:{min,max,default}, height:{...}, depth:{...} }, style: {...}, boxes: [...] }, x, y, z, width, height, depth, style: {...} }
   IMPORTANT: category MUST be in the fixed list above. Wrong category ("kitchen-cabinet" etc.) â†’ backend REJECTS tplNew, module falls back to ugly raw box. Kitchen base cabinet = base-cabinet; upper kitchen = wall-cabinet; tall pantry / fridge tower = tall-cabinet; drawer stack = drawer-base; corner unit = corner-cabinet; kitchen island = island.
   DSL grammar:
   - boxes item: { x, y, z, w, h, d, faces: { top, front, right, left, back, bottom }, opacity }.
   - Numeric fields may be number OR "{{ expr }}" with arithmetic + comparison + min/max/round/abs + identifiers (params.X, style.X, $colorToken: $cab, $woodFront, $handle...).
   - Color fields: "#hex" or "$tokenName". Forbid eval/Function/new/[]/=> in expressions.
   - Optional "if": "{{ expr }}" to skip shape when false.
4. Legacy raw boxes still allowed (no tpl/tplNew) with materialRef + color when needed.
`.trim();

const INTERIOR_REPLY_FORMAT_WITH_IMAGE = [
    'reply Báº®T BUá»˜C báº¯t Ä‘áº§u báº±ng 3 dĂ²ng theo Ä‘Ăºng format nĂ y (giá»¯ nguyĂªn label tiáº¿ng Viá»‡t):',
    '"Quan sĂ¡t áº£nh: <mĂ´ táº£ ngáº¯n nhá»¯ng gĂ¬ tháº¥y trong áº£nh â€” style, mĂ u, váº­t liá»‡u, bá»‘ cá»¥c>.',
    'Hiá»ƒu yĂªu cáº§u: <diá»…n giáº£i láº¡i Ă½ Ä‘á»“ user báº±ng 1-2 cĂ¢u>.',
    'ÄĂ£ Ă¡p dá»¥ng: <liá»‡t kĂª 2-4 thay Ä‘á»•i cá»¥ thá»ƒ trĂªn cabinetModel â€” kĂ­ch thÆ°á»›c/mĂ u/module thĂªm-sá»­a-xĂ³a>."',
    'Sau 3 dĂ²ng Ä‘Ă³ cĂ³ thá»ƒ thĂªm chĂº thĂ­ch thiáº¿t káº¿ náº¿u cáº§n.'
].join('\n');

const INTERIOR_REPLY_FORMAT_NO_IMAGE = [
    'reply Báº®T BUá»˜C báº¯t Ä‘áº§u báº±ng 2 dĂ²ng theo Ä‘Ăºng format nĂ y (giá»¯ nguyĂªn label tiáº¿ng Viá»‡t):',
    '"Hiá»ƒu yĂªu cáº§u: <diá»…n giáº£i láº¡i Ă½ Ä‘á»“ user báº±ng 1-2 cĂ¢u>.',
    'ÄĂ£ Ă¡p dá»¥ng: <liá»‡t kĂª 2-4 thay Ä‘á»•i cá»¥ thá»ƒ trĂªn cabinetModel â€” kĂ­ch thÆ°á»›c/mĂ u/module thĂªm-sá»­a-xĂ³a>."',
    'Sau 2 dĂ²ng Ä‘Ă³ cĂ³ thá»ƒ thĂªm chĂº thĂ­ch thiáº¿t káº¿ náº¿u cáº§n. KHĂ”NG bá»‹a ná»™i dung áº£nh vĂ¬ khĂ´ng cĂ³ áº£nh.'
].join('\n');

const INTERIOR_FEW_SHOT = [
    'VĂ­ dá»¥ output JSON Há»¢P Lá»† (compact):',
    '{"reply":"Quan sĂ¡t áº£nh: tá»§ Ă¡o cĂ¡nh trÆ°á»£t 2 cĂ¡nh kĂ­nh má», khung gá»— Ă³c chĂ³ tá»‘i mĂ u.\\nHiá»ƒu yĂªu cáº§u: muá»‘n tá»§ Ă¡o 2 cĂ¡nh trÆ°á»£t, 200 rá»™ng, cĂ³ ngÄƒn kĂ©o dÆ°á»›i.\\nÄĂ£ Ă¡p dá»¥ng: width 200, height 240, depth 60; thĂªm 2 cĂ¡nh trÆ°á»£t; thĂªm 2 ngÄƒn kĂ©o dÆ°á»›i cao 25.","askForInfo":false,"cabinetModel":{"title":"Tá»§ Ă¡o cĂ¡nh trÆ°á»£t","units":"cm","width":200,"height":240,"depth":60,"materials":{"board":"#8a623d"},"modules":[{"type":"panel","label":"Khoang chĂ­nh","kind":"box","materialRef":"wood-oak","x":0,"y":50,"z":0,"width":200,"height":190,"depth":60,"color":"#8a623d"},{"type":"drawer-zone","label":"NgÄƒn kĂ©o","kind":"box","materialRef":"wood-walnut","x":0,"y":0,"z":0,"width":200,"height":50,"depth":60,"color":"#5c3d22"}],"details":[{"type":"sliding-door","label":"CĂ¡nh trĂ¡i","x":0,"y":50,"z":58,"width":100,"height":190,"depth":2,"color":"#e8f0f5"},{"type":"sliding-door","label":"CĂ¡nh pháº£i","x":100,"y":50,"z":58,"width":100,"height":190,"depth":2,"color":"#e8f0f5"}],"specs":[["KĂ­ch thÆ°á»›c","200 x 240 x 60 cm","CĂ¡nh trÆ°á»£t kĂ­nh má»"]]}}',
    '{"reply":"Hiá»ƒu yĂªu cáº§u: tá»§ báº¿p chá»¯ L 500 x 100, cĂ³ tá»§ Ä‘á»©ng gĂ³c, khoang tá»§ láº¡nh, tá»§ dÆ°á»›i + tá»§ trĂªn.\\nÄĂ£ Ă¡p dá»¥ng: runs[] 2 nhĂ¡nh; main run east cĂ³ 5 module vá»›i x tuyá»‡t Ä‘á»‘i (0,60,140,140,140); module stack dĂ¹ng cĂ¹ng x, khĂ¡c y.","askForInfo":false,"cabinetModel":{"title":"Tá»§ báº¿p chá»¯ L cĂ³ tá»§ trĂªn","units":"cm","width":500,"height":260,"depth":60,"materials":{"board":"#c9986b"},"runs":[{"id":"main","origin":{"x":0,"z":0},"direction":"east","modules":[{"type":"tall-cabinet","label":"Tá»§ Ä‘á»©ng gĂ³c","kind":"box","materialRef":"wood-oak","x":0,"y":0,"z":0,"width":60,"height":260,"depth":60,"color":"#c9986b"},{"type":"fridge-slot","label":"Khoang tá»§ láº¡nh","kind":"void","x":60,"y":0,"z":0,"width":80,"height":190,"depth":60},{"type":"base-cabinet","label":"Tá»§ báº¿p dÆ°á»›i","kind":"box","materialRef":"wood-oak","x":140,"y":0,"z":0,"width":360,"height":86,"depth":60,"color":"#c9986b"},{"type":"upper-cabinet","label":"Tá»§ báº¿p trĂªn","kind":"box","materialRef":"wood-oak","x":140,"y":140,"z":25,"width":360,"height":80,"depth":35,"color":"#c9986b"},{"type":"ceiling-cabinet","label":"Tá»§ ká»‹ch tráº§n","kind":"box","materialRef":"wood-oak","x":140,"y":220,"z":25,"width":360,"height":40,"depth":35,"color":"#c9986b"}]},{"id":"return","origin":{"x":0,"z":0},"direction":"north","modules":[{"type":"base-cabinet","label":"NhĂ¡nh L","kind":"box","materialRef":"wood-oak","x":0,"y":0,"z":0,"width":100,"height":86,"depth":60,"color":"#c9986b"}]}],"details":[],"specs":[["Bá»‘ cá»¥c","Chá»¯ L 500 x 100 cm","CĂ³ tá»§ trĂªn + tá»§ dÆ°á»›i"]]}}',
    '{"reply":"Hiá»ƒu yĂªu cáº§u: tá»§ Ă¡o chá»¯ L cĂ³ cĂ¡nh kĂ©o vĂ  tá»§ trĂªn.\\nÄĂ£ Ă¡p dá»¥ng: dĂ¹ng template sliding-2door cho khoang chĂ­nh vĂ  upper-2door cho nhĂ¡nh phá»¥.","askForInfo":false,"cabinetModel":{"title":"Tá»§ Ă¡o template","units":"cm","width":300,"height":260,"depth":180,"palette":"wood-oak","runs":[{"id":"main","origin":{"x":0,"z":0},"direction":"east","modules":[{"tpl":"sliding-2door","x":0,"y":0,"z":0,"width":220,"height":240,"depth":60,"style":{"door":"flat","handle":"finger-pull"}}]},{"id":"return","origin":{"x":220,"z":0},"direction":"north","modules":[{"tpl":"upper-2door","x":0,"y":150,"z":0,"width":120,"height":90,"depth":60,"style":{"door":"shaker","handle":"bar"}}]}],"details":[],"inlineTemplates":{},"specs":[["Template","sliding-2door + upper-2door","Æ¯u tiĂªn template thay vĂ¬ box thĂ´"]]}}',
    '{"reply":"Hiá»ƒu yĂªu cáº§u: tá»§ Ä‘áº§u giÆ°á»ng cĂ³ khe Ä‘Ă¨n LED uá»‘n cong, khĂ´ng cĂ³ trong catalog.\\nÄĂ£ Ă¡p dá»¥ng: dĂ¹ng tplNew táº¡o template má»›i \\"led-nightstand\\" vá»›i 1 khoang chĂ­nh + line LED phĂ¡t sĂ¡ng phĂ­a trĂªn.","askForInfo":false,"cabinetModel":{"title":"Tá»§ Ä‘áº§u giÆ°á»ng LED","units":"cm","width":60,"height":50,"depth":40,"palette":"wood-walnut","modules":[{"tplNew":{"id":"led-nightstand","version":1,"category":"lower-cabinet","tags":["led","nightstand"],"description":{"vi":"Tá»§ Ä‘áº§u giÆ°á»ng cĂ³ khe LED","en":"Nightstand with LED strip"},"params":{"width":{"min":40,"max":80,"default":60},"height":{"min":40,"max":60,"default":50},"depth":{"min":30,"max":50,"default":40}},"style":{},"boxes":[{"x":0,"y":0,"z":0,"w":"{{width}}","h":"{{height}}","d":"{{depth}}","faces":{"top":"$woodTop","front":"$woodFront","right":"$woodSide","left":"$woodDark","back":"$woodBack"}},{"x":2,"y":"{{height - 4}}","z":"{{depth - 0.5}}","w":"{{width - 4}}","h":2,"d":0.5,"faces":{"front":"#fff4c4"}}]},"x":0,"y":0,"z":0,"width":60,"height":50,"depth":40}],"details":[],"specs":[["tplNew","led-nightstand","Template má»›i do AI táº¡o, chá» admin duyá»‡t"]]}}'
].join('\n');

function buildInteriorPrompt({ message, refImageUrls, project, baseModel, proposalContext = '' }) {
    const hasImages = refImageUrls.length > 0;
    const recent = project.versions
        .slice(-8)
        .filter((version) => version.userPrompt || version.aiReply)
        .map((version) => `V${version.index} USER: ${version.userPrompt || '(rollback)'}\nAI: ${version.aiReply || ''}`)
        .join('\n\n');

    const refImageNote = hasImages
        ? `NgÆ°á»i dĂ¹ng Ä‘Ă­nh kĂ¨m ${refImageUrls.length} áº£nh tham chiáº¿u (Ä‘Ă­nh kĂ¨m cĂ¹ng prompt nĂ y â€” hĂ£y quan sĂ¡t ká»¹ trÆ°á»›c khi sinh model).`
        : 'Láº§n nĂ y KHĂ”NG cĂ³ áº£nh tham chiáº¿u â€” KHĂ”NG bá»‹a hay Ä‘á» cáº­p áº£nh trong reply.';

    const replyFormat = hasImages ? INTERIOR_REPLY_FORMAT_WITH_IMAGE : INTERIOR_REPLY_FORMAT_NO_IMAGE;

    const askForInfoRule = [
        'Äáº·t askForInfo=true (giá»¯ nguyĂªn cabinetModel hiá»‡n táº¡i, reply lĂ  cĂ¢u há»i) Náº¾U:',
        hasImages ? '- áº¢nh quĂ¡ má»/khĂ´ng liĂªn quan/khĂ´ng xĂ¡c Ä‘á»‹nh Ä‘Æ°á»£c loáº¡i tá»§.' : null,
        '- YĂªu cáº§u user dÆ°á»›i 5 tá»« vĂ  khĂ´ng cĂ³ áº£nh.',
        '- KhĂ´ng xĂ¡c Ä‘á»‹nh Ä‘Æ°á»£c Ă­t nháº¥t 1 trong 3: kĂ­ch thÆ°á»›c, chá»©c nÄƒng tá»§ (Ă¡o/báº¿p/sĂ¡ch...), váº­t liá»‡u/mĂ u.',
        'NgÆ°á»£c láº¡i askForInfo=false vĂ  sinh cabinetModel.'
    ].filter(Boolean).join('\n');

    const proposalNote = proposalContext
        ? `ÄĂ£ cĂ³ proposal user xĂ¡c nháº­n tá»« bÆ°á»›c phĂ¢n tĂ­ch trÆ°á»›c (hĂ£y bĂ¡m sĂ¡t):\n${proposalContext}`
        : '';

    return [
        'Báº¡n lĂ  trá»£ lĂ½ thiáº¿t káº¿ ná»™i tháº¥t cho Alpha Studio (chuyĂªn vá» tá»§ vĂ  ná»™i tháº¥t Viá»‡t Nam).',
        'Nhiá»‡m vá»¥: táº¡o hoáº·c chá»‰nh cabinetModel JSON cho Interior Design Engine.',
        'Chá»‰ tráº£ vá» JSON thuáº§n (khĂ´ng markdown, khĂ´ng ```), schema: {"reply": string, "askForInfo": boolean, "cabinetModel": object}.',
        INTERIOR_DIMENSION_ANCHOR_RULE_VI,
        replyFormat,
        askForInfoRule,
        'cabinetModel báº¯t buá»™c: width/height/depth sá»‘ dÆ°Æ¡ng (cm), modules lĂ  máº£ng â‰¥1 pháº§n tá»­, má»—i module/detail cĂ³ x,y,z,width,height,depth lĂ  sá»‘.',
        INTERIOR_DOMAIN_HINTS,
        INTERIOR_RUNS_RULE_VI,
        INTERIOR_CATALOG_VI,
        INTERIOR_FEW_SHOT,
        refImageNote,
        recent ? `Lá»‹ch sá»­ gáº§n Ä‘Ă¢y:\n${recent}` : 'ChÆ°a cĂ³ lá»‹ch sá»­ chat.',
        `cabinetModel hiá»‡n táº¡i:\n${JSON.stringify(baseModel)}`,
        proposalNote,
        `YĂªu cáº§u má»›i cá»§a ngÆ°á»i dĂ¹ng:\n${message}`
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
        ? `NgÆ°á»i dĂ¹ng Ä‘Ă­nh kĂ¨m ${refImageUrls.length} áº£nh tham chiáº¿u (Ä‘Ă­nh kĂ¨m cĂ¹ng prompt nĂ y â€” hĂ£y quan sĂ¡t ráº¥t ká»¹).`
        : 'Láº§n nĂ y KHĂ”NG cĂ³ áº£nh tham chiáº¿u â€” bá» qua pháº§n phĂ¢n tĂ­ch áº£nh.';

    const observationField = hasImages
        ? '  "observation": "string â€” mĂ´ táº£ áº£nh: style, váº­t liá»‡u, mĂ u, bá»‘ cá»¥c, kĂ­ch thÆ°á»›c Æ°á»›c tĂ­nh. Tá»‘i Ä‘a 250 tá»«.",'
        : '  "observation": "" (chuá»—i rá»—ng â€” KHĂ”NG bá»‹a ná»™i dung áº£nh vĂ¬ khĂ´ng cĂ³ áº£nh),';

    return [
        'Báº¡n lĂ  trá»£ lĂ½ thiáº¿t káº¿ ná»™i tháº¥t cho Alpha Studio.',
        'ÄĂ¢y lĂ  BÆ¯á»C PHĂ‚N TĂCH (chÆ°a táº¡o cabinetModel). Má»¥c tiĂªu: giĂºp user review/chá»‰nh Ä‘á» xuáº¥t + tráº£ lá»i cĂ¢u há»i clarify trÆ°á»›c khi sinh JSON á»Ÿ bÆ°á»›c sau.',
        'Tráº£ vá» JSON THUáº¦N (khĂ´ng markdown ```, khĂ´ng text ngoĂ i JSON) theo schema:',
        '{',
        observationField,
        '  "understanding": "string â€” diá»…n giáº£i láº¡i Ă½ Ä‘á»“ user báº±ng 2-3 cĂ¢u. Tá»‘i Ä‘a 100 tá»«.",',
        '  "proposedChanges": ["string", ...] â€” máº£ng 3-6 thay Ä‘á»•i cá»¥ thá»ƒ trĂªn cabinetModel hiá»‡n táº¡i (kĂ­ch thÆ°á»›c W x H x D, mĂ u HEX, module thĂªm/sá»­a/xĂ³a). Má»—i item má»™t cĂ¢u ngáº¯n.,',
        '  "questions": [ { "question": "string", "options": ["string", ...] } , ... ]',
        '}',
        '- questions: 0-3 cĂ¢u há»i Ä‘á»ƒ clarify. CHá»ˆ há»i khi tháº­t sá»± cáº§n (kĂ­ch thÆ°á»›c cá»¥ thá»ƒ, váº­t liá»‡u, vá»‹ trĂ­, sá»‘ ngÄƒn...). Má»—i cĂ¢u cĂ³ 2-4 options gá»£i Ă½, NĂN cĂ³ 1 option "Äá»ƒ AI tá»± quyáº¿t" hoáº·c tÆ°Æ¡ng tá»±. Náº¿u khĂ´ng cáº§n há»i â†’ questions: [].',
        '- Táº¥t cáº£ text pháº£i báº±ng tiáº¿ng Viá»‡t.',
        '- KHĂ”NG sinh cabinetModel á»Ÿ bÆ°á»›c nĂ y.',
        INTERIOR_DOMAIN_HINTS,
        INTERIOR_RUNS_RULE_VI,
        INTERIOR_CATALOG_VI,
        refImageNote,
        recent ? `Lá»‹ch sá»­ gáº§n Ä‘Ă¢y:\n${recent}` : 'ChÆ°a cĂ³ lá»‹ch sá»­ chat.',
        `cabinetModel hiá»‡n táº¡i:\n${JSON.stringify(baseModel)}`,
        `YĂªu cáº§u má»›i cá»§a ngÆ°á»i dĂ¹ng:\n${message}`
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
    if (structured.observation) lines.push(`Quan sĂ¡t áº£nh: ${structured.observation}`);
    if (structured.understanding) lines.push(`Hiá»ƒu yĂªu cáº§u: ${structured.understanding}`);
    if (structured.proposedChanges?.length) {
        lines.push('Äá» xuáº¥t thay Ä‘á»•i:');
        structured.proposedChanges.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
    }
    if (structured.questions?.length) {
        lines.push('CĂ¢u há»i xĂ¡c nháº­n:');
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
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ táº£i danh sĂ¡ch dá»± Ă¡n.' });
    }
});

// â”€â”€â”€ Template catalog (engine load + user commit) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// GET /templates returns seed + approved templates merged by templateId
// (highest version wins). Engine consumes this on init.
//
// POST /templates accepts a project ID + inline template ID; the inline DSL is
// promoted to a new InteriorTemplate row with status='pending' so admins can
// review. The inline copy stays in the project â€” committing only makes the
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

function stableJson(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function normalizeWorkshopIds(ids) {
    return Array.from(new Set((Array.isArray(ids) ? ids : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)));
}

async function rebuildWorkshopBundle() {
    const entries = await fs.readdir(INTERIOR_WORKSHOP_COMPONENTS_DIR, { withFileTypes: true });
    const files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));

    const templates = [];
    for (const fileName of files) {
        const filePath = path.join(INTERIOR_WORKSHOP_COMPONENTS_DIR, fileName);
        const template = JSON.parse(await fs.readFile(filePath, 'utf8'));
        if (!template?.id || !Array.isArray(template.boxes) || template.boxes.length === 0) {
            throw new Error(`Component source không hợp lệ: ${fileName}`);
        }
        templates.push(template);
    }

    const bundle = [
        '// Generated from components/*.json. Do not edit by hand.',
        'window.ICL_TEMPLATE_BUNDLE = ',
        JSON.stringify(templates, null, 2),
        ';',
        ''
    ].join('\n');
    await fs.writeFile(INTERIOR_WORKSHOP_BUNDLE_PATH, bundle, 'utf8');
    return templates.length;
}

async function deleteWorkshopComponentSources(ids) {
    const componentRoot = await fs.realpath(INTERIOR_WORKSHOP_COMPONENTS_DIR);
    const removed = [];
    const missing = [];
    const rejected = [];

    for (const id of normalizeWorkshopIds(ids)) {
        if (!/^[a-z][a-z0-9-]{1,63}$/.test(id)) {
            rejected.push({ id, reason: 'invalid-id' });
            continue;
        }

        const filePath = path.resolve(INTERIOR_WORKSHOP_COMPONENTS_DIR, `${id}.json`);
        if (!filePath.startsWith(`${componentRoot}${path.sep}`)) {
            rejected.push({ id, reason: 'path-escaped-components' });
            continue;
        }

        try {
            await fs.unlink(filePath);
            removed.push(id);
        } catch (error) {
            if (error.code === 'ENOENT') missing.push(id);
            else throw error;
        }
    }

    const remaining = removed.length ? await rebuildWorkshopBundle() : null;
    return { removed, missing, rejected, remaining };
}

function isLoopbackRequest(req) {
    const ip = req.ip || req.socket?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function isAllowedWorkshopOrigin(req) {
    const origin = req.headers.origin;
    if (!origin || origin === 'null') return true;
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function ensureWorkshopWriteAllowed(req, res, next) {
    const enabled = process.env.NODE_ENV !== 'production' || process.env.INTERIOR_WORKSHOP_DELETE_ENABLED === 'true';
    if (!enabled) {
        return res.status(403).json({
            success: false,
            message: 'Tính năng xóa file Workshop chỉ bật trong môi trường local/dev.'
        });
    }
    if (!isLoopbackRequest(req)) {
        return res.status(403).json({
            success: false,
            message: 'Chỉ cho phép xóa file Workshop từ localhost.'
        });
    }
    if (!isAllowedWorkshopOrigin(req)) {
        return res.status(403).json({
            success: false,
            message: 'Origin không được phép xóa file Workshop.'
        });
    }
    return next();
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

        // Dedupe by templateId â€” highest version wins
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
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ táº£i danh má»¥c template.' });
    }
});

router.post('/templates/import', authMiddleware, async (req, res) => {
    try {
        const incoming = Array.isArray(req.body?.templates) ? req.body.templates : [];
        if (!incoming.length) {
            return res.status(400).json({ success: false, message: 'ChÆ°a chá»n template Ä‘á»ƒ import.' });
        }
        if (incoming.length > 50) {
            return res.status(400).json({ success: false, message: 'Má»—i láº§n import tá»‘i Ä‘a 50 template.' });
        }

        const canApprove = req.user?.role === 'admin' || req.user?.role === 'mod';
        const targetStatus = canApprove ? 'approved' : 'pending';
        const imported = [];
        const skipped = [];
        const rejected = [];

        for (const raw of incoming) {
            const candidate = {
                id: typeof raw?.id === 'string' ? raw.id.trim() : '',
                category: raw?.category || 'other',
                tags: Array.isArray(raw?.tags) ? raw.tags.slice(0, 20) : [],
                params: raw?.params || {},
                dsl: extractDsl(raw)
            };
            const validation = validateTemplateStructure(candidate);
            if (!validation.valid) {
                rejected.push({ id: candidate.id || '(missing)', message: validation.message });
                continue;
            }

            const latest = await InteriorTemplate.findOne({ templateId: candidate.id })
                .sort({ version: -1 })
                .lean();
            const normalizedLatest = latest ? {
                category: latest.category,
                tags: latest.tags || [],
                params: latest.params || {},
                style: latest.styleOptions || {},
                dsl: latest.dsl || {}
            } : null;
            const normalizedIncoming = {
                category: candidate.category,
                tags: candidate.tags,
                params: candidate.params,
                style: raw.style && typeof raw.style === 'object' && !Array.isArray(raw.style) ? raw.style : {},
                dsl: candidate.dsl
            };
            if (normalizedLatest && stableJson(normalizedLatest) === stableJson(normalizedIncoming)) {
                skipped.push({ id: candidate.id, version: latest.version, reason: 'same-as-latest' });
                continue;
            }
            const version = latest ? latest.version + 1 : 1;
            const created = await InteriorTemplate.create({
                templateId: candidate.id,
                version,
                name: raw.name && typeof raw.name === 'object' && !Array.isArray(raw.name)
                    ? raw.name
                    : { vi: raw.title || candidate.id, en: raw.title || candidate.id },
                description: raw.description && typeof raw.description === 'object' && !Array.isArray(raw.description)
                    ? raw.description
                    : { vi: '', en: '' },
                category: candidate.category,
                tags: candidate.tags,
                params: candidate.params,
                styleOptions: raw.style && typeof raw.style === 'object' && !Array.isArray(raw.style) ? raw.style : {},
                dsl: candidate.dsl,
                status: targetStatus,
                authorId: req.user._id,
                sourceInlineId: raw.source || 'interior-component-workshop',
                previewDims: raw.previewDims || null
            });
            imported.push({ id: created.templateId, version: created.version, status: created.status });
        }

        if (!imported.length && !skipped.length) {
            return res.status(400).json({
                success: false,
                message: 'KhĂ´ng import Ä‘Æ°á»£c template nĂ o.',
                data: { imported, skipped, rejected }
            });
        }

        return res.status(201).json({
            success: true,
            message: imported.length === 0 && skipped.length > 0
                ? 'CĂ¡c template Ä‘Ă£ cĂ³ sáºµn trong library.'
                : canApprove
                ? 'ÄĂ£ import template vĂ o library.'
                : 'ÄĂ£ gá»­i template vĂ o hĂ ng chá» admin review.',
            data: { imported, skipped, rejected }
        });
    } catch (error) {
        console.error('Interior templates direct import error:', error);
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ import template.' });
    }
});

router.post('/workshop/components/delete', ensureWorkshopWriteAllowed, async (req, res) => {
    try {
        const ids = normalizeWorkshopIds(req.body?.ids);
        if (!ids.length) {
            return res.status(400).json({ success: false, message: 'Chưa chọn component để xóa.' });
        }
        if (ids.length > 100) {
            return res.status(400).json({ success: false, message: 'Mỗi lần xóa tối đa 100 component.' });
        }

        const result = await deleteWorkshopComponentSources(ids);
        return res.json({
            success: true,
            message: result.removed.length
                ? 'Đã xóa file component Workshop và cập nhật bundle.'
                : 'Không có file component Workshop nào được xóa.',
            data: result
        });
    } catch (error) {
        console.error('Interior workshop component delete error:', error);
        return res.status(500).json({ success: false, message: 'Không thể xóa file component Workshop.' });
    }
});

router.post('/templates', authMiddleware, async (req, res) => {
    try {
        const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId.trim() : '';
        const inlineTemplateId = typeof req.body?.inlineTemplateId === 'string' ? req.body.inlineTemplateId.trim() : '';
        if (!projectId || !inlineTemplateId) {
            return res.status(400).json({ success: false, message: 'Thiáº¿u projectId hoáº·c inlineTemplateId.' });
        }

        const project = await findOwnedProject(projectId, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y dá»± Ă¡n.' });

        const baseVersion = currentVersion(project);
        const inlineDict = baseVersion?.modelJson?.inlineTemplates || {};
        const inlineTpl = inlineDict[inlineTemplateId];
        if (!inlineTpl) {
            return res.status(404).json({ success: false, message: `KhĂ´ng tĂ¬m tháº¥y template inline "${inlineTemplateId}".` });
        }

        const candidate = {
            id: typeof inlineTpl.id === 'string' && inlineTpl.id.trim() ? inlineTpl.id.trim() : inlineTemplateId,
            category: inlineTpl.category || 'other',
            params: inlineTpl.params || {},
            dsl: extractDsl(inlineTpl)
        };
        const validation = validateTemplateStructure(candidate);
        if (!validation.valid) {
            return res.status(400).json({ success: false, message: `Template khĂ´ng há»£p lá»‡: ${validation.message}` });
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
            message: 'ÄĂ£ gá»­i template cho admin review.',
            data: { templateId: created.templateId, _id: created._id }
        });
    } catch (error) {
        console.error('Interior templates commit error:', error);
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ gá»­i template.' });
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
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ táº¡o dá»± Ă¡n.' });
    }
});

router.get('/projects/:id', authMiddleware, async (req, res) => {
    try {
        const project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y dá»± Ă¡n.' });
        return res.json({ success: true, data: { project: await serializeProject(project) } });
    } catch (error) {
        console.error('Interior get project error:', error);
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ táº£i dá»± Ă¡n.' });
    }
});

router.patch('/projects/:id', authMiddleware, async (req, res) => {
    try {
        const project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y dá»± Ă¡n.' });
        if (typeof req.body?.name === 'string') {
            const name = req.body.name.trim();
            if (!name) return res.status(400).json({ success: false, message: 'TĂªn dá»± Ă¡n khĂ´ng há»£p lá»‡.' });
            project.name = name.slice(0, 120);
        }
        await project.save();
        return res.json({ success: true, data: { project: await serializeProject(project) } });
    } catch (error) {
        console.error('Interior update project error:', error);
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ cáº­p nháº­t dá»± Ă¡n.' });
    }
});

router.delete('/projects/:id', authMiddleware, async (req, res) => {
    try {
        const project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y dá»± Ă¡n.' });
        project.isDeleted = true;
        await project.save();
        return res.json({ success: true, data: { deleted: true } });
    } catch (error) {
        console.error('Interior delete project error:', error);
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ xĂ³a dá»± Ă¡n.' });
    }
});

const INTERIOR_ALLOWED_MODELS = ['gemini-3-flash-preview', 'gemini-3.1-pro-preview'];
// Default Pro for /chat apply: cabinet model synthesis needs strong reasoning to
// (a) pick the right template + style from catalog, (b) compose valid DSL for
// tplNew, (c) avoid silent fallback to ugly raw boxes. Flash remains opt-in via
// frontend model selector for quick low-stakes edits. /analyze-image (image
// summarization) keeps Flash default â€” see ANALYZE_DEFAULT_MODEL below.
const INTERIOR_DEFAULT_MODEL = 'gemini-3.1-pro-preview';

const FLASH_MODEL = 'gemini-3-flash-preview';
const PRO_MODEL = 'gemini-3.1-pro-preview';
const FLASH_DELEGATE_DEFAULT = process.env.INTERIOR_AGENT_FLASH_DELEGATE === 'true';
// Tool names that are mechanical state mutations â€” safe to delegate to Flash
// when primary model is Pro. Reads, terminals, and any error step force the
// next turn back to Pro for reasoning.
const FLASH_DELEGATABLE_TOOLS = new Set([
    'module.add', 'module.update', 'module.remove',
    'run.add', 'run.update',
    'model.setPalette', 'model.setDimensions'
]);

function isAllowedModel(model) {
    return model === FLASH_MODEL || model === PRO_MODEL;
}

function pickNextTurnModel({ primaryModel, delegateFlash, lastStepTool, lastStepOk }) {
    if (!delegateFlash || primaryModel !== PRO_MODEL) return primaryModel;
    if (lastStepOk === false) return PRO_MODEL; // escalate on failure
    if (lastStepTool && FLASH_DELEGATABLE_TOOLS.has(lastStepTool)) return FLASH_MODEL;
    return PRO_MODEL;
}

// Persist a partial run state. Best-effort: failure shouldn't break the loop.
async function persistRunState(logId, patch) {
    if (!logId) return;
    try {
        await InteriorAgentLog.updateOne({ _id: logId }, { $set: { ...patch, lastActiveAt: new Date() } });
    } catch (err) {
        console.warn('[interior:agent-log] persist failed:', err.message);
    }
}

async function runInteriorAgentSession({
    req, res,
    log,
    project,
    ctx,
    selectedModel,
    delegateFlash,
    initialMessages,
    initialStepIndex,
    initialPrompt,
    maxSteps,
    startedAt
}) {
    const steps = (log.steps || []).map((s) => ({ ...s }));
    let keepAlive = null;
    const abortController = new AbortController();
    req.on('close', () => abortController.abort());
    ctx.abortSignal = abortController.signal;

    setSseHeaders(res);
    keepAlive = setInterval(() => {
        if (!res.writableEnded) res.write(':ping\n\n');
    }, 15000);

    // Routing state: starts on user's primary model; mutates per-step based on
    // delegate setting + previous tool result.
    let nextTurnModel = log.nextTurnModel && isAllowedModel(log.nextTurnModel) ? log.nextTurnModel : selectedModel;

    writeEvent(res, 'run-started', { runId: String(log._id), stepsCount: steps.length, resuming: initialStepIndex > 0 });

    try {
        const result = await runAgentLoop({
            initialPrompt,
            initialMessages,
            initialStepIndex,
            systemPrompt: buildAgentSystemPrompt(),
            registry: interiorRegistry,
            ctx,
            maxSteps,
            aiCall: async ({ messages, systemPrompt }) => {
                const turnModel = nextTurnModel;
                const ai = await callGcliDirect('', { model: turnModel, messages, systemPrompt });
                const resolvedModel = ai.model && isAllowedModel(ai.model) ? ai.model : turnModel;
                ctx.aiModel = resolvedModel;
                ctx.usage = ai.usage || ctx.usage;
                ctx.lastMessages = messages; // snapshot for persistence
                return ai;
            },
            onStep: async (index, step) => {
                const tokens = ctx.usage
                    ? {
                        prompt: ctx.usage.promptTokens || 0,
                        completion: ctx.usage.completionTokens || 0,
                        total: ctx.usage.totalTokens || 0
                    }
                    : null;
                steps[index] = {
                    index,
                    ...step,
                    result: null,
                    latencyMs: null,
                    model: ctx.aiModel || nextTurnModel,
                    tokens
                };
                writeEvent(res, 'step', steps[index]);
            },
            onResult: async (index, toolResult, latencyMs) => {
                const prev = steps[index] || { index };
                steps[index] = {
                    ...prev,
                    result: toolResult,
                    latencyMs,
                    error: toolResult && toolResult.ok === false ? (toolResult.error || '') : ''
                };
                writeEvent(res, 'step-result', { index, result: toolResult, latencyMs });

                // Adaptive routing: decide next turn's model based on this step's
                // outcome. delegateFlash + Pro primary + mechanical mutate success
                // â†’ next = Flash. Anything else â†’ primary (Pro).
                nextTurnModel = pickNextTurnModel({
                    primaryModel: selectedModel,
                    delegateFlash,
                    lastStepTool: prev.tool,
                    lastStepOk: toolResult?.ok !== false
                });

                // Progressive persistence: store steps + draft + messages snapshot.
                await persistRunState(log._id, {
                    steps: steps.filter(Boolean),
                    stepsCount: steps.filter(Boolean).length,
                    draftModel: ctx.draftModel,
                    messages: ctx.lastMessages || [],
                    totalTokens: ctx.totalTokens || 0,
                    nextTurnModel,
                    status: 'running'
                });
            },
            onDone: async (data) => {
                const credit = ctx.agentCredit || { charged: false, balance: req.user.balance ?? 0 };
                const serialized = await serializeProject(project);
                writeEvent(res, 'done', {
                    runId: String(log._id),
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

        // Status mapping:
        //   committed â†’ terminal success (AI called model.commit, version saved)
        //   aborted   â†’ terminal abort (AI called model.abort tool intentionally)
        //   anything else (maxSteps / interrupted / error / parse-fail / aiCall-throw)
        //              â†’ resumable 'paused'. The yellow banner shows the reason
        //              and the user can hit Resume to try again. Run state has
        //              already been persisted incrementally per-step.
        const status = result.status === 'committed'
            ? 'committed'
            : result.status === 'aborted'
                ? 'aborted'
                : 'paused';

        await persistRunState(log._id, {
            status,
            steps: steps.filter(Boolean),
            stepsCount: steps.filter(Boolean).length,
            totalTokens: ctx.totalTokens || 0,
            finalReply: result.data?.reply || '',
            abortReason: result.data?.reason || result.error?.message || '',
            finishedAt: status === 'committed' || status === 'aborted' ? new Date() : null,
            messages: ctx.lastMessages || [],
            draftModel: ctx.draftModel,
            nextTurnModel
        });

        if (status === 'paused') {
            writeEvent(res, 'paused', {
                runId: String(log._id),
                stepsCount: steps.filter(Boolean).length,
                reason: result.error?.message || 'ÄĂ£ Ä‘áº¡t giá»›i háº¡n bÆ°á»›c trong phiĂªn nĂ y.'
            });
        }
    } catch (error) {
        console.error('Interior agent session error:', error);
        if (!res.headersSent) {
            if (keepAlive) clearInterval(keepAlive);
            return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ cháº¡y agent thiáº¿t káº¿.' });
        }
        writeEvent(res, 'error', { message: error.message || 'KhĂ´ng thá»ƒ cháº¡y agent thiáº¿t káº¿.' });
        await persistRunState(log._id, {
            status: 'error',
            steps: steps.filter(Boolean),
            stepsCount: steps.filter(Boolean).length,
            abortReason: error.message || '',
            finishedAt: new Date()
        });
    } finally {
        if (keepAlive) clearInterval(keepAlive);
        if (res.headersSent) closeSse(res);
    }
}

router.post('/projects/:id/agent', authMiddleware, async (req, res) => {
    const startedAt = new Date();
    let project = null;
    let log = null;
    try {
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const rawRefImageUrls = Array.isArray(req.body?.refImageUrls)
            ? req.body.refImageUrls
            : (typeof req.body?.refImageUrl === 'string' ? [req.body.refImageUrl] : []);
        const refImageUrls = rawRefImageUrls.filter((url) => typeof url === 'string' && url.trim()).map((url) => url.trim()).slice(0, 5);
        const requestedModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
        const selectedModel = INTERIOR_ALLOWED_MODELS.includes(requestedModel) ? requestedModel : INTERIOR_DEFAULT_MODEL;
        const delegateFlash = typeof req.body?.delegateFlash === 'boolean' ? req.body.delegateFlash : FLASH_DELEGATE_DEFAULT;
        if (!message) return res.status(400).json({ success: false, message: 'Vui lĂ²ng nháº­p yĂªu cáº§u thiáº¿t káº¿.' });
        if (message.length > MAX_USER_PROMPT_CHARS) return res.status(400).json({ success: false, message: `YĂªu cáº§u quĂ¡ dĂ i, tá»‘i Ä‘a ${MAX_USER_PROMPT_CHARS} kĂ½ tá»±.` });
        if (!isUnlimited(req.user.role) && (req.user.balance || 0) < INTERIOR_AGENT_CREDIT_COST) {
            return res.status(402).json({
                success: false,
                message: `Cáº§n ${INTERIOR_AGENT_CREDIT_COST} credit Ä‘á»ƒ cháº¡y agent, hiá»‡n cĂ³ ${req.user.balance || 0}.`,
                data: { cost: INTERIOR_AGENT_CREDIT_COST, balance: req.user.balance || 0 }
            });
        }
        project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y dá»± Ă¡n.' });
        if (project.versions.length >= MAX_VERSIONS_PER_PROJECT) return res.status(409).json({ success: false, message: 'Dá»± Ă¡n Ä‘Ă£ Ä‘áº¡t giá»›i háº¡n phiĂªn báº£n.' });

        const baseVersion = currentVersion(project);
        const baseModel = structuredClone(baseVersion?.modelJson || defaultCabinetModel());
        // Stamp module IDs onto legacy modules (default-model boxes, prior /chat
        // modules without IDs) so the AI agent can reference them via
        // module.update / module.remove. Without this the initial prompt
        // snapshot shows id-less modules and AI loops trying to address them.
        ensureInteriorDraft(baseModel);
        const initialPrompt = buildAgentInitialPrompt({ message, refImageUrls, baseModel });
        const maxSteps = Math.min(Math.max(Number(req.body?.maxSteps) || 30, 1), 60);

        log = await InteriorAgentLog.create({
            userId: req.user._id,
            projectId: project._id,
            startedAt,
            status: 'running',
            userPrompt: message,
            refImageUrls,
            selectedModel,
            delegateFlash,
            draftModel: baseModel,
            messages: [{ role: 'user', content: initialPrompt }],
            nextTurnModel: selectedModel,
            lastActiveAt: new Date()
        });

        const ctx = {
            project,
            draftModel: baseModel,
            userPrompt: message,
            refImageUrls,
            aiModel: selectedModel,
            usage: null,
            totalTokens: 0,
            beforeCommit: async () => {
                if (ctx.agentCredit) return { ok: true };
                const credit = await deductInteriorCredit(req.user, INTERIOR_AGENT_CREDIT_COST);
                if (credit.rejected) {
                    return {
                        ok: false,
                        error: `Cáº§n ${INTERIOR_AGENT_CREDIT_COST} credit Ä‘á»ƒ lÆ°u phiĂªn báº£n agent, hiá»‡n cĂ³ ${credit.balance}.`
                    };
                }
                ctx.agentCredit = credit;
                return { ok: true };
            }
        };

        await runInteriorAgentSession({
            req, res, log, project, ctx,
            selectedModel, delegateFlash,
            initialPrompt,
            initialMessages: null,
            initialStepIndex: 0,
            maxSteps,
            startedAt
        });
    } catch (error) {
        console.error('Interior agent route error:', error);
        if (!res.headersSent) return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ cháº¡y agent thiáº¿t káº¿.' });
    }
});

router.post('/projects/:id/agent/runs/:runId/resume', authMiddleware, async (req, res) => {
    let project = null;
    let log = null;
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.runId)) {
            return res.status(400).json({ success: false, message: 'runId khĂ´ng há»£p lá»‡.' });
        }
        project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y dá»± Ă¡n.' });

        log = await InteriorAgentLog.findOne({ _id: req.params.runId, userId: req.user._id, projectId: project._id });
        if (!log) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y phiĂªn agent.' });
        if (log.status !== 'paused' && log.status !== 'error') {
            return res.status(400).json({ success: false, message: `PhiĂªn Ä‘Ă£ ${log.status}, khĂ´ng thá»ƒ tiáº¿p tá»¥c.` });
        }
        if (!Array.isArray(log.messages) || log.messages.length === 0) {
            return res.status(400).json({ success: false, message: 'PhiĂªn nĂ y khĂ´ng cĂ³ dá»¯ liá»‡u Ä‘á»ƒ tiáº¿p tá»¥c.' });
        }
        if (!isUnlimited(req.user.role) && (req.user.balance || 0) < INTERIOR_AGENT_CREDIT_COST) {
            return res.status(402).json({
                success: false,
                message: `Cáº§n ${INTERIOR_AGENT_CREDIT_COST} credit Ä‘á»ƒ tiáº¿p tá»¥c agent, hiá»‡n cĂ³ ${req.user.balance || 0}.`
            });
        }

        const selectedModel = INTERIOR_ALLOWED_MODELS.includes(log.selectedModel) ? log.selectedModel : INTERIOR_DEFAULT_MODEL;
        const delegateFlash = !!log.delegateFlash;
        const maxSteps = Math.min(Math.max(Number(req.body?.maxSteps) || 30, 1), 60);
        const initialStepIndex = (log.steps?.length) || 0;
        const baseModel = log.draftModel || structuredClone(currentVersion(project)?.modelJson || defaultCabinetModel());
        ensureInteriorDraft(baseModel);

        await persistRunState(log._id, { status: 'running' });

        const ctx = {
            project,
            draftModel: structuredClone(baseModel),
            userPrompt: log.userPrompt || '',
            refImageUrls: log.refImageUrls || [],
            aiModel: selectedModel,
            usage: null,
            totalTokens: log.totalTokens || 0,
            beforeCommit: async () => {
                if (ctx.agentCredit) return { ok: true };
                const credit = await deductInteriorCredit(req.user, INTERIOR_AGENT_CREDIT_COST);
                if (credit.rejected) {
                    return {
                        ok: false,
                        error: `Cáº§n ${INTERIOR_AGENT_CREDIT_COST} credit Ä‘á»ƒ lÆ°u phiĂªn báº£n agent, hiá»‡n cĂ³ ${credit.balance}.`
                    };
                }
                ctx.agentCredit = credit;
                return { ok: true };
            }
        };

        await runInteriorAgentSession({
            req, res, log, project, ctx,
            selectedModel, delegateFlash,
            initialPrompt: null,
            initialMessages: log.messages,
            initialStepIndex,
            maxSteps,
            startedAt: log.startedAt
        });
    } catch (error) {
        console.error('Interior agent resume error:', error);
        if (!res.headersSent) return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ tiáº¿p tá»¥c agent.' });
    }
});

// Full-detail endpoint: returns the saved steps[] and current status so the
// frontend can rehydrate AgentTimeline after a refresh â€” not just the
// resume-banner summary that /agent/runs (list) provides.
router.get('/projects/:id/agent/runs/:runId', authMiddleware, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.runId)) {
            return res.status(400).json({ success: false, message: 'runId khĂ´ng há»£p lá»‡.' });
        }
        const project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y dá»± Ă¡n.' });
        const run = await InteriorAgentLog.findOne({
            _id: req.params.runId,
            userId: req.user._id,
            projectId: project._id
        })
            .select('_id status stepsCount totalTokens userPrompt refImageUrls selectedModel delegateFlash steps startedAt finishedAt lastActiveAt abortReason finalReply nextTurnModel')
            .lean();
        if (!run) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y phiĂªn agent.' });
        return res.json({ success: true, data: { run: { ...run, runId: String(run._id) } } });
    } catch (error) {
        console.error('Interior agent run get error:', error);
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ táº£i phiĂªn agent.' });
    }
});

router.get('/projects/:id/agent/runs', authMiddleware, async (req, res) => {
    try {
        const project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y dá»± Ă¡n.' });
        const runs = await InteriorAgentLog.find({
            userId: req.user._id,
            projectId: project._id,
            status: { $in: ['paused', 'error'] }
        })
            .sort({ lastActiveAt: -1 })
            .limit(20)
            .select('_id status stepsCount totalTokens userPrompt selectedModel delegateFlash startedAt lastActiveAt abortReason')
            .lean();
        return res.json({ success: true, data: { runs: runs.map((r) => ({ ...r, runId: String(r._id) })) } });
    } catch (error) {
        console.error('Interior agent runs list error:', error);
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ táº£i danh sĂ¡ch phiĂªn agent.' });
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

        if (!message) return res.status(400).json({ success: false, message: 'Vui lĂ²ng nháº­p yĂªu cáº§u thiáº¿t káº¿.' });
        if (message.length > MAX_USER_PROMPT_CHARS) {
            return res.status(400).json({ success: false, message: `YĂªu cáº§u quĂ¡ dĂ i, tá»‘i Ä‘a ${MAX_USER_PROMPT_CHARS} kĂ½ tá»±.` });
        }
        if (!isUnlimited(req.user.role) && (req.user.balance || 0) < INTERIOR_AI_CREDIT_COST) {
            return res.status(402).json({
                success: false,
                message: `Cáº§n ${INTERIOR_AI_CREDIT_COST} credit Ä‘á»ƒ gá»i AI, hiá»‡n cĂ³ ${req.user.balance || 0}.`,
                data: { cost: INTERIOR_AI_CREDIT_COST, balance: req.user.balance || 0 }
            });
        }

        const project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y dá»± Ă¡n.' });
        if (project.versions.length >= MAX_VERSIONS_PER_PROJECT) {
            return res.status(409).json({ success: false, message: 'Dá»± Ă¡n Ä‘Ă£ Ä‘áº¡t giá»›i háº¡n phiĂªn báº£n.' });
        }
        if (expectedCurrentVersionIndex !== null && project.currentVersionIndex !== expectedCurrentVersionIndex) {
            return res.status(409).json({
                success: false,
                message: 'Dá»± Ă¡n Ä‘Ă£ cĂ³ phiĂªn báº£n má»›i hÆ¡n. Vui lĂ²ng táº£i láº¡i trÆ°á»›c khi gá»­i.',
                data: { project: await serializeProject(project) }
            });
        }

        const baseVersion = currentVersion(project);
        const baseModel = baseVersion?.modelJson || defaultCabinetModel();

        // â”€â”€â”€ STAGE: PROPOSAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // BÆ°á»›c phĂ¢n tĂ­ch: AI tráº£ JSON structured {observation, understanding, proposedChanges[], questions[]}.
        // Frontend má»Ÿ dialog cho user review/chá»‰nh + tráº£ lá»i cĂ¢u há»i.
        // Trá»« 1 credit (user Ä‘Ă£ báº­t 2-step vĂ  biáº¿t sáº½ tá»‘n 2 credit tá»•ng).
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
                return res.status(502).json({ success: false, message: error.message || 'AI táº¡m thá»i khĂ´ng pháº£n há»“i.' });
            }
            if (!aiText) {
                recordInteriorAiLog({
                    userId: req.user._id, projectId: project._id, stage: 'proposal',
                    model: proposalModel, prompt: proposalPrompt, refImageUrls,
                    rawResponse: '', latencyMs: Date.now() - startedAt,
                    status: 'upstream-error', errorMessage: 'Empty AI response'
                });
                return res.status(502).json({ success: false, message: 'AI khĂ´ng tráº£ vá» phĂ¢n tĂ­ch.' });
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
                return res.status(502).json({ success: false, message: 'AI khĂ´ng tráº£ vá» phĂ¢n tĂ­ch Ä‘Ăºng Ä‘á»‹nh dáº¡ng.' });
            }
            if (!structured) {
                recordInteriorAiLog({
                    userId: req.user._id, projectId: project._id, stage: 'proposal',
                    model: proposalModel, prompt: proposalPrompt, refImageUrls,
                    rawResponse: aiText, latencyMs: Date.now() - startedAt, usage: proposalUsage,
                    status: 'validation-failed', errorMessage: 'validateProposalPayload returned null'
                });
                return res.status(502).json({ success: false, message: 'AI khĂ´ng tráº£ vá» phĂ¢n tĂ­ch Ä‘Ăºng Ä‘á»‹nh dáº¡ng.' });
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
                    message: `Cáº§n ${INTERIOR_AI_CREDIT_COST} credit Ä‘á»ƒ gá»i AI, hiá»‡n cĂ³ ${credit.balance}.`,
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

        // â”€â”€â”€ STAGE: APPLY (default) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const aiImageUrls = await presignImageUrls(refImageUrls);
        const applyPrompt = buildInteriorPrompt({ message, refImageUrls, project, baseModel, proposalContext });
        const applyStartedAt = Date.now();
        let aiText;
        let aiUsage = null;
        let actualModel = selectedModel;
        try {
            // Interior tool LUĂ”N gá»i gcli trá»±c tiáº¿p (callGcliDirect = gcli.ggchan.dev upstream).
            // Má»—i turn Ä‘Ă£ embed full chat history + model JSON nĂªn khĂ´ng cáº§n OpenClaw session memory.
            // Náº¿u user báº­t 2-step, proposalContext Ä‘Æ°á»£c truyá»n vĂ o Ä‘á»ƒ AI bĂ¡m sĂ¡t Ä‘á» xuáº¥t Ä‘Ă£ xĂ¡c nháº­n.
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
            return res.status(502).json({ success: false, message: error.message || 'AI táº¡m thá»i khĂ´ng pháº£n há»“i.' });
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
            return res.status(502).json({ success: false, message: 'AI khĂ´ng tráº£ vá» JSON há»£p lá»‡.' });
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
            return res.status(502).json({ success: false, message: `AI tráº£ vá» model khĂ´ng há»£p lá»‡: ${validation.message}` });
        }

        const credit = await deductInteriorCredit(req.user);
        if (credit.rejected) {
            return res.status(402).json({
                success: false,
                message: `Cáº§n ${INTERIOR_AI_CREDIT_COST} credit Ä‘á»ƒ gá»i AI, hiá»‡n cĂ³ ${credit.balance}.`,
                data: { cost: INTERIOR_AI_CREDIT_COST, balance: credit.balance }
            });
        }

        // Git-like branching: náº¿u user Ä‘Ă£ rollback (currentVersionIndex < max),
        // thĂ¬ truncate cĂ¡c version "future" trÆ°á»›c khi push Ä‘á»ƒ giá»¯ chuá»—i linear.
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
            aiReply: payload.reply || 'ÄĂ£ cáº­p nháº­t model thiáº¿t káº¿.',
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
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ xá»­ lĂ½ yĂªu cáº§u thiáº¿t káº¿.' });
    }
});

// â”€â”€â”€ Image-to-design pipeline (Phase 4) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        'Coordinate system: x leftâ†’right, y bottomâ†’top, z frontâ†’back. Units = cm.',
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
        if (!imageUrl) return res.status(400).json({ success: false, message: 'imageUrl lĂ  báº¯t buá»™c.' });

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
            return res.status(502).json({ success: false, message: error.message || 'AI táº¡m thá»i khĂ´ng pháº£n há»“i.' });
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
                message: `AI khĂ´ng tráº£ vá» model há»£p lá»‡${lastError ? `: ${lastError}` : '.'}`
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
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ phĂ¢n tĂ­ch áº£nh.' });
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
            return res.status(400).json({ success: false, message: `modelJson khĂ´ng há»£p lá»‡: ${validation.message}` });
        }

        const dataUrlMatch = viewBase64.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
        if (!dataUrlMatch) {
            return res.status(400).json({ success: false, message: 'viewBase64 pháº£i lĂ  data URL image (png/jpeg/webp).' });
        }
        const [, mime, b64] = dataUrlMatch;
        const buffer = Buffer.from(b64, 'base64');
        if (buffer.length > 12 * 1024 * 1024) {
            return res.status(413).json({ success: false, message: 'áº¢nh 3D view quĂ¡ lá»›n (>12MB).' });
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
                meta: { pending: true, note: 'Image generation upstream chÆ°a kĂ­ch hoáº¡t; renderUrl tráº£ vá» view 3D gá»‘c.' }
            }
        });
    } catch (error) {
        console.error('Interior generate-render error:', error);
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ táº¡o render AI.' });
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
        const stageFilter = (req.query.stage === 'proposal' || req.query.stage === 'apply') ? req.query.stage : null;
        const statusFilter = (typeof req.query.status === 'string' && ['ok', 'parse-failed', 'validation-failed', 'upstream-error'].includes(req.query.status))
            ? req.query.status : null;

        // Chat logs (legacy /chat InteriorAiLog).
        const chatFilter = { ...filter };
        if (stageFilter) chatFilter.stage = stageFilter;
        if (statusFilter) chatFilter.status = statusFilter;
        const chatLogs = await InteriorAiLog.find(chatFilter)
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('userId', 'name email')
            .lean();
        const chatEntries = chatLogs.map((log) => ({ ...log, kind: 'chat' }));

        // Agent runs (multi-step harness InteriorAgentLog). We skip the
        // stage/status filters that only apply to chat logs â€” agent runs have
        // their own status enum (committed/paused/aborted/error/maxSteps/running).
        // Always include them so admin can review the multi-step trace.
        let agentEntries = [];
        if (!stageFilter && !statusFilter) {
            const agentLogs = await InteriorAgentLog.find(filter)
                .sort({ createdAt: -1 })
                .limit(limit)
                .populate('userId', 'name email')
                .select('_id userId projectId status stepsCount totalTokens userPrompt refImageUrls selectedModel delegateFlash steps finalReply abortReason startedAt finishedAt lastActiveAt createdAt')
                .lean();
            agentEntries = agentLogs.map((log) => ({ ...log, kind: 'agent' }));
        }

        // Merge + sort by createdAt desc + cap to limit so the UI doesn't get
        // 2Ă— the requested count.
        const merged = [...chatEntries, ...agentEntries]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, limit);

        return res.json({ success: true, data: { logs: merged } });
    } catch (error) {
        console.error('Interior admin logs error:', error);
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ táº£i log AI.' });
    }
});

router.post('/projects/:id/rollback', authMiddleware, async (req, res) => {
    try {
        const project = await findOwnedProject(req.params.id, req.user._id);
        if (!project) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y dá»± Ă¡n.' });

        const targetVersionId = typeof req.body?.targetVersionId === 'string' ? req.body.targetVersionId : '';
        const targetVersionIndex = Number.isInteger(req.body?.targetVersionIndex) ? req.body.targetVersionIndex : null;
        const target = project.versions.find((version) => (
            (targetVersionId && version._id?.toString() === targetVersionId)
            || (targetVersionIndex !== null && version.index === targetVersionIndex)
        ));
        if (!target) return res.status(404).json({ success: false, message: 'KhĂ´ng tĂ¬m tháº¥y phiĂªn báº£n cáº§n khĂ´i phá»¥c.' });

        // Git-like rollback: chá»‰ di chuyá»ƒn con trá» currentVersionIndex vá» target.
        // Versions sau target váº«n Ä‘Æ°á»£c giá»¯ â€” frontend filter chat theo currentVersionIndex.
        // Náº¿u user gá»­i prompt má»›i sau rollback, route /chat sáº½ truncate versions > currentVersionIndex.
        project.currentVersionIndex = target.index;
        await project.save();
        return res.json({ success: true, data: { project: await serializeProject(project) } });
    } catch (error) {
        console.error('Interior rollback error:', error);
        return res.status(500).json({ success: false, message: 'KhĂ´ng thá»ƒ khĂ´i phá»¥c phiĂªn báº£n.' });
    }
});

export default router;
