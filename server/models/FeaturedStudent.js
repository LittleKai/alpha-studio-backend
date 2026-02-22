import mongoose from 'mongoose';

const featuredStudentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    order: {
        type: Number,
        default: 0
    },
    label: {
        type: String,
        default: '',
        trim: true
    },
    hired: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

featuredStudentSchema.index({ order: 1 });

const FeaturedStudent = mongoose.model('FeaturedStudent', featuredStudentSchema);
export default FeaturedStudent;
