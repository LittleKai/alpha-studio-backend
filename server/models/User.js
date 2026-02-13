import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [6, 'Password must be at least 6 characters']
    },
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true
    },
    role: {
        type: String,
        enum: ['student', 'partner', 'admin'],
        default: 'student'
    },
    avatar: {
        type: String,
        default: null
    },
    backgroundImage: {
        type: String,
        default: null
    },
    // Extended profile fields
    bio: {
        type: String,
        default: '',
        maxlength: [500, 'Bio cannot exceed 500 characters']
    },
    skills: [{
        type: String,
        trim: true
    }],
    phone: {
        type: String,
        default: ''
    },
    location: {
        type: String,
        default: ''
    },
    birthDate: {
        type: Date,
        default: null
    },
    showBirthDate: {
        type: Boolean,
        default: false
    },
    socials: {
        facebook: { type: String, default: '' },
        linkedin: { type: String, default: '' },
        github: { type: String, default: '' },
        custom: [{
            label: { type: String, required: true },
            url: { type: String, required: true }
        }]
    },
    featuredWorks: [{
        image: { type: String, required: true },
        title: { type: String, required: true },
        description: { type: String, default: '' }
    }],
    attachments: [{
        url: { type: String, required: true },
        filename: { type: String, required: true },
        type: { type: String, default: 'file' },
        size: { type: Number, default: 0 }
    }],
    subscription: {
        plan: {
            type: String,
            enum: ['free', 'basic', 'pro', 'enterprise'],
            default: 'free'
        },
        apiQuota: {
            type: Number,
            default: 100
        },
        expiresAt: {
            type: Date,
            default: null
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: {
        type: Date,
        default: null
    },
    balance: {
        type: Number,
        default: 0,
        min: [0, 'Balance cannot be negative']
    },
    passwordResetCode: {
        type: String,
        default: null
    },
    passwordResetExpires: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function() {
    if (!this.isModified('password')) return;

    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function() {
    const user = this.toObject();
    delete user.password;
    return user;
};

const User = mongoose.model('User', userSchema);

export default User;
