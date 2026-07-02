import express from 'express';
import { callGcliDirect } from '../utils/aiProvider.js';
import { authMiddleware } from '../middleware/auth.js';
import { VocabAiUsage } from '../models/Vocab.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';

const router = express.Router();

const DAILY_FREE_LIMIT = 1;

const AI_CARD_MODELS = {
    flash: { id: 'gemini-3-flash', cost: 5, allowsDailyFree: true },
    'gemini-3-flash': { id: 'gemini-3-flash', cost: 5, allowsDailyFree: true },
    pro: { id: 'gemini-3.1-pro', cost: 10, allowsDailyFree: false },
    'gemini-3.1-pro': { id: 'gemini-3.1-pro', cost: 10, allowsDailyFree: false },
    'gemini-3.5-flash': { id: 'gemini-3.5-flash', cost: 10, allowsDailyFree: false },
};

function todayUtcKey() {
    return new Date().toISOString().slice(0, 10);
}

function normalizeAiCardModel(model) {
    return AI_CARD_MODELS[model || 'gemini-3-flash'] || null;
}

function dailyFreeRemaining(usage) {
    if (!usage || usage.dailyFreeDate !== todayUtcKey()) {
        return DAILY_FREE_LIMIT;
    }
    return Math.max(0, DAILY_FREE_LIMIT - (usage.dailyFreeUsed || 0));
}

async function getOrCreateAiUsage(userId) {
    let usage = await VocabAiUsage.findOne({ userId });
    if (!usage) {
        usage = await VocabAiUsage.create({
            userId,
            freeUsesRemaining: DAILY_FREE_LIMIT,
            dailyFreeDate: todayUtcKey(),
            dailyFreeUsed: 0,
        });
    }

    if (usage.dailyFreeDate !== todayUtcKey()) {
        usage.dailyFreeDate = todayUtcKey();
        usage.dailyFreeUsed = 0;
        usage.freeUsesRemaining = DAILY_FREE_LIMIT;
        await usage.save();
    }

    return usage;
}

// Helper to extract and parse JSON from LLM response
const parseLLMResponse = (text) => {
    try {
        // Strip out markdown code blocks like ```json ... ```
        const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleanedText);
    } catch (error) {
        console.error('Failed to parse JSON from LLM:', text);
        throw new Error('Failed to parse LLM response as JSON');
    }
};

router.post('/mnemonic', async (req, res) => {
    try {
        const { word, meaning } = req.body;

        if (!word) {
            return res.status(400).json({ error: 'Word is required' });
        }

        const prompt = `Generate a mnemonic and explanation to help remember the word "${word}"${meaning ? ` with the meaning "${meaning}"` : ''}. Output ONLY a valid JSON object with the following structure (no markdown, no extra text):
{
  "mnemonic": "...",
  "explanation": "..."
}`;

        const llmResponse = await callGcliDirect(prompt);
        const parsedData = parseLLMResponse(llmResponse.text);

        res.json(parsedData);
    } catch (error) {
        console.error('Error generating mnemonic:', error);
        res.status(500).json({ error: error.message || 'Failed to generate mnemonic' });
    }
});

router.post('/generate-deck', async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        const prompt = `Extract vocabulary words from the following text and create a list of flashcards. Output ONLY a valid JSON object with the following structure (no markdown, no extra text):
{
  "cards": [
    { "front": "...", "back": "...", "phonetic": "..." }
  ]
}

Text:
${text}`;

        const llmResponse = await callGcliDirect(prompt);
        const parsedData = parseLLMResponse(llmResponse.text);

        res.json(parsedData);
    } catch (error) {
        console.error('Error generating deck:', error);
        res.status(500).json({ error: error.message || 'Failed to generate deck' });
    }
});

router.get('/usage', authMiddleware, async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        const usage = await getOrCreateAiUsage(userId);
        const user = await User.findById(userId);

        res.json({
            success: true,
            freeUsesRemaining: dailyFreeRemaining(usage),
            creditBalance: user ? user.balance : 0,
        });
    } catch (error) {
        console.error('Error getting AI usage:', error);
        res.status(500).json({ error: 'Failed to retrieve AI usage' });
    }
});

router.post('/generate-cards', authMiddleware, async (req, res) => {
    const userId = req.user._id || req.user.id;
    let reservedFreeUse = false;
    let chargedUser = null;
    let chargeCost = 0;
    let transactionDetails = null;

    try {
        const {
            prompt,
            sourceLanguage,
            targetLanguage,
            count,
            includeExamples,
            includeNotes,
            noteInstructions,
            model,
        } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const modelConfig = normalizeAiCardModel(model);
        if (!modelConfig) {
            return res.status(400).json({ error: 'Unsupported AI model' });
        }

        let usage = await getOrCreateAiUsage(userId);
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (modelConfig.allowsDailyFree && dailyFreeRemaining(usage) > 0) {
            const reservedUsage = await VocabAiUsage.findOneAndUpdate(
                {
                    userId,
                    dailyFreeDate: todayUtcKey(),
                    dailyFreeUsed: { $lt: DAILY_FREE_LIMIT },
                },
                {
                    $inc: { dailyFreeUsed: 1 },
                    $set: { freeUsesRemaining: 0 },
                },
                { new: true }
            );

            if (reservedUsage) {
                usage = reservedUsage;
                reservedFreeUse = true;
            }
        }

        if (!reservedFreeUse) {
            chargeCost = modelConfig.cost;
            chargedUser = await User.findOneAndUpdate(
                { _id: userId, balance: { $gte: chargeCost } },
                { $inc: { balance: -chargeCost } },
                { new: true }
            );

            if (!chargedUser) {
                return res.status(400).json({
                    error: `Insufficient balance. This model requires ${chargeCost} credits.`,
                });
            }

            transactionDetails = {
                userId: chargedUser._id,
                type: 'spend',
                serviceType: 'other',
                amount: chargeCost,
                credits: chargeCost,
                status: 'completed',
                transactionCode: 'AI_CARD_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7).toUpperCase(),
                paymentMethod: 'system',
                description: `VocabFlip AI Card Generator spend (${modelConfig.id})`,
            };
        }

        // Generate Cards using LLM
        const promptText = `Generate exactly ${count || 10} flashcards for learning ${targetLanguage} from ${sourceLanguage} based on the following topic or request: "${prompt}".
${includeExamples ? 'Provide an example sentence using the word in the front language on each card.' : 'Do not include example sentences.'}
${includeNotes ? `Provide short grammatical or usage notes for each card${noteInstructions ? ` matching these instructions: "${noteInstructions}"` : ''}.` : 'Do not include notes.'}

Output ONLY a valid JSON object with the following structure (no markdown, no extra text, no wrapper):
{
  "cards": [
    {
      "front": "word/phrase in ${sourceLanguage}",
      "front_phonetic": "pronunciation or phonetic guide",
      "back": "translation/meaning in ${targetLanguage}",
      "example": "example sentence (if requested, otherwise null)",
      "notes": "short notes (if requested, otherwise null)"
    }
  ]
}`;

        const llmResponse = await callGcliDirect(promptText, { model: modelConfig.id });
        const parsedData = parseLLMResponse(llmResponse.text);

        if (transactionDetails) {
            await Transaction.create(transactionDetails);
        }

        usage = await getOrCreateAiUsage(userId);

        res.json({
            success: true,
            cards: parsedData.cards || [],
            freeUsesRemaining: dailyFreeRemaining(usage),
            creditBalance: chargedUser ? chargedUser.balance : user.balance,
        });
    } catch (error) {
        if (reservedFreeUse) {
            try {
                const usage = await VocabAiUsage.findOne({ userId });
                if (usage && usage.dailyFreeDate === todayUtcKey() && usage.dailyFreeUsed > 0) {
                    usage.dailyFreeUsed -= 1;
                    usage.freeUsesRemaining = dailyFreeRemaining(usage);
                    await usage.save();
                }
            } catch (rollbackError) {
                console.error('Failed to rollback AI daily free use:', rollbackError);
            }
        }

        if (chargedUser && chargeCost > 0) {
            try {
                await User.updateOne({ _id: chargedUser._id }, { $inc: { balance: chargeCost } });
            } catch (rollbackError) {
                console.error('Failed to refund AI card generation charge:', rollbackError);
            }
        }

        console.error('Error generating cards:', error);
        res.status(500).json({ error: error.message || 'Failed to generate cards' });
    }
});

export default router;
