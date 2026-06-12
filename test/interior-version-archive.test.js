import test from 'node:test';
import assert from 'node:assert/strict';
import {
    archiveInteriorVersions,
    hydrateInteriorVersions,
    limitDocumentComments,
    limitWorkflowHistory
} from '../server/retention/interiorVersionArchive.js';

function projectWithVersions(count) {
    return {
        _id: 'project-1',
        versions: Array.from({ length: count }, (_, index) => ({
            index,
            modelJson: { index },
            createdAt: new Date(2026, 0, index + 1)
        })),
        versionArchives: []
    };
}

test('bounds workflow embedded arrays', () => {
    const entry = { id: 'x' };
    const bounded = limitWorkflowHistory({
        chatHistory: Array(600).fill(entry),
        expenseLog: Array(1100).fill(entry),
        tasks: Array(1200).fill(entry)
    });
    assert.equal(bounded.chatHistory.length, 500);
    assert.equal(bounded.expenseLog.length, 1000);
    assert.equal(bounded.tasks.length, 1000);
    assert.equal(limitDocumentComments(Array(600).fill(entry)).length, 500);
});

test('does not remove versions when upload or verification fails', async () => {
    for (const storage of [
        { put: async () => { throw new Error('upload failed'); } },
        {
            put: async () => ({ provider: 'b2', key: 'archive.json', url: 'https://cdn/archive.json', checksum: 'x', size: 1 }),
            exists: async () => false
        }
    ]) {
        const project = projectWithVersions(25);
        await assert.rejects(
            () => archiveInteriorVersions({ project, storage, hotLimit: 20 })
        );
        assert.equal(project.versions.length, 25);
        assert.equal(project.versionArchives.length, 0);
    }
});

test('archives verified old versions and hydrates the original list', async () => {
    const objects = new Map();
    const storage = {
        put: async ({ key, body }) => {
            objects.set(key, body);
            const { sha256 } = await import('../server/storage/storageMetadata.js');
            return {
                provider: 'b2',
                key,
                url: `https://cdn/${key}`,
                checksum: sha256(body),
                size: body.byteLength
            };
        },
        exists: async (key) => objects.has(key),
        get: async (key) => objects.get(key)
    };
    const project = projectWithVersions(25);

    await archiveInteriorVersions({ project, storage, hotLimit: 20 });
    assert.equal(project.versions.length, 20);
    assert.equal(project.versionArchives.length, 1);
    assert.deepEqual(
        {
            fromIndex: project.versionArchives[0].fromIndex,
            toIndex: project.versionArchives[0].toIndex,
            count: project.versionArchives[0].count
        },
        { fromIndex: 0, toIndex: 4, count: 5 }
    );

    const hydrated = await hydrateInteriorVersions({ project, storage });
    assert.deepEqual(hydrated.map((version) => version.index), Array.from({ length: 25 }, (_, index) => index));
});
