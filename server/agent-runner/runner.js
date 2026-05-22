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
    initialMessages,
    initialStepIndex = 0,
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
    // Resume support: when initialMessages is provided, the runner continues
    // a previous conversation instead of seeding from initialPrompt. This is
    // how /agent/runs/:runId/resume picks up after a pause.
    const messages = Array.isArray(initialMessages) && initialMessages.length > 0
        ? [...initialMessages]
        : [{ role: 'user', content: initialPrompt }];
    let parseRetries = 0;
    for (let stepIndex = initialStepIndex; stepIndex < initialStepIndex + maxSteps; stepIndex += 1) {
        if (ctx?.abortSignal?.aborted) {
            // Use a distinct status from AI-initiated 'aborted' (model.abort tool)
            // so the route can mark client-side aborts as resumable 'paused'
            // instead of terminal. Skip onError — same reasoning as maxSteps:
            // throwing on the consumer side would block the paused event.
            return { ok: false, status: 'interrupted', error: { message: 'Agent loop aborted by client.' }, messages };
        }
        // Measure total step duration from BEFORE the AI call so latencyMs
        // reflects the real wait the user experiences (gcli round-trip 10–30s
        // dominates the local tool handler time which is sub-millisecond).
        const stepStartedAt = Date.now();
        let aiText = '';
        try {
            const response = await aiCall({ messages, systemPrompt });
            aiText = typeof response === 'string' ? response : (response?.text || '');
            if (response?.usage) ctx.totalTokens = (ctx.totalTokens || 0) + (response.usage.totalTokens || response.usage.total_tokens || 0);
        } catch (error) {
            // Don't fire onError here: frontend treats 'error' SSE event as fatal
            // (throws + exits stream). Upstream gcli errors (524, network) are
            // transient — surface them via the route's 'paused' event instead so
            // the resume banner appears with the error reason. Run state is
            // already persisted incrementally.
            return { ok: false, status: 'error', error: { message: error.message || 'AI call failed.' }, messages };
        }

        const parsed = parseAiTurn(aiText);
        if (!parsed.ok) {
            parseRetries += 1;
            const message = `Your response must be exactly one JSON object on one line. ${parsed.error}`;
            messages.push({ role: 'assistant', content: aiText || '' });
            messages.push({ role: 'user', content: errorUserMessage(message) });
            if (parseRetries > 1) {
                // Same rationale: surface as resumable rather than killing the stream.
                return { ok: false, status: 'error', error: { message }, messages };
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
        let result;
        try {
            result = normalizeResult(await tool.handler(args, ctx));
        } catch (error) {
            result = { ok: false, error: error.message || 'Tool handler crashed.' };
        }
        // Total step latency = AI call + parse + dispatch + handler. The AI
        // round-trip dominates this; tool handlers are typically sub-ms.
        const latencyMs = Date.now() - stepStartedAt;
        messages.push({ role: 'user', content: JSON.stringify(result) });
        await onResult?.(stepIndex, result, latencyMs);
        if (tool.terminal && result.ok) {
            await onDone?.(result.data || {});
            return { ok: true, status: toolName === 'model.abort' ? 'aborted' : 'committed', data: result.data || {}, messages };
        }
    }
    // maxSteps is a PAUSE point, not an error — the route handler will emit a
    // 'paused' SSE event downstream. We deliberately skip onError here because
    // the frontend consumer treats `error` events as fatal (it throws + exits
    // the stream loop), which would prevent the subsequent 'paused' event from
    // ever reaching the UI. Only true runtime failures (parse retries, aiCall
    // throws, abort) call onError above.
    return { ok: false, status: 'maxSteps', error: { message: 'Max steps exceeded' }, messages };
}
