import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const initCollections = async () => {
    try {
        console.log('🔄 Connecting to MongoDB Atlas...\n');

        const uri = process.env.MONGODB_URI.replace(/:[^:@]+@/, ':****@');
        console.log('📡 URI:', uri);

        await mongoose.connect(process.env.MONGODB_URI);

        console.log('\n✅ Connected successfully!');
        console.log('📊 Database:', mongoose.connection.db.databaseName);
        console.log('🌐 Host:', mongoose.connection.host);

        const db = mongoose.connection.db;

        const collections = [
            'users',
            'courses',
            'students',
            'partners',
            'projects',
            'studio_sessions',
            'transformations',
            'api_usage'
        ];

        console.log('\n📁 Creating collections...\n');

        for (const collectionName of collections) {
            const exists = await db.listCollections({ name: collectionName }).hasNext();

            if (!exists) {
                await db.createCollection(collectionName);
                console.log(`✅ Created: ${collectionName}`);
            } else {
                console.log(`⏭️  Already exists: ${collectionName}`);
            }
        }

        console.log('\n📊 Creating indexes...\n');

        await db.collection('users').createIndex({ email: 1 }, { unique: true });
        await db.collection('users').createIndex({ role: 1 });
        await db.collection('users').createIndex({ 'subscription.plan': 1 });
        console.log('✅ Users indexes created');

        await db.collection('courses').createIndex({ category: 1 });
        await db.collection('courses').createIndex({ published: 1 });
        await db.collection('courses').createIndex({ 'rating.average': -1 });
        console.log('✅ Courses indexes created');

        await db.collection('students').createIndex({ userId: 1 }, { unique: true });
        await db.collection('students').createIndex({ studentId: 1 }, { unique: true });
        console.log('✅ Students indexes created');

        await db.collection('partners').createIndex({ userId: 1 }, { unique: true });
        await db.collection('partners').createIndex({ status: 1 });
        console.log('✅ Partners indexes created');

        await db.collection('projects').createIndex({ userId: 1 });
        await db.collection('projects').createIndex({ status: 1 });
        await db.collection('projects').createIndex({ 'team.userId': 1 });
        console.log('✅ Projects indexes created');

        await db.collection('studio_sessions').createIndex({ userId: 1 });
        await db.collection('studio_sessions').createIndex({ sessionId: 1 }, { unique: true });
        await db.collection('studio_sessions').createIndex({ createdAt: -1 });
        console.log('✅ Studio Sessions indexes created');

        await db.collection('transformations').createIndex({ sessionId: 1 });
        await db.collection('transformations').createIndex({ userId: 1 });
        await db.collection('transformations').createIndex({ type: 1 });
        await db.collection('transformations').createIndex({ createdAt: -1 });
        console.log('✅ Transformations indexes created');

        await db.collection('api_usage').createIndex({ userId: 1 });
        await db.collection('api_usage').createIndex({ timestamp: -1 });
        await db.collection('api_usage').createIndex({ billingPeriod: 1 });
        await db.collection('api_usage').createIndex({ userId: 1, billingPeriod: 1 });
        console.log('✅ API Usage indexes created');

        console.log('\n👤 Creating sample users...\n');

        const adminExists = await db.collection('users').findOne({
            email: 'admin@alphastudio.com'
        });

        if (!adminExists) {
            await db.collection('users').insertOne({
                email: 'admin@alphastudio.com',
                password: 'admin123456',
                name: 'Admin User',
                role: 'admin',
                avatar: '',
                phone: '',
                preferences: {
                    language: 'vi',
                    theme: 'light',
                    notifications: true
                },
                subscription: {
                    plan: 'enterprise',
                    startDate: new Date(),
                    apiQuota: {
                        monthly: 10000,
                        used: 0
                    }
                },
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date(),
                lastLoginAt: null
            });
            console.log('✅ Admin user created');
            console.log('   Email: admin@alphastudio.com');
            console.log('   Password: admin123456');
        } else {
            console.log('⏭️  Admin user already exists');
        }

        const studentExists = await db.collection('users').findOne({
            email: 'student@example.com'
        });

        if (!studentExists) {
            await db.collection('users').insertOne({
                email: 'student@example.com',
                password: 'student123',
                name: 'Nguyễn Văn A',
                role: 'student',
                avatar: '',
                phone: '0123456789',
                preferences: {
                    language: 'vi',
                    theme: 'light',
                    notifications: true
                },
                subscription: {
                    plan: 'free',
                    startDate: new Date(),
                    apiQuota: {
                        monthly: 100,
                        used: 0
                    }
                },
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date(),
                lastLoginAt: null
            });
            console.log('✅ Student user created');
            console.log('   Email: student@example.com');
            console.log('   Password: student123');
        } else {
            console.log('⏭️  Student user already exists');
        }

        console.log('\n📁 Final collections list:\n');
        const finalCollections = await db.listCollections().toArray();
        finalCollections.forEach(col => {
            console.log(`   • ${col.name}`);
        });

        // FIX: Use countDocuments instead of stats()
        console.log('\n📊 Collection Statistics:\n');
        for (const col of finalCollections) {
            const count = await db.collection(col.name).countDocuments();
            console.log(`   ${col.name}: ${count} document${count !== 1 ? 's' : ''}`);
        }

        console.log('\n🎉 Database initialization completed successfully!\n');

        await mongoose.connection.close();
        console.log('✅ Connection closed\n');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error during initialization:', error.message);
        console.error(error);
        process.exit(1);
    }
};

initCollections();