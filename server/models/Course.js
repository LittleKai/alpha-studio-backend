import mongoose from 'mongoose';

const lessonSchema = new mongoose.Schema({
    lessonId: {
        type: String,
        required: true
    },
    title: {
        vi: { type: String, required: true },
        en: { type: String, required: true }
    },
    duration: {
        type: Number,
        default: 0 // minutes
    },
    type: {
        type: String,
        enum: ['video', 'text', 'quiz', 'assignment'],
        default: 'video'
    },
    content: {
        type: String,
        default: ''
    },
    order: {
        type: Number,
        default: 0
    }
}, { _id: false });

const moduleSchema = new mongoose.Schema({
    moduleId: {
        type: String,
        required: true
    },
    title: {
        vi: { type: String, required: true },
        en: { type: String, required: true }
    },
    lessons: [lessonSchema]
}, { _id: false });

const courseSchema = new mongoose.Schema({
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
    category: {
        type: String,
        enum: ['ai-basic', 'ai-advanced', 'ai-studio', 'ai-creative'],
        required: [true, 'Category is required']
    },
    thumbnail: {
        type: String,
        default: ''
    },
    duration: {
        type: Number,
        default: 0 // hours
    },
    level: {
        type: String,
        enum: ['beginner', 'intermediate', 'advanced'],
        default: 'beginner'
    },
    price: {
        type: Number,
        default: 0 // VND
    },
    discount: {
        type: Number,
        default: 0, // percentage 0-100
        min: 0,
        max: 100
    },
    status: {
        type: String,
        enum: ['draft', 'published', 'archived'],
        default: 'draft'
    },
    instructor: {
        name: {
            type: String,
            default: ''
        },
        avatar: {
            type: String,
            default: ''
        },
        bio: {
            type: String,
            default: ''
        }
    },
    modules: [moduleSchema],
    enrolledCount: {
        type: Number,
        default: 0
    },
    rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },
    reviewCount: {
        type: Number,
        default: 0
    },
    tags: [{
        type: String,
        trim: true
    }],
    prerequisites: [{
        type: String,
        trim: true
    }],
    learningOutcomes: [{
        vi: { type: String },
        en: { type: String }
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    publishedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Virtual for final price after discount
courseSchema.virtual('finalPrice').get(function() {
    if (this.discount > 0) {
        return Math.round(this.price * (1 - this.discount / 100));
    }
    return this.price;
});

// Virtual for total lessons count
courseSchema.virtual('totalLessons').get(function() {
    let count = 0;
    if (this.modules && this.modules.length > 0) {
        this.modules.forEach(module => {
            if (module.lessons) {
                count += module.lessons.length;
            }
        });
    }
    return count;
});

// Ensure virtuals are included in JSON output
courseSchema.set('toJSON', { virtuals: true });
courseSchema.set('toObject', { virtuals: true });

// Text index for search
courseSchema.index({
    'title.vi': 'text',
    'title.en': 'text',
    'description.vi': 'text',
    'description.en': 'text',
    'tags': 'text'
});

// Index for common queries
courseSchema.index({ status: 1, category: 1 });
courseSchema.index({ createdAt: -1 });
courseSchema.index({ enrolledCount: -1 });
courseSchema.index({ rating: -1 });

const Course = mongoose.model('Course', courseSchema);

export default Course;
