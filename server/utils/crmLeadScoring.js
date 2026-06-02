export function calculateCrmLeadScore({
    customer,
    recentInboundCount = 0,
    repliedToCampaign = false,
    highPriorityInsightCount = 0,
    manualAdjustment = 0
} = {}) {
    let score = 0;
    const stage = customer?.lifecycleStage || customer?.status || 'lead';

    if (repliedToCampaign) score += 25;
    score += Math.min(30, recentInboundCount * 10);
    score += Math.min(30, highPriorityInsightCount * 15);

    if (stage === 'opportunity') score += 25;
    if (stage === 'customer') score += 20;
    if (stage === 'subscriber') score += 10;
    if (customer?.consentStatus === 'granted') score += 10;
    if (customer?.lastMessageAt) score += 10;

    score += Number(manualAdjustment) || 0;
    return Math.max(0, Math.min(100, score));
}
