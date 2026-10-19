import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSitemapXml } from '../server/routes/sitemap.js';

test('buildSitemapXml emits canonical public URLs without duplicate hreflang', () => {
    const xml = buildSitemapXml({
        courses: [{ slug: 'ai-course', updatedAt: '2026-10-01T00:00:00Z' }],
        articles: [
            { slug: 'news-one', category: 'news', updatedAt: '2026-10-02T00:00:00Z' },
            { slug: 'private-looking', category: 'about', updatedAt: 'bad-date' },
        ],
        skills: [{ slug: 'firecrawl', updatedAt: '2026-10-03T00:00:00Z' }],
        eventItems: [
            { slug: 'public-case', ownership: 'platform', updatedAt: '2026-10-04T00:00:00Z' },
            { slug: 'private-case', ownership: 'user', visibility: 'private', updatedAt: '2026-10-04T00:00:00Z' },
        ],
    });

    assert.match(xml, /<loc>https:\/\/giaiphapsangtao\.com\/news<\/loc>/);
    assert.match(xml, /\/studio\/ai-skills<\/loc>/);
    assert.match(xml, /\/studio\/event-library<\/loc>/);
    assert.match(xml, /\/studio\/vietyaku<\/loc>/);
    assert.match(xml, /\/studio\/crm<\/loc>/);
    assert.match(xml, /\/studio\/vocab<\/loc>/);
    assert.match(xml, /\/studio\/ai-skills\/firecrawl<\/loc>/);
    assert.match(xml, /\/studio\/event-library\/public-case<\/loc>/);
    assert.doesNotMatch(xml, /private-case/);
    assert.doesNotMatch(xml, /event-creative-city|co-loa-living-spiral|interior-design/);
    assert.doesNotMatch(xml, /hreflang=/);
    assert.doesNotMatch(xml, /private-looking.*lastmod/);
});
