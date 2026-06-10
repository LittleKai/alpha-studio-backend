import express from 'express';
import { callGcliDirect } from '../utils/aiProvider.js';

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
        const parsedData = parseLLMResponse(llmResponse);
        
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
        const parsedData = parseLLMResponse(llmResponse);
        
        res.json(parsedData);
    } catch (error) {
        console.error('Error generating deck:', error);
        res.status(500).json({ error: error.message || 'Failed to generate deck' });
    }
});

export default router;
