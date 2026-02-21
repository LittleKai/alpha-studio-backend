import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import connectDB from './db/connection.js';
import authRoutes from './routes/auth.js';
import courseRoutes from './routes/courses.js';
import partnerRoutes from './routes/partners.js';
import jobRoutes from './routes/jobs.js';
import paymentRoutes from './routes/payment.js';
import adminRoutes from './routes/admin.js';
import promptRoutes from './routes/prompts.js';
import resourceRoutes from './routes/resources.js';
import commentRoutes from './routes/comments.js';
import enrollmentRoutes from './routes/enrollments.js';
import reviewRoutes from './routes/reviews.js';
import articleRoutes from './routes/articles.js';
import cloudRoutes from './routes/cloud.js';
import uploadRoutes from './routes/upload.js';
import cron from 'node-cron';
import HostMachine from './models/HostMachine.js';
import CloudSession from './models/CloudSession.js';

// Load env variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Connect to MongoDB
connectDB();

// CORS configuration
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://alphastudio.vercel.app'
];

// Add production frontend URL from env (without trailing slash)
if (process.env.FRONTEND_URL) {
    const frontendUrl = process.env.FRONTEND_URL.replace(/\/$/, '');
    if (!allowedOrigins.includes(frontendUrl)) {
        allowedOrigins.push(frontendUrl);
    }
}

console.log('Allowed CORS origins:', allowedOrigins);

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn('CORS blocked origin:', origin);
            callback(null, true); // Allow anyway but log warning
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(cookieParser());

// Request logging (development)
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    });
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/partners', partnerRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/prompts', promptRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/cloud', cloudRoutes);
app.use('/api/upload', uploadRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Alpha Studio API is running',
        timestamp: new Date().toISOString()
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

// Cron: check host machines heartbeat every 60 seconds
cron.schedule('* * * * *', async () => {
    try {
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

        // Find machines that haven't pinged in 2 minutes
        const staleMachines = await HostMachine.find({
            status: { $ne: 'offline' },
            lastPingAt: { $lt: twoMinutesAgo }
        });

        for (const machine of staleMachines) {
            console.log(`[Cron] Machine "${machine.name}" (${machine.machineId}) went offline`);
            machine.status = 'offline';
            await machine.save();

            // End active sessions on this machine
            const activeSessions = await CloudSession.find({
                hostMachineId: machine._id,
                status: 'active'
            });

            for (const session of activeSessions) {
                session.status = 'ended';
                session.endedAt = new Date();
                session.endReason = 'machine_offline';
                await session.save();
            }

            if (activeSessions.length > 0) {
                machine.currentContainers = 0;
                await machine.save();
                console.log(`[Cron] Ended ${activeSessions.length} sessions on offline machine "${machine.name}"`);
            }
        }
    } catch (error) {
        console.error('[Cron] Heartbeat check error:', error);
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Alpha Studio API Server`);
    console.log(`   Port: ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   API: http://localhost:${PORT}/api\n`);
});
