import mongoose from 'mongoose';
import { buildMongoOptions } from '../config/database.js';
import { createDatabaseLifecycle } from './lifecycle.js';

let lifecycle = null;

function getLifecycle() {
    if (!lifecycle) {
        lifecycle = createDatabaseLifecycle({
            mongoose,
            uri: process.env.MONGODB_URI,
            options: buildMongoOptions(process.env),
            afterConnect: async () => {
                console.log('MongoDB connected successfully');
                console.log(`Database: ${mongoose.connection.db.databaseName}`);
            }
        });
    }
    return lifecycle;
}

const connectDB = () => getLifecycle().connect();

export const disconnectDB = () => getLifecycle().disconnect();
export const isDatabaseReady = () => getLifecycle().isReady();
export default connectDB;
