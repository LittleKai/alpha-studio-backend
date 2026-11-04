import crypto from 'crypto';

/**
 * LumiStage (by Alpha Studio) — Commercial Catalog, Token Pricing (= 1/3 Official Gemini) & License Signer
 * Legal Entity: CÔNG TY TNHH MTV GROUPLIFE
 */

export const LUMI_BRAND = {
    name: 'LumiStage',
    productName: 'LumiStage',
    fullName: 'LumiStage — by Alpha Studio',
    legalEntity: 'CÔNG TY TNHH MTV GROUPLIFE',
    creditUnitVnd: 100,
    taxNote: 'Sản phẩm/dịch vụ phần mềm thuộc đối tượng không chịu thuế GTGT (KCT).'
};

/**
 * Giá Token của Web LumiStage (qua gcli) = đúng 1/3 giá Gemini Flash chính thức:
 * - Google Gemini Flash chính thức: $0.30 / 1M Input (~76.2 Credits) | $2.50 / 1M Output (~635 Credits)
 * - LumiStage (1/3 chính thức):     25 Credits / 1M Input (2.500đ)   | 210 Credits / 1M Output (21.000đ)
 * Quy chuẩn hệ thống: 1 Credit = 100 VNĐ.
 */
export const LUMI_TOKEN_PRICING = {
    inputCreditsPerMillion: 25,
    outputCreditsPerMillion: 210,
    minChargeCredits: 0.01,
    officialReference: {
        inputCreditsPerMillion: 76.2,
        outputCreditsPerMillion: 635,
        discountRatio: '1/3'
    }
};

export const LUMI_EFFORT_MODELS = {
    low: {
        id: 'low',
        labelVi: 'Nhanh (Low)',
        model: 'gemini-3.8-flash',
        gcliModel: 'gemini-3.8-flash-low'
    },
    medium: {
        id: 'medium',
        labelVi: 'Cân bằng (Medium)',
        model: 'gemini-3.8-flash',
        gcliModel: 'gemini-3.8-flash-medium'
    },
    high: {
        id: 'high',
        labelVi: 'Chuyên sâu (High)',
        model: 'gemini-3.8-flash',
        gcliModel: 'gemini-3.8-flash-high'
    }
};

export const LUMI_PLANS = {
    lumi_pro_monthly: {
        id: 'lumi_pro_monthly',
        name: 'Gói LumiStage Pro (1 Tháng)',
        nameVi: 'Gói LumiStage Pro (1 Tháng)',
        priceVnd: 149000,
        priceCredits: 1490,
        bonusAiCredits: 300,
        durationDays: 30
    },
    lumi_pro_quarterly: {
        id: 'lumi_pro_quarterly',
        name: 'Gói LumiStage Pro (3 Tháng)',
        nameVi: 'Gói LumiStage Pro (3 Tháng)',
        priceVnd: 399000,
        priceCredits: 3990,
        bonusAiCredits: 1000,
        durationDays: 90
    },
    lumi_pro_yearly: {
        id: 'lumi_pro_yearly',
        name: 'Gói LumiStage Pro (12 Tháng)',
        nameVi: 'Gói LumiStage Pro (12 Tháng)',
        priceVnd: 1390000,
        priceCredits: 13900,
        bonusAiCredits: 4500,
        durationDays: 365
    }
};

const SINGLE_EXPORT_ACTION = {
    id: 'lumi_single_export',
    name: 'Xuất lẻ 1 file sạch (Không watermark)',
    nameVi: 'Xuất lẻ 1 file sạch (Không watermark)',
    priceVnd: 5000,
    priceCredits: 50
};

const UNLOCK_PROJECT_ACTION = {
    id: 'lumi_unlock_project',
    name: 'Mở khóa trọn gói 1 Dự án (Xóa watermark vĩnh viễn)',
    nameVi: 'Mở khóa trọn gói 1 Dự án (Xóa watermark vĩnh viễn)',
    priceVnd: 20000,
    priceCredits: 200
};

export const LUMI_CREDIT_ACTIONS = {
    lumi_single_export: SINGLE_EXPORT_ACTION,
    singleExport: SINGLE_EXPORT_ACTION,
    lumi_unlock_project: UNLOCK_PROJECT_ACTION,
    unlockProject: UNLOCK_PROJECT_ACTION
};

export function getLumiProduct(productId) {
    return LUMI_PLANS[productId] || LUMI_CREDIT_ACTIONS[productId] || null;
}

/**
 * Tính số Credit cần trừ theo số token thực tế trả về từ model.
 * - Nếu người dùng bật BYOK (dùng API Key cá nhân): thu 0 Credit.
 * - Nếu dùng model của Web (gemini-3.8-flash 3 effort qua gcli):
 *   Credits = (promptTokens * 25 + completionTokens * 210) / 1_000_000
 */
export function calculateLumiTokenCredits(usage = {}, options = {}) {
    if (options.byok === true) {
        const promptTokens = Number(usage?.promptTokens) || 0;
        const completionTokens = Number(usage?.completionTokens) || 0;
        const totalTokens = Number(usage?.totalTokens) || (promptTokens + completionTokens);
        return {
            credits: 0,
            totalCredits: 0,
            vndEquivalent: 0,
            promptTokens,
            completionTokens,
            totalTokens,
            byok: true
        };
    }

    const promptTokens = Math.max(0, Number(usage?.promptTokens) || 0);
    const completionTokens = Math.max(0, Number(usage?.completionTokens) || 0);
    const totalTokens = Math.max(promptTokens + completionTokens, Number(usage?.totalTokens) || 0);

    // Fallback ước lượng nếu upstream không trả về usage object
    const effPrompt = promptTokens > 0 ? promptTokens : 2500;
    const effCompletion = completionTokens > 0 ? completionTokens : 800;

    const rawCredits = (
        effPrompt * LUMI_TOKEN_PRICING.inputCreditsPerMillion +
        effCompletion * LUMI_TOKEN_PRICING.outputCreditsPerMillion
    ) / 1_000_000;

    const credits = Math.max(
        LUMI_TOKEN_PRICING.minChargeCredits,
        Math.round(rawCredits * 10000) / 10000
    );

    return {
        credits,
        totalCredits: credits,
        vndEquivalent: Math.round(credits * LUMI_BRAND.creditUnitVnd),
        promptTokens: effPrompt,
        completionTokens: effCompletion,
        totalTokens: totalTokens || (effPrompt + effCompletion),
        byok: false
    };
}

function getLicenseSecret() {
    return process.env.JWT_SECRET || 'lumistage-default-license-secret-key';
}

/**
 * Ký token giấy phép LumiStage (dùng được cả khi client mất mạng tạm thời 7 ngày).
 */
export function signLumiLicenseToken({
    userId,
    email = '',
    plan = 'free',
    proActive = false,
    expiresAt = null,
    singleExportCredits = 0,
    unlockedProjectIds = [],
    unlockedProjectKeys = []
}) {
    const now = Date.now();
    const mergedKeys = unlockedProjectKeys.length ? unlockedProjectKeys : unlockedProjectIds;
    const payload = {
        v: 1,
        brand: 'LumiStage',
        uid: String(userId),
        email: String(email || ''),
        plan,
        pro: Boolean(proActive || (plan && plan !== 'free')),
        exp: expiresAt ? new Date(expiresAt).getTime() : null,
        offlineGraceUntil: now + 7 * 24 * 60 * 60 * 1000,
        singleExports: Number(singleExportCredits) || 0,
        unlockedProjects: Array.isArray(mergedKeys)
            ? mergedKeys.slice(0, 100).map(String)
            : [],
        iat: now
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = crypto
        .createHmac('sha256', getLicenseSecret())
        .update(encodedPayload)
        .digest('base64url');
    return `${encodedPayload}.${signature}`;
}

export function verifyLumiLicenseToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) {
        return { valid: false, reason: 'invalid_format' };
    }
    const [encodedPayload, signature] = token.split('.');
    const expectedSig = crypto
        .createHmac('sha256', getLicenseSecret())
        .update(encodedPayload)
        .digest('base64url');

    try {
        const sigBuf = Buffer.from(signature, 'utf8');
        const expBuf = Buffer.from(expectedSig, 'utf8');
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            return { valid: false, reason: 'bad_signature' };
        }
        const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
        const now = Date.now();
        if (payload.pro && payload.exp && now > payload.exp) {
            payload.pro = false;
        }
        return { valid: true, payload };
    } catch {
        return { valid: false, reason: 'parse_error' };
    }
}
