import mongoose from 'mongoose';

const partnerSchema = new mongoose.Schema({
    companyName: {
        type: String,
        required: [true, 'Company name is required'],
        trim: true
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
    logo: {
        type: String,
        default: ''
    },
    website: {
        type: String,
        default: ''
    },
    email: {
        type: String,
        default: ''
    },
    phone: {
        type: String,
        default: ''
    },
    address: {
        type: String,
        default: ''
    },
    partnerType: {
        type: String,
        enum: ['technology', 'education', 'enterprise', 'startup', 'government', 'other'],
        default: 'technology'
    },
    status: {
        type: String,
        enum: ['draft', 'published', 'archived'],
        default: 'draft'
    },
    featured: {
        type: Boolean,
        default: false
    },
    order: {
        type: Number,
        default: 0
    },
    socialLinks: {
        facebook: { type: String, default: '' },
        linkedin: { type: String, default: '' },
        twitter: { type: String, default: '' }
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

// Text index for search
partnerSchema.index({
    'companyName': 'text',
    'description.vi': 'text',
    'description.en': 'text'
});

// Index for common queries
partnerSchema.index({ status: 1, partnerType: 1 });
partnerSchema.index({ createdAt: -1 });
partnerSchema.index({ order: 1 });

const Partner = mongoose.model('Partner', partnerSchema);

export default Partner;
