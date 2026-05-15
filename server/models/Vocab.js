import mongoose from 'mongoose';

const vocabPublicDeckSchema = new mongoose.Schema({
    deckId: { type: String, required: true, unique: true, index: true },
    originalLocalId: { type: String, default: null },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    authorName: { type: String, default: 'Anonymous' },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    sourceLanguage: { type: String, default: 'en', index: true },
    targetLanguage: { type: String, default: 'vi', index: true },
    categoryId: { type: String, default: 'other', index: true },
    tags: [{ type: String, trim: true }],
    cardCount: { type: Number, default: 0 },
    version: { type: Number, default: 1 },
    ratingSum: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    downloadCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    shortId: { type: String, default: null },
    imageUrl: { type: String, default: null },
    frontFields: { type: String, default: null },
    backFields: { type: String, default: null },
    imageDisplayMode: { type: String, default: null },
    showBackFirst: { type: Boolean, default: false },
    publishedAt: { type: Date, default: Date.now },
}, { timestamps: true });

vocabPublicDeckSchema.index({
    name: 'text',
    description: 'text',
    tags: 'text',
});

const vocabPublicFlashcardSchema = new mongoose.Schema({
    publicDeckId: { type: String, required: true, index: true },
    front: { type: String, required: true },
    frontPhonetic: { type: String, default: null },
    back: { type: String, required: true },
    example: { type: String, default: null },
    notes: { type: String, default: null },
    tags: [{ type: String, trim: true }],
    order: { type: Number, default: 0 },
    frontImageUrl: { type: String, default: null },
    backImageUrl: { type: String, default: null },
    shareImage: { type: Boolean, default: true },
}, { timestamps: true });

const vocabRatingSchema = new mongoose.Schema({
    publicDeckId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userName: { type: String, default: null },
    rating: { type: Number, min: 1, max: 5, required: true },
    review: { type: String, default: null },
}, { timestamps: true });
vocabRatingSchema.index({ publicDeckId: 1, userId: 1 }, { unique: true });

const vocabImportLinkSchema = new mongoose.Schema({
    publicDeckId: { type: String, required: true, index: true },
    localDeckId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    importedVersion: { type: Number, required: true },
    importedAt: { type: Date, default: Date.now },
    lastSyncedAt: { type: Date, default: null },
    autoSync: { type: Boolean, default: true },
}, { timestamps: true });
vocabImportLinkSchema.index({ userId: 1, localDeckId: 1 }, { unique: true });
vocabImportLinkSchema.index({ userId: 1, publicDeckId: 1 });

const vocabProfileSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    nickname: { type: String, default: null, index: true },
    gender: { type: String, default: 'preferNotToSay' },
    avatarIndex: { type: Number, default: 0 },
    avatarUrl: { type: String, default: null },
    bio: { type: String, default: null },
}, { timestamps: true });

const vocabFeedbackSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    category: { type: String, required: true },
    message: { type: String, required: true },
    email: { type: String, default: null },
    appVersion: { type: String, default: null },
    platform: { type: String, default: null },
}, { timestamps: true });

export const VocabPublicDeck = mongoose.model('VocabPublicDeck', vocabPublicDeckSchema);
export const VocabPublicFlashcard = mongoose.model('VocabPublicFlashcard', vocabPublicFlashcardSchema);
export const VocabDeckRating = mongoose.model('VocabDeckRating', vocabRatingSchema);
export const VocabImportLink = mongoose.model('VocabImportLink', vocabImportLinkSchema);
export const VocabProfile = mongoose.model('VocabProfile', vocabProfileSchema);
export const VocabFeedback = mongoose.model('VocabFeedback', vocabFeedbackSchema);
