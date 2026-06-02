/**
 * CRM Catalog Configuration
 * Defines plans and AI top-up packs.
 */

export const CRM_PLANS = {
    crm_monthly: {
        id: 'crm_monthly',
        name: 'Gói Alpha CRM Hàng Tháng',
        priceVnd: 500000,
        priceCredits: 525,
        includedAiLimit: 1000,
        deviceLimit: 1,
        durationDays: 30
    }
};

export const CRM_AI_PACKS = {
    crm_ai_pack_100: {
        id: 'crm_ai_pack_100',
        name: 'Gói AI Top-up 200',
        priceVnd: 50000,
        priceCredits: 50,
        extraAiLimit: 200
    },
    crm_ai_pack_500: {
        id: 'crm_ai_pack_500',
        name: 'Gói AI Top-up 1000',
        priceVnd: 200000,
        priceCredits: 200,
        extraAiLimit: 1000
    },
    crm_ai_pack_1000: {
        id: 'crm_ai_pack_1000',
        name: 'Gói AI Top-up 2000',
        priceVnd: 350000,
        priceCredits: 350,
        extraAiLimit: 2000
    }
};

/**
 * Helper to check if a product ID exists in the catalog
 */
export const getCrmProduct = (productId) => {
    return CRM_PLANS[productId] || CRM_AI_PACKS[productId] || null;
};
