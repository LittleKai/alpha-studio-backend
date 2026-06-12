import { findRedundantIndexes } from './indexPlan.js';

const RETAINED_COLLECTIONS = new Set([
    'chatmessages',
    'cloudsessions',
    'crmagentcommands',
    'crmauditlogs',
    'crmchatbotlogs',
    'crmexecutionlogs',
    'crmgroupmessages',
    'crmmessages',
    'crmpairingsessions',
    'interior_analysis',
    'interioragentlogs',
    'interiorailogs',
    'studiogenerations',
    'webhooklogs'
]);

const MERGE_CANDIDATES = new Map([
    ['crmcustomers', 'Review overlap with crmcontacts and keep one canonical customer profile.']
]);

export const KNOWN_MODEL_COLLECTIONS = new Set([
    'articles', 'chatmessages', 'cloudsessions', 'comments', 'courses',
    'crmagentcommands', 'crmaiusages', 'crmauditlogs', 'crmbillingorders',
    'crmcampaigns', 'crmchatbotlogs', 'crmchatbotrules', 'crmcontacts',
    'crmconversations', 'crmcustomers', 'crmdevices', 'crmexecutionlogs',
    'crmgroupcheckpoints', 'crmgroupinsights', 'crmgroupmessages',
    'crmgroupsummaries', 'crmmessages', 'crmpairingsessions', 'crmsegments', 'crmsubscriptions',
    'crmtasks', 'crmtemplates', 'crmzalogroups', 'enrollments',
    'featuredstudents', 'flowservers', 'hostmachines', 'interior_analysis',
    'interior_quota', 'interior_renders', 'interioragentlogs', 'interiorailogs',
    'interiorprojects', 'interiortemplates', 'jobs', 'partners', 'prompts',
    'resources', 'reviews', 'studiogenerations', 'systemsettings',
    'transactions', 'users', 'vocab_chinese_dictionaries',
    'vocabdeckratings', 'vocabfeedbacks', 'vocabimportlinks',
    'vocabprivatedecks', 'vocabprivateflashcards', 'vocabprofiles',
    'vocabpublicdecks', 'vocabpublicflashcards', 'webhooklogs',
    'workflowdocuments', 'workflowprojects'
]);

export function classifyCollection({ name, documentCount = null }) {
    if (name.includes('archive')) {
        return {
            classification: 'archive',
            reason: 'Archive data should remain outside MongoDB; keep metadata only.',
            recommendation: 'Verify object-storage ownership and retention.'
        };
    }
    if (MERGE_CANDIDATES.has(name)) {
        return {
            classification: 'merge-candidate',
            reason: MERGE_CANDIDATES.get(name),
            recommendation: 'Review reads/writes and migrate references before any merge.'
        };
    }
    if (RETAINED_COLLECTIONS.has(name)) {
        return {
            classification: 'keep-with-retention',
            reason: 'Operational, log, session, or message history with bounded retention.',
            recommendation: 'Keep TTL/index policy and monitor monthly growth.'
        };
    }
    if (KNOWN_MODEL_COLLECTIONS.has(name)) {
        return {
            classification: 'keep',
            reason: 'Collection is owned by an active application model.',
            recommendation: 'Keep; remove only redundant indexes after query review.'
        };
    }
    if (documentCount === 0) {
        return {
            classification: 'remove-candidate',
            reason: 'Collection is unknown to current models and empty.',
            recommendation: 'Confirm no external writer, then archive metadata and remove manually.'
        };
    }
    return {
        classification: 'review',
        reason: 'Collection is not represented by a current model.',
        recommendation: 'Identify owner and query paths before keep/archive/remove decision.'
    };
}

async function safeCollectionStats(db, name) {
    try {
        return await db.command({ collStats: name, scale: 1 });
    } catch (error) {
        return { unsupported: error.message };
    }
}

export async function auditDatabase(db) {
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    const report = [];
    for (const { name } of collections.sort((left, right) => left.name.localeCompare(right.name))) {
        const collection = db.collection(name);
        const [documentCount, indexes, stats] = await Promise.all([
            collection.estimatedDocumentCount(),
            collection.indexes(),
            safeCollectionStats(db, name)
        ]);
        report.push({
            name,
            documentCount,
            logicalSize: stats.size ?? null,
            storageSize: stats.storageSize ?? null,
            averageObjectSize: stats.avgObjSize ?? null,
            totalIndexSize: stats.totalIndexSize ?? null,
            statsUnsupported: stats.unsupported ?? null,
            indexCount: indexes.length,
            redundantIndexes: findRedundantIndexes(indexes),
            ...classifyCollection({ name, documentCount })
        });
    }
    return report;
}

function displayBytes(value) {
    return Number.isFinite(value) ? value.toLocaleString('en-US') : 'n/a';
}

export function auditToMarkdown(report, { generatedAt = new Date() } = {}) {
    const rows = report.map((item) => (
        `| ${item.name} | ${item.documentCount} | ${displayBytes(item.storageSize)} | ${displayBytes(item.totalIndexSize)} | ${item.classification} | ${item.recommendation} |`
    ));
    return [
        '# MongoDB M0 Live Audit',
        '',
        `Generated: ${generatedAt.toISOString()}`,
        '',
        '| Collection | Documents | Storage bytes | Index bytes | Classification | Recommendation |',
        '|---|---:|---:|---:|---|---|',
        ...rows,
        ''
    ].join('\n');
}
