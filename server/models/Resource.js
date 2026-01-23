import mongoose from 'mongoose';

// Helper function to generate slug
function generateSlug(title) {
    const baseSlug = (title.en || title.vi || 'resource')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return `${baseSlug}-${Date.now().toString(36)}`;
}

// Max file size: 50MB in bytes
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const resourceSchema = new mongoose.Schema({
    slug: {
        type: String,
        unique: true,
        index: true
    },
    title: {
        vi: {
            type: String,
            required: [true, 'Vietnamese title is required'],
            trim: true
        },
        en: {
            type: String,
            required: [true, 'English title is required'],
            trim: true
        }
    },
    description: {
        vi: {
            type: String,
            default: ''
        },
        en: {
            type: String,
            default: ''
        }
    },
    resourceType: {
        type: String,
        enum: ['template', 'dataset', 'design-asset', 'project-file', '3d-model', 'font', 'other'],
        default: 'other'
    },
    file: {
        url: {
            type: String,
            required: [true, 'File URL is required']
        },
        publicId: String,
        filename: {
            type: String,
            required: [true, 'Filename is required']
        },
        format: String,
        size: {
            type: Number,
            required: [true, 'File size is required'],
            max: [MAX_FILE_SIZE, 'File size cannot exceed 50MB']
        },
        mimeType: String
    },
    thumbnail: {
        url: String,
        publicId: String
    },
    previewImages: [{
        url: {
            type: String,
            required: true
        },
        publicId: String,
        caption: String
    }],
    tags: [{
        type: String,
        trim: true,
        lowercase: true
    }],
    compatibleSoftware: [{
        type: String,
        trim: true
    }],
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Author is required']
    },
    // Engagement metrics
    likesCount: {
        type: Number,
        default: 0
    },
    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    bookmarksCount: {
        type: Number,
        default: 0
    },
    bookmarks: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    downloadsCount: {
        type: Number,
        default: 0
    },
    viewsCount: {
        type: Number,
        default: 0
    },
    commentsCount: {
        type: Number,
        default: 0
    },
    // Rating system
    rating: {
        average: {
            type: Number,
            default: 0,
            min: 0,
            max: 5
        },
        count: {
            type: Number,
            default: 0
        }
    },
    ratings: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        score: {
            type: Number,
            required: true,
            min: 1,
            max: 5
        },
        ratedAt: {
            type: Date,
            default: Date.now
        }
    }],
    // Status & moderation
    status: {
        type: String,
        enum: ['published', 'hidden', 'archived'],
        default: 'published'  // Auto-publish
    },
    isFeatured: {
        type: Boolean,
        default: false
    },
    moderatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    moderatedAt: Date,
    moderationReason: String,
    publishedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Pre-save hook to generate slug
resourceSchema.pre('save', function(next) {
    if (this.isNew && !this.slug) {
        this.slug = generateSlug(this.title);
    }
    next();
});

// Method to recalculate rating average
resourceSchema.methods.recalculateRating = function() {
    if (this.ratings.length === 0) {
        this.rating.average = 0;
        this.rating.count = 0;
    } else {
        const sum = this.ratings.reduce((acc, r) => acc + r.score, 0);
        this.rating.average = Math.round((sum / this.ratings.length) * 10) / 10;
        this.rating.count = this.ratings.length;
    }
};

// Virtual for formatted file size
resourceSchema.virtual('fileSizeFormatted').get(function() {
    const size = this.file?.size || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
});

// Text index for search
resourceSchema.index({
    'title.vi': 'text',
    'title.en': 'text',
    'description.vi': 'text',
    'description.en': 'text',
    'tags': 'text',
    'compatibleSoftware': 'text'
});

// Indexes for common queries
resourceSchema.index({ status: 1, resourceType: 1 });
resourceSchema.index({ author: 1 });
resourceSchema.index({ createdAt: -1 });
resourceSchema.index({ likesCount: -1 });
resourceSchema.index({ downloadsCount: -1 });
resourceSchema.index({ 'rating.average': -1 });
resourceSchema.index({ isFeatured: 1, status: 1 });
resourceSchema.index({ tags: 1 });
resourceSchema.index({ compatibleSoftware: 1 });

// Ensure virtuals are included in JSON output
resourceSchema.set('toJSON', { virtuals: true });
resourceSchema.set('toObject', { virtuals: true });

// Static constant for max file size
resourceSchema.statics.MAX_FILE_SIZE = MAX_FILE_SIZE;

const Resource = mongoose.model('Resource', resourceSchema);

export default Resource;
