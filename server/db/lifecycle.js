export function createDatabaseLifecycle({
    mongoose,
    uri,
    options,
    afterConnect
}) {
    let connectPromise = null;
    let disconnectPromise = null;

    async function connect() {
        if (mongoose.connection.readyState === 1) {
            return mongoose.connection;
        }
        if (connectPromise) return connectPromise;

        connectPromise = (async () => {
            if (!uri) throw new Error('MONGODB_URI is required');
            await mongoose.connect(uri, options);
            if (afterConnect) await afterConnect();
            return mongoose.connection;
        })();

        try {
            return await connectPromise;
        } finally {
            connectPromise = null;
        }
    }

    async function disconnect() {
        if (mongoose.connection.readyState === 0) return;
        if (disconnectPromise) return disconnectPromise;

        disconnectPromise = mongoose.disconnect();
        try {
            await disconnectPromise;
        } finally {
            disconnectPromise = null;
        }
    }

    return {
        connect,
        disconnect,
        isReady: () => mongoose.connection.readyState === 1
    };
}

export async function shutdown({ server, disconnect }) {
    if (server) {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }
    await disconnect();
}
