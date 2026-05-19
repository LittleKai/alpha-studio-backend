import fs from 'node:fs/promises';
import path from 'node:path';

function parseList(value) {
    if (!value) return [];
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return trimmed.slice(1, -1).split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    }
    return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseFrontmatter(text, fallbackName) {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    const meta = {};
    let body = text;
    if (match) {
        body = text.slice(match[0].length);
        for (const line of match[1].split(/\r?\n/)) {
            const idx = line.indexOf(':');
            if (idx === -1) continue;
            const key = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim();
            if (key === 'tags') meta.tags = parseList(value);
            else meta[key] = value.replace(/^['"]|['"]$/g, '');
        }
    }
    const name = meta.name || fallbackName;
    return {
        name,
        description: meta.description || name,
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        content: body.trim()
    };
}

export class SkillLoader {
    constructor(skillsDir) {
        this.skillsDir = skillsDir;
        this.skills = new Map();
    }

    async init() {
        this.skills.clear();
        let entries = [];
        try {
            entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
        } catch (error) {
            if (error.code === 'ENOENT') return this;
            throw error;
        }
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
            const filePath = path.join(this.skillsDir, entry.name);
            const text = await fs.readFile(filePath, 'utf8');
            const fallbackName = entry.name.replace(/\.md$/i, '');
            const skill = parseFrontmatter(text, fallbackName);
            this.skills.set(skill.name, skill);
        }
        return this;
    }

    list() {
        return [...this.skills.values()].map(({ name, description, tags }) => ({ name, description, tags }));
    }

    read(name) {
        const skill = this.skills.get(name);
        if (!skill) return null;
        return { ...skill };
    }

    summary() {
        return this.list().map((skill) => ({ name: skill.name, description: skill.description }));
    }
}
