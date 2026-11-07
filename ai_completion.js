'use strict';

function extractText(content) {
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
        return content.map(function(part) {
            if (typeof part === 'string') return part;
            return part && typeof part.text === 'string' ? part.text : '';
        }).join('').trim();
    }
    return '';
}

function parseResponse(response) {
    return response.text().then(function(rawBody) {
        var data;
        try { data = rawBody ? JSON.parse(rawBody) : null; }
        catch (_) { throw new Error('OpenRouter returned invalid JSON (HTTP ' + response.status + ')'); }
        if (!response.ok || !data || data.error) {
            var apiError = data && data.error ? data.error : {};
            var error = new Error('OpenRouter HTTP ' + response.status + ': ' + String(apiError.message || response.statusText || 'request failed').slice(0, 240));
            error.status = response.status;
            error.retryable = response.status === 429 || response.status >= 500;
            throw error;
        }
        var choice = data.choices && data.choices[0];
        var answer = extractText(choice && choice.message && choice.message.content);
        if (!answer && choice && choice.text) answer = extractText(choice.text);
        if (!answer) {
            var empty = new Error('OpenRouter returned an empty completion');
            empty.retryable = true;
            empty.model = data.model || null;
            throw empty;
        }
        return { answer: answer, model: data.model || null };
    });
}

async function requestOpenRouterCompletion(options) {
    var primary = String(options.primaryModel || 'openrouter/free').trim();
    var fallbacks = Array.isArray(options.fallbackModels) ? options.fallbackModels : [];
    // Never silently switch to a paid model. Explicit fallbacks must be configured by the owner.
    var models = [primary].concat(fallbacks.map(function(model) { return String(model || '').trim(); }).filter(Boolean));
    if (!models.some(function(model) { return model !== primary; })) {
        models.push('openrouter/free');
    }
    var uniqueModels = [];
    models.forEach(function(model) { if (model && uniqueModels.indexOf(model) === -1) uniqueModels.push(model); });
    // If the primary is the free router, retry it once: its dynamic routing can select another free model.
    if (uniqueModels.length === 1) uniqueModels.push(uniqueModels[0]);

    var lastError;
    for (var i = 0; i < uniqueModels.length && i < 3; i++) {
        var model = uniqueModels[i];
        try {
            var response = await options.fetchWithTimeout(options.url || 'https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + options.apiKey,
                    'HTTP-Referer': options.referer || 'https://t.me/void_node_bot',
                    'X-Title': 'Void Node AI Advisor'
                },
                body: JSON.stringify({
                    model: model,
                    messages: options.messages,
                    max_tokens: options.maxTokens || 1000,
                    temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.45
                })
            }, options.timeoutMs || 18000, 'OpenRouter chat completion (' + model + ')');
            var parsed = await parseResponse(response);
            return { answer: parsed.answer, model: parsed.model || model, attempts: i + 1 };
        } catch (error) {
            lastError = error;
            console.warn('OpenRouter attempt failed:', {
                model: model,
                attempt: i + 1,
                reason: String(error && error.message || error).slice(0, 240)
            });
            if (error && error.retryable === false) break;
        }
    }
    throw new Error('AI completion unavailable after ' + Math.min(uniqueModels.length, 3) + ' attempt(s): ' + String(lastError && lastError.message || 'unknown error').slice(0, 240));
}

module.exports = { extractText: extractText, requestOpenRouterCompletion: requestOpenRouterCompletion };
