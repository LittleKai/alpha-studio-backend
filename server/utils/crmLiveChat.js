export const CRM_MESSAGE_TYPES = [
    'text',
    'image',
    'file',
    'sticker',
    'video',
    'voice',
    'gif',
    'link',
    'location',
    'contact_card',
    'rich',
    'unknown'
];

const CRM_MESSAGE_TYPE_SET = new Set(CRM_MESSAGE_TYPES);

function parseValidDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeCrmMessageType(value) {
    const normalized = String(value || 'text').trim().toLowerCase();
    return CRM_MESSAGE_TYPE_SET.has(normalized) ? normalized : 'unknown';
}

export function normalizeQueryLimit(value, { defaultLimit = 30, maxLimit = 100 } = {}) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return defaultLimit;
    return Math.min(maxLimit, Math.max(1, parsed));
}

export function buildConversationMessageQuery({ userId, conversationId, before, after }) {
    const query = { userId, conversationId };
    const beforeDate = parseValidDate(before);
    const afterDate = parseValidDate(after);

    if (beforeDate || afterDate) {
        query.createdAt = {};
        if (beforeDate) query.createdAt.$lt = beforeDate;
        if (afterDate) query.createdAt.$gt = afterDate;
    }

    return query;
}

function managedGroupClauses(managedGroups) {
    if (!Array.isArray(managedGroups)) return [];
    return managedGroups
        .map((group) => ({
            accountId: String(group?.accountId || '').trim(),
            groupId: String(group?.groupId || '').trim()
        }))
        .filter((group) => group.accountId && group.groupId)
        .map((group) => ({
            threadType: 'group',
            accountId: group.accountId,
            threadId: group.groupId
        }));
}

function andFilters(...filters) {
    const cleanFilters = filters.filter((filter) => filter && Object.keys(filter).length > 0);
    if (cleanFilters.length === 0) return {};
    if (cleanFilters.length === 1) return cleanFilters[0];
    return { $and: cleanFilters };
}

export function withManagedConversationVisibility(baseQuery, managedGroups) {
    const query = { ...(baseQuery || {}) };
    if (query.threadType === 'user') return query;

    const groupClauses = managedGroupClauses(managedGroups);
    if (query.threadType === 'group') {
        const visibility = groupClauses.length > 0
            ? { $or: groupClauses }
            : { _id: { $exists: false } };
        return andFilters(query, visibility);
    }

    const visibility = groupClauses.length > 0
        ? { $or: [{ threadType: 'user' }, ...groupClauses] }
        : { threadType: 'user' };
    return andFilters(query, visibility);
}
