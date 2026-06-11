const DAY_MS = 24 * 60 * 60 * 1000;

export const RETENTION_MS = Object.freeze({
    queue: 7 * DAY_MS,
    technicalLog: 30 * DAY_MS,
    webhook: 90 * DAY_MS,
    crmHistory: 365 * DAY_MS,
    cloudSession: 365 * DAY_MS,
    chatHistory: 365 * DAY_MS
});

export function terminalPurgeAt(kind, terminalAt = new Date()) {
    const duration = RETENTION_MS[kind];
    if (!duration) {
        throw new Error(`Unknown retention kind: ${kind}`);
    }
    return new Date(new Date(terminalAt).getTime() + duration);
}

export function compactTerminalAgentState(update) {
    if (!['committed', 'aborted', 'error'].includes(update.status)) {
        return update;
    }

    return {
        ...update,
        messages: [],
        draftModel: null
    };
}
