import test from 'node:test';
import assert from 'node:assert';
import { CRM_PLANS, CRM_AI_PACKS, CRM_TRIAL, getCrmProduct } from './crmCatalog.js';

test('CRM Catalog Plans & Packs structure', () => {
    const monthly = CRM_PLANS.crm_monthly;
    assert.ok(monthly);
    assert.strictEqual(monthly.id, 'crm_monthly');
    assert.strictEqual(monthly.priceVnd, 100000);
    assert.strictEqual(monthly.priceCredits, 1000);
    assert.strictEqual(monthly.includedAiLimit, 200);
    assert.strictEqual(monthly.billingUnit, 'credit');

    assert.strictEqual(CRM_TRIAL.id, 'crm_trial');
    assert.strictEqual(CRM_TRIAL.durationDays, 30);
    assert.strictEqual(CRM_TRIAL.includedAiLimit, 100);
    assert.strictEqual(CRM_TRIAL.billingUnit, 'credit');
    assert.strictEqual(CRM_TRIAL.deviceLimit, 1);

    const pack100 = CRM_AI_PACKS.crm_ai_pack_100;
    assert.ok(pack100);
    assert.strictEqual(pack100.priceVnd, 50000);
    assert.strictEqual(pack100.priceCredits, 500);
    assert.strictEqual(pack100.extraAiLimit, 500);

    const pack500 = CRM_AI_PACKS.crm_ai_pack_500;
    assert.strictEqual(pack500.priceCredits, 2000);
    assert.strictEqual(pack500.extraAiLimit, 2200);

    const pack1000 = CRM_AI_PACKS.crm_ai_pack_1000;
    assert.strictEqual(pack1000.priceCredits, 3500);
    assert.strictEqual(pack1000.extraAiLimit, 4000);

    assert.deepStrictEqual(getCrmProduct('crm_monthly'), monthly);
    assert.deepStrictEqual(getCrmProduct('crm_ai_pack_100'), pack100);
    assert.strictEqual(getCrmProduct('non_existent'), null);
});
