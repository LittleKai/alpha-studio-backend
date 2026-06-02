import mongoose from 'mongoose';
import CrmSubscription from '../server/models/CrmSubscription.js';
import CrmDevice from '../server/models/CrmDevice.js';
import CrmPairingSession from '../server/models/CrmPairingSession.js';
import CrmAgentCommand from '../server/models/CrmAgentCommand.js';
import CrmBillingOrder from '../server/models/CrmBillingOrder.js';
import CrmAuditLog from '../server/models/CrmAuditLog.js';

const uri = process.env.MONGODB_URI;

if (!uri) {
    console.error('Missing MONGODB_URI. Refusing to run CRM index migration.');
    process.exit(1);
}

const models = [
    CrmSubscription,
    CrmDevice,
    CrmPairingSession,
    CrmAgentCommand,
    CrmBillingOrder,
    CrmAuditLog
];

try {
    await mongoose.connect(uri);

    for (const model of models) {
        await model.syncIndexes();
        console.log(`Synced indexes for ${model.modelName}`);
    }

    console.log('CRM index migration completed. Safe to rerun.');
} catch (error) {
    console.error('CRM index migration failed:', error);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect();
}
