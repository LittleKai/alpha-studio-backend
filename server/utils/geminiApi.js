import { GoogleGenAI, Modality } from '@google/genai';
import crypto from 'crypto';

export async function generateImageGemini(prompt, model, ratio, count, apiKey) {
    const ai = new GoogleGenAI({ apiKey });
    // Gemini 2.5 flash / 3.0 pro image support.
    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: { parts: [{ text: prompt }] },
            config: { responseModalities: [Modality.IMAGE] },
        });

        const candidates = response.candidates?.[0]?.content?.parts || [];
        const items = [];
        for (const part of candidates) {
            if (part.inlineData) {
                // Here we get base64. We need to save it directly or return it.
                // For simplicity, we can return base64 and the caller saves it to B2.
                items.push({
                    base64: part.inlineData.data,
                    mimeType: part.inlineData.mimeType,
                    mediaName: `gemini_${crypto.randomUUID()}`
                });
            }
        }
        return items;
    } catch (e) {
        throw e;
    }
}

export async function generateVideoGemini(prompt, model, ratio, count, apiKey) {
    const ai = new GoogleGenAI({ apiKey });
    try {
        const response = await ai.models.generateContent({
            model: 'veo-2.0-generate-001', // Fallback to Veo 2.0
            contents: { parts: [{ text: prompt }] },
            // GenAI sdk may need different config for video
        });

        // This part would depend on actual Veo implementation in details.
        // For demonstration we assume it returns video inlineData or uri.
        const candidates = response.candidates?.[0]?.content?.parts || [];
        const items = [];
        // Extract logic here ...
        return items;
    } catch (e) {
        throw e;
    }
}
