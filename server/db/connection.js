import mongoose from 'mongoose';

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            maxPoolSize: 10,
            minPoolSize: 5,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        console.log('✅ MongoDB connected successfully');
        console.log(`📊 Database: ${mongoose.connection.db.databaseName}`);

        // Clean up stale indexes (one-time migration)
        await cleanupStaleIndexes();
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        process.exit(1);
    }
};

// Drop stale indexes that may cause issues
const cleanupStaleIndexes = async () => {
    try {
        const db = mongoose.connection.db;

        // Check and drop stale userId_1 index on partners collection
        const partnersCollection = db.collection('partners');
        const partnerIndexes = await partnersCollection.indexes();
        const hasUserIdIndex = partnerIndexes.some(idx => idx.name === 'userId_1');

        if (hasUserIdIndex) {
            await partnersCollection.dropIndex('userId_1');
            console.log('🧹 Dropped stale userId_1 index from partners collection');
        }
    } catch (error) {
        // Ignore errors if index doesn't exist or collection not found
        if (error.code !== 27 && error.code !== 26) {
            console.warn('⚠️ Index cleanup warning:', error.message);
        }
    }
};

export default connectDB;