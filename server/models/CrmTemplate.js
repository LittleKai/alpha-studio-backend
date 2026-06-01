import mongoose from 'mongoose';

const crmTemplateSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    subject: {
        type: String,
        trim: true,
        default: ''
    },
    body: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['email', 'zalo', 'sms'],
        default: 'zalo'
    },
    variables: [{
        type: String
    }]
}, {
    timestamps: true
});

const CrmTemplate = mongoose.model('CrmTemplate', crmTemplateSchema);

export default CrmTemplate;
