import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema({
    targetType: {
        type: String,
        enum: ['prompt', 'resource'],
        required: [true, 'Target type is required']
    },
    targetId: {
        type: mongoose.Schema.Types.ObjectId,
        required: [true, 'Target ID is required'],
        refPath: 'targetType'
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Author is required']
    },
    content: {
        type: String,
        required: [true, 'Comment content is required'],
        maxlength: [2000, 'Comment cannot exceed 2000 characters'],
        trim: true
    },
    parentComment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Comment',
        default: null
    },
    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    likesCount: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['visible', 'hidden', 'flagged'],
        default: 'visible'
    },
    isEdited: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Indexes for common queries
commentSchema.index({ targetType: 1, targetId: 1, status: 1 });
commentSchema.index({ author: 1 });
commentSchema.index({ parentComment: 1 });
commentSchema.index({ createdAt: -1 });

// Virtual for replies count
commentSchema.virtual('repliesCount', {
    ref: 'Comment',
    localField: '_id',
    foreignField: 'parentComment',
    count: true
});

// Ensure virtuals are included in JSON output
commentSchema.set('toJSON', { virtuals: true });
commentSchema.set('toObject', { virtuals: true });

const Comment = mongoose.model('Comment', commentSchema);

export default Comment;
