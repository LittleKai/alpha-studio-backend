import 'dotenv/config';
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/alpha-studio';
console.log('Connecting to', MONGODB_URI);
await mongoose.connect(MONGODB_URI);

const db = mongoose.connection.db;

const conversations = await db.collection('crmconversations').find().toArray();
console.log('\n--- conversations ---');
console.log(JSON.stringify(conversations, null, 2));

const messages = await db.collection('crmmessages').find().sort({ createdAt: -1 }).limit(5).toArray();
console.log('\n--- last 5 messages ---');
console.log(JSON.stringify(messages, null, 2));

await mongoose.disconnect();
