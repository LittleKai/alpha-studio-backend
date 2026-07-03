import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import InteriorTemplate from '../models/InteriorTemplate.js';
import { extractDsl, validateTemplateStructure } from './templateValidator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Primary: monorepo tools/ folders (local dev source of truth).
// Fallback: server/assets/interior/* copies bundled into the Docker image by
// scripts/sync-interior-assets.mjs — the tools/ folders do not exist on Fly.
export const BUILTIN_TEMPLATE_DIR_CANDIDATES = [
    path.resolve(__dirname, '../../../tools/interior-design-engine/src/templates'),
    path.resolve(__dirname, '../assets/interior/templates')
];
export const WORKSHOP_COMPONENT_DIR_CANDIDATES = [
    path.resolve(__dirname, '../../../tools/interior-component-workshop/components'),
    path.resolve(__dirname, '../assets/interior/workshop')
];

const TOKEN_ALIASES = new Map([
    ['$wood', '$woodFront'],
    ['$woodLight', '$woodFrontL']
]);

async function pathExists(target) {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

async function firstExistingDir(candidates) {
    for (const candidate of candidates) {
        if (await pathExists(candidate)) return candidate;
    }
    return null;
}

async function readJson(filePath) {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
}

function normalizeToken(value) {
    if (typeof value !== 'string') return value;
    return TOKEN_ALIASES.get(value) || value;
}

function normalizeFaces(faces) {
    if (!faces || typeof faces !== 'object' || Array.isArray(faces)) return faces;
    const out = {};
    for (const [key, value] of Object.entries(faces)) {
        if (key === 'side') {
            if (out.left === undefined) out.left = normalizeToken(value);
            if (out.right === undefined) out.right = normalizeToken(value);
        } else {
            out[key] = normalizeToken(value);
        }
    }
    return out;
}

function normalizeShape(shape) {
    if (!shape || typeof shape !== 'object' || Array.isArray(shape)) return shape;
    const out = {};
    for (const [key, value] of Object.entries(shape)) {
        if (key === 'faces') out.faces = normalizeFaces(value);
        else if (Array.isArray(value)) out[key] = value.map(normalizeShape);
        else if (value && typeof value === 'object') out[key] = normalizeShape(value);
        else out[key] = normalizeToken(value);
    }
    return out;
}

export function normalizeTemplateForStorage(raw) {
    const dsl = extractDsl(raw);
    return {
        id: typeof raw?.id === 'string' ? raw.id.trim() : '',
        version: raw?.version || 1,
        name: raw?.name && typeof raw.name === 'object' && !Array.isArray(raw.name)
            ? raw.name
            : { vi: raw?.title || raw?.id || '', en: raw?.title || raw?.id || '' },
        description: raw?.description && typeof raw.description === 'object' && !Array.isArray(raw.description)
            ? raw.description
            : { vi: '', en: '' },
        category: raw?.category || 'other',
        tags: Array.isArray(raw?.tags) ? raw.tags.slice(0, 20) : [],
        params: raw?.params || {},
        styleOptions: raw?.style && typeof raw.style === 'object' && !Array.isArray(raw.style) ? raw.style : {},
        dsl: {
            boxes: (dsl.boxes || []).map(normalizeShape)
        },
        previewDims: raw?.previewDims || null
    };
}

async function upsertTemplate(raw, { status, authorId = null, sourceProjectId = null, sourceInlineId = null } = {}) {
    const template = normalizeTemplateForStorage(raw);
    const validation = validateTemplateStructure({
        id: template.id,
        category: template.category,
        tags: template.tags,
        params: template.params,
        dsl: template.dsl
    });
    if (!validation.valid) {
        return { ok: false, id: template.id || '(missing)', message: validation.message };
    }

    await InteriorTemplate.updateOne(
        { templateId: template.id, version: template.version },
        {
            $set: {
                templateId: template.id,
                version: template.version,
                name: template.name,
                description: template.description,
                category: template.category,
                tags: template.tags,
                params: template.params,
                styleOptions: template.styleOptions,
                dsl: template.dsl,
                status,
                authorId,
                sourceProjectId,
                sourceInlineId,
                previewDims: template.previewDims
            }
        },
        { upsert: true }
    );
    return { ok: true, id: template.id, version: template.version, status };
}

export async function seedBuiltinInteriorTemplates({ sourceDir, logger = console } = {}) {
    sourceDir ||= await firstExistingDir(BUILTIN_TEMPLATE_DIR_CANDIDATES);
    if (!sourceDir || !await pathExists(sourceDir)) {
        logger.warn?.(`[interior:seed] built-in template dir missing, skipped. Candidates: ${BUILTIN_TEMPLATE_DIR_CANDIDATES.join(' | ')}`);
        return { processed: 0, skipped: true };
    }
    const manifest = await readJson(path.join(sourceDir, 'manifest.json'));
    const files = Array.isArray(manifest.templates) ? manifest.templates : [];
    let processed = 0;
    const rejected = [];
    for (const filename of files) {
        const result = await upsertTemplate(await readJson(path.join(sourceDir, filename)), {
            status: 'seed',
            sourceInlineId: 'interior-design-engine'
        });
        if (result.ok) processed += 1;
        else rejected.push(result);
    }
    logger.log?.(`[interior:seed] built-in templates upserted: ${processed}${rejected.length ? `, rejected: ${rejected.length}` : ''}`);
    return { processed, rejected };
}

export async function seedWorkshopInteriorTemplates({ sourceDir, logger = console } = {}) {
    sourceDir ||= await firstExistingDir(WORKSHOP_COMPONENT_DIR_CANDIDATES);
    if (!sourceDir || !await pathExists(sourceDir)) {
        logger.warn?.(`[interior:seed] workshop component dir missing, skipped. Candidates: ${WORKSHOP_COMPONENT_DIR_CANDIDATES.join(' | ')}`);
        return { processed: 0, skipped: true };
    }
    const files = (await fs.readdir(sourceDir))
        .filter((name) => name.endsWith('.json'))
        .sort((a, b) => a.localeCompare(b));
    let processed = 0;
    const rejected = [];
    for (const filename of files) {
        const result = await upsertTemplate(await readJson(path.join(sourceDir, filename)), {
            status: 'approved',
            sourceInlineId: 'interior-component-workshop'
        });
        if (result.ok) processed += 1;
        else rejected.push(result);
    }
    logger.log?.(`[interior:seed] workshop templates upserted: ${processed}${rejected.length ? `, rejected: ${rejected.length}` : ''}`);
    return { processed, rejected };
}

export async function seedInteriorTemplateAssets(options = {}) {
    const builtins = await seedBuiltinInteriorTemplates(options);
    const workshop = await seedWorkshopInteriorTemplates(options);
    return { builtins, workshop };
}
