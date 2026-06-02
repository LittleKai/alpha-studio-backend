export function redactPhoneLikeStrings(text = '') {
    return String(text).replace(/(?:\+?84|0)(?:[\s.-]?\d){8,10}/g, '[redacted-phone]');
}

export function buildGroupSummaryPrompt({ group, messages }) {
    const transcript = messages
        .map((message) => {
            const sender = message.senderName || message.senderId || 'Thanh vien';
            const sentAt = message.sentAt ? new Date(message.sentAt).toISOString() : '';
            return `[${sentAt}] ${sender}: ${redactPhoneLikeStrings(message.content || '')}`;
        })
        .join('\n')
        .slice(0, 18000);

    return [
        'Ban la chuyen gia CRM. Tom tat cuoc tro chuyen nhom Zalo theo dinh dang co cau truc.',
        'Tra ve tieng Viet ngan gon voi cac muc: Tom tat, Chu de chinh, Quyet dinh, Cau hoi chua giai quyet, Nhu cau khach hang, Rui ro, Co hoi, Hanh dong tiep theo.',
        `Nhom: ${group?.name || group?.groupId || 'Zalo group'}`,
        '',
        transcript
    ].join('\n');
}

export function extractSimpleInsights(summaryText = '') {
    const lines = String(summaryText)
        .split('\n')
        .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
        .filter(Boolean);
    const opportunity = lines.find((line) => /co hoi|opportun/i.test(line));
    const risk = lines.find((line) => /rui ro|risk/i.test(line));
    const question = lines.find((line) => /cau hoi|question/i.test(line));
    const insights = [];

    if (opportunity) {
        insights.push({
            type: 'opportunity',
            title: 'Co hoi tu tom tat nhom',
            description: opportunity,
            recommendedAction: 'Tao viec theo doi hoac lien he thanh vien lien quan.',
            priority: 'high'
        });
    }
    if (risk) {
        insights.push({
            type: 'risk',
            title: 'Rui ro can theo doi',
            description: risk,
            recommendedAction: 'Gan nguoi phu trach xu ly truoc lan cham soc tiep theo.',
            priority: 'high'
        });
    }
    if (question) {
        insights.push({
            type: 'question',
            title: 'Cau hoi chua giai quyet',
            description: question,
            recommendedAction: 'Phan cong nhan su tra loi trong nhom.',
            priority: 'medium'
        });
    }

    if (insights.length === 0 && summaryText) {
        insights.push({
            type: 'follow_up',
            title: 'Can theo doi sau tom tat',
            description: lines[0] || 'Tom tat co noi dung can xem lai.',
            recommendedAction: 'Doc tom tat va tao viec neu co co hoi ban hang.',
            priority: 'medium'
        });
    }

    return insights;
}
