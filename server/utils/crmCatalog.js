/**
 * CRM Catalog Configuration
 * Defines plans and AI Credit top-up packs (1 Credit = 100 VNĐ, billed per token).
 */

export const CRM_PLANS = {
    crm_monthly: {
        id: 'crm_monthly',
        name: 'Gói Alpha CRM Hàng Tháng',
        priceVnd: 100000,
        priceCredits: 1000,
        includedAiLimit: 200, // 200 AI Credits tặng kèm mỗi chu kỳ (trừ theo token)
        billingUnit: 'credit',
        deviceLimit: 1,
        durationDays: 30
    }
};

export const CRM_TRIAL = {
    id: 'crm_trial',
    name: 'Dùng thử Alpha CRM',
    includedAiLimit: 100, // 100 AI Credits dùng thử (trừ theo token)
    billingUnit: 'credit',
    deviceLimit: 1,
    durationDays: 30
};

export const CRM_AI_PACKS = {
    crm_ai_pack_100: {
        id: 'crm_ai_pack_100',
        name: 'Gói AI Credit 500',
        priceVnd: 50000,
        priceCredits: 500,
        extraAiLimit: 500 // 500 AI Credits vĩnh viễn khi gói chính còn hạn
    },
    crm_ai_pack_500: {
        id: 'crm_ai_pack_500',
        name: 'Gói AI Credit 2.200',
        priceVnd: 200000,
        priceCredits: 2000,
        extraAiLimit: 2200 // 2.200 AI Credits (+10% bonus)
    },
    crm_ai_pack_1000: {
        id: 'crm_ai_pack_1000',
        name: 'Gói AI Credit 4.000',
        priceVnd: 350000,
        priceCredits: 3500,
        extraAiLimit: 4000 // 4.000 AI Credits (+14% bonus)
    }
};

/**
 * Helper to check if a product ID exists in the catalog
 */
export const getCrmProduct = (productId) => {
    return CRM_PLANS[productId] || CRM_AI_PACKS[productId] || null;
};
