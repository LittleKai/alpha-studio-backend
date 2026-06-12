import { validateCabinetModel } from '../../utils/cabinetModelValidator.js';
import {
    archiveInteriorVersions,
    deleteStorageObjects,
    prepareInteriorVersionBranch
} from '../../retention/interiorVersionArchive.js';
import { createStorage } from '../../storage/index.js';
import { applyTemplateDefaultsToModel, invalid, ok } from './common.js';

let storage;

function getStorage(ctx) {
    if (ctx.storage) return ctx.storage;
    storage ||= createStorage();
    return storage;
}

export default {
    name: 'model.commit',
    description: 'Commit the draft as a new project version and end the loop.',
    terminal: true,
    validateArgs: (args) => (typeof args.reply === 'string' && args.reply.trim() ? ok() : invalid('reply is required.')),
    handler: async (args, ctx) => {
        applyTemplateDefaultsToModel(ctx.draftModel);
        const validation = validateCabinetModel(ctx.draftModel);
        if (!validation.valid) return { ok: false, error: validation.message };
        const project = ctx.project;
        const objectStorage = getStorage(ctx);
        const currentIdx = project.currentVersionIndex;
        const obsoleteArchiveKeys = await prepareInteriorVersionBranch({
            project,
            storage: objectStorage
        });
        const nextIndex = project.versions.length > 0 ? Math.max(...project.versions.map((version) => version.index)) + 1 : 0;
        if (typeof ctx.beforeCommit === 'function') {
            const gate = await ctx.beforeCommit({ versionIndex: nextIndex, reply: args.reply });
            if (gate?.ok === false) return { ok: false, error: gate.error || 'Commit rejected.' };
        }
        project.versions.push({
            index: nextIndex,
            parentIndex: project.currentVersionIndex,
            userPrompt: ctx.userPrompt || '',
            refImageUrls: ctx.refImageUrls || [],
            modelJson: ctx.draftModel,
            aiReply: args.reply,
            askForInfo: args.askForInfo === true,
            aiModel: ctx.aiModel || null,
            usage: ctx.usage || null
        });
        project.currentVersionIndex = nextIndex;
        await archiveInteriorVersions({ project, storage: objectStorage });
        await project.save();
        await deleteStorageObjects(objectStorage, obsoleteArchiveKeys);
        ctx.committedVersionIndex = nextIndex;
        return { ok: true, data: { versionIndex: nextIndex, reply: args.reply } };
    }
};
