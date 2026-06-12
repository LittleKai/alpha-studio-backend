import mongoose from 'mongoose';
import { RETENTION_MS } from '../retention/policy.js';

const chatMessageSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    role: {
        type: String,
        enum: ['user', 'assistant'],
        required: true
    },
    content: {
        type: String,
        required: true,
        maxlength: 16000
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

chatMessageSchema.index({ userId: 1, createdAt: -1 });
chatMessageSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: RETENTION_MS.chatHistory / 1000 }
);

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

export default ChatMessage;
