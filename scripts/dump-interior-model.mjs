// Dump current model JSON of an interior project.
// Usage: node scripts/dump-interior-model.mjs <projectId> [versionIndex]
import 'dotenv/config';
import mongoose from 'mongoose';
import InteriorProject from '../server/models/InteriorProject.js';

const [, , projectId, versionArg] = process.argv;
if (!projectId) {
    console.error('Usage: node scripts/dump-interior-model.mjs <projectId> [versionIndex]');
    process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);

const project = await InteriorProject.findById(projectId).lean();
if (!project) {
    console.error(`Project ${projectId} not found.`);
    process.exit(2);
}

const versionIndex = versionArg !== undefined ? parseInt(versionArg, 10) : project.currentVersionIndex;
const version = project.versions.find((v) => v.index === versionIndex);
if (!version) {
    console.error(`Version ${versionIndex} not found.`);
    process.exit(3);
}

console.log(JSON.stringify({
    project: { _id: String(project._id), name: project.name },
    versionIndex,
    label: version.label,
    modelJson: version.modelJson
}, null, 2));

await mongoose.disconnect();
