import mongoose from 'mongoose';

// Helper function to generate slug
function generateSlug(title) {
    const baseSlug = (title.en || title.vi || 'prompt')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return `${baseSlug}-${Date.now().toString(36)}`;
}

const promptSchema = new mongoose.Schema({
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
    // Support multiple prompts (prompt 1, 2, 3...)
    promptContents: [{
        label: {
            type: String,
            default: ''
        },
        content: {
            type: String,
            required: true,
            maxlength: [10000, 'Prompt content cannot exceed 10000 characters']
        }
    }],
    // Legacy single prompt field for backward compatibility
    promptContent: {
        type: String,
        maxlength: [10000, 'Prompt content cannot exceed 10000 characters']
    },
    // Notes field for additional information
    notes: {
        type: String,
        maxlength: [5000, 'Notes cannot exceed 5000 characters'],
        default: ''
    },
    category: {
        type: String,
        enum: ['image-generation', 'text-generation', 'code', 'workflow', 'other'],
        default: 'other'
    },
    platform: {
        type: String,
        enum: ['midjourney', 'stable-diffusion', 'dalle', 'comfyui', 'chatgpt', 'claude', 'other'],
        default: 'other'
    },
    exampleImages: [{
        type: {
            type: String,
            enum: ['input', 'output'],
            required: true
        },
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
promptSchema.pre('save', function(next) {
    if (this.isNew && !this.slug) {
        this.slug = generateSlug(this.title);
    }
    next();
});

// Method to recalculate rating average
promptSchema.methods.recalculateRating = function() {
    if (this.ratings.length === 0) {
        this.rating.average = 0;
        this.rating.count = 0;
    } else {
        const sum = this.ratings.reduce((acc, r) => acc + r.score, 0);
        this.rating.average = Math.round((sum / this.ratings.length) * 10) / 10;
        this.rating.count = this.ratings.length;
    }
};

// Text index for search
promptSchema.index({
    'title.vi': 'text',
    'title.en': 'text',
    'description.vi': 'text',
    'description.en': 'text',
    'promptContent': 'text',
    'tags': 'text'
});

// Indexes for common queries
promptSchema.index({ status: 1, category: 1 });
promptSchema.index({ status: 1, platform: 1 });
promptSchema.index({ author: 1 });
promptSchema.index({ createdAt: -1 });
promptSchema.index({ likesCount: -1 });
promptSchema.index({ downloadsCount: -1 });
promptSchema.index({ 'rating.average': -1 });
promptSchema.index({ isFeatured: 1, status: 1 });
promptSchema.index({ tags: 1 });

// Ensure virtuals are included in JSON output
promptSchema.set('toJSON', { virtuals: true });
promptSchema.set('toObject', { virtuals: true });

const Prompt = mongoose.model('Prompt', promptSchema);

export default Prompt;
