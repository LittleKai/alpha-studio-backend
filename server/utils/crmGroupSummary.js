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

const GOAL_INSTRUCTIONS = {
    leads: '- opportunities: khach co tin hieu mua hang (hoi gia, hoi mua, quan tam san pham). Moi muc ghi ten/biet danh nguoi noi neu co.',
    questions: '- questions: cau hoi cua khach CHUA duoc ai tra loi trong doan chat.',
    complaints: '- risks: phan nan, khieu nai, cam xuc tieu cuc can xu ly.',
    actions: '- actionItems: viec can lam cu the de cham soc/chot khach (title ngan, gon, hanh dong duoc).',
    trends: '- keyTopics: chu de noi bat / xu huong duoc nhac nhieu.'
};

// Build a JSON-output summary prompt. goals filters emphasis, customPrompt is the
// operator's industry-tuned instruction, priorSummary + openItems give continuity
// so the model does not repeat already-tracked / resolved items.
export function buildGroupSummaryPromptV2({
    group,
    messages,
    goals = [],
    customPrompt = '',
    priorSummary = '',
    openItems = []
}) {
    const transcript = messages
        .map((message) => {
            const sender = message.senderName || message.senderId || 'Thanh vien';
            const sentAt = message.sentAt ? new Date(message.sentAt).toISOString() : '';
            return `[${sentAt}] ${sender}: ${redactPhoneLikeStrings(message.content || '')}`;
        })
        .join('\n')
        .slice(0, 18000);

    const goalLines = (Array.isArray(goals) ? goals : [])
        .map((goal) => GOAL_INSTRUCTIONS[goal])
        .filter(Boolean);

    const sections = [
        customPrompt
            ? String(customPrompt).slice(0, 4000)
            : 'Ban la chuyen gia CRM/marketing. Tom tat cuoc tro chuyen nhom Zalo de doi ngu ban hang hanh dong.',
        '',
        'Tra ve DUY NHAT mot JSON hop le (khong kem giai thich, khong code fence) theo schema:',
        '{',
        '  "summaryText": "tom tat ngan 2-4 cau, tieng Viet",',
        '  "keyTopics": ["..."],',
        '  "decisions": ["..."],',
        '  "questions": ["cau hoi chua duoc tra loi"],',
        '  "risks": ["phan nan / rui ro"],',
        '  "opportunities": ["khach co tin hieu mua hang"],',
        '  "sentiment": "positive|neutral|negative|mixed",',
        '  "actionItems": [{"title":"...","description":"...","priority":"low|medium|high"}]',
        '}',
        'Yeu cau noi dung (chi dien muc lien quan, de mang rong neu khong co):',
        ...(goalLines.length ? goalLines : ['- Dien day du cac muc co du lieu.']),
        'Tat ca bang tieng Viet. Khong bia thong tin. Khong ghi so dien thoai.',
        ''
    ];

    if (priorSummary) {
        sections.push(
            'BOI CANH - tom tat lan truoc (chi de hieu mach, KHONG nhac lai y da co):',
            String(priorSummary).slice(0, 2000),
            ''
        );
    }
    if (Array.isArray(openItems) && openItems.length) {
        sections.push(
            'CAC VIEC DANG THEO DOI (da ghi nhan roi - TUYET DOI khong tao lai action item trung y, chi them viec MOI):',
            openItems.slice(0, 40).map((item) => `- ${item}`).join('\n'),
            ''
        );
    }

    sections.push(
        `Nhom: ${group?.name || group?.groupId || 'Zalo group'}`,
        'Doan hoi thoai:',
        transcript
    );

    return sections.join('\n');
}

// Parse the model's JSON response, tolerating code fences / surrounding prose.
// Returns null if no usable JSON object is found.
export function parseGroupSummaryJson(text = '') {
    const raw = String(text || '');
    let candidate = raw.trim();
    const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) candidate = fence[1].trim();
    if (candidate[0] !== '{') {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) return null;
        candidate = candidate.slice(start, end + 1);
    }
    let parsed;
    try {
        parsed = JSON.parse(candidate);
    } catch (_) {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const arr = (value) => Array.isArray(value)
        ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 30)
        : [];
    const sentiments = ['positive', 'neutral', 'negative', 'mixed'];
    const actionItems = Array.isArray(parsed.actionItems)
        ? parsed.actionItems
            .map((item) => ({
                title: String(item?.title || '').trim().slice(0, 200),
                description: String(item?.description || '').trim().slice(0, 1000),
                priority: ['low', 'medium', 'high'].includes(item?.priority) ? item.priority : 'medium'
            }))
            .filter((item) => item.title)
            .slice(0, 30)
        : [];

    return {
        summaryText: String(parsed.summaryText || '').trim(),
        keyTopics: arr(parsed.keyTopics),
        decisions: arr(parsed.decisions),
        questions: arr(parsed.questions),
        risks: arr(parsed.risks),
        opportunities: arr(parsed.opportunities),
        sentiment: sentiments.includes(parsed.sentiment) ? parsed.sentiment : 'neutral',
        actionItems
    };
}

// Stable key per item so re-summarization can dedup and skip resolved items.
export function dedupKeyForItem(groupId = '', title = '') {
    const normalized = String(title)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    let hash = 0;
    for (let i = 0; i < normalized.length; i += 1) {
        hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
    }
    return `${groupId}:${(hash >>> 0).toString(36)}`;
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
