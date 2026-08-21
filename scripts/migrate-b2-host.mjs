/**
 * Rewrite a stale B2/CDN host inside every stored absolute URL.
 *
 * Context: `cdn.giaiphapsangtao.com` stopped resolving (NXDOMAIN), so every URL
 * persisted with that host is dead — and `extractB2Key()` in routes/upload.js can
 * no longer derive a key from them either, which breaks presigned downloads for
 * course videos and lesson documents, not just the direct links. The objects
 * themselves are untouched on B2; only the host stored in Mongo is wrong.
 *
 * Field inventory mirrors the B2 orphan checker in routes/admin.js — keep the two
 * in sync when a new B2 URL field is added anywhere.
 *
 * Dry-run by default. Nothing is written without --apply.
 *
 *   node scripts/migrate-b2-host.mjs                 # report only
 *   node scripts/migrate-b2-host.mjs --apply         # rewrite
 *   node scripts/migrate-b2-host.mjs --from <url> --to <url>
 */

import 'dotenv/config';
import mongoose from 'mongoose';

import WorkflowDocument from '../server/models/WorkflowDocument.js';
import Resource from '../server/models/Resource.js';
import Prompt from '../server/models/Prompt.js';
import Course from '../server/models/Course.js';
import InteriorAnalysis from '../server/models/InteriorAnalysis.js';
import InteriorRender from '../server/models/InteriorRender.js';
import SystemSetting from '../server/models/SystemSetting.js';

const DEFAULT_FROM = 'https://cdn.giaiphapsangtao.com/file/alpha-studio';

function arg(name) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : null;
}

const apply = process.argv.includes('--apply');
const FROM = (arg('--from') || DEFAULT_FROM).replace(/\/+$/, '');
const TO = (arg('--to') || process.env.CDN_BASE_URL || '').replace(/\/+$/, '');

if (!TO) {
    console.error('No target host. Set CDN_BASE_URL or pass --to <url>.');
    process.exit(1);
}
if (TO === FROM) {
    console.error(`--from and --to are identical (${FROM}). Nothing to do.`);
    process.exit(1);
}
if (!process.env.MONGODB_URI) {
    console.error('Missing MONGODB_URI. Refusing to run.');
    process.exit(1);
}

/** Rewrite a single value if it is a string carrying the stale host. */
function rewrite(value) {
    return typeof value === 'string' && value.includes(FROM)
        ? value.split(FROM).join(TO)
        : value;
}

/** Deep-rewrite any plain object/array (used for SystemSetting's Mixed value). */
function rewriteDeep(value) {
    if (typeof value === 'string') return rewrite(value);
    if (Array.isArray(value)) return value.map(rewriteDeep);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteDeep(v)]));
    }
    return value;
}

const samples = [];
let totalDocs = 0;
let totalUrls = 0;

function note(label, before, after) {
    totalUrls += 1;
    if (samples.length < 12) samples.push({ label, before, after });
}

/**
 * @param {string} label            human name for the report
 * @param {import('mongoose').Model} Model
 * @param {string} projection       fields to load
 * @param {(doc: any) => object|null} build  returns a $set patch, or null if unchanged
 */
async function scan(label, Model, projection, build) {
    const docs = await Model.find({}, projection).lean();
    let changed = 0;

    for (const doc of docs) {
        const patch = build(doc);
        if (!patch) continue;
        changed += 1;
        if (apply) await Model.updateOne({ _id: doc._id }, { $set: patch });
    }

    totalDocs += changed;
    console.log(`  ${label.padEnd(28)} ${String(changed).padStart(5)} document(s)`);
}

async function main() {
    await mongoose.connect(process.env.MONGODB_URI);

    console.log(`\nMode : ${apply ? 'APPLY (writing)' : 'dry-run (no writes)'}`);
    console.log(`From : ${FROM}`);
    console.log(`To   : ${TO}\n`);

    await scan('WorkflowDocument.url', WorkflowDocument, 'url', (d) => {
        const url = rewrite(d.url);
        if (url === d.url) return null;
        note('WorkflowDocument.url', d.url, url);
        return { url };
    });

    await scan('Resource.file + previews', Resource, 'file previewImages', (d) => {
        const patch = {};
        const fileUrl = rewrite(d.file?.url);
        if (d.file?.url && fileUrl !== d.file.url) {
            note('Resource.file.url', d.file.url, fileUrl);
            patch.file = { ...d.file, url: fileUrl };
        }
        if ((d.previewImages || []).some((i) => rewrite(i?.url) !== i?.url)) {
            patch.previewImages = d.previewImages.map((i) => {
                const url = rewrite(i?.url);
                if (i?.url && url !== i.url) note('Resource.previewImages[].url', i.url, url);
                return { ...i, url };
            });
        }
        return Object.keys(patch).length ? patch : null;
    });

    await scan('Prompt.exampleImages', Prompt, 'exampleImages', (d) => {
        if (!(d.exampleImages || []).some((i) => rewrite(i?.url) !== i?.url)) return null;
        return {
            exampleImages: d.exampleImages.map((i) => {
                const url = rewrite(i?.url);
                if (i?.url && url !== i.url) note('Prompt.exampleImages[].url', i.url, url);
                return { ...i, url };
            }),
        };
    });

    await scan('Course lesson media', Course, 'modules', (d) => {
        let touched = false;
        const modules = (d.modules || []).map((mod) => ({
            ...mod,
            lessons: (mod.lessons || []).map((lesson) => {
                const videoUrl = rewrite(lesson.videoUrl);
                if (lesson.videoUrl && videoUrl !== lesson.videoUrl) {
                    note('Course lesson.videoUrl', lesson.videoUrl, videoUrl);
                    touched = true;
                }
                const documents = (lesson.documents || []).map((doc) => {
                    const url = rewrite(doc?.url);
                    if (doc?.url && url !== doc.url) {
                        note('Course lesson.documents[].url', doc.url, url);
                        touched = true;
                    }
                    return { ...doc, url };
                });
                return { ...lesson, videoUrl, documents };
            }),
        }));
        return touched ? { modules } : null;
    });

    await scan('InteriorAnalysis.imageUrl', InteriorAnalysis, 'imageUrl', (d) => {
        const imageUrl = rewrite(d.imageUrl);
        if (imageUrl === d.imageUrl) return null;
        note('InteriorAnalysis.imageUrl', d.imageUrl, imageUrl);
        return { imageUrl };
    });

    await scan('InteriorRender view/render', InteriorRender, 'viewUrl renderUrl', (d) => {
        const patch = {};
        for (const field of ['viewUrl', 'renderUrl']) {
            const next = rewrite(d[field]);
            if (d[field] && next !== d[field]) {
                note(`InteriorRender.${field}`, d[field], next);
                patch[field] = next;
            }
        }
        return Object.keys(patch).length ? patch : null;
    });

    // Cached release manifests. These self-heal on the next successful fetch, but
    // they are what gets served while the CDN is unreachable — so fix them too.
    await scan('SystemSetting release cache', SystemSetting, 'key value', (d) => {
        if (!JSON.stringify(d.value ?? null).includes(FROM)) return null;
        const value = rewriteDeep(d.value);
        note(`SystemSetting[${d.key}]`, FROM, TO);
        return { value };
    });

    console.log(`\n${'-'.repeat(60)}`);
    console.log(`Documents to change : ${totalDocs}`);
    console.log(`URLs to rewrite     : ${totalUrls}`);

    if (samples.length) {
        console.log('\nSample rewrites:');
        for (const s of samples) {
            console.log(`  [${s.label}]`);
            console.log(`    - ${s.before}`);
            console.log(`    + ${s.after}`);
        }
        if (totalUrls > samples.length) {
            console.log(`  ... and ${totalUrls - samples.length} more`);
        }
    }

    console.log(
        apply
            ? '\nDone — changes written. Safe to rerun (idempotent).'
            : '\nDry run only. Rerun with --apply to write.'
    );
}

try {
    await main();
} catch (error) {
    console.error('\nB2 host migration failed:', error);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect();
}
