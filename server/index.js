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
import workflowRoutes from './routes/workflow.js';
import featuredStudentsRoutes from './routes/featuredStudents.js';
import studioRoutes from './routes/studio.js';
import sitemapRoutes from './routes/sitemap.js';
import { configureBucketCors } from './utils/b2Storage.js';
import cron from 'node-cron';
import HostMachine from './models/HostMachine.js';
import CloudSession from './models/CloudSession.js';
import FlowServer from './models/FlowServer.js';
import StudioGeneration from './models/StudioGeneration.js';

// Load env variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Connect to MongoDB
connectDB();

// Configure B2 bucket CORS for browser direct upload
configureBucketCors();

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
// 5mb headroom for prompts, settings, and the legacy inline-base64 reference
// image path. Studio's primary path is now B2 temp upload (FE → B2 → URL),
// so payloads stay small. Default 100kb is too tight for any base64 image.
app.use(express.json({ limit: '5mb' }));
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
app.use('/api/workflow', workflowRoutes);
app.use('/api/featured-students', featuredStudentsRoutes);
app.use('/api/studio', studioRoutes);

// Sitemap (no /api prefix — served at root)
app.use('/sitemap.xml', sitemapRoutes);

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

        // Flow servers — mark offline if no ping for 2 minutes
        const staleFlowServers = await FlowServer.find({
            status: { $ne: 'offline' },
            lastPingAt: { $lt: twoMinutesAgo }
        });
        for (const server of staleFlowServers) {
            console.log(`[Cron] Flow server "${server.name}" (${server.machineId}) went offline`);
            server.status = 'offline';
            server.tokenValid = false;
            await server.save();
        }
    } catch (error) {
        console.error('[Cron] Heartbeat check error:', error);
    }
});

// Cron: purge expired StudioGeneration (and unsaved items) every 30 minutes
cron.schedule('*/30 * * * *', async () => {
    try {
        const now = new Date();
        // Only delete gens where EVERY item is unsaved — preserve saved B2 artifacts.
        const result = await StudioGeneration.deleteMany({
            expiresAt: { $lt: now },
            'items.saved': { $ne: true }
        });
        if (result.deletedCount > 0) {
            console.log(`[Cron] Purged ${result.deletedCount} expired studio generations`);
        }
    } catch (error) {
        console.error('[Cron] Studio cleanup error:', error);
    }
});

// Cron: orphan-purge B2 reference images older than 1h. Studio temp uploads
// to studio/refs/ are normally deleted by the FE right after gen completes,
// but a crash mid-flow or a network glitch can leave files behind. Hourly
// sweep keeps the bucket tidy.
cron.schedule('0 * * * *', async () => {
    try {
        const { listAllFiles, deleteFile } = await import('./utils/b2Storage.js');
        const cutoffMs = Date.now() - 60 * 60 * 1000;
        const all = await listAllFiles();
        const stale = all.filter((f) =>
            f.key.startsWith('studio/refs/') &&
            f.lastModified && new Date(f.lastModified).getTime() < cutoffMs,
        );
        for (const f of stale) {
            try { await deleteFile(f.key); }
            catch (e) { console.warn(`[Cron] refs purge failed for ${f.key}:`, e?.message); }
        }
        if (stale.length > 0) {
            console.log(`[Cron] Purged ${stale.length} stale studio/refs/ files`);
        }
    } catch (error) {
        console.error('[Cron] Studio refs purge error:', error);
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Alpha Studio API Server`);
    console.log(`   Port: ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   API: http://localhost:${PORT}/api\n`);
});
