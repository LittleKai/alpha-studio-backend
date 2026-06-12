import {
    compactTerminalAgentState,
    terminalPurgeAt
} from './policy.js';

export function buildTerminalCommandUpdate(status, finishedAt = new Date(), extra = {}) {
    return {
        ...extra,
        status,
        finishedAt,
        purgeAt: terminalPurgeAt('queue', finishedAt)
    };
}

export function buildEndedSessionUpdate(endReason, endedAt = new Date(), extra = {}) {
    return {
        ...extra,
        status: 'ended',
        endedAt,
        endReason,
        purgeAt: terminalPurgeAt('cloudSession', endedAt)
    };
}

export function buildTerminalAgentUpdate(update) {
    return compactTerminalAgentState(update);
}
