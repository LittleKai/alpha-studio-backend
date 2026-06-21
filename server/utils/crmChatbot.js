export function normalizeVietnamese(value = '') {
    return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .trim();
}

export function normalizeChatbotDebounceSeconds(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 20;
    return Math.min(120, Math.max(10, parsed));
}

export function hasHandoffKeyword(settingsOrRule, message) {
    const keywords = settingsOrRule?.handoffKeywords
        || ['nhan vien', 'nguoi that', 'tu van vien', 'gap admin', 'human'];
    const text = normalizeVietnamese(message);
    return keywords.some((keyword) => {
        const normalized = normalizeVietnamese(keyword);
        return normalized && text.includes(normalized);
    });
}

export function isWithinBusinessHours(businessHours, now = new Date()) {
    if (!businessHours?.enabled) return true;
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: businessHours.timezone || 'Asia/Ho_Chi_Minh',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    });
    const parts = Object.fromEntries(
        formatter.formatToParts(now).map((part) => [part.type, part.value])
    );
    const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = days[parts.weekday];
    if (Array.isArray(businessHours.days)
        && businessHours.days.length > 0
        && !businessHours.days.includes(day)) {
        return false;
    }
    const current = `${parts.hour}:${parts.minute}`;
    const start = businessHours.start || '08:00';
    const end = businessHours.end || '18:00';
    return start <= end
        ? current >= start && current <= end
        : current >= start || current <= end;
}

export function matchChatbotRule(rule, message, now = new Date()) {
    if (!isWithinBusinessHours(rule?.businessHours, now)) return false;
    const text = normalizeVietnamese(message);
    const keywords = Array.isArray(rule?.keywords) ? rule.keywords : [];
    return keywords.some((keyword) => {
        const key = normalizeVietnamese(keyword);
        if (!key) return false;
        if (rule.matchMode === 'exact') return text === key;
        if (rule.matchMode === 'startsWith') return text.startsWith(key);
        return text.includes(key);
    });
}

export function buildChatbotConfigSnapshot({
    settings,
    rules,
    crmThreadKeys,
    selectedGroupKeys,
    version
}) {
    return {
        version,
        settings,
        rules,
        scope: {
            crmThreadKeys: [...new Set(crmThreadKeys)],
            selectedGroupKeys: [...new Set(selectedGroupKeys)]
        }
    };
}
