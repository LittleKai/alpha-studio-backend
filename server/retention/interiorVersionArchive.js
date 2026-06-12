import { migrationObjectKey, sha256 } from '../storage/storageMetadata.js';

export const INTERIOR_HOT_VERSION_LIMIT = 20;
export const WORKFLOW_HISTORY_LIMITS = Object.freeze({
    chatHistory: 500,
    expenseLog: 1000,
    tasks: 1000
});
export const WORKFLOW_DOCUMENT_COMMENT_LIMIT = 500;

function newest(items, limit) {
    return Array.isArray(items) ? items.slice(-limit) : [];
}

function plainVersion(version) {
    return typeof version?.toObject === 'function'
        ? version.toObject({ depopulate: true })
        : version;
}

export function limitWorkflowHistory(value = {}) {
    return {
        ...value,
        chatHistory: newest(value.chatHistory, WORKFLOW_HISTORY_LIMITS.chatHistory),
        expenseLog: newest(value.expenseLog, WORKFLOW_HISTORY_LIMITS.expenseLog),
        tasks: newest(value.tasks, WORKFLOW_HISTORY_LIMITS.tasks)
    };
}

export function limitDocumentComments(comments) {
    return newest(comments, WORKFLOW_DOCUMENT_COMMENT_LIMIT);
}

export async function archiveInteriorVersions({
    project,
    storage,
    hotLimit = INTERIOR_HOT_VERSION_LIMIT
}) {
    const versions = Array.isArray(project.versions) ? project.versions : [];
    if (versions.length <= hotLimit) return null;

    const archiveVersions = versions.slice(0, -hotLimit).map(plainVersion);
    const hotVersions = versions.slice(-hotLimit);
    const fromIndex = archiveVersions[0].index;
    const toIndex = archiveVersions.at(-1).index;
    const body = Buffer.from(JSON.stringify({
        format: 'alpha-studio/interior-versions',
        version: 1,
        versions: archiveVersions
    }));
    const checksum = sha256(body);
    const key = migrationObjectKey({
        collection: 'interiorprojects',
        documentId: project._id.toString(),
        fieldPath: `versions-${fromIndex}-${toIndex}`,
        checksum,
        extension: '.json'
    });
    const uploaded = await storage.put({
        key,
        body,
        contentType: 'application/json',
        filename: `versions-${fromIndex}-${toIndex}.json`
    });
    if (!await storage.exists(uploaded.key)) {
        throw new Error(`Interior version archive was not found after upload: ${uploaded.key}`);
    }
    const storedBody = Buffer.from(await storage.get(uploaded.key));
    if (sha256(storedBody) !== checksum) {
        throw new Error(`Interior version archive checksum mismatch: ${uploaded.key}`);
    }

    const metadata = {
        provider: uploaded.provider,
        key: uploaded.key,
        url: uploaded.url,
        checksum,
        size: body.byteLength,
        fromIndex,
        toIndex,
        count: archiveVersions.length,
        createdAt: new Date()
    };
    project.versionArchives = [...(project.versionArchives || []), metadata];
    project.versions = hotVersions;
    return metadata;
}

export async function hydrateInteriorVersions({ project, storage }) {
    const archives = Array.isArray(project.versionArchives) ? project.versionArchives : [];
    const versionsByIndex = new Map();

    for (const archive of archives) {
        const body = Buffer.from(await storage.get(archive.key));
        if (archive.checksum && sha256(body) !== archive.checksum) {
            throw new Error(`Interior version archive checksum mismatch: ${archive.key}`);
        }
        const payload = JSON.parse(body.toString('utf8'));
        if (!Array.isArray(payload.versions)) {
            throw new Error(`Interior version archive has an invalid payload: ${archive.key}`);
        }
        for (const version of payload.versions) {
            versionsByIndex.set(version.index, version);
        }
    }

    for (const version of project.versions || []) {
        const plain = plainVersion(version);
        versionsByIndex.set(plain.index, plain);
    }
    return [...versionsByIndex.values()].sort((left, right) => left.index - right.index);
}

export async function prepareInteriorVersionBranch({ project, storage }) {
    if (!(project.versions || []).some((version) => version.index > project.currentVersionIndex)) {
        return [];
    }
    const allVersions = await hydrateInteriorVersions({ project, storage });
    const obsoleteKeys = (project.versionArchives || []).map((archive) => archive.key);
    project.versions = allVersions.filter((version) => version.index <= project.currentVersionIndex);
    project.versionArchives = [];
    return obsoleteKeys;
}

export async function deleteStorageObjects(storage, keys) {
    await Promise.allSettled([...new Set(keys)].map((key) => storage.delete(key)));
}
