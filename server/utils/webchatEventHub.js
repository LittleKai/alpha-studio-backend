// Per-guest-session SSE connection hub for the public Webchat widget
// (message.new). Unlike crmEventHub (keyed by authenticated CRM userId),
// this is keyed by `${widgetId}:${sessionToken}` and requires no auth
// middleware — the session token itself (unguessable, generated client-side)
// is the only gate. In-memory only — backend runs as a single Fly.io
// instance; would need Redis pub/sub if that ever changes.

const MAX_CONNECTIONS_PER_KEY = 2;
const HEARTBEAT_INTERVAL_MS = 25000;

const connectionsByKey = new Map(); // key(string) -> Set<res>
let lastEventId = 0;

function subscribe(key, res) {
    let connections = connectionsByKey.get(key);
    if (!connections) {
        connections = new Set();
        connectionsByKey.set(key, connections);
    }

    if (connections.size >= MAX_CONNECTIONS_PER_KEY) {
        const oldest = connections.values().next().value;
        if (oldest) {
            connections.delete(oldest);
            if (!oldest.writableEnded) oldest.end();
        }
    }

    connections.add(res);

    res.on('close', () => {
        connections.delete(res);
        if (connections.size === 0) connectionsByKey.delete(key);
    });
}

function publish(key, eventName, payload) {
    const connections = connectionsByKey.get(key);
    if (!connections || connections.size === 0) return;

    lastEventId += 1;
    const id = lastEventId;
    const data = JSON.stringify(payload ?? {});

    for (const res of connections) {
        try {
            res.write(`id: ${id}\n`);
            res.write(`event: ${eventName}\n`);
            res.write(`data: ${data}\n\n`);
        } catch (error) {
            connections.delete(res);
        }
    }
}

function heartbeatTick() {
    for (const connections of connectionsByKey.values()) {
        for (const res of connections) {
            try {
                res.write(': ping\n\n');
            } catch (error) {
                connections.delete(res);
            }
        }
    }
}

function connectionCount(key) {
    return connectionsByKey.get(key)?.size || 0;
}

setInterval(heartbeatTick, HEARTBEAT_INTERVAL_MS).unref?.();

export default {
    subscribe,
    publish,
    connectionCount,
};
