export function setSseHeaders(res) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
}

export function writeEvent(res, type, payload) {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(payload ?? {})}\n\n`);
}

export function closeSse(res) {
    if (!res.writableEnded) res.end();
}
