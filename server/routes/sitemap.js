import express from 'express';
import Course from '../models/Course.js';
import Article from '../models/Article.js';
import EventLibraryItem from '../models/EventLibraryItem.js';
import Skill from '../models/Skill.js';

const router = express.Router();
export const SITE_URL = 'https://giaiphapsangtao.com';

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function safeDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function urlEntry(loc, { lastmod, changefreq = 'monthly', priority = '0.7' } = {}) {
    const date = safeDate(lastmod);
    return `  <url>\n    <loc>${escapeXml(loc)}</loc>${date ? `\n    <lastmod>${date}</lastmod>` : ''}\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

export function buildSitemapXml({ courses = [], articles = [], eventItems = [], skills = [] } = {}) {
    const entries = new Map();
    const add = (path, options) => {
        const loc = `${SITE_URL}${path === '/' ? '/' : `/${String(path).replace(/^\/+/, '')}`}`;
        if (!entries.has(loc)) entries.set(loc, urlEntry(loc, options));
    };

    [
        ['/', { changefreq: 'weekly', priority: '1.0' }],
        ['/courses', { changefreq: 'daily', priority: '0.9' }],
        ['/about', { priority: '0.7' }], ['/services', { priority: '0.7' }],
        ['/news', { priority: '0.7' }], ['/studio', { priority: '0.8' }],
        ['/studio/ai-skills', { priority: '0.8' }], ['/studio/event-library', { priority: '0.8' }],
        ['/studio/vietyaku', { priority: '0.7' }], ['/studio/crm', { priority: '0.7' }],
        ['/studio/vocab', { priority: '0.7' }],
    ].forEach(([path, options]) => add(path, options));

    courses.forEach((course) => course?.slug && add(`/courses/${course.slug}`, { lastmod: course.updatedAt, changefreq: 'weekly', priority: '0.8' }));
    articles.forEach((article) => {
        if (!article?.slug || !['about', 'news', 'services'].includes(article.category)) return;
        add(`/${article.category}/${article.slug}`, { lastmod: article.updatedAt, priority: '0.7' });
    });
    skills.forEach((skill) => skill?.slug && add(`/studio/ai-skills/${skill.slug}`, { lastmod: skill.updatedAt, priority: '0.6' }));
    eventItems.forEach((item) => {
        if (!item?.slug) return;
        if (item.ownership !== 'platform' && !(item.ownership === 'user' && item.visibility === 'public')) return;
        add(`/studio/event-library/${item.slug}`, { lastmod: item.updatedAt, priority: '0.6' });
    });

    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...entries.values()].join('\n')}\n</urlset>`;
}

router.get('/', async (req, res) => {
    try {
        const [courses, articles, eventItems, skills] = await Promise.all([
            Course.find({ status: 'published' }, { slug: 1, updatedAt: 1 }).lean(),
            Article.find({ status: 'published', category: { $in: ['about', 'news', 'services'] } }, { slug: 1, category: 1, updatedAt: 1 }).lean(),
            EventLibraryItem.find({ $or: [{ ownership: 'platform' }, { visibility: 'public' }] }, { slug: 1, ownership: 1, visibility: 1, updatedAt: 1 }).lean(),
            Skill.find({}, { slug: 1, updatedAt: 1 }).lean(),
        ]);
        res.header('Content-Type', 'application/xml');
        res.header('Cache-Control', 'public, max-age=3600');
        res.send(buildSitemapXml({ courses, articles, eventItems, skills }));
    } catch (error) {
        console.error('Sitemap error:', error);
        res.status(500).send('Error generating sitemap');
    }
});

export default router;
