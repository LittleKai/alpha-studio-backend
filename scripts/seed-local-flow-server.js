/**
 * One-shot seed: register the local flow-agent as a FlowServer so
 * /api/studio/image/generate can pick it and serve Plan 4 traffic.
 *
 * Reads config from alpha-studio-flow-agent/.env to match machineId +
 * AGENT_SECRET + FLOW_PROJECT_ID. If the record exists, it updates in place.
 *
 * Usage:
 *   cd alpha-studio-backend
 *   node scripts/seed-local-flow-server.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FlowServer from '../server/models/FlowServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOW_AGENT_ENV = path.resolve(__dirname, '..', '..', 'alpha-studio-flow-agent', '.env');

function readEnvFile(file) {
    const out = {};
    if (!fs.existsSync(file)) return out;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
        if (m) out[m[1]] = m[2].trim();
    }
    return out;
}

const agentEnv = readEnvFile(FLOW_AGENT_ENV);
const machineId = agentEnv.MACHINE_ID || 'flow-agent-01';
const secret = agentEnv.AGENT_SECRET || 'changeme-shared-secret-with-backend';
const projectId = agentEnv.FLOW_PROJECT_ID || '';
const agentPort = agentEnv.PORT || '4100';
const agentUrl = `http://localhost:${agentPort}`;

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI missing in backend .env');
    await mongoose.connect(uri);

    const existing = await FlowServer.findOne({ machineId });
    if (existing) {
        existing.agentUrl = agentUrl;
        existing.secret = secret;
        existing.projectId = projectId;
        existing.enabled = true;
        // Keep status/tokenValid — heartbeat will refresh them. But bootstrap to
        // available so pickFlowServer can find it immediately for smoke testing.
        existing.status = 'available';
        existing.tokenValid = true;
        existing.lastPingAt = new Date();
        await existing.save();
        console.log(`Updated existing FlowServer (${machineId}) → ${agentUrl}`);
    } else {
        const doc = await FlowServer.create({
            name: 'Local dev flow-agent',
            machineId,
            agentUrl,
            secret,
            projectId,
            status: 'available',
            tokenValid: true,
            enabled: true,
            lastPingAt: new Date(),
        });
        console.log(`Created FlowServer (${machineId}) → ${agentUrl}  _id=${doc._id}`);
    }

    console.log('\nDone. You can now POST /api/studio/image/generate.');
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
