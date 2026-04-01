import express from 'express';
import Course from '../models/Course.js';
import Article from '../models/Article.js';

const router = express.Router();

const SITE_URL = 'https://giaiphapsangtao.com';

function escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function urlEntry(loc, { lastmod, changefreq = 'monthly', priority = '0.7' } = {}) {
    return `
  <url>
    <loc>${escapeXml(loc)}</loc>
    ${lastmod ? `<lastmod>${new Date(lastmod).toISOString().split('T')[0]}</lastmod>` : ''}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
    <xhtml:link rel="alternate" hreflang="vi" href="${escapeXml(loc)}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(loc)}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(loc)}"/>
  </url>`;
}

// GET /sitemap.xml
router.get('/', async (req, res) => {
    try {
        const [courses, articles] = await Promise.all([
            Course.find({ status: 'published' }, { slug: 1, updatedAt: 1 }).lean(),
            Article.find({ status: 'published' }, { slug: 1, category: 1, updatedAt: 1 }).lean()
        ]);

        const staticPages = [
            urlEntry(`${SITE_URL}/`, { changefreq: 'weekly', priority: '1.0' }),
            urlEntry(`${SITE_URL}/courses`, { changefreq: 'daily', priority: '0.9' }),
            urlEntry(`${SITE_URL}/about`, { changefreq: 'monthly', priority: '0.7' }),
            urlEntry(`${SITE_URL}/services`, { changefreq: 'monthly', priority: '0.7' })
        ];

        const coursePages = courses.map(c =>
            urlEntry(`${SITE_URL}/courses/${c.slug}`, { lastmod: c.updatedAt, changefreq: 'weekly', priority: '0.8' })
        );

        const articlePages = articles.map(a =>
            urlEntry(`${SITE_URL}/${a.category}/${a.slug}`, { lastmod: a.updatedAt, changefreq: 'monthly', priority: '0.7' })
        );

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[...staticPages, ...coursePages, ...articlePages].join('')}
</urlset>`;

        res.header('Content-Type', 'application/xml');
        res.header('Cache-Control', 'public, max-age=3600');
        res.send(xml);
    } catch (error) {
        console.error('Sitemap error:', error);
        res.status(500).send('Error generating sitemap');
    }
});

export default router;
