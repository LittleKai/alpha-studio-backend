import mongoose from 'mongoose';
import Article from '../models/Article.js';
import PageVisit from '../models/PageVisit.js';
import SystemSetting from '../models/SystemSetting.js';

export const SERVICE_VIEWS_BACKFILL_KEY = 'article_service_views_backfilled_v1';

/**
 * Extract the service article slug from a normalized PageVisit path like `/services/<slug>`.
 * Returns `null` for listing pages (`/services`), nested subpaths, or other routes.
 */
export function extractServiceSlugFromPath(path) {
    if (typeof path !== 'string') return null;
    const match = path.match(/^\/services\/([^/?#]+)$/);
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

/**
 * Seed `Article.viewCount` for `services` articles from existing `PageVisit` records
 * once per database (idempotency marker stored in `SystemSetting` with a cutoff
 * timestamp so historical views are never lost when `PageVisit` 90-day TTL expires).
 */
export async function backfillServiceArticleViewsFromPageVisits({
    mongooseClient = mongoose,
    ArticleModel = Article,
    PageVisitModel = PageVisit,
    SystemSettingModel = SystemSetting,
    logger = console,
} = {}) {
    const session = await mongooseClient.startSession();
    try {
        return await session.withTransaction(async () => {
            const cutoff = new Date();
            const claim = await SystemSettingModel.findOneAndUpdate(
                { key: SERVICE_VIEWS_BACKFILL_KEY },
                {
                    $setOnInsert: {
                        value: cutoff.toISOString(),
                        description: 'Cutoff timestamp for seeding /services Article.viewCount from PageVisit',
                    },
                },
                { upsert: true, new: false, session }
            );

            if (claim) {
                return { skipped: true, updated: 0 };
            }

            const rows = await PageVisitModel.aggregate([
                { $match: { path: { $regex: '^/services/[^/]+$' }, createdAt: { $lt: cutoff } } },
                { $group: { _id: '$path', views: { $sum: 1 } } },
            ], { session });

            const ops = [];
            for (const row of rows) {
                const slug = extractServiceSlugFromPath(row?._id);
                const views = Number(row?.views || 0);
                if (!slug || views <= 0) continue;
                ops.push({
                    updateOne: {
                        filter: { category: 'services', slug },
                        update: { $inc: { viewCount: views } },
                    },
                });
            }

            if (ops.length > 0) {
                await ArticleModel.bulkWrite(ops, { ordered: false, session, timestamps: false });
            }

            logger.log?.(`[articleViews] Backfilled viewCount for ${ops.length} /services article(s) from PageVisit`);
            return { skipped: false, updated: ops.length };
        });
    } finally {
        await session.endSession();
    }
}
