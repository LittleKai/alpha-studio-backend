import mongoose from 'mongoose';

const jobSchema = new mongoose.Schema({
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
    requirements: {
        vi: {
            type: String,
            default: ''
        },
        en: {
            type: String,
            default: ''
        }
    },
    benefits: {
        vi: {
            type: String,
            default: ''
        },
        en: {
            type: String,
            default: ''
        }
    },
    company: {
        name: {
            type: String,
            default: 'Alpha Studio'
        },
        logo: {
            type: String,
            default: ''
        }
    },
    location: {
        type: String,
        default: ''
    },
    jobType: {
        type: String,
        enum: ['full-time', 'part-time', 'contract', 'internship', 'remote'],
        default: 'full-time'
    },
    experienceLevel: {
        type: String,
        enum: ['fresher', 'junior', 'mid', 'senior', 'lead', 'manager'],
        default: 'junior'
    },
    salary: {
        min: {
            type: Number,
            default: 0
        },
        max: {
            type: Number,
            default: 0
        },
        currency: {
            type: String,
            default: 'VND'
        },
        negotiable: {
            type: Boolean,
            default: true
        }
    },
    category: {
        type: String,
        enum: ['engineering', 'design', 'marketing', 'operations', 'hr', 'finance', 'other'],
        default: 'engineering'
    },
    skills: [{
        type: String,
        trim: true
    }],
    status: {
        type: String,
        enum: ['draft', 'published', 'closed'],
        default: 'draft'
    },
    featured: {
        type: Boolean,
        default: false
    },
    applicationDeadline: {
        type: Date,
        default: null
    },
    applicationCount: {
        type: Number,
        default: 0
    },
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

// Virtual for salary display
jobSchema.virtual('salaryDisplay').get(function() {
    if (this.salary.negotiable && this.salary.min === 0 && this.salary.max === 0) {
        return 'Negotiable';
    }
    if (this.salary.min === this.salary.max) {
        return `${this.salary.min.toLocaleString()} ${this.salary.currency}`;
    }
    return `${this.salary.min.toLocaleString()} - ${this.salary.max.toLocaleString()} ${this.salary.currency}`;
});

// Ensure virtuals are included in JSON output
jobSchema.set('toJSON', { virtuals: true });
jobSchema.set('toObject', { virtuals: true });

// Text index for search
jobSchema.index({
    'title.vi': 'text',
    'title.en': 'text',
    'description.vi': 'text',
    'description.en': 'text',
    'skills': 'text'
});

// Index for common queries
jobSchema.index({ status: 1, category: 1 });
jobSchema.index({ createdAt: -1 });
jobSchema.index({ jobType: 1 });
jobSchema.index({ experienceLevel: 1 });

const Job = mongoose.model('Job', jobSchema);

export default Job;
