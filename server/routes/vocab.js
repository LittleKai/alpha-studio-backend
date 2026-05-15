import express from 'express';
import mongoose from 'mongoose';
import { authMiddleware } from '../middleware/auth.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import {
    VocabDeckRating,
    VocabFeedback,
    VocabImportLink,
    VocabProfile,
    VocabPublicDeck,
    VocabPublicFlashcard,
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

export default router;
