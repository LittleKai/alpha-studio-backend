import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isBotUserAgent,
    parseUserAgent,
    hostFromUrl,
    isSelfHost,
    classifyChannel,
    normalizePath,
} from '../server/routes/analytics.js';
import { REQUIRED_INDEXES } from '../server/migrations/m0/indexPlan.js';
import { RETENTION_MS } from '../server/retention/policy.js';
import { RETENTION_DAYS } from '../server/models/PageVisit.js';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

test('isBotUserAgent flags crawlers and empty user agents', () => {
    assert.equal(isBotUserAgent(''), true);
    assert.equal(isBotUserAgent(null), true);
    assert.equal(isBotUserAgent('Googlebot/2.1 (+http://www.google.com/bot.html)'), true);
    assert.equal(isBotUserAgent('curl/8.4.0'), true);
    assert.equal(isBotUserAgent('HeadlessChrome/120.0.0.0'), true);
    assert.equal(isBotUserAgent('facebookexternalhit/1.1'), true);
    assert.equal(isBotUserAgent(CHROME_WIN), false);
    assert.equal(isBotUserAgent(SAFARI_IPHONE), false);
});

test('parseUserAgent derives device, browser and os', () => {
    assert.deepEqual(parseUserAgent(CHROME_WIN), { device: 'desktop', browser: 'Chrome', os: 'Windows' });
    assert.deepEqual(parseUserAgent(SAFARI_IPHONE), { device: 'mobile', browser: 'Safari', os: 'iOS' });

    const androidTablet = parseUserAgent('Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
    assert.equal(androidTablet.device, 'tablet');
    assert.equal(androidTablet.os, 'Android');

    const androidPhone = parseUserAgent('Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36');
    assert.equal(androidPhone.device, 'mobile');

    // Edge and Coc Coc both contain "chrome" and must not be misread as Chrome
    assert.equal(parseUserAgent(`${CHROME_WIN} Edg/131.0.0.0`).browser, 'Edge');
    assert.equal(parseUserAgent(`${CHROME_WIN} coc_coc_browser/120.0.0`).browser, 'Coc Coc');

    assert.deepEqual(parseUserAgent(''), { device: 'desktop', browser: 'other', os: 'other' });
});

test('hostFromUrl strips www and tolerates garbage', () => {
    assert.equal(hostFromUrl('https://www.Google.com/search?q=x'), 'google.com');
    assert.equal(hostFromUrl('https://m.facebook.com/'), 'm.facebook.com');
    assert.equal(hostFromUrl('not a url'), '');
    assert.equal(hostFromUrl(''), '');
    assert.equal(hostFromUrl(undefined), '');
});

test('isSelfHost recognises our own domains', () => {
    assert.equal(isSelfHost('giaiphapsangtao.com'), true);
    assert.equal(isSelfHost('alpha-studio.vercel.app'), true);
    assert.equal(isSelfHost('localhost'), true);
    assert.equal(isSelfHost('google.com'), false);
    assert.equal(isSelfHost(''), false);
});

test('classifyChannel routes Google Ads traffic to paid-search', () => {
    // gclid alone is enough - Google Ads appends it even without utm tags
    assert.equal(classifyChannel({ gclid: 'Cj0KCQiA' }), 'paid-search');
    assert.equal(classifyChannel({ utmSource: 'google', utmMedium: 'cpc' }), 'paid-search');
    assert.equal(classifyChannel({ utmSource: 'google', utmMedium: 'ppc' }), 'paid-search');
    assert.equal(classifyChannel({ utmSource: 'facebook', utmMedium: 'display' }), 'paid-social');
});

test('classifyChannel separates organic, social, referral and direct', () => {
    assert.equal(classifyChannel({ referrerHost: 'google.com' }), 'organic-search');
    assert.equal(classifyChannel({ referrerHost: 'coccoc.com' }), 'organic-search');
    assert.equal(classifyChannel({ referrerHost: 'm.facebook.com' }), 'social');
    assert.equal(classifyChannel({ referrerHost: 'zalo.me' }), 'social');
    assert.equal(classifyChannel({ referrerHost: 'vnexpress.net' }), 'referral');
    assert.equal(classifyChannel({}), 'direct');
    assert.equal(classifyChannel({ referrerHost: 'giaiphapsangtao.com' }), 'direct');
    assert.equal(classifyChannel({ utmSource: 'newsletter' }), 'email');
    assert.equal(classifyChannel({ utmSource: 'partner-blog' }), 'campaign');
});

test('normalizePath collapses ids but keeps readable slugs', () => {
    assert.equal(normalizePath('/students/507f1f77bcf86cd799439011'), '/students/:id');
    assert.equal(normalizePath('/courses/khoa-hoc-ai-co-ban'), '/courses/khoa-hoc-ai-co-ban');
    assert.equal(normalizePath('/studio/ai-skills?page=3#top'), '/studio/ai-skills');
    assert.equal(normalizePath('/jobs/12345'), '/jobs/:id');
    assert.equal(normalizePath('/jobs/123'), '/jobs/123');
    assert.equal(normalizePath('/'), '/');
    assert.equal(normalizePath('/studio/'), '/studio');
    assert.equal(normalizePath('studio/vocab'), '/studio/vocab');
    assert.equal(normalizePath(''), '/');
    assert.equal(normalizePath('/a'.repeat(200)).length <= 200, true);
});

// The runtime connects with autoIndex=false, so schema-level index() calls never
// reach MongoDB — pagevisits indexes exist only if they are in the reviewed plan.
test('pagevisits indexes are declared in the reviewed index plan', () => {
    const planned = REQUIRED_INDEXES.filter((i) => i.collection === 'pagevisits');
    const keys = planned.map((i) => JSON.stringify(i.key));

    assert.ok(keys.includes(JSON.stringify({ createdAt: 1 })), 'missing TTL index on createdAt');
    assert.ok(keys.includes(JSON.stringify({ createdAt: -1 })));
    assert.ok(keys.includes(JSON.stringify({ path: 1, createdAt: -1 })));
    assert.ok(keys.includes(JSON.stringify({ sessionId: 1, createdAt: 1 })));
    assert.ok(keys.includes(JSON.stringify({ visitorId: 1 })));
    assert.ok(keys.includes(JSON.stringify({ channel: 1 })));

    const ttl = planned.find((i) => JSON.stringify(i.key) === JSON.stringify({ createdAt: 1 }));
    assert.equal(ttl.options.expireAfterSeconds, RETENTION_MS.analytics / 1000);
});

test('the analytics range cap matches the retention window', () => {
    // /overview clamps ?days= to RETENTION_DAYS — a longer range would read a window
    // the TTL has already emptied and quietly report zeros.
    assert.equal(RETENTION_DAYS, 90);
    assert.equal(RETENTION_MS.analytics, RETENTION_DAYS * 24 * 60 * 60 * 1000);
});
