// Per-userId SSE connection hub for CRM realtime events (message.new,
// message.status, conversation.updated, device.status, pairing.completed).
// In-memory only — backend runs as a single Fly.io instance. If the backend
// ever scales to >1 instance, this needs to move to Redis pub/sub so a
// publish() on one instance reaches subscribers connected to another.

const MAX_CONNECTIONS_PER_USER = 5;
const HEARTBEAT_INTERVAL_MS = 25000;

const connectionsByUser = new Map(); // userId(string) -> Set<res>
let lastEventId = 0;

function subscribe(userId, res) {
    const key = String(userId);
    let connections = connectionsByUser.get(key);
    if (!connections) {
        connections = new Set();
        connectionsByUser.set(key, connections);
    }

    if (connections.size >= MAX_CONNECTIONS_PER_USER) {
        const oldest = connections.values().next().value;
        if (oldest) {
            connections.delete(oldest);
            if (!oldest.writableEnded) oldest.end();
        }
    }

    connections.add(res);

    res.on('close', () => {
        connections.delete(res);
        if (connections.size === 0) connectionsByUser.delete(key);
    });
}

function publish(userId, eventName, payload) {
    const key = String(userId);
    const connections = connectionsByUser.get(key);
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
    for (const connections of connectionsByUser.values()) {
        for (const res of connections) {
            try {
                res.write(': ping\n\n');
            } catch (error) {
                connections.delete(res);
            }
        }
    }
}

function connectionCount(userId) {
    return connectionsByUser.get(String(userId))?.size || 0;
}

setInterval(heartbeatTick, HEARTBEAT_INTERVAL_MS).unref?.();

export default {
    subscribe,
    publish,
    heartbeatTick,
    connectionCount
};
