import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    course: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    comment: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000
    },
    // Admin can reply to reviews
    reply: {
        content: { type: String, default: '' },
        repliedAt: { type: Date, default: null },
        repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    },
    isVerifiedPurchase: {
        type: Boolean,
        default: false
    },
    helpful: {
        count: { type: Number, default: 0 },
        users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'approved' // Auto-approve by default
    }
}, {
    timestamps: true
});

// Compound index for unique review per user per course
reviewSchema.index({ user: 1, course: 1 }, { unique: true });

// Index for course reviews
reviewSchema.index({ course: 1, createdAt: -1 });

// Index for user reviews
reviewSchema.index({ user: 1, createdAt: -1 });

// Static method to calculate average rating for a course
reviewSchema.statics.calculateAverageRating = async function(courseId) {
    const result = await this.aggregate([
        { $match: { course: courseId, status: 'approved' } },
        {
            $group: {
                _id: '$course',
                avgRating: { $avg: '$rating' },
                count: { $sum: 1 }
            }
        }
    ]);

    if (result.length > 0) {
        return {
            rating: Math.round(result[0].avgRating * 10) / 10,
            count: result[0].count
        };
    }
    return { rating: 0, count: 0 };
};

// Post-save hook to update course rating
reviewSchema.post('save', async function() {
    const Review = this.constructor;
    const Course = mongoose.model('Course');

    const { rating, count } = await Review.calculateAverageRating(this.course);

    await Course.findByIdAndUpdate(this.course, {
        rating,
        reviewCount: count
    });
});

// Post-remove hook to update course rating
reviewSchema.post('findOneAndDelete', async function(doc) {
    if (doc) {
        const Review = mongoose.model('Review');
        const Course = mongoose.model('Course');

        const { rating, count } = await Review.calculateAverageRating(doc.course);

        await Course.findByIdAndUpdate(doc.course, {
            rating,
            reviewCount: count
        });
    }
});

const Review = mongoose.model('Review', reviewSchema);

export default Review;
