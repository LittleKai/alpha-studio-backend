import { RETENTION_MS } from '../../retention/policy.js';

const PROTECTED_OPTIONS = [
    'unique',
    'sparse',
    'partialFilterExpression',
    'expireAfterSeconds',
    'weights',
    'wildcardProjection'
];

function isProtected(index) {
    return PROTECTED_OPTIONS.some((option) => index[option] !== undefined)
        || Object.values(index.key || {}).includes('text');
}

function keys(index) {
    return Object.entries(index.key || {});
}

function sameKeys(left, right) {
    const leftKeys = keys(left);
    const rightKeys = keys(right);
    return leftKeys.length === rightKeys.length
        && leftKeys.every(([field, direction], index) => (
            rightKeys[index]?.[0] === field && rightKeys[index]?.[1] === direction
        ));
}

function plainOptions(index) {
    const ignored = new Set(['v', 'name', 'ns', 'key']);
    return Object.fromEntries(
        Object.entries(index)
            .filter(([key]) => !ignored.has(key))
            .sort(([left], [right]) => left.localeCompare(right))
    );
}

function sameOptions(left, right) {
    return JSON.stringify(plainOptions(left)) === JSON.stringify(plainOptions(right));
}

function isPrefix(smaller, larger) {
    const smallKeys = keys(smaller);
    const largeKeys = keys(larger);
    return smallKeys.length < largeKeys.length
        && smallKeys.every(([field, direction], index) => (
            largeKeys[index]?.[0] === field && largeKeys[index]?.[1] === direction
        ));
}

export function findRedundantIndexes(indexes) {
    const redundant = [];
    for (let index = 0; index < indexes.length; index += 1) {
        const candidate = indexes[index];
        if (candidate.name === '_id_' || isProtected(candidate)) continue;

        const exactEarlier = indexes.slice(0, index).find((other) => (
            other.name !== '_id_'
            && !isProtected(other)
            && sameKeys(candidate, other)
            && sameOptions(candidate, other)
        ));
        if (exactEarlier) {
            redundant.push({
                name: candidate.name,
                reason: `Exact duplicate of ${exactEarlier.name}`
            });
            continue;
        }

        const covering = indexes.find((other) => (
            other !== candidate
            && other.name !== '_id_'
            && !isProtected(other)
            && sameOptions(candidate, other)
            && isPrefix(candidate, other)
        ));
        if (covering) {
            redundant.push({
                name: candidate.name,
                reason: `Covered by leading fields of ${covering.name}`
            });
        }
    }
    return redundant;
}

export const REQUIRED_INDEXES = Object.freeze([
    { collection: 'webhooklogs', key: { createdAt: 1 }, options: { expireAfterSeconds: RETENTION_MS.webhook / 1000 } },
    { collection: 'chatmessages', key: { createdAt: 1 }, options: { expireAfterSeconds: RETENTION_MS.chatHistory / 1000 } },
    { collection: 'crmauditlogs', key: { createdAt: 1 }, options: { expireAfterSeconds: RETENTION_MS.crmHistory / 1000 } },
    { collection: 'crmchatbotlogs', key: { createdAt: 1 }, options: { expireAfterSeconds: RETENTION_MS.crmHistory / 1000 } },
    { collection: 'crmexecutionlogs', key: { createdAt: 1 }, options: { expireAfterSeconds: RETENTION_MS.crmHistory / 1000 } },
    { collection: 'crmgroupmessages', key: { createdAt: 1 }, options: { expireAfterSeconds: RETENTION_MS.crmHistory / 1000 } },
    { collection: 'crmmessages', key: { createdAt: 1 }, options: { expireAfterSeconds: RETENTION_MS.crmHistory / 1000 } },
    { collection: 'cloudsessions', key: { purgeAt: 1 }, options: { expireAfterSeconds: 0 } },
    { collection: 'crmagentcommands', key: { purgeAt: 1 }, options: { expireAfterSeconds: 0 } },
    { collection: 'crmpairingsessions', key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } }
]);

export const APPROVED_INDEX_DROPS = Object.freeze([
    { collection: 'partners', name: 'userId_1', reason: 'Legacy field removed from Partner model.' }
]);

async function ensureReviewedIndex(db, definition) {
    const collection = db.collection(definition.collection);
    const existing = (await collection.indexes()).find((index) => (
        sameKeys(index, { key: definition.key })
    ));
    if (!existing) {
        const name = await collection.createIndex(definition.key, definition.options);
        return { action: 'create', collection: definition.collection, name };
    }

    const desiredTtl = definition.options.expireAfterSeconds;
    if (desiredTtl !== undefined && existing.expireAfterSeconds !== desiredTtl) {
        await db.command({
            collMod: definition.collection,
            index: {
                name: existing.name,
                expireAfterSeconds: desiredTtl
            }
        });
        return {
            action: 'update-ttl',
            collection: definition.collection,
            name: existing.name,
            expireAfterSeconds: desiredTtl
        };
    }
    return { action: 'keep', collection: definition.collection, name: existing.name };
}

export async function applyReviewedIndexPlan(db) {
    const results = [];
    for (const definition of REQUIRED_INDEXES) {
        results.push(await ensureReviewedIndex(db, definition));
    }
    for (const approved of APPROVED_INDEX_DROPS) {
        try {
            await db.collection(approved.collection).dropIndex(approved.name);
            results.push({ action: 'drop', ...approved });
        } catch (error) {
            if (error.code !== 26 && error.code !== 27) throw error;
            results.push({ action: 'skip-missing', ...approved });
        }
    }
    return results;
}
