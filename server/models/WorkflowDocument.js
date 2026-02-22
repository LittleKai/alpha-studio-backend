import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema({
    id: String,
    author: String,
    text: String,
    timestamp: String
}, { _id: false });

const workflowDocumentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, default: 'FILE' },
    size: { type: String, default: '0 B' },
    uploadDate: { type: String, default: '' },
    uploader: { type: String, default: '' },
    status: { type: String, default: 'pending' },
    url: { type: String, default: '' },
    fileKey: { type: String, default: '' },
    isProject: { type: Boolean, default: false },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowProject', default: null },
    comments: { type: [commentSchema], default: [] },
    note: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, {
    timestamps: true,
    toJSON: { virtuals: true }
});

export default mongoose.model('WorkflowDocument', workflowDocumentSchema);
