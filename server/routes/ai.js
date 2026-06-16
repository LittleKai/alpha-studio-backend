import express from 'express';
import { callGcliDirect } from '../utils/aiProvider.js';
import { authMiddleware } from '../middleware/auth.js';
import { VocabAiUsage } from '../models/Vocab.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';

const router = express.Router();

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
        let usage = await VocabAiUsage.findOne({ userId });
        if (!usage) {
            usage = await VocabAiUsage.create({ userId, freeUsesRemaining: 3 });
        }

        const user = await User.findById(userId);

        res.json({
            success: true,
            freeUsesRemaining: usage.freeUsesRemaining,
            creditBalance: user ? user.balance : 0
        });
    } catch (error) {
        console.error('Error getting AI usage:', error);
        res.status(500).json({ error: 'Failed to retrieve AI usage' });
    }
});

router.post('/generate-cards', authMiddleware, async (req, res) => {
    try {
        const {
            prompt,
            sourceLanguage,
            targetLanguage,
            count,
            includeExamples,
            includeNotes,
            noteInstructions,
            model
        } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const userId = req.user._id || req.user.id;
        let usage = await VocabAiUsage.findOne({ userId });
        if (!usage) {
            usage = await VocabAiUsage.create({ userId, freeUsesRemaining: 3 });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const cost = 50; // 50 credits (coins) per generation when out of free uses
        const usesFree = usage.freeUsesRemaining > 0;

        if (!usesFree && user) {
            if (user.balance < cost) {
                return res.status(400).json({
                    error: 'Không đủ số dư để thực hiện thao tác này. Mỗi lượt tạo thẻ cần 50 credit.'
                });
            }
        }

        // Map model type to correct GCLI models
        let modelName = 'gemini-3-flash-preview';
        if (model === 'pro') {
            modelName = 'gemini-3.1-pro-preview';
        } else if (model === 'flash') {
            modelName = 'gemini-3-flash-preview';
        } else if (model) {
            modelName = model;
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

        const llmResponse = await callGcliDirect(promptText, { model: modelName });
        const parsedData = parseLLMResponse(llmResponse.text);

        // Deduct usage/credits only after successful generation
        if (usesFree) {
            usage.freeUsesRemaining -= 1;
            await usage.save();
        } else {
            user.balance -= cost;
            await user.save();

            // Create Transaction record
            await Transaction.create({
                userId: user._id,
                type: 'spend',
                serviceType: 'other',
                amount: cost,
                credits: cost,
                status: 'completed',
                transactionCode: 'AI_CARD_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7).toUpperCase(),
                paymentMethod: 'system',
                description: 'VocabFlip AI Card Generator spend'
            });
        }

        res.json({
            success: true,
            cards: parsedData.cards || [],
            freeUsesRemaining: usage.freeUsesRemaining,
            creditBalance: user.balance
        });
    } catch (error) {
        console.error('Error generating cards:', error);
        res.status(500).json({ error: error.message || 'Failed to generate cards' });
    }
});

export default router;
