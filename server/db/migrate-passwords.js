/**
 * Migrate existing users to use hashed passwords
 * Run: node server/db/migrate-passwords.js
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://aduc5525:@cluster0.c1mdcyv.mongodb.net/alpha-studio?retryWrites=true&w=majority&appName=Cluster0';

// Sample users to ensure exist with hashed passwords
const sampleUsers = [
    {
        email: 'admin@alphastudio.com',
        password: 'admin123456',
        name: 'Admin',
        role: 'admin',
        subscription: { plan: 'enterprise', apiQuota: 10000 }
    },
    {
        email: 'student@example.com',
        password: 'student123',
        name: 'Demo Student',
        role: 'student',
        subscription: { plan: 'free', apiQuota: 100 }
    }
];

async function migratePasswords() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('Connected!\n');

        const db = mongoose.connection.db;
        const usersCollection = db.collection('users');

        for (const userData of sampleUsers) {
            const existingUser = await usersCollection.findOne({ email: userData.email });

            // Hash the password
            const salt = await bcrypt.genSalt(12);
            const hashedPassword = await bcrypt.hash(userData.password, salt);

            if (existingUser) {
                // Update existing user with hashed password
                await usersCollection.updateOne(
                    { email: userData.email },
                    {
                        $set: {
                            password: hashedPassword,
                            name: userData.name,
                            role: userData.role,
                            subscription: userData.subscription,
                            isActive: true,
                            updatedAt: new Date()
                        }
                    }
                );
                console.log(`Updated: ${userData.email}`);
            } else {
                // Create new user
                await usersCollection.insertOne({
                    email: userData.email,
                    password: hashedPassword,
                    name: userData.name,
                    role: userData.role,
                    subscription: userData.subscription,
                    avatar: null,
                    isActive: true,
                    lastLogin: null,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                console.log(`Created: ${userData.email}`);
            }
        }

        console.log('\n✅ Password migration completed!');
        console.log('\nSample login credentials:');
        console.log('  Admin: admin@alphastudio.com / admin123456');
        console.log('  Student: student@example.com / student123');

    } catch (error) {
        console.error('Migration error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

migratePasswords();
