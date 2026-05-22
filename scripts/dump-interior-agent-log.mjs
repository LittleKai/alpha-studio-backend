// Dump InteriorAgentLog runs for a project.
// Usage: node scripts/dump-interior-agent-log.mjs <projectId> [limit] [--full]
import 'dotenv/config';
import mongoose from 'mongoose';
import InteriorAgentLog from '../server/models/InteriorAgentLog.js';
import InteriorProject from '../server/models/InteriorProject.js';

const args = process.argv.slice(2);
const projectId = args[0];
const full = args.includes('--full');
const limitArg = args.find((a, i) => i > 0 && !a.startsWith('--'));
if (!projectId) {
    console.error('Usage: node scripts/dump-interior-agent-log.mjs <projectId> [limit] [--full]');
    process.exit(1);
}
const limit = Math.min(Math.max(parseInt(limitArg, 10) || 5, 1), 50);

await mongoose.connect(process.env.MONGODB_URI);

const project = await InteriorProject.findById(projectId).lean();
if (!project) {
    console.error(`Project ${projectId} not found.`);
    process.exit(2);
}

const runs = await InteriorAgentLog.find({ projectId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

const summary = runs.map((run) => ({
    _id: String(run._id),
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    lastActiveAt: run.lastActiveAt,
    stepsCount: run.stepsCount,
    totalTokens: run.totalTokens,
    userPrompt: run.userPrompt?.slice(0, 200),
    selectedModel: run.selectedModel,
    delegateFlash: run.delegateFlash,
    abortReason: run.abortReason,
    finalReply: run.finalReply?.slice(0, 200),
    steps: full
        ? run.steps
        : run.steps?.map((s) => ({
            index: s.index,
            tool: s.tool,
            thought: s.thought?.slice(0, 120),
            latencyMs: s.latencyMs,
            model: s.model,
            tokens: s.tokens?.total ?? 0,
            ok: s.result?.ok,
            err: s.error
        }))
}));

console.log(JSON.stringify({
    project: {
        _id: String(project._id),
        name: project.name,
        currentVersionIndex: project.currentVersionIndex,
        versionCount: project.versions?.length
    },
    runCount: summary.length,
    runs: summary
}, null, 2));

await mongoose.disconnect();
