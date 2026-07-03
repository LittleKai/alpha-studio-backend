// Copy interior design AI assets from the monorepo tools/ folders into
// server/assets/interior/ so they ship inside the backend Docker image
// (Dockerfile only COPYs server/). Run this before deploying whenever
// templates, workshop components, or agent skills change:
//
//   npm run sync:interior-assets
//
// At runtime, interiorTemplateAssets.js and the interior route prefer the
// tools/ folders (local dev source of truth) and fall back to these bundled
// copies when tools/ is absent (Fly.io image).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const BACKEND_ROOT = path.resolve(__dirname, '..');

const SYNC_TARGETS = [
    {
        label: 'engine templates',
        source: path.join(REPO_ROOT, 'tools/interior-design-engine/src/templates'),
        dest: path.join(BACKEND_ROOT, 'server/assets/interior/templates'),
        filter: (name) => name.endsWith('.json')
    },
    {
        label: 'workshop components',
        source: path.join(REPO_ROOT, 'tools/interior-component-workshop/components'),
        dest: path.join(BACKEND_ROOT, 'server/assets/interior/workshop'),
        filter: (name) => name.endsWith('.json')
    },
    {
        label: 'agent skills',
        source: path.join(REPO_ROOT, 'tools/interior-design-engine/skills'),
        dest: path.join(BACKEND_ROOT, 'server/assets/interior/skills'),
        filter: (name) => name.endsWith('.md')
    }
];

async function syncDir({ label, source, dest, filter }) {
    let entries;
    try {
        entries = (await fs.readdir(source, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && filter(entry.name))
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`[sync-interior-assets] source missing, skipped ${label}: ${source}`);
            return { label, copied: 0, removed: 0, skipped: true };
        }
        throw error;
    }

    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(dest, { recursive: true });
    for (const name of entries) {
        await fs.copyFile(path.join(source, name), path.join(dest, name));
    }
    console.log(`[sync-interior-assets] ${label}: ${entries.length} file(s) -> ${path.relative(BACKEND_ROOT, dest)}`);
    return { label, copied: entries.length };
}

for (const target of SYNC_TARGETS) {
    await syncDir(target);
}
console.log('[sync-interior-assets] done.');
