import test from 'node:test';
import assert from 'node:assert';
import { CRM_PLANS, CRM_AI_PACKS, getCrmProduct } from './crmCatalog.js';

test('CRM Catalog Plans & Packs structure', (t) => {
    // Test crm_monthly exists and is configured correctly
    const monthly = CRM_PLANS.crm_monthly;
    assert.ok(monthly);
    assert.strictEqual(monthly.id, 'crm_monthly');
    assert.strictEqual(monthly.priceVnd, 500000);
    assert.strictEqual(monthly.priceCredits, 525);
    assert.strictEqual(monthly.includedAiLimit, 1000);

    // Test pack details
    const pack100 = CRM_AI_PACKS.crm_ai_pack_100;
    assert.ok(pack100);
    assert.strictEqual(pack100.priceVnd, 50000);
    assert.strictEqual(pack100.extraAiLimit, 200);

    // Test catalog product getter helper
    const subProduct = getCrmProduct('crm_monthly');
    assert.deepStrictEqual(subProduct, monthly);

    const packProduct = getCrmProduct('crm_ai_pack_100');
    assert.deepStrictEqual(packProduct, pack100);

    const invalidProduct = getCrmProduct('non_existent');
    assert.strictEqual(invalidProduct, null);
});
