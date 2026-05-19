// Quick reviewer script: dump InteriorAiLog entries for a project ID.
// Usage: node scripts/dump-interior-log.mjs <projectId> [limit]
import 'dotenv/config';
import mongoose from 'mongoose';
import InteriorAiLog from '../server/models/InteriorAiLog.js';
import InteriorProject from '../server/models/InteriorProject.js';

const [, , projectId, limitArg] = process.argv;
if (!projectId) {
    console.error('Usage: node scripts/dump-interior-log.mjs <projectId> [limit]');
    process.exit(1);
}
const limit = Math.min(Math.max(parseInt(limitArg, 10) || 20, 1), 200);

await mongoose.connect(process.env.MONGODB_URI);

const project = await InteriorProject.findById(projectId).lean();
if (!project) {
    console.error(`Project ${projectId} not found.`);
    process.exit(2);
}

const logs = await InteriorAiLog.find({ projectId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

console.log(JSON.stringify({
    project: { _id: project._id, name: project.name, currentVersionIndex: project.currentVersionIndex, versions: project.versions.length },
    currentVersion: project.versions.find((v) => v.index === project.currentVersionIndex) || null,
    logs
}, null, 2));

await mongoose.disconnect();
