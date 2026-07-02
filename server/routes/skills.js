import express from 'express';
import Skill from '../models/Skill.js';

const router = express.Router();

// ── In-memory cache for filterCounts (refreshed every 5 minutes) ──────────
let filterCountsCache = null;
let filterCountsCacheTime = 0;
const FILTER_COUNTS_TTL = 5 * 60 * 1000; // 5 minutes

// Fields to return for list/index endpoints (exclude heavy `sections`)
const INDEX_FIELDS = 'slug name headline headline_vi short_description short_description_vi tier category difficulty install_type estimated_time_saving author install_command source_repo_url works_with tags';

/**
 * Parse estimated_time_saving string like "2 hours" / "30 minutes" into minutes.
 * Returns NaN when the string cannot be parsed.
 */
function parseTimeSavingMinutes(str) {
    if (!str) return NaN;
    const match = str.match(/([\d.]+)\s*(hour|minute|min|hr)/i);
    if (!match) return NaN;
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    if (unit.startsWith('hour') || unit.startsWith('hr')) return value * 60;
    return value;
}

/**
 * Build the global filterCounts object from ALL skills in the DB.
 * Cached for 5 minutes so the frontend sidebar always shows accurate totals.
 */
async function getFilterCounts() {
    const now = Date.now();
    if (filterCountsCache && now - filterCountsCacheTime < FILTER_COUNTS_TTL) {
        return filterCountsCache;
    }

    const [categoryAgg, tierAgg, difficultyAgg, installTypeAgg, totalSkills, allTimeSavings] = await Promise.all([
        Skill.aggregate([
            { $group: { _id: '$category', count: { $sum: 1 } } }
        ]),
        Skill.aggregate([
            { $group: { _id: '$tier', count: { $sum: 1 } } }
        ]),
        Skill.aggregate([
            { $group: { _id: '$difficulty', count: { $sum: 1 } } }
        ]),
        Skill.aggregate([
            { $match: { install_type: { $ne: '' } } },
            { $group: { _id: '$install_type', count: { $sum: 1 } } }
        ]),
        Skill.countDocuments(),
        Skill.find({ estimated_time_saving: { $ne: '' } })
            .select('estimated_time_saving')
            .lean()
    ]);

    const categories = {};
    for (const c of categoryAgg) {
        if (c._id) categories[c._id] = c.count;
    }

    const tiers = {};
    for (const t of tierAgg) {
        if (t._id) tiers[t._id] = t.count;
    }

    const difficulties = {};
    for (const d of difficultyAgg) {
        if (d._id) difficulties[d._id] = d.count;
    }

    const installTypes = {};
    for (const i of installTypeAgg) {
        if (i._id) installTypes[i._id] = i.count;
    }

    // Count verified (Gold + Silver tiers) and compute total time saved in hours
    const verifiedCount = (tiers['Gold'] || 0) + (tiers['Silver'] || 0);
    let totalTimeSavedMinutes = 0;
    for (const skill of allTimeSavings) {
        const mins = parseTimeSavingMinutes(skill.estimated_time_saving);
        if (!isNaN(mins)) totalTimeSavedMinutes += mins;
    }

    filterCountsCache = {
        categories,
        tiers,
        difficulties,
        installTypes,
        totalSkills,
        verifiedCount,
        totalTimeSavedHours: Math.round(totalTimeSavedMinutes / 60)
    };
    filterCountsCacheTime = now;

    return filterCountsCache;
}

// @route   GET /api/skills
// @desc    Get all skills with filtering, pagination, search
// @access  Public
router.get('/', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 12,
            search,
            category,
            difficulty,
            tier,
            install_type,
            timeSaving,
            sort = '-createdAt'
        } = req.query;

        // Build query
        const query = {};

        if (category) query.category = category;
        if (tier) query.tier = tier;
        if (install_type) query.install_type = install_type;

        if (difficulty) {
            query.difficulty = new RegExp(`^${difficulty}$`, 'i');
        }

        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { name: searchRegex },
                { headline: searchRegex },
                { headline_vi: searchRegex },
                { short_description: searchRegex },
                { short_description_vi: searchRegex },
                { tags: searchRegex },
                { author: searchRegex }
            ];
        }

        // Build sort
        let sortOption = {};
        switch (sort) {
            case 'az':
                sortOption = { name: 1 };
                break;
            case 'za':
                sortOption = { name: -1 };
                break;
            case 'popular':
                // Gold > Silver > Bronze ranking via computed sort
                sortOption = { _tierRank: 1, name: 1 };
                break;
            case 'timeSaved':
                sortOption = { _timeSavedRank: 1, name: 1 };
                break;
            case 'quickest':
                sortOption = { _timeSavedRank: -1, name: 1 };
                break;
            default:
                if (sort.startsWith('-')) {
                    sortOption[sort.substring(1)] = -1;
                } else {
                    sortOption[sort] = 1;
                }
        }

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // For 'popular' and 'timeSaved' sorts, or timeSaving filter, use aggregation
        const needsAggregation = sort === 'popular' || sort === 'timeSaved' || sort === 'quickest' || timeSaving;

        let skills, total;

        if (needsAggregation) {
            const pipeline = [];

            // Match stage
            if (Object.keys(query).length > 0) {
                pipeline.push({ $match: query });
            }

            // Add computed fields for sorting/filtering
            pipeline.push({
                $addFields: {
                    _tierRank: {
                        $switch: {
                            branches: [
                                { case: { $eq: ['$tier', 'Gold'] }, then: 1 },
                                { case: { $eq: ['$tier', 'Silver'] }, then: 2 },
                                { case: { $eq: ['$tier', 'Bronze'] }, then: 3 }
                            ],
                            default: 4
                        }
                    },
                    _timeSavedMinutes: {
                        $let: {
                            vars: {
                                hourMatch: {
                                    $regexFind: {
                                        input: '$estimated_time_saving',
                                        regex: /([\d.]+)\s*(hour|hr)/i
                                    }
                                },
                                minMatch: {
                                    $regexFind: {
                                        input: '$estimated_time_saving',
                                        regex: /([\d.]+)\s*(minute|min)/i
                                    }
                                }
                            },
                            in: {
                                $cond: {
                                    if: { $ne: ['$$hourMatch', null] },
                                    then: {
                                        $multiply: [
                                            { $toDouble: { $arrayElemAt: ['$$hourMatch.captures', 0] } },
                                            60
                                        ]
                                    },
                                    else: {
                                        $cond: {
                                            if: { $ne: ['$$minMatch', null] },
                                            then: { $toDouble: { $arrayElemAt: ['$$minMatch.captures', 0] } },
                                            else: 0
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            // Time saving filter
            if (timeSaving) {
                switch (timeSaving) {
                    case 'short':
                        pipeline.push({ $match: { _timeSavedMinutes: { $gt: 0, $lt: 60 } } });
                        break;
                    case 'medium':
                        pipeline.push({ $match: { _timeSavedMinutes: { $gte: 60, $lte: 180 } } });
                        break;
                    case 'long':
                        pipeline.push({ $match: { _timeSavedMinutes: { $gt: 180 } } });
                        break;
                }
            }

            // Count before pagination
            const countPipeline = [...pipeline, { $count: 'total' }];

            // Sort
            if (sort === 'popular') {
                pipeline.push({ $sort: { _tierRank: 1, name: 1 } });
            } else if (sort === 'timeSaved') {
                pipeline.push({ $sort: { _timeSavedMinutes: -1, name: 1 } });
            } else if (sort === 'quickest') {
                pipeline.push({ $sort: { _timeSavedMinutes: 1, name: 1 } });
            } else {
                pipeline.push({ $sort: sortOption });
            }

            // Pagination
            pipeline.push({ $skip: skip });
            pipeline.push({ $limit: limitNum });

            // Project only index fields (remove computed fields)
            pipeline.push({
                $project: {
                    source: 0,
                    url: 0,
                    sections: 0,
                    crawl_meta: 0,
                    _tierRank: 0,
                    _timeSavedMinutes: 0
                }
            });

            const [countResult, data] = await Promise.all([
                Skill.aggregate(countPipeline),
                Skill.aggregate(pipeline)
            ]);

            total = countResult.length > 0 ? countResult[0].total : 0;
            skills = data;
        } else {
            [skills, total] = await Promise.all([
                Skill.find(query)
                    .select(INDEX_FIELDS)
                    .sort(sortOption)
                    .skip(skip)
                    .limit(limitNum)
                    .lean(),
                Skill.countDocuments(query)
            ]);
        }

        // Get cached filter counts (from ALL skills, not filtered)
        const filterCounts = await getFilterCounts();

        res.json({
            success: true,
            data: skills,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                pages: Math.ceil(total / limitNum)
            },
            filterCounts
        });
    } catch (error) {
        console.error('Get skills error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching skills'
        });
    }
});

// @route   GET /api/skills/stats
// @desc    Get aggregate skill statistics
// @access  Public
router.get('/stats', async (req, res) => {
    try {
        const filterCounts = await getFilterCounts();
        res.json({
            success: true,
            data: filterCounts
        });
    } catch (error) {
        console.error('Get skills stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching skill stats'
        });
    }
});

// @route   GET /api/skills/:slug
// @desc    Get single skill by slug with full detail
// @access  Public
router.get('/:slug', async (req, res) => {
    try {
        const skill = await Skill.findOne({ slug: req.params.slug }).lean();

        if (!skill) {
            return res.status(404).json({
                success: false,
                message: 'Skill not found'
            });
        }

        // Get 4 related skills from same category (exclude current)
        const relatedSkills = await Skill.find({
            category: skill.category,
            _id: { $ne: skill._id }
        })
            .select(INDEX_FIELDS)
            .limit(4)
            .lean();

        res.json({
            success: true,
            data: skill,
            relatedSkills
        });
    } catch (error) {
        console.error('Get skill error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching skill'
        });
    }
});

export default router;
