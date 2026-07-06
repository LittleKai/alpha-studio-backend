import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import helmet from 'helmet';
import connectDB, {
    disconnectDB,
    isDatabaseReady
} from './db/connection.js';
import { shutdown } from './db/lifecycle.js';
import authRoutes from './routes/auth.js';
import courseRoutes from './routes/courses.js';
import partnerRoutes from './routes/partners.js';
import jobRoutes from './routes/jobs.js';
import paymentRoutes from './routes/payment.js';
import adminRoutes from './routes/admin.js';
import settingsRoutes from './routes/settings.js';
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
import geminiRoutes from './routes/gemini.js';
import chatRoutes from './routes/chat.js';
import vocabRoutes from './routes/vocab.js';
import aiRoutes from './routes/ai.js';
import interiorRoutes from './routes/interior.js';
import skillRoutes from './routes/skills.js';
import crmRoutes from './routes/crm.js';
import channelWebhookRoutes from './routes/channelWebhooks.js';
import webchatPublicRoutes from './routes/webchatPublic.js';
import { configureBucketCors } from './utils/b2Storage.js';
import { seedInteriorTemplateAssets } from './utils/interiorTemplateAssets.js';
import { runSubscriptionMaintenance } from './jobs/crmSubscriptionJobs.js';
import cron from 'node-cron';
import CrmDevice from './models/CrmDevice.js';
import crmEventHub from './utils/crmEventHub.js';
import HostMachine from './models/HostMachine.js';
import CloudSession from './models/CloudSession.js';
import FlowServer from './models/FlowServer.js';
import StudioGeneration from './models/StudioGeneration.js';
import { buildEndedSessionUpdate } from './retention/terminalUpdates.js';
import { localStorageMount } from './storage/localStorageMount.js';
import { buildAllowedOrigins, buildCorsOptions } from './config/cors.js';

// Load env variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security headers
app.use(helmet({
    // Allow cross-origin resource loading for CDN/B2 assets
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

console.log('Allowed CORS origins:', buildAllowedOrigins(process.env));

// Public Webchat widget routes: mounted BEFORE the app-wide CORS whitelist
// because arbitrary customer domains embed this widget. It carries no
// cookies/credentials (bearer-style session token in body/query only), so
// reflecting any Origin here is safe and it never falls through to the
// restrictive global policy below.
app.use('/api/public/webchat', webchatPublicRoutes);

app.use(cors(buildCorsOptions(process.env)));
// 5mb headroom for prompts, settings, and the legacy inline-base64 reference
// image path. Studio's primary path is now B2 temp upload (FE → B2 → URL),
// so payloads stay small. Default 100kb is too tight for any base64 image.
app.use(express.json({
    limit: '5mb',
    verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(cookieParser());

const localMount = localStorageMount(process.env);
if (localMount) {
    app.use(localMount.route, express.static(localMount.root));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/webchat', express.static(path.join(__dirname, 'public', 'webchat')));

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
app.use('/api/settings', settingsRoutes);
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
app.use('/api/gemini', geminiRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/vocab', vocabRoutes);
app.use('/api/interior', interiorRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/crm', channelWebhookRoutes);
app.use('/api/skills', skillRoutes);

// Sitemap (no /api prefix — served at root)
app.use('/sitemap.xml', sitemapRoutes);

// Health check
app.get('/api/health2', (req, res) => res.json({ hello: 'new logic' }));
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Alpha Studio API is running',
        timestamp: new Date().toISOString()
    });
});
app.get('/api/ready', (req, res) => {
    const ready = isDatabaseReady();
    res.status(ready ? 200 : 503).json({
        success: ready,
        message: ready ? 'Alpha Studio API is ready' : 'Database is not ready'
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
    if (err?.code === 'INLINE_MEDIA_NOT_ALLOWED') {
        return res.status(422).json({
            success: false,
            message: `Inline file/media is not allowed at ${err.path}. Upload it first and store its URL.`
        });
    }
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

let cronStarted = false;

function startCronJobs() {
    if (cronStarted) return;
    cronStarted = true;

// Cron: check host machines heartbeat every 60 seconds
cron.schedule('* * * * *', async () => {
    if (!isDatabaseReady()) return;
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
                Object.assign(session, buildEndedSessionUpdate('machine_offline'));
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
    if (!isDatabaseReady()) return;
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

// Cron: CRM Subscription maintenance (run hourly to expire or auto-renew)
cron.schedule('0 * * * *', async () => {
    if (!isDatabaseReady()) return;
    await runSubscriptionMaintenance();
});

// Interval: mark CRM Desktop Agent devices offline if their heartbeat has
// gone stale for >60s (checked every 30s — finer-grained than node-cron's
// 1-minute floor). Publishes device.status so mobile/web clients see it.
setInterval(async () => {
    if (!isDatabaseReady()) return;
    try {
        const staleThreshold = new Date(Date.now() - 60 * 1000);
        const staleDevices = await CrmDevice.find({
            status: 'active',
            agentStatus: 'online',
            lastHeartbeatAt: { $lt: staleThreshold }
        });
        for (const device of staleDevices) {
            device.agentStatus = 'offline';
            await device.save();
            crmEventHub.publish(device.userId, 'device.status', {
                deviceId: device._id,
                agentStatus: 'offline',
                zaloAccounts: device.zaloAccounts,
                queueDepth: device.queueDepth,
                lastHeartbeatAt: device.lastHeartbeatAt
            });
        }
    } catch (error) {
        console.error('[Interval] CRM device offline check error:', error);
    }
}, 30 * 1000);
}

let shuttingDown = false;

function registerShutdownHandlers(server) {
    const handleSignal = async (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`${signal} received, shutting down`);
        try {
            await shutdown({ server, disconnect: disconnectDB });
            process.exit(0);
        } catch (error) {
            console.error('Graceful shutdown failed:', error);
            process.exit(1);
        }
    };

    process.once('SIGINT', () => handleSignal('SIGINT'));
    process.once('SIGTERM', () => handleSignal('SIGTERM'));
}

export async function startServer() {
    await connectDB();
    if (process.env.INTERIOR_TEMPLATE_AUTO_SEED !== 'false') {
        try {
            await seedInteriorTemplateAssets({ logger: console });
        } catch (error) {
            console.warn('[interior:seed] startup seed failed:', error.message);
            if (process.env.INTERIOR_TEMPLATE_SEED_STRICT === 'true') throw error;
        }
    }
    await configureBucketCors();
    startCronJobs();

    const server = app.listen(PORT, () => {
        console.log('\nAlpha Studio API Server');
        console.log(`   Port: ${PORT}`);
        console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`   API: http://localhost:${PORT}/api\n`);
    });

    server.setTimeout(15 * 60 * 1000);
    registerShutdownHandlers(server);
    return server;
}

if (process.env.NODE_ENV !== 'test') {
    startServer().catch((error) => {
        console.error('Server startup failed:', error);
        process.exitCode = 1;
    });
}

export { app };
