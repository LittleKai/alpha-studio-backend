import { parseAiTurn } from './protocol.js';

function normalizeResult(result) {
    if (!result || typeof result !== 'object') return { ok: false, error: 'Tool returned an invalid result.' };
    if (result.ok === true) return { ok: true, data: result.data ?? null };
    return { ok: false, error: result.error || 'Tool failed.' };
}

function errorUserMessage(message) {
    return JSON.stringify({ ok: false, error: message });
}

export async function runAgentLoop({
    initialPrompt,
    systemPrompt,
    registry,
    ctx,
    aiCall,
    maxSteps = 30,
    onStep,
    onResult,
    onDone,
    onError
}) {
    const messages = [{ role: 'user', content: initialPrompt }];
    let parseRetries = 0;
    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
        if (ctx?.abortSignal?.aborted) {
            const error = { message: 'Agent loop aborted by client.' };
            await onError?.(error);
            return { ok: false, status: 'aborted', error, messages };
        }
        let aiText = '';
        try {
            const response = await aiCall({ messages, systemPrompt });
            aiText = typeof response === 'string' ? response : (response?.text || '');
            if (response?.usage) ctx.totalTokens = (ctx.totalTokens || 0) + (response.usage.totalTokens || response.usage.total_tokens || 0);
        } catch (error) {
            const payload = { message: error.message || 'AI call failed.' };
            await onError?.(payload);
            return { ok: false, status: 'error', error: payload, messages };
        }

        const parsed = parseAiTurn(aiText);
        if (!parsed.ok) {
            parseRetries += 1;
            const message = `Your response must be exactly one JSON object on one line. ${parsed.error}`;
            messages.push({ role: 'assistant', content: aiText || '' });
            messages.push({ role: 'user', content: errorUserMessage(message) });
            if (parseRetries > 1) {
                const payload = { message };
                await onError?.(payload);
                return { ok: false, status: 'error', error: payload, messages };
            }
            stepIndex -= 1;
            continue;
        }
        parseRetries = 0;

        const { thought, tool: toolName, args } = parsed.value;
        messages.push({ role: 'assistant', content: JSON.stringify(parsed.value) });
        const tool = registry.get(toolName);
        if (!tool) {
            messages.push({ role: 'user', content: errorUserMessage(`Tool '${toolName}' not found. Available: ${registry.list().map((item) => item.name).join(', ')}`) });
            continue;
        }
        const validation = tool.validateArgs(args, ctx);
        if (!validation?.valid) {
            const errors = Array.isArray(validation?.errors) ? validation.errors.join('; ') : (validation?.error || 'Invalid args.');
            messages.push({ role: 'user', content: errorUserMessage(errors) });
            continue;
        }

        await onStep?.(stepIndex, { thought, tool: toolName, args });
        const startedAt = Date.now();
        let result;
        try {
            result = normalizeResult(await tool.handler(args, ctx));
        } catch (error) {
            result = { ok: false, error: error.message || 'Tool handler crashed.' };
        }
        const latencyMs = Date.now() - startedAt;
        messages.push({ role: 'user', content: JSON.stringify(result) });
        await onResult?.(stepIndex, result, latencyMs);
        if (tool.terminal && result.ok) {
            await onDone?.(result.data || {});
            return { ok: true, status: toolName === 'model.abort' ? 'aborted' : 'committed', data: result.data || {}, messages };
        }
    }
    const payload = { message: 'Max steps exceeded' };
    await onError?.(payload);
    return { ok: false, status: 'maxSteps', error: payload, messages };
}
