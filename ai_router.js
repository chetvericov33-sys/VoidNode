// ============================================================
// ai_router.js — ИНТЕГРАЦИЯ С OPENROUTER (ТОЛЬКО ФОРМАТИРОВАНИЕ)
// ============================================================

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Карта моделей для разных задач
const MODEL_MAP = {
    formatting: 'google/gemini-2.0-flash-exp:free',
    explain: 'meta-llama/llama-3.3-70b-instruct:free',
    chat: 'qwen/qwen3-vl-235b-a22b-thinking:free',
    default: 'openrouter/free'
};

// Основная функция запроса к OpenRouter
async function callOpenRouter(messages, modelKey = 'default', temperature = 0.7) {
    const model = MODEL_MAP[modelKey] || MODEL_MAP.default;

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://t.me/void_node_bot',
                'X-Title': 'Void Node Bot'
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: temperature,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('❌ OpenRouter error:', error);
            if (model !== 'openrouter/free') {
                console.log(`🔄 Fallback to openrouter/free for ${modelKey}`);
                return callOpenRouter(messages, 'default', temperature);
            }
            return null;
        }

        const data = await response.json();
        return data.choices[0].message.content;

    } catch (error) {
        console.error('❌ OpenRouter request failed:', error);
        return null;
    }
}

// === ФУНКЦИИ ТОЛЬКО ДЛЯ ФОРМАТИРОВАНИЯ ===

// 1. Превращает цифры в понятный текст (НЕ ДАЁТ РЕКОМЕНДАЦИЙ!)
async function formatAnalysisResults(engineResult, lang = 'ru') {
    const systemPrompt = lang === 'ru'
        ? 'Ты — крипто-помощник. Преврати сухие цифры в понятный текст для пользователя. Не добавляй новых данных, только переформулируй то, что уже есть в данных. Будь дружелюбным, но не давай советов.'
        : 'You are a crypto assistant. Turn dry numbers into understandable text for the user. Do not add new data, only rephrase what is already in the data. Be friendly, but do not give advice.';

    const userMessage = `Расскажи понятным языком о моём портфеле:\n${JSON.stringify(engineResult, null, 2)}`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
    ];

    return await callOpenRouter(messages, 'formatting');
}

// 2. Объясняет решение движка (НЕ ОСПАРИВАЕТ!)
async function explainEngineDecision(decision, context, lang = 'ru') {
    const systemPrompt = lang === 'ru'
        ? 'Ты — крипто-помощник. Объясни пользователю, почему движок принял такое решение. Не оспаривай решение, просто объясни его логику понятным языком.'
        : 'You are a crypto assistant. Explain to the user why the engine made this decision. Do not challenge the decision, just explain its logic in simple terms.';

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Движок принял решение: ${decision}\nКонтекст: ${JSON.stringify(context)}` }
    ];

    return await callOpenRouter(messages, 'explain');
}

// 3. Безопасный AI-чат (без торговых рекомендаций)
async function safeAIChat(userMessage, portfolioData, lang = 'ru') {
    // Проверка на опасные запросы
    const dangerousKeywords = [
        'купить', 'продать', 'buy', 'sell', 'ордер', 'order',
        'вложить', 'инвестировать', 'invest',
        'вывести', 'withdraw', 'перевести', 'transfer'
    ];

    const lower = userMessage.toLowerCase();
    for (const keyword of dangerousKeywords) {
        if (lower.includes(keyword)) {
            return lang === 'ru'
                ? '❌ Я не могу давать торговые рекомендации. Я здесь, чтобы помочь тебе понять твой портфель и объяснить данные. Для торговых решений используй автоторговлю.'
                : '❌ I cannot give trading recommendations. I am here to help you understand your portfolio and explain the data. Use autotrading for trading decisions.';
        }
    }

    const systemPrompt = lang === 'ru'
        ? 'Ты — крипто-помощник. Отвечай на вопросы пользователя о его портфеле, но НЕ давай торговых рекомендаций. Если пользователь спрашивает "что делать" — направляй его к функциям бота (анализ, автоторговля).'
        : 'You are a crypto assistant. Answer user questions about their portfolio, but DO NOT give trading recommendations. If the user asks "what to do" — direct them to the bot\'s functions (analysis, autotrading).';

    let userContent = userMessage;
    if (portfolioData) {
        userContent += `\n\nДанные моего портфеля:\n${JSON.stringify(portfolioData)}`;
    }

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
    ];

    const result = await callOpenRouter(messages, 'chat', 0.8);

    const warning = lang === 'ru'
        ? '\n\n⚠️ *Важно:* Я не даю торговых рекомендаций. Все решения принимает алгоритмический движок бота.'
        : '\n\n⚠️ *Important:* I do not give trading recommendations. All decisions are made by the bot\'s algorithmic engine.';

    return result + warning;
}

// 4. Проверка, можно ли отправить запрос (безопасность)
function isSafeQuery(userMessage) {
    const dangerousKeywords = [
        'купить', 'продать', 'buy', 'sell', 'ордер', 'order',
        'вложить', 'инвестировать', 'invest',
        'вывести', 'withdraw', 'перевести', 'transfer'
    ];

    const lower = userMessage.toLowerCase();
    for (const keyword of dangerousKeywords) {
        if (lower.includes(keyword)) {
            return false;
        }
    }
    return true;
}

// Экспорт всех функций
module.exports = {
    callOpenRouter,
    formatAnalysisResults,
    explainEngineDecision,
    safeAIChat,
    isSafeQuery,
    MODEL_MAP
};
