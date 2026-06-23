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
    leads: '- opportunities: Danh sach leads nong va co hoi ban hang (khach hoi gia, hoi mua, quan tam/hoi tham chi tiet ve san pham/dich vu). Ghi ro ten khach va nhu cau cu the cua ho.',
    questions: '- questions: Cac cau hoi hoac ban khoan cua khach hang CHUA duoc tra loi thoa dang hoac can phan hoi lam ro them trong doan chat.',
    complaints: '- risks: Phan nan, khieu nai, su thieu hai long ve chat luong san pham/dich vu, thai do, hoac van de giao nhan can duoc xu ly gap.',
    actions: '- actionItems: Danh sach cong viec cham soc khach hang thiet thuc, da dang can thuc hien (bao gom: (1) Phan hoi gap thong tin cho khach, (2) Gui bao gia/tai lieu/anh san pham, (3) Dat lich hen cuoc goi/gap mat, (4) Theo doi lai sau mua/sau tu van (follow-up), (5) Cap nhat thong tin/giai doan len CRM, (6) Ho tro ky thuat/van hanh). Moi hanh dong phai co tieu de ngan gon mang tinh hanh dong, phan mo ta ghi ro ai phai lam gi va priority hop ly.',
    trends: '- keyTopics: Cac chu de noi bat, moi quan tam chung, xu huong nhom hoac cac chu de duoc thao luan nhieu nhat.'
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
            : 'Ban la mot chuyen gia CRM va marketing cao cap. Nhiem vu cua ban la phan tich chuyen sau cuoc tro chuyen nhom Zalo de cung cap cho doi ngu ban hang cac thong tin chi tiet, thuc te va de xuat cac hanh dong cham soc khach hang cu the.',
        '',
        'Tra ve DUY NHAT mot JSON hop le (khong kem loi giai thich nao khac, khong bao quanh boi ```json) theo schema sau:',
        '{',
        '  "summaryText": "Tom tat chi tiet 3-5 cau phan anh day du dien bien chinh cua nhom, tam trang/thai do chung cua cac thanh vien va ket qua thao luan.",',
        '  "keyTopics": ["Chu de thao luan chi tiet kem nguoi khoi xuong"],',
        '  "decisions": ["Quyet dinh hoac thoa thuan da dat duoc"],',
        '  "questions": ["Cau hoi chua duoc phan hoi"],',
        '  "risks": ["Rui ro hoac van de tieu cuc can chu y"],',
        '  "opportunities": ["Khach co tin hieu quan tam/mua hang thuc te"],',
        '  "sentiment": "positive|neutral|negative|mixed",',
        '  "actionItems": [',
        '    {',
        '      "title": "Tieu de cong viec ngan gon, truc quan va bat dau bang mot dong tu (VD: \'Gui bao gia cho anh Nam\', \'Goi dien lam ro yeu cau ky thuat\')",',
        '      "description": "Chi tiet buoc can thuc hien, ghi ro thong tin khach hang can cham soc va noi dung can truyen tai",',
        '      "priority": "low|medium|high"',
        '    }',
        '  ]',
        '}',
        'Yeu cau noi dung (chi dien muc co du lieu lien quan, de mang rong neu khong co):',
        ...(goalLines.length ? goalLines : ['- Dien day du cac muc co du lieu de phan tich duoc chi tiet.']),
        'Tat ca bang tieng Viet. Tuyet doi khong tu bia dat thong tin ngoai doan chat. Khong kem so dien thoai.',
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
