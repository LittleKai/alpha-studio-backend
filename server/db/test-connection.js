import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const testConnection = async () => {
    try {
        console.log('🔄 Testing MongoDB Atlas connection...\n');

        const uri = process.env.MONGODB_URI.replace(/:[^:@]+@/, ':****@');
        console.log('📡 Connection URI:', uri);

        await mongoose.connect(process.env.MONGODB_URI);

        console.log('\n✅ Connection successful!');
        console.log('📊 Database name:', mongoose.connection.db.databaseName);
        console.log('🌐 Host:', mongoose.connection.host);
        console.log('📍 Connection state:', mongoose.connection.readyState);

        const collections = await mongoose.connection.db.listCollections().toArray();

        if (collections.length > 0) {
            console.log('\n📁 Existing collections:');
            collections.forEach(col => {
                console.log(`   • ${col.name}`);
            });
        } else {
            console.log('\n📁 No collections found (database is empty)');
        }

        await mongoose.connection.close();
        console.log('\n✅ Connection closed successfully\n');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Connection failed!');
        console.error('Error:', error.message);

        if (error.message.includes('authentication')) {
            console.log('\n💡 Tips:');
            console.log('   1. Check username and password in .env');
            console.log('   2. Make sure user has correct permissions in MongoDB Atlas');
        }

        if (error.message.includes('IP')) {
            console.log('\n💡 Tips:');
            console.log('   1. Add your IP to Network Access in MongoDB Atlas');
            console.log('   2. Or allow access from anywhere (0.0.0.0/0)');
        }

        process.exit(1);
    }
};

testConnection();