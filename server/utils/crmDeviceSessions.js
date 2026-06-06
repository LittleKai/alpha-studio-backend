import crypto from 'node:crypto';
import mongoose from 'mongoose';
import CrmDevice from '../models/CrmDevice.js';
import CrmAuditLog from '../models/CrmAuditLog.js';

export const buildActiveDeviceConflict = (device) => ({
    displayName: device.displayName,
    lastSeenAt: device.lastSeenAt
});

export const createAgentSecret = () => {
    const agentSecret = crypto.randomBytes(32).toString('hex');

    return {
        agentSecret,
        agentSecretHash: crypto.createHash('sha256').update(agentSecret).digest('hex')
    };
};

export const replaceActiveDevice = async ({
    mongooseClient = mongoose,
    models = { CrmDevice, CrmAuditLog },
    userId,
    subscriptionId,
    deviceInput
}) => {
    const session = await mongooseClient.startSession();

    try {
        return await session.withTransaction(async () => {
            const activeDevice = await models.CrmDevice.findOne({
                userId,
                subscriptionId,
                status: 'active'
            }).session(session);

            let device;
            let replacedDevice = null;

            if (!activeDevice) {
                [device] = await models.CrmDevice.create([{
                    ...deviceInput,
                    userId,
                    subscriptionId,
                    status: 'active'
                }], { session });
            } else {
                const now = new Date();

                [replacedDevice] = await models.CrmDevice.create([{
                    userId,
                    subscriptionId,
                    machineFingerprintHash: activeDevice.machineFingerprintHash,
                    displayName: activeDevice.displayName,
                    platform: activeDevice.platform,
                    appVersion: activeDevice.appVersion,
                    agentVersion: activeDevice.agentVersion,
                    status: 'replaced',
                    agentSecretHash: activeDevice.agentSecretHash,
                    lastSeenAt: activeDevice.lastSeenAt,
                    lastIp: activeDevice.lastIp,
                    registeredAt: activeDevice.registeredAt,
                    replacedAt: now
                }], { session });

                Object.assign(activeDevice, deviceInput, {
                    userId,
                    subscriptionId,
                    status: 'active',
                    replacedAt: null,
                    registeredAt: now,
                    lastSeenAt: now
                });
                await activeDevice.save({ session });
                device = activeDevice;
            }

            await models.CrmAuditLog.create([{
                userId,
                subscriptionId,
                deviceId: device._id,
                action: 'device_replaced',
                details: {
                    replacedDeviceId: replacedDevice?._id ?? null,
                    activeDeviceId: device._id
                }
            }], { session });

            return { device, replacedDevice };
        });
    } finally {
        await session.endSession();
    }
};
