import mongoose from 'mongoose';

const lessonProgressSchema = new mongoose.Schema({
    lessonId: { type: String, required: true },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    watchedDuration: { type: Number, default: 0 }, // in seconds
    lastPosition: { type: Number, default: 0 } // video position in seconds
}, { _id: false });

const enrollmentSchema = new mongoose.Schema({
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
    enrolledAt: {
        type: Date,
        default: Date.now
    },
    progress: {
        type: Number,
        default: 0, // percentage 0-100
        min: 0,
        max: 100
    },
    completedLessons: [lessonProgressSchema],
    currentLesson: {
        moduleId: { type: String, default: '' },
        lessonId: { type: String, default: '' }
    },
    status: {
        type: String,
        enum: ['active', 'completed', 'expired'],
        default: 'active'
    },
    completedAt: {
        type: Date,
        default: null
    },
    lastAccessedAt: {
        type: Date,
        default: Date.now
    },
    // For paid courses
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'free'],
        default: 'free'
    },
    paymentId: {
        type: String,
        default: ''
    },
    paidAmount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Compound index for unique enrollment per user per course
enrollmentSchema.index({ user: 1, course: 1 }, { unique: true });

// Index for user's enrollments
enrollmentSchema.index({ user: 1, enrolledAt: -1 });

// Index for course enrollments
enrollmentSchema.index({ course: 1 });

// Method to calculate progress
enrollmentSchema.methods.calculateProgress = function(totalLessons) {
    if (totalLessons === 0) return 0;
    const completedCount = this.completedLessons.filter(l => l.completed).length;
    return Math.round((completedCount / totalLessons) * 100);
};

// Method to mark lesson as completed
enrollmentSchema.methods.markLessonCompleted = function(lessonId) {
    const existingLesson = this.completedLessons.find(l => l.lessonId === lessonId);
    if (existingLesson) {
        existingLesson.completed = true;
        existingLesson.completedAt = new Date();
    } else {
        this.completedLessons.push({
            lessonId,
            completed: true,
            completedAt: new Date()
        });
    }
};

// Method to update video progress
enrollmentSchema.methods.updateVideoProgress = function(lessonId, watchedDuration, lastPosition) {
    const existingLesson = this.completedLessons.find(l => l.lessonId === lessonId);
    if (existingLesson) {
        existingLesson.watchedDuration = Math.max(existingLesson.watchedDuration, watchedDuration);
        existingLesson.lastPosition = lastPosition;
    } else {
        this.completedLessons.push({
            lessonId,
            completed: false,
            watchedDuration,
            lastPosition
        });
    }
};

const Enrollment = mongoose.model('Enrollment', enrollmentSchema);

export default Enrollment;
