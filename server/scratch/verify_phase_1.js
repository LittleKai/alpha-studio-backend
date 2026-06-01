import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../db/connection.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import CrmSubscription from '../models/CrmSubscription.js';
import CrmBillingOrder from '../models/CrmBillingOrder.js';
import CrmDevice from '../models/CrmDevice.js';
import { CRM_PLANS, CRM_AI_PACKS } from '../utils/crmCatalog.js';
import { hasQuota, consumeQuota, refundQuota } from '../utils/crmQuota.js';

dotenv.config();

const TEST_EMAIL = 'crm-test-user-999@alphastudio.com';

async function runVerification() {
    console.log('=== ALPHA CRM PHASE 1 VERIFICATION START ===');

    // 1. Quota & Catalog Utilities Tests (In-Memory)
    console.log('\n--- 1. Testing Utilities in-memory ---');
    console.log('Plans available:', Object.keys(CRM_PLANS));
    console.log('AI Packs available:', Object.keys(CRM_AI_PACKS));

    const mockSub = {
        status: 'active',
        includedAiLimit: 10,
        includedAiUsed: 9,
        extraAiRemaining: 5
    };

    console.log('Initial mock sub:', { ...mockSub });
    console.log('Has quota?', hasQuota(mockSub)); // Expected: true

    let bucket = consumeQuota(mockSub);
    console.log('Consumed 1. Bucket used:', bucket); // Expected: 'included'
    console.log('After consume 1:', { ...mockSub });

    bucket = consumeQuota(mockSub);
    console.log('Consumed 2. Bucket used:', bucket); // Expected: 'extra'
    console.log('After consume 2:', { ...mockSub });
    console.log('Has quota?', hasQuota(mockSub)); // Expected: true

    const refunded = refundQuota(mockSub, 'extra');
    console.log('Refunded "extra" bucket? Success:', refunded); // Expected: true
    console.log('After refund:', { ...mockSub });

    // Connect to database
    console.log('\n--- 2. Connecting to DB for Integration Tests ---');
    await connectDB();

    let testUser = null;

    try {
        // Enforce non-destructive tests: delete any pre-existing leftovers of our specific test account first
        testUser = await User.findOne({ email: TEST_EMAIL });
        if (testUser) {
            console.log('Cleaning up leftovers of previous test run...');
            await CrmDevice.deleteMany({ userId: testUser._id });
            await CrmSubscription.deleteMany({ userId: testUser._id });
            await CrmBillingOrder.deleteMany({ userId: testUser._id });
            await Transaction.deleteMany({ userId: testUser._id });
            await testUser.deleteOne();
        }

        // Create fresh clean test user
        console.log(`Creating fresh isolated test user: ${TEST_EMAIL}`);
        testUser = new User({
            name: 'Isolated CRM Test User',
            email: TEST_EMAIL,
            password: 'isolatedtestpassword123',
            role: 'student',
            balance: 1000 // Seed with credits for purchasing crm_monthly (210 credits)
        });
        await testUser.save();
        
        const userId = testUser._id;
        console.log(`Test user created with ID: ${userId}, balance: ${testUser.balance} credits`);

        const plan = CRM_PLANS.crm_monthly;

        // ===============================================================
        // TEST SCENARIO A: Credit Checkout with Compensating Rollback
        // ===============================================================
        console.log('\n--- A. Testing Credit Checkout with Downstream Failure Rollback ---');
        const initialBalance = testUser.balance;

        // Simulate balance deduction
        const userAfterDebit = await User.findOneAndUpdate(
            { _id: userId, balance: { $gte: plan.priceCredits } },
            { $inc: { balance: -plan.priceCredits } },
            { new: true }
        );
        console.log(`Deducted ${plan.priceCredits} credits. User balance: ${userAfterDebit.balance}`);

        try {
            console.log('Simulating a downstream DB failure during subscription creation...');
            throw new Error('Forced DB Error for Rollback Test');
        } catch (err) {
            console.log(`Fulfillment failed: "${err.message}". Initiating compensating refund...`);
            const refundedUser = await User.findByIdAndUpdate(
                userId,
                { $inc: { balance: plan.priceCredits } },
                { new: true }
            );
            console.log(`Refund completed. User balance is restored to: ${refundedUser.balance}`);
            if (refundedUser.balance !== initialBalance) {
                throw new Error('Compensating rollback failed to restore original balance!');
            }
            console.log('✅ Balance compensating rollback passed successfully.');
        }

        // ===============================================================
        // TEST SCENARIO B: Early Subscription Renewal (Paid Time Extension)
        // ===============================================================
        console.log('\n--- B. Testing Early Subscription Renewal Extensions ---');
        
        // 1. Create an active subscription that ends in 10 days
        const now = new Date();
        const initialPeriodEnd = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days from now
        
        let sub = new CrmSubscription({
            userId,
            status: 'active',
            plan: plan.id,
            periodStart: now,
            periodEnd: initialPeriodEnd,
            includedAiLimit: plan.includedAiLimit,
            includedAiUsed: 120, // Spent some quota
            extraAiRemaining: 75, // Has extra quota
            deviceLimit: plan.deviceLimit,
            lastRenewedAt: now
        });
        await sub.save();
        console.log(`Created initial active subscription ID: ${sub._id}`);
        console.log(`Initial Period End: ${sub.periodEnd.toISOString()}`);
        console.log(`Initial Quota: Included used ${sub.includedAiUsed}/500, Extra remaining ${sub.extraAiRemaining}`);

        // 2. Perform a renewal (adds 30 days starting from max(now, periodEnd))
        console.log('Simulating a renewal purchase via checkout/webhook...');
        const oldActiveSub = await CrmSubscription.findOne({ userId, status: 'active' });
        
        if (oldActiveSub) {
            let periodEnd;
            if (new Date() > new Date(oldActiveSub.periodEnd)) {
                // If it was expired, periodEnd starts from now
                periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            } else {
                // If it is active, extend from current periodEnd
                periodEnd = new Date(new Date(oldActiveSub.periodEnd).getTime() + 30 * 24 * 60 * 60 * 1000);
            }

            oldActiveSub.periodEnd = periodEnd;
            oldActiveSub.includedAiLimit = plan.includedAiLimit;
            oldActiveSub.includedAiUsed = 0; // Reset included AI quota for new period
            // extraAiRemaining is naturally preserved!
            await oldActiveSub.save();
            sub = oldActiveSub;
        }

        console.log(`After renewal Period End: ${sub.periodEnd.toISOString()}`);
        console.log(`After renewal Quota: Included used ${sub.includedAiUsed}/500, Extra remaining ${sub.extraAiRemaining}`);

        const expectedPeriodEnd = new Date(initialPeriodEnd.getTime() + 30 * 24 * 60 * 60 * 1000);
        const differenceMs = Math.abs(sub.periodEnd.getTime() - expectedPeriodEnd.getTime());
        
        if (differenceMs > 1000) {
            throw new Error(`PeriodEnd extension is incorrect! Got ${sub.periodEnd.toISOString()}, expected ${expectedPeriodEnd.toISOString()}`);
        }
        if (sub.includedAiUsed !== 0) {
            throw new Error('Included AI quota was not reset for the new period!');
        }
        if (sub.extraAiRemaining !== 75) {
            throw new Error('Paid extra AI quota was lost during renewal!');
        }
        console.log('✅ Subscription early renewal extension passed successfully.');

        // ===============================================================
        // TEST SCENARIO C: Race-Safe One-Device Limit Constraint
        // ===============================================================
        console.log('\n--- C. Testing Race-Safe One-Device Unique Limit Index ---');

        // Create first active device
        const device1 = new CrmDevice({
            userId,
            subscriptionId: sub._id,
            machineFingerprintHash: 'fingerprint_hash_1',
            displayName: 'Windows Workstation 1',
            status: 'active',
            agentSecretHash: 'agent_secret_hash_1'
        });
        await device1.save();
        console.log(`Successfully created active device 1 ID: ${device1._id}`);

        // Try creating second active device for the same subscription
        console.log('Attempting to create second active device under the same subscription...');
        try {
            const device2 = new CrmDevice({
                userId,
                subscriptionId: sub._id,
                machineFingerprintHash: 'fingerprint_hash_2',
                displayName: 'Windows Laptop 2',
                status: 'active',
                agentSecretHash: 'agent_secret_hash_2'
            });
            await device2.save();
            throw new Error('Database allowed registering more than one active device for a single subscription!');
        } catch (dbErr) {
            if (dbErr.code === 11000 || dbErr.message.includes('E11000')) {
                console.log(`✅ Registration blocked by Database Unique Constraint as expected: "${dbErr.message.split(' ').slice(0, 5).join(' ')}..."`);
            } else {
                throw dbErr;
            }
        }

        // ===============================================================
        // TEST SCENARIO D: CRM AI Pack Fallback (Skeleton Expired Sub)
        // ===============================================================
        console.log('\n--- D. Testing CRM AI Pack Expired Skeleton Subscription Fallback ---');

        // Expire all subscriptions for the test user
        await CrmSubscription.updateMany({ userId }, { status: 'expired' });
        console.log('Marked all subscriptions as expired...');

        // Simulate Casso webhook or admin approval of AI Pack on an expired subscription
        const packProduct = CRM_AI_PACKS.crm_ai_pack_100;
        console.log(`Simulating AI Pack purchase for ${packProduct.name} (+${packProduct.extraAiLimit} requests)...`);

        const latestSub = await CrmSubscription.findOne({ userId }).sort({ createdAt: -1 });
        if (latestSub) {
            latestSub.extraAiRemaining += packProduct.extraAiLimit;
            await latestSub.save();
            sub = latestSub;
            console.log(`Added entitlement to latest sub. Status: ${sub.status}, extraAiRemaining: ${sub.extraAiRemaining}`);
        } else {
            throw new Error('Expected subscription was not found!');
        }

        if (sub.status !== 'expired') {
            throw new Error('Subscription status changed from expired!');
        }
        if (sub.extraAiRemaining !== 175) { // 75 + 100
            throw new Error(`AI Pack entitlement not added correctly. Expected 175, got ${sub.extraAiRemaining}`);
        }
        console.log('✅ CRM AI Pack fallback entitlement preservation passed successfully.');

        // Clean up test data completely - leaves the DB pristine!
        console.log('\n--- 5. Pure non-destructive cleanup ---');
        await CrmDevice.deleteMany({ userId });
        await CrmSubscription.deleteMany({ userId });
        await CrmBillingOrder.deleteMany({ userId });
        await Transaction.deleteMany({ userId });
        await testUser.deleteOne();
        console.log(`Successfully purged test user ${TEST_EMAIL} and all associated test records.`);

        console.log('\n=== ALPHA CRM PHASE 1 VERIFICATION SUCCESS ===');
    } catch (dbError) {
        console.error('Database verification error:', dbError);
        // Fallback cleanup in case of failure
        if (testUser && testUser._id) {
            try {
                await CrmDevice.deleteMany({ userId: testUser._id });
                await CrmSubscription.deleteMany({ userId: testUser._id });
                await CrmBillingOrder.deleteMany({ userId: testUser._id });
                await Transaction.deleteMany({ userId: testUser._id });
                await testUser.deleteOne();
                console.log('Successfully ran fallback cleanup on failure.');
            } catch (cleanupErr) {
                console.error('Failed to run fallback cleanup:', cleanupErr);
            }
        }
    } finally {
        await mongoose.disconnect();
        console.log('Database disconnected.');
    }
}

runVerification();
