import express from 'express';
import mongoose from 'mongoose';
import { authMiddleware } from '../middleware/auth.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import SystemSetting from '../models/SystemSetting.js';
import {
    VocabDeckRating,
    VocabFeedback,
    VocabImportLink,
    VocabProfile,
    VocabPublicDeck,
    VocabPublicFlashcard,
    VocabPrivateDeck,
    VocabPrivateFlashcard,
    VocabChineseDictionary,
} from '../models/Vocab.js';

const router = express.Router();

const categories = [
    { id: 'general', name: 'General', icon: 'category', color: '#64748b', order: 0 },
    { id: 'business', name: 'Business', icon: 'business', color: '#0ea5e9', order: 1 },
    { id: 'travel', name: 'Travel', icon: 'flight', color: '#22c55e', order: 2 },
    { id: 'food', name: 'Food', icon: 'restaurant', color: '#f97316', order: 3 },
    { id: 'technology', name: 'Technology', icon: 'computer', color: '#6366f1', order: 4 },
    { id: 'education', name: 'Education', icon: 'school', color: '#a855f7', order: 5 },
    { id: 'other', name: 'Other', icon: 'more_horiz', color: '#71717a', order: 99 },
];

function ok(res, data, message = 'OK') {
    return res.json({ success: true, message, data });
}

function userId(req) {
    return req.user._id || req.user.id;
}

function toDate(value) {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : value;
}

function serializeDeck(deck) {
    const d = deck.toObject ? deck.toObject() : deck;
    return {
        id: d.deckId,
        original_local_id: d.originalLocalId,
        author_id: String(d.authorId),
        author_name: d.authorName,
        name: d.name,
        description: d.description,
        source_language: d.sourceLanguage,
        target_language: d.targetLanguage,
        category_id: d.categoryId,
        tags: d.tags || [],
        card_count: d.cardCount || 0,
        version: d.version || 1,
        rating_sum: d.ratingSum || 0,
        rating_count: d.ratingCount || 0,
        download_count: d.downloadCount || 0,
        created_at: toDate(d.createdAt),
        updated_at: toDate(d.updatedAt),
        published_at: toDate(d.publishedAt),
        is_active: d.isActive !== false,
        short_id: d.shortId || d.deckId,
        image_url: d.imageUrl,
        front_fields: d.frontFields,
        back_fields: d.backFields,
        image_display_mode: d.imageDisplayMode,
        show_back_first: Boolean(d.showBackFirst),
    };
}

function serializeFlashcard(card) {
    const c = card.toObject ? card.toObject() : card;
    return {
        id: String(c._id),
        public_deck_id: c.publicDeckId,
        front: c.front,
        front_phonetic: c.frontPhonetic,
        back: c.back,
        example: c.example,
        notes: c.notes,
        tags: c.tags || [],
        order: c.order || 0,
        front_image_url: c.frontImageUrl,
        back_image_url: c.backImageUrl,
        share_image: c.shareImage !== false,
        created_at: toDate(c.createdAt),
        updated_at: toDate(c.updatedAt),
    };
}

function serializeRating(rating) {
    const r = rating.toObject ? rating.toObject() : rating;
    return {
        id: String(r._id),
        public_deck_id: r.publicDeckId,
        user_id: String(r.userId),
        user_name: r.userName,
        rating: r.rating,
        review: r.review,
        created_at: toDate(r.createdAt),
        updated_at: toDate(r.updatedAt),
    };
}

function serializeImportLink(link) {
    const l = link.toObject ? link.toObject() : link;
    return {
        id: String(l._id),
        public_deck_id: l.publicDeckId,
        local_deck_id: l.localDeckId,
        user_id: String(l.userId),
        imported_version: l.importedVersion,
        imported_at: toDate(l.importedAt),
        last_synced_at: toDate(l.lastSyncedAt),
        auto_sync: l.autoSync !== false,
    };
}

// GET /api/vocab/releases/latest
router.get('/releases/latest', async (_req, res) => {
    try {
        let b2Data = null;
        try {
            const response = await fetch('https://cdn.giaiphapsangtao.com/file/alpha-studio/vocabflip-app/version.json');
            if (response.ok) {
                const release = await response.json();
                const assets = release.assets || [];
                const windowsAsset = assets.find((asset) => {
                    const name = (asset.name || '').toLowerCase();
                    return name.includes('windows') && name.endsWith('.zip');
                }) || assets.find((asset) => (asset.name || '').toLowerCase().endsWith('.zip'));
                const androidAsset = assets.find((asset) => (asset.name || '').toLowerCase().endsWith('.apk'));
                const version = release.tag_name
                    ? (release.tag_name.startsWith('v') ? release.tag_name.substring(1) : release.tag_name)
                    : (release.version || '1.1.6');

                b2Data = {
                    version,
                    windowsInstallerUrl: windowsAsset
                        ? windowsAsset.browser_download_url
                        : `https://cdn.giaiphapsangtao.com/file/alpha-studio/vocabflip-app/releases/vocabflip-windows-v${version}.zip`,
                    androidApkUrl: androidAsset
                        ? androidAsset.browser_download_url
                        : `https://cdn.giaiphapsangtao.com/file/alpha-studio/vocabflip-app/releases/vocabflip-v${version}.apk`,
                    releaseNotes: release.body || 'VocabFlip release build',
                    publishedAt: release.published_at || new Date().toISOString(),
                    windowsSize: windowsAsset?.size,
                    androidSize: androidAsset?.size,
                };

                // Automatically update/cache in SystemSetting database so the override remains fresh!
                await SystemSetting.findOneAndUpdate(
                    { key: 'vocab_latest_release' },
                    { value: b2Data },
                    { upsert: true, new: true }
                );
            }
        } catch (fetchError) {
            console.error('Failed to fetch VocabFlip release metadata from B2:', fetchError.message);
        }

        if (b2Data) {
            return ok(res, b2Data);
        }

        // If CDN fetch fails, fall back to cached settings in DB
        const setting = await SystemSetting.findOne({ key: 'vocab_latest_release' });
        if (setting && setting.value) {
            return ok(res, setting.value);
        }

        // Final fallback if both CDN fetch and DB cache are unavailable
        return ok(res, {
            version: '1.1.6',
            windowsInstallerUrl: 'https://cdn.giaiphapsangtao.com/file/alpha-studio/vocabflip-app/releases/vocabflip-windows-v1.1.6.zip',
            androidApkUrl: 'https://cdn.giaiphapsangtao.com/file/alpha-studio/vocabflip-app/releases/vocabflip-v1.1.6.apk',
            releaseNotes: 'VocabFlip release build',
            publishedAt: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Error fetching latest VocabFlip release:', error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi server khi lấy thông tin bản phát hành VocabFlip mới nhất'
        });
    }
});

function serializeProfile(profile, fallbackUser = null) {
    if (!profile && !fallbackUser) return null;
    const p = profile?.toObject ? profile.toObject() : profile;
    return {
        id: p?.userId ? String(p.userId) : String(fallbackUser?._id),
        user_id: p?.userId ? String(p.userId) : String(fallbackUser?._id),
        nickname: p?.nickname || fallbackUser?.name || null,
        gender: p?.gender || 'preferNotToSay',
        avatar_index: p?.avatarIndex || 0,
        avatar_url: p?.avatarUrl || fallbackUser?.avatar || null,
        bio: p?.bio || fallbackUser?.bio || null,
        updated_at: toDate(p?.updatedAt || fallbackUser?.updatedAt),
    };
}

function serializeFeedback(item) {
    const f = item.toObject ? item.toObject() : item;
    return {
        id: String(f._id),
        user_id: f.userId ? String(f.userId) : null,
        category: f.category,
        message: f.message,
        email: f.email,
        app_version: f.appVersion,
        platform: f.platform,
        created_at: toDate(f.createdAt),
    };
}

function serializePrivateDeck(deck) {
    const d = deck.toObject ? deck.toObject() : deck;
    return {
        id: d.deckId,
        name: d.name,
        description: d.description,
        source_language: d.sourceLanguage,
        target_language: d.targetLanguage,
        created_at: toDate(d.createdAt),
        updated_at: toDate(d.updatedAt),
        linked_public_deck_id: d.linkedPublicDeckId,
        linked_version: d.linkedVersion,
        is_published: d.isPublished ? 1 : 0,
        published_deck_id: d.publishedDeckId,
        was_imported: d.wasImported ? 1 : 0,
        show_back_first: d.showBackFirst ? 1 : 0,
        front_fields: d.frontFields,
        back_fields: d.backFields,
        image_display_mode: d.imageDisplayMode,
        image_path: d.imagePath,
        auto_play_tts_on_flip: d.autoPlayTtsOnFlip ? 1 : 0,
        category: d.category,
        tags: d.tags && d.tags.length > 0 ? d.tags.join(',') : null,
        card_count: d.cardCount || 0,
        new_count: d.newCount || 0,
        learning_count: d.learningCount || 0,
        review_count: d.reviewCount || 0,
    };
}

function serializePrivateFlashcard(card) {
    const c = card.toObject ? card.toObject() : card;
    return {
        id: c.cardId,
        deck_id: c.deckId,
        front: c.front,
        front_phonetic: c.frontPhonetic,
        back: c.back,
        example: c.example,
        notes: c.notes,
        image_url: c.imageUrl,
        front_image_url: c.frontImageUrl,
        back_image_url: c.backImageUrl,
        share_image: c.shareImage ? 1 : 0,
        tags: c.tags && c.tags.length > 0 ? c.tags.join(',') : '',
        created_at: toDate(c.createdAt),
        updated_at: toDate(c.updatedAt),
        easiness_factor: c.easinessFactor || 2.5,
        interval: c.interval || 0,
        repetitions: c.repetitions || 0,
        next_review_date: toDate(c.nextReviewDate),
        last_review_date: toDate(c.lastReviewDate),
    };
}

router.get('/categories', async (_req, res) => ok(res, categories));

router.get('/public-decks/mine', authMiddleware, async (req, res) => {
    try {
        const decks = await VocabPublicDeck.find({
            authorId: userId(req),
            isActive: true,
        }).sort({ updatedAt: -1 });
        return ok(res, decks.map(serializeDeck));
    } catch (error) {
        console.error('Vocab my decks error:', error);
        return res.status(500).json({ success: false, message: 'Cannot load published decks' });
    }
});

router.get('/public-decks', async (req, res) => {
    try {
        const {
            category_id,
            source_language,
            target_language,
            q,
            tags,
            sort_by = 'popular',
            descending = 'true',
            limit = 20,
            skip = 0,
        } = req.query;

        const query = { isActive: true };
        if (category_id) query.categoryId = category_id;
        if (source_language) query.sourceLanguage = source_language;
        if (target_language) query.targetLanguage = target_language;
        if (tags) query.tags = { $in: String(tags).split(',').map((t) => t.trim()).filter(Boolean) };
        if (q) {
            const regex = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            query.$or = [{ name: regex }, { description: regex }, { tags: regex }];
        }

        const sortField = {
            popular: 'downloadCount',
            rating: 'ratingSum',
            newest: 'publishedAt',
            updated: 'updatedAt',
        }[sort_by] || 'downloadCount';

        const decks = await VocabPublicDeck.find(query)
            .sort({ [sortField]: String(descending) === 'false' ? 1 : -1 })
            .skip(Number(skip) || 0)
            .limit(Math.min(Number(limit) || 20, 100));

        return ok(res, decks.map(serializeDeck));
    } catch (error) {
        console.error('Vocab browse error:', error);
        return res.status(500).json({ success: false, message: 'Cannot browse decks' });
    }
});

router.get('/public-decks/:id', async (req, res) => {
    const deck = await VocabPublicDeck.findOne({ deckId: req.params.id, isActive: true });
    if (!deck) return res.status(404).json({ success: false, message: 'Deck not found' });
    return ok(res, serializeDeck(deck));
});

router.get('/public-decks/:id/flashcards', async (req, res) => {
    const cards = await VocabPublicFlashcard.find({ publicDeckId: req.params.id }).sort({ order: 1 });
    return ok(res, cards.map(serializeFlashcard));
});

router.post('/public-decks', authMiddleware, async (req, res) => {
    try {
        const body = req.body || {};
        const deckId = String(body.id || body.short_id || new mongoose.Types.ObjectId().toString()).toUpperCase();
        const existing = await VocabPublicDeck.findOne({ deckId });
        if (existing) {
            return res.status(409).json({ success: false, message: 'Deck ID already exists' });
        }

        const deck = await VocabPublicDeck.create({
            deckId,
            shortId: body.short_id || deckId,
            originalLocalId: body.original_local_id || null,
            authorId: userId(req),
            authorName: body.author_name || req.user.name || 'Anonymous',
            name: body.name,
            description: body.description || null,
            sourceLanguage: body.source_language || 'en',
            targetLanguage: body.target_language || 'vi',
            categoryId: body.category_id || 'other',
            tags: Array.isArray(body.tags) ? body.tags : [],
            cardCount: Array.isArray(body.flashcards) ? body.flashcards.length : 0,
            imageUrl: body.image_url || null,
            frontFields: body.front_fields || null,
            backFields: body.back_fields || null,
            imageDisplayMode: body.image_display_mode || null,
            showBackFirst: Boolean(body.show_back_first),
            publishedAt: new Date(),
        });

        if (Array.isArray(body.flashcards) && body.flashcards.length > 0) {
            await VocabPublicFlashcard.insertMany(body.flashcards.map((card, index) => ({
                publicDeckId: deckId,
                front: card.front,
                frontPhonetic: card.front_phonetic || null,
                back: card.back,
                example: card.example || null,
                notes: card.notes || null,
                tags: Array.isArray(card.tags) ? card.tags : [],
                order: index,
                frontImageUrl: card.front_image_url || null,
                backImageUrl: card.back_image_url || null,
                shareImage: card.share_image !== false,
            })));
        }

        return ok(res, serializeDeck(deck), 'Deck published');
    } catch (error) {
        console.error('Vocab publish error:', error);
        return res.status(500).json({ success: false, message: 'Cannot publish deck' });
    }
});

router.patch('/public-decks/:id', authMiddleware, async (req, res) => {
    try {
        const deck = await VocabPublicDeck.findOne({ deckId: req.params.id });
        if (!deck) return res.status(404).json({ success: false, message: 'Deck not found' });
        if (String(deck.authorId) !== String(userId(req)) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Only the author can update this deck' });
        }

        const body = req.body || {};
        if (body.name !== undefined) deck.name = body.name;
        if (body.description !== undefined) deck.description = body.description;
        if (body.category_id !== undefined) deck.categoryId = body.category_id;
        if (body.tags !== undefined) deck.tags = Array.isArray(body.tags) ? body.tags : [];
        if (body.image_url !== undefined) deck.imageUrl = body.image_url;
        if (body.front_fields !== undefined) deck.frontFields = body.front_fields;
        if (body.back_fields !== undefined) deck.backFields = body.back_fields;
        if (body.image_display_mode !== undefined) deck.imageDisplayMode = body.image_display_mode;
        if (body.show_back_first !== undefined) deck.showBackFirst = Boolean(body.show_back_first);
        if (Array.isArray(body.flashcards)) {
            await VocabPublicFlashcard.deleteMany({ publicDeckId: deck.deckId });
            await VocabPublicFlashcard.insertMany(body.flashcards.map((card, index) => ({
                publicDeckId: deck.deckId,
                front: card.front,
                frontPhonetic: card.front_phonetic || null,
                back: card.back,
                example: card.example || null,
                notes: card.notes || null,
                tags: Array.isArray(card.tags) ? card.tags : [],
                order: index,
                frontImageUrl: card.front_image_url || null,
                backImageUrl: card.back_image_url || null,
                shareImage: card.share_image !== false,
            })));
            deck.cardCount = body.flashcards.length;
        }
        deck.version += 1;
        await deck.save();
        return ok(res, serializeDeck(deck), 'Deck updated');
    } catch (error) {
        console.error('Vocab update error:', error);
        return res.status(500).json({ success: false, message: 'Cannot update deck' });
    }
});

router.delete('/public-decks/:id', authMiddleware, async (req, res) => {
    const deck = await VocabPublicDeck.findOne({ deckId: req.params.id });
    if (!deck) return res.status(404).json({ success: false, message: 'Deck not found' });
    if (String(deck.authorId) !== String(userId(req)) && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Only the author can unpublish this deck' });
    }
    await VocabPublicFlashcard.deleteMany({ publicDeckId: deck.deckId });
    await VocabPublicDeck.deleteOne({ _id: deck._id });
    return ok(res, null, 'Deck unpublished');
});

router.post('/public-decks/:id/download', async (req, res) => {
    await VocabPublicDeck.updateOne({ deckId: req.params.id }, { $inc: { downloadCount: 1 } });
    return ok(res, null);
});

router.put('/public-decks/:id/rating', authMiddleware, async (req, res) => {
    const ratingValue = Number(req.body.rating);
    if (ratingValue < 1 || ratingValue > 5) {
        return res.status(400).json({ success: false, message: 'Rating must be 1-5' });
    }

    const filter = { publicDeckId: req.params.id, userId: userId(req) };
    const previous = await VocabDeckRating.findOne(filter);
    const rating = await VocabDeckRating.findOneAndUpdate(filter, {
        userName: req.body.user_name || req.user.name,
        rating: ratingValue,
        review: req.body.review || null,
    }, { new: true, upsert: true, setDefaultsOnInsert: true });

    const inc = previous ? ratingValue - previous.rating : ratingValue;
    await VocabPublicDeck.updateOne({ deckId: req.params.id }, {
        $inc: { ratingSum: inc, ratingCount: previous ? 0 : 1 },
    });
    return ok(res, serializeRating(rating));
});

router.get('/public-decks/:id/rating/me', authMiddleware, async (req, res) => {
    const rating = await VocabDeckRating.findOne({ publicDeckId: req.params.id, userId: userId(req) });
    if (!rating) return res.status(404).json({ success: false, message: 'Rating not found' });
    return ok(res, serializeRating(rating));
});

router.get('/public-decks/:id/ratings', async (req, res) => {
    const ratings = await VocabDeckRating.find({ publicDeckId: req.params.id })
        .sort({ updatedAt: -1 })
        .limit(Math.min(Number(req.query.limit) || 20, 100));
    return ok(res, ratings.map(serializeRating));
});

router.delete('/public-decks/:id/rating', authMiddleware, async (req, res) => {
    const rating = await VocabDeckRating.findOneAndDelete({ publicDeckId: req.params.id, userId: userId(req) });
    if (rating) {
        await VocabPublicDeck.updateOne({ deckId: req.params.id }, {
            $inc: { ratingSum: -rating.rating, ratingCount: -1 },
        });
    }
    return ok(res, null);
});

router.post('/imports', authMiddleware, async (req, res) => {
    const link = await VocabImportLink.findOneAndUpdate({
        userId: userId(req),
        localDeckId: req.body.local_deck_id,
    }, {
        publicDeckId: req.body.public_deck_id,
        importedVersion: req.body.imported_version,
        autoSync: req.body.auto_sync !== false,
    }, { new: true, upsert: true, setDefaultsOnInsert: true });
    return ok(res, serializeImportLink(link));
});

router.get('/imports', authMiddleware, async (req, res) => {
    const links = await VocabImportLink.find({ userId: userId(req) }).sort({ updatedAt: -1 });
    return ok(res, links.map(serializeImportLink));
});

router.get('/imports/by-local/:localDeckId', authMiddleware, async (req, res) => {
    const link = await VocabImportLink.findOne({ userId: userId(req), localDeckId: req.params.localDeckId });
    if (!link) return res.status(404).json({ success: false, message: 'Import link not found' });
    return ok(res, serializeImportLink(link));
});

router.get('/imports/by-public/:publicDeckId', authMiddleware, async (req, res) => {
    const link = await VocabImportLink.findOne({ userId: userId(req), publicDeckId: req.params.publicDeckId });
    if (!link) return res.status(404).json({ success: false, message: 'Import link not found' });
    return ok(res, serializeImportLink(link));
});

router.patch('/imports/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.imported_version !== undefined) updates.importedVersion = req.body.imported_version;
    if (req.body.last_synced_at !== undefined) updates.lastSyncedAt = req.body.last_synced_at;
    if (req.body.auto_sync !== undefined) updates.autoSync = req.body.auto_sync;
    const link = await VocabImportLink.findOneAndUpdate({ _id: req.params.id, userId: userId(req) }, updates, { new: true });
    if (!link) return res.status(404).json({ success: false, message: 'Import link not found' });
    return ok(res, serializeImportLink(link));
});

router.delete('/imports/:id', authMiddleware, async (req, res) => {
    await VocabImportLink.deleteOne({ _id: req.params.id, userId: userId(req) });
    return ok(res, null);
});

router.get('/profile', authMiddleware, async (req, res) => {
    const profile = await VocabProfile.findOne({ userId: userId(req) });
    return ok(res, serializeProfile(profile, req.user));
});

router.put('/profile', authMiddleware, async (req, res) => {
    const profile = await VocabProfile.findOneAndUpdate({ userId: userId(req) }, {
        nickname: req.body.nickname || null,
        gender: req.body.gender || 'preferNotToSay',
        avatarIndex: req.body.avatar_index || 0,
        avatarUrl: req.body.avatar_url || null,
        bio: req.body.bio || null,
    }, { new: true, upsert: true, setDefaultsOnInsert: true });
    return ok(res, serializeProfile(profile, req.user));
});

router.get('/profiles/check-nickname', authMiddleware, async (req, res) => {
    const nickname = String(req.query.nickname || '').trim();
    if (!nickname) return res.status(400).json({ success: false, message: 'nickname is required' });
    const profile = await VocabProfile.findOne({ nickname });
    if (!profile) return res.status(404).json({ success: false, message: 'Nickname is available' });
    return ok(res, serializeProfile(profile));
});

router.get('/profiles/:id', async (req, res) => {
    const profile = await VocabProfile.findOne({ userId: req.params.id });
    if (profile) return ok(res, serializeProfile(profile));
    const user = await User.findById(req.params.id).select('name avatar bio updatedAt');
    if (!user) return res.status(404).json({ success: false, message: 'Profile not found' });
    return ok(res, serializeProfile(null, user));
});

router.get('/sync/notifications', authMiddleware, async (_req, res) => ok(res, []));
router.patch('/sync/notifications/:id/read', authMiddleware, async (_req, res) => ok(res, null));
router.post('/sync/notifications/read-all', authMiddleware, async (_req, res) => ok(res, null));

router.post('/feedback', authMiddleware, async (req, res) => {
    const item = await VocabFeedback.create({
        userId: userId(req),
        category: req.body.category,
        message: req.body.message,
        email: req.body.email || null,
        appVersion: req.body.app_version || null,
        platform: req.body.platform || null,
    });
    return ok(res, serializeFeedback(item), 'Feedback submitted');
});

router.get('/feedback', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'mod') {
        return res.status(403).json({ success: false, message: 'Admin or moderator only' });
    }
    const items = await VocabFeedback.find({})
        .sort({ createdAt: -1 })
        .limit(Math.min(Number(req.query.limit) || 50, 200));
    return ok(res, items.map(serializeFeedback));
});

router.get('/feedback/count', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'mod') {
        return res.status(403).json({ success: false, message: 'Admin or moderator only' });
    }
    const since = req.query.since ? new Date(req.query.since) : new Date(0);
    const count = await VocabFeedback.countDocuments({ createdAt: { $gt: since } });
    return ok(res, { count });
});

/**
 * @route   POST /api/vocab/spend
 * @desc    Deduct credits for VocabFlip actions
 * @access  Private
 */
router.post('/spend', authMiddleware, async (req, res) => {
    try {
        const { amount, reason } = req.body;

        if (!amount || typeof amount !== 'number' || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Số xu không hợp lệ'
            });
        }

        const user = await User.findById(userId(req));
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }

        if (user.balance < amount) {
            return res.status(400).json({
                success: false,
                message: 'Không đủ số dư để thực hiện thao tác này'
            });
        }

        user.balance -= amount;
        await user.save();

        await Transaction.create({
            userId: user._id,
            type: 'spend',
            serviceType: 'vocab',
            amount,
            status: 'completed',
            notes: reason || 'VocabFlip action',
            createdAt: new Date()
        });

        return ok(res, { remainingBalance: user.balance }, 'Đã trừ xu thành công');
    } catch (error) {
        console.error('Vocab spend error:', error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi server khi trừ xu VocabFlip'
        });
    }
});

/**
 * =========================================================================
 * VocabFlip Private Storage & CRUD Routes (Web client integration)
 * =========================================================================
 */

router.get('/my-decks', authMiddleware, async (req, res) => {
    try {
        const uId = userId(req);
        const now = new Date();
        const counts = await VocabPrivateFlashcard.aggregate([
            { $match: { userId: new mongoose.Types.ObjectId(uId.toString()) } },
            {
                $group: {
                    _id: "$deckId",
                    total: { $sum: 1 },
                    newCount: {
                        $sum: { $cond: [{ $eq: ["$repetitions", 0] }, 1, 0] }
                    },
                    learningCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $gt: ["$repetitions", 0] },
                                        { $lt: ["$repetitions", 3] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    reviewCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $gte: ["$repetitions", 3] },
                                        {
                                            $or: [
                                                { $eq: ["$nextReviewDate", null] },
                                                { $lte: ["$nextReviewDate", now] }
                                            ]
                                        }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        const countsMap = {};
        counts.forEach(c => {
            countsMap[c._id] = {
                total: c.total || 0,
                newCount: c.newCount || 0,
                learning: c.learningCount || 0,
                review: c.reviewCount || 0
            };
        });

        const decks = await VocabPrivateDeck.find({ userId: uId }).sort({ createdAt: 1 });
        const serialized = decks.map(d => {
            const c = countsMap[d.deckId] || { total: 0, newCount: 0, learning: 0, review: 0 };
            return serializePrivateDeck({
                ...d.toObject(),
                cardCount: c.total,
                newCount: c.newCount,
                learningCount: c.learning,
                reviewCount: c.review
            });
        });

        return ok(res, serialized);
    } catch (error) {
        console.error('Get private decks error:', error);
        return res.status(500).json({ success: false, message: 'Cannot load decks' });
    }
});

router.get('/my-decks/cards/search', authMiddleware, async (req, res) => {
    try {
        const uId = userId(req);
        const { q, limit = 50 } = req.query;
        if (!q) {
            return res.status(400).json({ success: false, message: 'Search query q is required' });
        }

        const regex = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const cards = await VocabPrivateFlashcard.find({
            userId: uId,
            $or: [
                { front: regex },
                { back: regex },
                { example: regex },
                { notes: regex },
                { tags: regex }
            ]
        }).limit(Math.min(Number(limit) || 50, 100));

        return ok(res, cards.map(serializePrivateFlashcard));
    } catch (error) {
        console.error('Search private cards error:', error);
        return res.status(500).json({ success: false, message: 'Cannot search cards' });
    }
});

router.get('/my-decks/cards/:cardId', authMiddleware, async (req, res) => {
    try {
        const uId = userId(req);
        const card = await VocabPrivateFlashcard.findOne({ cardId: req.params.cardId, userId: uId });
        if (!card) {
            return res.status(404).json({ success: false, message: 'Card not found' });
        }
        return ok(res, serializePrivateFlashcard(card));
    } catch (error) {
        console.error('Get private card error:', error);
        return res.status(500).json({ success: false, message: 'Cannot load card' });
    }
});

router.get('/my-decks/:deckId', authMiddleware, async (req, res) => {
    try {
        const uId = userId(req);
        const deck = await VocabPrivateDeck.findOne({ deckId: req.params.deckId, userId: uId });
        if (!deck) {
            return res.status(404).json({ success: false, message: 'Deck not found' });
        }

        const now = new Date();
        const counts = await VocabPrivateFlashcard.aggregate([
            { $match: { deckId: req.params.deckId, userId: new mongoose.Types.ObjectId(uId.toString()) } },
            {
                $group: {
                    _id: "$deckId",
                    total: { $sum: 1 },
                    newCount: {
                        $sum: { $cond: [{ $eq: ["$repetitions", 0] }, 1, 0] }
                    },
                    learningCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $gt: ["$repetitions", 0] },
                                        { $lt: ["$repetitions", 3] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    reviewCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $gte: ["$repetitions", 3] },
                                        {
                                            $or: [
                                                { $eq: ["$nextReviewDate", null] },
                                                { $lte: ["$nextReviewDate", now] }
                                            ]
                                        }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        const c = counts[0] || { total: 0, newCount: 0, learningCount: 0, reviewCount: 0 };
        const serialized = serializePrivateDeck({
            ...deck.toObject(),
            cardCount: c.total,
            newCount: c.newCount,
            learningCount: c.learningCount,
            reviewCount: c.reviewCount
        });

        return ok(res, serialized);
    } catch (error) {
        console.error('Get private deck error:', error);
        return res.status(500).json({ success: false, message: 'Cannot load deck' });
    }
});

router.post('/my-decks', authMiddleware, async (req, res) => {
    try {
        const uId = userId(req);
        const body = req.body || {};
        const deckId = String(body.id || new mongoose.Types.ObjectId().toString()).toUpperCase();
        
        const existing = await VocabPrivateDeck.findOne({ deckId, userId: uId });
        if (existing) {
            return res.status(409).json({ success: false, message: 'Deck ID already exists for this user' });
        }

        const deck = await VocabPrivateDeck.create({
            deckId,
            userId: uId,
            name: body.name,
            description: body.description || null,
            sourceLanguage: body.source_language || 'en',
            targetLanguage: body.target_language || 'vi',
            linkedPublicDeckId: body.linked_public_deck_id || null,
            linkedVersion: body.linked_version || null,
            isPublished: Boolean(body.is_published),
            publishedDeckId: body.published_deck_id || null,
            wasImported: Boolean(body.was_imported),
            showBackFirst: Boolean(body.show_back_first),
            frontFields: body.front_fields || null,
            backFields: body.back_fields || null,
            imageDisplayMode: body.image_display_mode || 'both',
            imagePath: body.image_path || null,
            autoPlayTtsOnFlip: body.auto_play_tts_on_flip !== false,
            category: body.category || null,
            tags: Array.isArray(body.tags) ? body.tags : (body.tags ? body.tags.split(',') : []),
        });

        return ok(res, serializePrivateDeck(deck), 'Deck created');
    } catch (error) {
        console.error('Create private deck error:', error);
        return res.status(500).json({ success: false, message: 'Cannot create deck' });
    }
});

router.put('/my-decks/:deckId', authMiddleware, async (req, res) => {
    try {
        const uId = userId(req);
        const deck = await VocabPrivateDeck.findOne({ deckId: req.params.deckId, userId: uId });
        if (!deck) {
            return res.status(404).json({ success: false, message: 'Deck not found' });
        }

        const body = req.body || {};
        if (body.name !== undefined) deck.name = body.name;
        if (body.description !== undefined) deck.description = body.description;
        if (body.source_language !== undefined) deck.sourceLanguage = body.source_language;
        if (body.target_language !== undefined) deck.targetLanguage = body.target_language;
        if (body.linked_public_deck_id !== undefined) deck.linkedPublicDeckId = body.linked_public_deck_id;
        if (body.linked_version !== undefined) deck.linkedVersion = body.linked_version;
        if (body.is_published !== undefined) deck.isPublished = Boolean(body.is_published);
        if (body.published_deck_id !== undefined) deck.publishedDeckId = body.published_deck_id;
        if (body.was_imported !== undefined) deck.wasImported = Boolean(body.was_imported);
        if (body.show_back_first !== undefined) deck.showBackFirst = Boolean(body.show_back_first);
        if (body.front_fields !== undefined) deck.frontFields = body.front_fields;
        if (body.back_fields !== undefined) deck.backFields = body.back_fields;
        if (body.image_display_mode !== undefined) deck.imageDisplayMode = body.image_display_mode;
        if (body.image_path !== undefined) deck.imagePath = body.image_path;
        if (body.auto_play_tts_on_flip !== undefined) deck.autoPlayTtsOnFlip = Boolean(body.auto_play_tts_on_flip);
        if (body.category !== undefined) deck.category = body.category;
        if (body.tags !== undefined) {
            deck.tags = Array.isArray(body.tags) ? body.tags : (body.tags ? body.tags.split(',') : []);
        }

        await deck.save();
        return ok(res, serializePrivateDeck(deck), 'Deck updated');
    } catch (error) {
        console.error('Update private deck error:', error);
        return res.status(500).json({ success: false, message: 'Cannot update deck' });
    }
});

router.delete('/my-decks/:deckId', authMiddleware, async (req, res) => {
    try {
        const uId = userId(req);
        const deck = await VocabPrivateDeck.findOne({ deckId: req.params.deckId, userId: uId });
        if (!deck) {
            return res.status(404).json({ success: false, message: 'Deck not found' });
        }

        await VocabPrivateFlashcard.deleteMany({ deckId: req.params.deckId, userId: uId });
        await VocabPrivateDeck.deleteOne({ _id: deck._id });

        return ok(res, null, 'Deck deleted');
    } catch (error) {
        console.error('Delete private deck error:', error);
        return res.status(500).json({ success: false, message: 'Cannot delete deck' });
    }
});

router.get('/my-decks/:deckId/cards', authMiddleware, async (req, res) => {
    try {
        const uId = userId(req);
        const deck = await VocabPrivateDeck.findOne({ deckId: req.params.deckId, userId: uId });
        if (!deck) {
            return res.status(404).json({ success: false, message: 'Deck not found' });
        }

        const cards = await VocabPrivateFlashcard.find({ deckId: req.params.deckId, userId: uId }).sort({ createdAt: 1 });
        return ok(res, cards.map(serializePrivateFlashcard));
    } catch (error) {
        console.error('Get private cards error:', error);
        return res.status(500).json({ success: false, message: 'Cannot load cards' });
    }
});

router.get('/my-decks/:deckId/due-cards', authMiddleware, async (req, res) => {
    try {
        const uId = userId(req);
        const deck = await VocabPrivateDeck.findOne({ deckId: req.params.deckId, userId: uId });
        if (!deck) {
            return res.status(404).json({ success: false, message: 'Deck not found' });
        }

        const now = new Date();
        const cards = await VocabPrivateFlashcard.find({
            deckId: req.params.deckId,
            userId: uId,
            $or: [
                { repetitions: 0 },
                { repetitions: { $gt: 0, $lt: 3 } },
                { 
                    repetitions: { $gte: 3 },
                    $or: [
                        { nextReviewDate: null },
                        { nextReviewDate: { $lte: now } }
                    ]
                }
            ]
        });

        return ok(res, cards.map(serializePrivateFlashcard));
    } catch (error) {
        console.error('Get private due cards error:', error);
        return res.status(500).json({ success: false, message: 'Cannot load due cards' });
    }
});

router.post('/my-decks/:deckId/cards', authMiddleware, async (req, res) => {
    try {
        const uId = userId(req);
        const deck = await VocabPrivateDeck.findOne({ deckId: req.params.deckId, userId: uId });
        if (!deck) {
            return res.status(404).json({ success: false, message: 'Deck not found' });
        }

        const body = req.body || {};
        const cardId = String(body.id || new mongoose.Types.ObjectId().toString());

        const existing = await VocabPrivateFlashcard.findOne({ cardId, userId: uId });
        if (existing) {
            return res.status(409).json({ success: false, message: 'Card ID already exists for this user' });
        }

        const card = await VocabPrivateFlashcard.create({
            cardId,
            deckId: req.params.deckId,
            userId: uId,
            front: body.front,
            frontPhonetic: body.front_phonetic || null,
            back: body.back,
            example: body.example || null,
            notes: body.notes || null,
            imageUrl: body.image_url || null,
            frontImageUrl: body.front_image_url || null,
            backImageUrl: body.back_image_url || null,
            shareImage: body.share_image !== false,
            tags: Array.isArray(body.tags) ? body.tags : (body.tags ? body.tags.split(',') : []),
            easinessFactor: body.easiness_factor !== undefined ? Number(body.easiness_factor) : 2.5,
            interval: body.interval !== undefined ? Number(body.interval) : 0,
            repetitions: body.repetitions !== undefined ? Number(body.repetitions) : 0,
            nextReviewDate: body.next_review_date ? new Date(body.next_review_date) : null,
            lastReviewDate: body.last_review_date ? new Date(body.last_review_date) : null,
        });

        return ok(res, serializePrivateFlashcard(card), 'Card created');
    } catch (error) {
        console.error('Create private card error:', error);
        return res.status(500).json({ success: false, message: 'Cannot create card' });
    }
});

router.post('/my-decks/:deckId/cards/batch', authMiddleware, async (req, res) => {
    try {
        const uId = userId(req);
        const deck = await VocabPrivateDeck.findOne({ deckId: req.params.deckId, userId: uId });
        if (!deck) {
            return res.status(404).json({ success: false, message: 'Deck not found' });
        }

        const cardsData = req.body || [];
        if (!Array.isArray(cardsData)) {
            return res.status(400).json({ success: false, message: 'Body must be an array of flashcards' });
        }

        const preparedCards = cardsData.map(c => {
            const cardId = String(c.id || new mongoose.Types.ObjectId().toString());
            return {
                cardId,
                deckId: req.params.deckId,
                userId: uId,
                front: c.front,
                frontPhonetic: c.front_phonetic || null,
                back: c.back,
                example: c.example || null,
                notes: c.notes || null,
                imageUrl: c.image_url || null,
                frontImageUrl: c.front_image_url || null,
                backImageUrl: c.back_image_url || null,
                shareImage: c.share_image !== false,
                tags: Array.isArray(c.tags) ? c.tags : (c.tags ? c.tags.split(',') : []),
                easinessFactor: c.easiness_factor !== undefined ? Number(c.easiness_factor) : 2.5,
                interval: c.interval !== undefined ? Number(c.interval) : 0,
                repetitions: c.repetitions !== undefined ? Number(c.repetitions) : 0,
                nextReviewDate: c.next_review_date ? new Date(c.next_review_date) : null,
                lastReviewDate: c.last_review_date ? new Date(c.last_review_date) : null,
            };
        });

        const ops = preparedCards.map(c => ({
            updateOne: {
                filter: { cardId: c.cardId, userId: uId },
                update: { $set: c },
                upsert: true
            }
        }));

        await VocabPrivateFlashcard.bulkWrite(ops);

        const updatedCards = await VocabPrivateFlashcard.find({
            cardId: { $in: preparedCards.map(c => c.cardId) },
            userId: uId
        });

        return ok(res, updatedCards.map(serializePrivateFlashcard), 'Batch cards synchronized');
    } catch (error) {
        console.error('Batch sync private cards error:', error);
        return res.status(500).json({ success: false, message: 'Cannot sync flashcards' });
    }
});

router.put('/my-decks/:deckId/cards/:cardId', authMiddleware, async (req, res) => {
    try {
        const uId = userId(req);
        const card = await VocabPrivateFlashcard.findOne({ cardId: req.params.cardId, userId: uId });
        if (!card) {
            return res.status(404).json({ success: false, message: 'Card not found' });
        }

        const body = req.body || {};
        if (body.front !== undefined) card.front = body.front;
        if (body.front_phonetic !== undefined) card.frontPhonetic = body.front_phonetic;
        if (body.back !== undefined) card.back = body.back;
        if (body.example !== undefined) card.example = body.example;
        if (body.notes !== undefined) card.notes = body.notes;
        if (body.image_url !== undefined) card.imageUrl = body.image_url;
        if (body.front_image_url !== undefined) card.frontImageUrl = body.front_image_url;
        if (body.back_image_url !== undefined) card.backImageUrl = body.back_image_url;
        if (body.share_image !== undefined) card.shareImage = Boolean(body.share_image);
        if (body.tags !== undefined) {
            card.tags = Array.isArray(body.tags) ? body.tags : (body.tags ? body.tags.split(',') : []);
        }
        
        if (body.easiness_factor !== undefined) card.easinessFactor = Number(body.easiness_factor);
        if (body.interval !== undefined) card.interval = Number(body.interval);
        if (body.repetitions !== undefined) card.repetitions = Number(body.repetitions);
        if (body.next_review_date !== undefined) card.nextReviewDate = body.next_review_date ? new Date(body.next_review_date) : null;
        if (body.last_review_date !== undefined) card.lastReviewDate = body.last_review_date ? new Date(body.last_review_date) : null;

        await card.save();
        return ok(res, serializePrivateFlashcard(card), 'Card updated');
    } catch (error) {
        console.error('Update private card error:', error);
        return res.status(500).json({ success: false, message: 'Cannot update card' });
    }
});

// ==========================================
// CHINESE DICTIONARY
// ==========================================

router.get('/dictionary/chinese/search', async (req, res) => {
    try {
        const query = req.query.query;
        const limit = parseInt(req.query.limit) || 20;

        if (!query) {
            return res.status(400).json({ success: false, message: 'Missing query parameter' });
        }

        // Exact match first
        let results = await VocabChineseDictionary.find({ word: query }).limit(limit).lean();

        if (results.length === 0) {
            // Prefix match
            results = await VocabChineseDictionary.find({ word: { $regex: '^' + query } }).limit(limit).lean();
        }

        if (results.length === 0) {
            // Contains match
            results = await VocabChineseDictionary.find({ word: { $regex: query } }).limit(limit).lean();
        }

        return ok(res, results);
    } catch (error) {
        console.error('Dictionary search error:', error);
        return res.status(500).json({ success: false, message: 'Dictionary search failed' });
    }
});

router.get('/dictionary/chinese/lookup', async (req, res) => {
    try {
        const word = req.query.word;

        if (!word) {
            return res.status(400).json({ success: false, message: 'Missing word parameter' });
        }

        const result = await VocabChineseDictionary.findOne({ word: word }).lean();
        return ok(res, result);
    } catch (error) {
        console.error('Dictionary lookup error:', error);
        return res.status(500).json({ success: false, message: 'Dictionary lookup failed' });
    }
});

router.get('/dictionary/chinese/pinyin', async (req, res) => {
    try {
        const pinyin = req.query.pinyin;
        const limit = parseInt(req.query.limit) || 20;

        if (!pinyin) {
            return res.status(400).json({ success: false, message: 'Missing pinyin parameter' });
        }

        const results = await VocabChineseDictionary.find({ pinyin: { $regex: pinyin, $options: 'i' } }).limit(limit).lean();
        return ok(res, results);
    } catch (error) {
        console.error('Dictionary pinyin error:', error);
        return res.status(500).json({ success: false, message: 'Dictionary pinyin search failed' });
    }
});

router.delete('/my-decks/:deckId/cards/:cardId', authMiddleware, async (req, res) => {
    try {
        const uId = userId(req);
        const card = await VocabPrivateFlashcard.findOne({ cardId: req.params.cardId, userId: uId });
        if (!card) {
            return res.status(404).json({ success: false, message: 'Card not found' });
        }

        await VocabPrivateFlashcard.deleteOne({ _id: card._id });
        return ok(res, null, 'Card deleted');
    } catch (error) {
        console.error('Delete private card error:', error);
        return res.status(500).json({ success: false, message: 'Cannot delete card' });
    }
});

export default router;
