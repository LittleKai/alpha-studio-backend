import mongoose from 'mongoose';

const expenseEntrySchema = new mongoose.Schema({
    id: String,
    name: String,
    amount: Number,
    date: String
}, { _id: false });

const taskSchema = new mongoose.Schema({
    id: String,
    title: String,
    assigneeId: String,
    assigneeName: String,
    status: { type: String, default: 'todo' },
    dueDate: String,
    fileId: String
}, { _id: false });

const teamMemberSchema = new mongoose.Schema({
    id: String,
    name: String,
    role: String,
    avatar: String,
    isExternal: { type: Boolean, default: false },
    projectRole: { type: String, default: '' }
}, { _id: false });

const commentSchema = new mongoose.Schema({
    id: String,
    author: String,
    text: String,
    timestamp: String,
    isSystem: { type: Boolean, default: false }
}, { _id: false });

const workflowProjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    client: { type: String, default: '' },
    description: { type: String, default: '' },
    department: { type: String, default: 'event_planner' },
    status: { type: String, default: 'planning' },
    startDate: { type: String, default: '' },
    deadline: { type: String, default: '' },
    budget: { type: Number, default: 0 },
    expenses: { type: Number, default: 0 },
    expenseLog: { type: [expenseEntrySchema], default: [] },
    team: { type: [teamMemberSchema], default: [] },
    progress: { type: Number, default: 0 },
    chatHistory: { type: [commentSchema], default: [] },
    tasks: { type: [taskSchema], default: [] },
    avatar: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, {
    timestamps: true,
    toJSON: { virtuals: true }
});

export default mongoose.model('WorkflowProject', workflowProjectSchema);
