import mongoose from 'mongoose';
import { buildMongoOptions } from '../config/database.js';
import { createDatabaseLifecycle } from './lifecycle.js';

let lifecycle = null;

async function cleanupStaleIndexes() {
    try {
        const db = mongoose.connection.db;
        const partnersCollection = db.collection('partners');
        const partnerIndexes = await partnersCollection.indexes();
        const hasUserIdIndex = partnerIndexes.some((index) => index.name === 'userId_1');

        if (hasUserIdIndex) {
            await partnersCollection.dropIndex('userId_1');
            console.log('Dropped stale userId_1 index from partners collection');
        }
    } catch (error) {
        if (error.code !== 27 && error.code !== 26) {
            console.warn('Index cleanup warning:', error.message);
        }
    }
}

function getLifecycle() {
    if (!lifecycle) {
        lifecycle = createDatabaseLifecycle({
            mongoose,
            uri: process.env.MONGODB_URI,
            options: buildMongoOptions(process.env),
            afterConnect: async () => {
                console.log('MongoDB connected successfully');
                console.log(`Database: ${mongoose.connection.db.databaseName}`);
                await cleanupStaleIndexes();
            }
        });
    }
    return lifecycle;
}

const connectDB = () => getLifecycle().connect();

export const disconnectDB = () => getLifecycle().disconnect();
export const isDatabaseReady = () => getLifecycle().isReady();
export default connectDB;
