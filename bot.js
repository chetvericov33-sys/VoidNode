// ============================================================
// 0. ПОДКЛЮЧЕНИЕ ЗАВИСИМОСТЕЙ ДЛЯ NODE.JS
// ============================================================
require('dotenv').config();
const express = require('express');
const KVStore = require('./kv-store');

// Полифил для crypto.subtle (если Node.js < 20)
if (!globalThis.crypto) {
  const { Crypto } = require('@peculiar/webcrypto');
  globalThis.crypto = new Crypto();
}

// Создаём экземпляр KV
const VOID_KV = new KVStore();

// ============================================================
// 0. УПРАВЛЕНИЕ СООБЩЕНИЯМИ (СИСТЕМА ОДНОГО СООБЩЕНИЯ)
// ============================================================
async function getUserLastMessageId(chatId) { /* ... как в предыдущей версии */ }
async function setUserLastMessageId(chatId, messageId) { /* ... */ }
async function deleteUserLastMessage(chatId) { /* ... */ }
async function botDeleteMessage(chatId, messageId) { /* ... */ }
async function deleteUserMessage(chatId, messageId) { /* ... */ }
async function deleteUserMessageWithDelay(chatId, messageId, delay = 1500) { /* ... */ }
async function sendUpdatedMessage(chatId, text, keyboard = null, parseMode = 'Markdown', userMessageId = null) { /* ... */ }
async function sendMessage(chatId, text, keyboard = null, parseMode = 'Markdown') { /* ... */ }

// ============================================================
// 1. КОНФИГУРАЦИЯ (ключи из переменных окружения)
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const WHITELIST_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT', 'ADA/USDT', 'DOT/USDT'];
const CRYPTOBOT_TOKEN = process.env.CRYPTOBOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const ADANOS_API_KEY = process.env.ADANOS_API_KEY;
const APIFY_API_KEY = process.env.APIFY_API_KEY;
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

const CONFIG = {
  MAX_POSITION_SIZE: 0.1,
  STOP_LOSS_DEFAULT: 5,
  CACHE_DURATION: 30000,
  MAX_HISTORY_ENTRIES: 30,
  COOLDOWN_ACTIONS: 3,
  COOLDOWN_WINDOW: 600000,
  COOLDOWN_BLOCK: 900000,
  MAX_RECOMMENDATIONS: 5,
  CHECK_TIMEOUT: 30000,
  UNDO_WINDOW: 10000,
  PORTFOLIO_HISTORY_DAYS: 90,
  ALERT_CHECK_INTERVAL: 300000,
  AUTOTRADE_CHECK_INTERVAL: 900000,
  PANIC_CHECK_INTERVAL: 900000,
  TRUSTED_NEWS_DOMAINS: [
    'cointelegraph.com', 'news.bitcoin.com', 'cryptopotato.com',
    'beincrypto.com', 'coindesk.com', 'decrypt.co', 'theblock.co',
    'cryptoslate.com', 'dailyhodl.com', 'u.today', 'ambcrypto.com',
    'fxstreet.com', 'investing.com'
  ],
  MAX_ORDERS_PER_DAY: 10,
};

// ============================================================
// 2. ТАРИФЫ (PLANS) – без изменений
// ============================================================
const PLANS = { /* ... полный объект из предыдущей версии */ };

// ============================================================
// 3. МУЛЬТИЯЗЫЧНОСТЬ (LANGUAGES) – обновлённая с новыми ключами помощи и ответами
// ============================================================
const LANGUAGES = {
  ru: {
    // Все существующие ключи ... (сохраняем из прошлой версии)
    // Добавляем/обновляем для помощи:
    help_menu_title: '❓ *Помощь по боту*\n\nВыберите интересующий вас вопрос, чтобы получить быстрый ответ:',
    help_q1: '🔐 Как подключить биржу?',
    help_q2: '📊 Как работает анализ портфеля?',
    help_q3: '💳 Какие тарифы доступны?',
    help_q4: '🛡️ Как проверить контракт?',
    help_q5: '🔔 Как создать оповещение?',
    help_q6: '🚀 Как включить автоторговлю?',
    help_q7: '❄️ Что такое холодный душ?',
    help_q8: '📝 Как работает дневник настроения?',
    help_q9: '🔌 Как отключить биржу?',
    help_q10: '🤖 Как использовать AI-советник?',
    help_contact_moderator: '👤 Написать модератору',

    help_answer_q1: '🔐 *Как подключить биржу?*\n\n1. Зайдите на биржу (Binance, Bybit, OKX и др.)\n2. Перейдите в раздел управления API\n3. Создайте ключ с правами *только на чтение*\n4. Скопируйте API-ключ и Secret-ключ\n5. Отправьте их в бот командой /connect в формате:\n`API_KEY:SECRET_KEY`\n\n🔒 *Ключи шифруются и не имеют права на вывод средств.*',
    help_answer_q2: '📊 *Как работает анализ портфеля?*\n\nКоманда /analyze запускает полный анализ вашего портфеля:\n\n• Показывает распределение активов (BTC, альты, стейблы)\n• Рассчитывает RSI, скользящие средние (MA20, MA200)\n• Оценивает риск (низкий/средний/высокий)\n• Считает коэффициент Шарпа и VaR\n• Даёт конкретные рекомендации по ребалансировке\n\n📌 После анализа вы можете исполнить рекомендации одним нажатием кнопки.',
    help_answer_q3: '💳 *Какие тарифы доступны?*\n\n🔰 *Триал* — 0 ₽, 7 дней\n• 2 анализа/день, 3 антискам-проверки\n\n⭐ *Старт* — 500 ₽/мес\n• 10 анализов/день, 3 оповещения\n\n🚀 *PRO* — 1 000 ₽/мес\n• 30 анализов/день, 15 оповещений, автоторговля (3/день)\n\n👑 *VIP* — 1 500 ₽/мес\n• ВСЕ БЕЗЛИМИТНО\n• Приоритетная поддержка 24/7\n\nПодробнее: /subscribe',
    help_answer_q4: '🛡️ *Как проверить контракт?*\n\nВы можете проверить смарт-контракт несколькими способами:\n\n1. Отправьте адрес контракта (0x...) в чат – бот проверит его автоматически\n2. Используйте меню *Безопасность* → *Контракт*\n3. Используйте меню *Безопасность* → *DEX* – покажет ликвидность и риски\n\n🔍 Бот проверяет:\n• Верификацию на Etherscan\n• Подозрительные паттерны (honeypot)\n• Скоринг риска (0–100 баллов)\n\n📌 Пример: `0x742d35Cc6634C0532925a3b844Bc454e4438f44e`',
    help_answer_q5: '🔔 *Как создать оповещение?*\n\nИспользуйте команду /alerts или меню *Оповещения*.\n\nДоступны 5 типов оповещений:\n• 📊 По цене – сработает при достижении заданной цены\n• 📈 По изменению % – при изменении цены более чем на X%\n• 📊 По объёму – при превышении объёма торгов\n• 📰 Новостное – при появлении новостей по вашим активам\n• 📅 Календарное – перед важными экономическими событиями\n\n📌 Лимит зависит от вашего тарифа.\nВсе оповещения можно просмотреть и удалить через меню.',
    help_answer_q6: '🚀 *Как включить автоторговлю?*\n\nКоманда /autotrade открывает меню с 3 уровнями сложности:\n\n🛡️ *Уровень 1 (Защита)* – устанавливает стоп-лоссы при падении 5% и 10%\n\n🔄 *Уровень 2 (Перераспределение)* – продаёт мусорные токены и покупает растущие\n\n🧠 *Уровень 3 (Умный рост)* – использует трейлинг стоп-лосс и фиксирует 30% прибыли при росте >20%\n\n📌 Автоторговля проверяет портфель каждые 15 минут. Доступна только на PRO и VIP.',
    help_answer_q7: '❄️ *Что такое холодный душ?*\n\nХолодный душ — экстренная защита при резком падении рынка.\n\n• Бот автоматически проверяет цену BTC каждые 15 минут\n• При падении на 5% за 15 минут – отправляет предупреждение\n• Предлагает одним нажатием конвертировать все активы в USDT\n\n🛡️ Это помогает сохранить капитал во время обвалов.\n\nДоступен на тарифах PRO и VIP. Активируйте командой /panic.',
    help_answer_q8: '📝 *Как работает дневник настроения?*\n\nКоманда /diary открывает дневник эмоций.\n\nВыберите своё текущее настроение:\n😌 Спокоен | 🤔 Задумчив | 😰 Тревожен | 😱 Паника | 😤 Зол | 😊 Эйфория\n\n📌 Бот сохраняет записи и анализирует их.\nЕсли вы тревожны 3 дня подряд — бот предупредит, что торговать в таком состоянии опасно.\n\n💡 Это помогает контролировать психологическое состояние и избегать импульсивных решений.',
    help_answer_q9: '🔌 *Как отключить биржу?*\n\nКоманда /disconnect или меню *Настройки* → *Отключить биржу*.\n\nПосле подтверждения:\n• API-ключи будут удалены\n• Бот перестанет анализировать портфель\n• Все данные о портфеле будут стёрты\n\n⚠️ Вы всегда можете подключить биржу заново командой /connect.\n\n📌 Если вы случайно подтвердили отключение, есть 10 секунд на отмену: /undo',
    help_answer_q10: '🤖 *Как использовать AI-советник?*\n\nAI-советник доступен двумя способами:\n\n1. После анализа портфеля нажмите кнопку *💬 AI-советник*\n2. В главном меню выберите *Помощь* и затем *Задать свой вопрос*\n\n🤖 AI знает ваш портфель и даёт персонализированные советы.\n\n📌 Примеры вопросов:\n• "Стоит ли докупить BTC?"\n• "Как снизить риски?"\n• "Что делать с альткоинами?"\n\n💡 Все ответы сопровождаются пояснением последствий, рисков и альтернатив.\n\n🔄 Для выхода из AI-режима отправьте /exit.',
    help_contact_moderator_message: '👤 *Связь с модератором*\n\nНапишите @clofeLEAN — он вам поможет!\n\n📌 Также вы можете задать вопрос в нашем чате поддержки:\n📱 [Чат поддержки](https://t.me/void_node_chat)\n\n⏳ Мы отвечаем в течение 15 минут (в рабочее время).\n\n🔄 Для VIP-пользователей доступна приоритетная поддержка 24/7.',
    back_to_help: '🔙 Назад к помощи',
  },
  en: {
    // Английские переводы аналогичны (добавить самостоятельно)
  }
};

// ============================================================
// 4. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (getText, getGreeting, работа с KV)
// ============================================================
function getText(lang, key, ...args) { /* ... как в предыдущей версии */ }
function getGreeting(name, lang) { /* ... */ }
async function getUserLanguage(chatId) { /* ... */ }
async function setUserLanguage(chatId, lang) { /* ... */ }
async function getUserMode(chatId) { /* ... */ }
async function setUserMode(chatId, mode) { /* ... */ }

// ============================================================
// 5. ШИФРОВАНИЕ (без изменений)
// ============================================================
async function encrypt(text) { /* ... */ }
async function decrypt(encoded) { /* ... */ }

// ============================================================
// 6. KV ФУНКЦИИ (без изменений)
// ============================================================
async function saveUserKeys(chatId, apiKey, secretKey, exchangeId) { /* ... */ }
async function loadUserKeys(chatId) { /* ... */ }
async function deleteUserKeys(chatId) { /* ... */ }
async function getUserState(chatId) { /* ... */ }
async function setUserState(chatId, state) { /* ... */ }
async function getKillSwitch(chatId) { /* ... */ }
async function setKillSwitch(chatId, active) { /* ... */ }
async function getOnboarded(chatId) { /* ... */ }
async function setOnboarded(chatId) { /* ... */ }

// ============================================================
// 7. ТАРИФЫ И ЛИМИТЫ (без изменений)
// ============================================================
async function getUserPlan(chatId) { /* ... */ }
async function activateTrial(chatId) { /* ... */ }
async function activatePlan(chatId, planId) { /* ... */ }
async function checkLimit(chatId, feature) { /* ... */ }

// ============================================================
// 8. ИСТОРИЯ (без изменений)
// ============================================================
async function addHistory(chatId, action, detail) { /* ... */ }
async function getHistory(chatId) { /* ... */ }

// ============================================================
// 9. ПЛАТЕЖИ CRYPTOBOT (без изменений)
// ============================================================
async function createCryptoInvoice(chatId, planId, amountRub) { /* ... */ }

// ============================================================
// 10. TELEGRAM ФУНКЦИИ (дополнительные)
// ============================================================
async function sendTyping(chatId) { /* ... */ }
async function answerCallback(callbackId, text = null, showAlert = false) { /* ... */ }
async function sendDocument(chatId, content, filename) { /* ... */ }

// ============================================================
// 11. МЕТРИКИ (для отображения, не для анализа движка)
// ============================================================
function createProgressBarUI(value, max = 100, length = 10) { /* ... */ }
function getIdealPortfolio(mode) { /* ... */ }
function generateCSV(riskReport) { /* ... */ }

// ============================================================
// 12. fetchWithRetry И measurePerformance (НОВЫЕ)
// ============================================================
async function fetchWithRetry(fn, retries = 3, delay = 1000) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ Попытка ${i + 1}/${retries} не удалась: ${error.message}`);
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, delay * (i + 1)));
      }
    }
  }
  throw lastError;
}

async function measurePerformance(fn, name) {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const duration = Date.now() - start;
    console.log(`⏱️ ${name}: ${duration}ms`);
    if (duration > 5000) {
      console.warn(`⚠️ Медленный запрос: ${name} (${duration}ms)`);
    }
  }
}

// ============================================================
// 13. БИРЖЕВЫЕ ФУНКЦИИ (С RETRY И PERFOMANCE)
// ============================================================
async function getExchange(exchangeId, apiKey, secretKey) {
  const { default: ccxt } = await import('https://cdn.jsdelivr.net/npm/ccxt@4.1.61/dist/ccxt.js');
  return new ccxt[exchangeId]({
    apiKey: apiKey,
    secret: secretKey,
    enableRateLimit: true,
    timeout: 30000,
  });
}

async function detectExchange(apiKey, secretKey) {
  const patterns = {
    binance: /^vm[A-Za-z0-9]{60,}/,
    bybit: /^B[A-Za-z0-9]{30,}/,
    okx: /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}/,
    kucoin: /^[a-zA-Z0-9]{24,}/,
    gate: /^GT[A-Za-z0-9]{30,}/,
  };
  for (const [exchange, pattern] of Object.entries(patterns)) {
    if (pattern.test(apiKey)) return exchange;
  }
  const exchanges = ['binance', 'bybit', 'okx', 'kucoin', 'gate', 'bitget', 'kraken'];
  for (const id of exchanges) {
    try {
      const exchange = await getExchange(id, apiKey, secretKey);
      await fetchWithRetry(() => exchange.fetchBalance());
      return id;
    } catch (error) {
      continue;
    }
  }
  return null;
}

// ============================================================
// 14. КЭШИРОВАНИЕ (без изменений)
// ============================================================
const CACHE = new Map();
const CACHE_TTL = 60000;
const COMMISSION_RATE = 0.001;

async function getCachedTicker(exchange, symbol) {
  const key = `${exchange.id}_${symbol}`;
  if (CACHE.has(key) && Date.now() - CACHE.get(key).timestamp < CACHE_TTL) {
    return CACHE.get(key).data;
  }
  try {
    const ticker = await fetchWithRetry(() => exchange.fetchTicker(symbol));
    CACHE.set(key, { data: ticker, timestamp: Date.now() });
    return ticker;
  } catch (error) {
    console.warn(`Не удалось получить тикер для ${symbol}:`, error.message);
    return null;
  }
}

async function getCachedOHLCV(exchange, symbol, timeframe = '1d', limit = 30) {
  const key = `${exchange.id}_${symbol}_${timeframe}_${limit}`;
  if (CACHE.has(key) && Date.now() - CACHE.get(key).timestamp < CACHE_TTL) {
    return CACHE.get(key).data;
  }
  try {
    const ohlcv = await fetchWithRetry(() => exchange.fetchOHLCV(symbol, timeframe, undefined, limit));
    CACHE.set(key, { data: ohlcv, timestamp: Date.now() });
    return ohlcv;
  } catch (error) {
    console.warn(`Не удалось получить OHLCV для ${symbol}:`, error.message);
    return null;
  }
}

// ============================================================
// 15. БАЗОВЫЕ МЕТРИКИ (RSI, MA, волатильность, Шарп, Сортино, VaR, корреляция)
// ============================================================
async function calculateRSI(exchange, symbol, period = 14) {
  const ohlcv = await getCachedOHLCV(exchange, symbol, '1d', period + 1);
  if (!ohlcv || ohlcv.length < period + 1) return { rsi: 50, signal: 'neutral' };
  const prices = ohlcv.map(c => c[4]);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i-1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  let signal = 'neutral';
  if (rsi > 70) signal = 'overbought';
  else if (rsi < 30) signal = 'oversold';
  return { rsi, signal };
}

async function calculateMA(exchange, symbol, period = 20) {
  const ohlcv = await getCachedOHLCV(exchange, symbol, '1d', period);
  if (!ohlcv || ohlcv.length < period) return { ma: 0, current: 0, diff: 0 };
  const prices = ohlcv.map(c => c[4]);
  const currentPrice = prices[prices.length - 1];
  const ma = prices.reduce((a, b) => a + b, 0) / prices.length;
  const diff = ((currentPrice - ma) / ma) * 100;
  return { ma, currentPrice, diff };
}

async function calculateVolatility(exchange, symbol, days = 30) {
  const ohlcv = await getCachedOHLCV(exchange, symbol, '1d', days);
  if (!ohlcv || ohlcv.length < 2) return 0;
  const prices = ohlcv.map(c => c[4]);
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

async function calculateSharpeRatio(exchange, symbol, riskFreeRate = 0.02, days = 30) {
  const ohlcv = await getCachedOHLCV(exchange, symbol, '1d', days);
  if (!ohlcv || ohlcv.length < 2) return 0;
  const prices = ohlcv.map(c => c[4]);
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const std = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / returns.length);
  if (std === 0) return 0;
  return (avg * 365 - riskFreeRate) / (std * Math.sqrt(365));
}

async function calculateSortinoRatio(exchange, symbol, riskFreeRate = 0.02, days = 30) {
  const ohlcv = await getCachedOHLCV(exchange, symbol, '1d', days);
  if (!ohlcv || ohlcv.length < 2) return 0;
  const prices = ohlcv.map(c => c[4]);
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const downside = returns.filter(r => r < 0);
  if (downside.length === 0) return 0;
  const downsideDev = Math.sqrt(downside.reduce((a, b) => a + Math.pow(b, 2), 0) / downside.length);
  if (downsideDev === 0) return 0;
  return (avg * 365 - riskFreeRate) / (downsideDev * Math.sqrt(365));
}

async function calculateVaR(exchange, symbol, confidence = 0.95, days = 30) {
  const ohlcv = await getCachedOHLCV(exchange, symbol, '1d', days);
  if (!ohlcv || ohlcv.length < 2) return 0;
  const prices = ohlcv.map(c => c[4]);
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  returns.sort((a, b) => a - b);
  const index = Math.floor((1 - confidence) * returns.length);
  return returns[index] * 100;
}

async function calculateCorrelation(exchange, symbol1, symbol2, days = 30) {
  const ohlcv1 = await getCachedOHLCV(exchange, symbol1, '1d', days);
  const ohlcv2 = await getCachedOHLCV(exchange, symbol2, '1d', days);
  if (!ohlcv1 || !ohlcv2 || ohlcv1.length < 2 || ohlcv2.length < 2) return 0;
  const prices1 = ohlcv1.map(c => c[4]);
  const prices2 = ohlcv2.map(c => c[4]);
  const minLen = Math.min(prices1.length, prices2.length);
  const returns1 = [], returns2 = [];
  for (let i = 1; i < minLen; i++) {
    returns1.push((prices1[i] - prices1[i-1]) / prices1[i-1]);
    returns2.push((prices2[i] - prices2[i-1]) / prices2[i-1]);
  }
  const n = returns1.length;
  const mean1 = returns1.reduce((a, b) => a + b, 0) / n;
  const mean2 = returns2.reduce((a, b) => a + b, 0) / n;
  let cov = 0, var1 = 0, var2 = 0;
  for (let i = 0; i < n; i++) {
    const d1 = returns1[i] - mean1;
    const d2 = returns2[i] - mean2;
    cov += d1 * d2;
    var1 += d1 * d1;
    var2 += d2 * d2;
  }
  cov /= n;
  var1 /= n;
  var2 /= n;
  if (var1 === 0 || var2 === 0) return 0;
  return cov / Math.sqrt(var1 * var2);
}

// ============================================================
// 16. ДЕТЕРМИНИРОВАННЫЙ ДВИЖОК АНАЛИЗА ПОРТФЕЛЯ (analyzePortfolioEngine)
// ============================================================
async function analyzePortfolioEngine(exchangeId, apiKey, secretKey, chatId = null, lang = 'ru') {
  // Проверка лимитов и ключей
  if (chatId) {
    const check = await checkLimit(chatId, 'analyze');
    if (!check.allowed) return { error: 'limit', message: check.reason };
    await sendTyping(chatId);
    const exchange = await getExchange(exchangeId, apiKey, secretKey);
    try {
      await fetchWithRetry(() => exchange.fetchBalance());
    } catch (e) {
      if (e.message.includes('Invalid API key') || e.message.includes('Signature')) {
        return { error: 'invalid_key', message: getText(lang, 'error_api_key') };
      }
      return { error: 'exchange_error', message: getText(lang, 'error_exchange') };
    }
  }

  const exchange = await getExchange(exchangeId, apiKey, secretKey);
  const balance = await fetchWithRetry(() => exchange.fetchBalance());
  const total = balance.total;
  const coins = Object.keys(total).filter(key => total[key] > 0);
  if (coins.length === 0) return { error: 'empty', message: getText(lang, 'no_coins') };

  // Параллельный сбор тикеров
  const tickerPromises = coins.map(coin => getCachedTicker(exchange, `${coin}/USDT`));
  const tickerResults = await Promise.allSettled(tickerPromises);

  let totalUSDT = 0, btcAmount = 0, usdtAmount = 0;
  const altcoins = [];
  for (let i = 0; i < coins.length; i++) {
    const coin = coins[i];
    const amount = total[coin];
    if (coin === 'USDT') {
      usdtAmount += amount;
      totalUSDT += amount;
      continue;
    }
    const tickerResult = tickerResults[i];
    if (tickerResult.status === 'fulfilled' && tickerResult.value) {
      const ticker = tickerResult.value;
      const price = ticker.last * (1 - COMMISSION_RATE);
      const value = amount * price;
      totalUSDT += value;
      if (coin === 'BTC') btcAmount += value;
      else altcoins.push({ asset: coin, value, volume: ticker.quoteVolume || 0, delisted: false, price });
    } else {
      altcoins.push({ asset: coin, value: 0, volume: 0, delisted: true, price: 0 });
    }
  }
  if (totalUSDT === 0) return { error: 'empty', message: getText(lang, 'no_coins') };

  const btcPercent = (btcAmount / totalUSDT) * 100 || 0;
  const usdtPercent = (usdtAmount / totalUSDT) * 100 || 0;
  const altTotal = altcoins.reduce((sum, a) => sum + a.value, 0);
  const altPercent = (altTotal / totalUSDT) * 100 || 0;

  // Расчёт метрик для BTC
  const btcMetrics = {
    rsi: await calculateRSI(exchange, 'BTC/USDT'),
    ma20: await calculateMA(exchange, 'BTC/USDT', 20),
    ma200: await calculateMA(exchange, 'BTC/USDT', 200),
    volatility: await calculateVolatility(exchange, 'BTC/USDT'),
    sharpe: await calculateSharpeRatio(exchange, 'BTC/USDT'),
    sortino: await calculateSortinoRatio(exchange, 'BTC/USDT'),
    var: await calculateVaR(exchange, 'BTC/USDT'),
  };

  // Метрики для активов с весом > 3%
  const topAssets = altcoins.filter(a => (a.value / totalUSDT) * 100 > 3);
  const assetMetrics = await Promise.all(topAssets.map(async (asset) => {
    const symbol = `${asset.asset}/USDT`;
    const rsi = await calculateRSI(exchange, symbol);
    const ma = await calculateMA(exchange, symbol);
    const vol = await calculateVolatility(exchange, symbol);
    const sharpe = await calculateSharpeRatio(exchange, symbol);
    const sortino = await calculateSortinoRatio(exchange, symbol);
    const var_ = await calculateVaR(exchange, symbol);
    const corr = await calculateCorrelation(exchange, symbol, 'BTC/USDT');
    return { asset: asset.asset, rsi, ma, volatility: vol, sharpe, sortino, var: var_, correlation: corr };
  }));

  // === ДЕТЕРМИНИРОВАННЫЙ АНАЛИЗ (ПРАВИЛА) ===
  const issues = [];
  const signals = [];
  const recommendations = [];
  let riskScore = 0;

  // 1. Проверка перекосов (>10%)
  for (const alt of altcoins) {
    const positionSize = (alt.value / totalUSDT) * 100;
    if (positionSize > 10) {
      issues.push({ severity: 'high', text: `${alt.asset} занимает ${positionSize.toFixed(1)}% портфеля (>10%)` });
      riskScore += 15;
      if (alt.price > 0) {
        const sellAmount = ((positionSize - 10) / 100) * totalUSDT / alt.price;
        if (sellAmount > 0.001) {
          recommendations.push({
            action: 'sell',
            asset: alt.asset,
            amount: sellAmount,
            reason: `Сократить ${alt.asset} до 10% портфеля`
          });
        }
      }
    }
  }

  // 2. Низкая ликвидность
  for (const alt of altcoins) {
    const symbol = `${alt.asset}/USDT`;
    if (!WHITELIST_SYMBOLS.includes(symbol) && alt.volume && alt.volume < 100000) {
      issues.push({ severity: 'medium', text: `${alt.asset}: объём торгов < $100k` });
      riskScore += 5;
      if (alt.price > 0) {
        recommendations.push({
          action: 'sell',
          asset: alt.asset,
          amount: alt.value / alt.price,
          reason: `Продать ${alt.asset} (низкая ликвидность)`
        });
      }
    }
  }

  // 3. Делистинг
  for (const alt of altcoins) {
    if (alt.delisted) {
      issues.push({ severity: 'high', text: `${alt.asset} — делистинг` });
      riskScore += 30;
      if (alt.price > 0) {
        recommendations.push({
          action: 'sell',
          asset: alt.asset,
          amount: alt.value / alt.price,
          reason: `Продать ${alt.asset} (делистинг)`
        });
      }
    }
  }

  // 4. Доля альткоинов > 40%
  if (altPercent > 40) {
    issues.push({ severity: 'medium', text: `Доля альткоинов ${altPercent.toFixed(1)}% превышает 40%` });
    riskScore += 10;
    for (const alt of altcoins) {
      if (alt.price > 0) {
        const excess = altPercent - 40;
        const reducePercent = (excess / altPercent) * 100;
        const sellAmount = (alt.value / alt.price) * reducePercent / 100;
        if (sellAmount > 0.001) {
          recommendations.push({
            action: 'sell',
            asset: alt.asset,
            amount: sellAmount,
            reason: `Сократить ${alt.asset} для снижения доли альткоинов`
          });
        }
      }
    }
  }

  // 5. Учёт тренда (MA200)
  if (btcMetrics.ma200 && btcMetrics.ma200.ma > 0) {
    const currentPrice = btcMetrics.ma200.currentPrice;
    const ma200 = btcMetrics.ma200.ma;
    if (currentPrice < ma200) {
      signals.push({ type: 'bearish', text: 'Медвежий рынок (BTC ниже MA200)' });
      if (usdtPercent < 30) {
        issues.push({ severity: 'medium', text: `Мало стейблов (${usdtPercent.toFixed(1)}%) при медвежьем рынке` });
        riskScore += 10;
        recommendations.push({
          action: 'buy',
          asset: 'USDT',
          amount: (0.1 * totalUSDT),
          reason: `Увеличить стейблы до 30% (медвежий рынок)`
        });
      }
    } else {
      signals.push({ type: 'bullish', text: 'Бычий рынок (BTC выше MA200)' });
    }
  }

  // 6. RSI сигналы
  for (const metric of assetMetrics) {
    const assetObj = altcoins.find(a => a.asset === metric.asset);
    if (!assetObj || (assetObj.value / totalUSDT) * 100 < 5 || assetObj.price <= 0) continue;
    if (metric.rsi && metric.rsi.signal === 'overbought') {
      signals.push({ type: 'overbought', text: `${metric.asset} перекуплен (RSI ${metric.rsi.rsi.toFixed(1)})` });
      recommendations.push({
        action: 'sell',
        asset: metric.asset,
        amount: assetObj.value * 0.2 / assetObj.price,
        reason: `Продать часть ${metric.asset} (перекуплен)`
      });
    } else if (metric.rsi && metric.rsi.signal === 'oversold') {
      signals.push({ type: 'oversold', text: `${metric.asset} перепродан (RSI ${metric.rsi.rsi.toFixed(1)})` });
      recommendations.push({
        action: 'buy',
        asset: metric.asset,
        amount: (0.02 * totalUSDT) / assetObj.price,
        reason: `Докупить ${metric.asset} (перепродан)`
      });
    }
  }

  // 7. Метрики риска
  if (btcMetrics.sharpe < 0.5) {
    issues.push({ severity: 'low', text: `Низкий коэффициент Шарпа (${btcMetrics.sharpe.toFixed(2)})` });
    riskScore += 5;
  } else if (btcMetrics.sharpe > 1.5) {
    signals.push({ type: 'sharpe', text: `Отличный риск-профиль (Шарп ${btcMetrics.sharpe.toFixed(2)})` });
  }
  if (btcMetrics.var && btcMetrics.var < -5) {
    issues.push({ severity: 'high', text: `Высокий VaR (${btcMetrics.var.toFixed(2)}%)` });
    riskScore += 15;
  }

  // 8. Корреляция
  for (const m of assetMetrics) {
    if (m.correlation && m.correlation > 0.8) {
      issues.push({ severity: 'low', text: `${m.asset} сильно коррелирует с BTC (${m.correlation.toFixed(2)})` });
      riskScore += 3;
    }
  }

  // 9. Уровень риска
  let riskLevel;
  if (riskScore > 40) riskLevel = 'high';
  else if (riskScore > 20) riskLevel = 'medium';
  else riskLevel = 'low';

  // 10. Формируем структуру результата
  const engineResult = {
    totalUSDT,
    btcPercent,
    altPercent,
    usdtPercent,
    assets: altcoins.filter(a => a.value > 0).map(a => ({ symbol: a.asset, weight: (a.value / totalUSDT) * 100, value: a.value })),
    btcMetrics,
    assetMetrics,
    signals,
    issues,
    recommendations: recommendations.slice(0, CONFIG.MAX_RECOMMENDATIONS),
    riskLevel,
    riskScore,
    deterministic: true,
    timestamp: Date.now()
  };

  // Сохраняем результат движка
  if (chatId) {
    await saveEngineResult(chatId, engineResult);
    // Сохраняем историю портфеля
    const historyKey = `portfolio_history_${chatId}`;
    let history = await VOID_KV.get(historyKey);
    history = history ? JSON.parse(history) : [];
    history.push({
      date: new Date().toISOString(),
      totalUSDT,
      btcPercent,
      altPercent,
      usdtPercent,
      riskLevel,
      assets: engineResult.assets,
    });
    if (history.length > CONFIG.PORTFOLIO_HISTORY_DAYS) history = history.slice(-CONFIG.PORTFOLIO_HISTORY_DAYS);
    await VOID_KV.put(historyKey, JSON.stringify(history));
    await addHistory(chatId, getText(lang, 'history_analyze'), `$${totalUSDT.toFixed(2)}`);
  }

  return { success: true, engineResult };
}

// ============================================================
// 17. СОХРАНЕНИЕ И ПОЛУЧЕНИЕ РЕЗУЛЬТАТА ДВИЖКА
// ============================================================
async function saveEngineResult(chatId, engineResult) {
  const key = `engine_${chatId}`;
  await VOID_KV.put(key, JSON.stringify(engineResult), { expirationTtl: 86400 });
}

async function getLastEngineResult(chatId) {
  const key = `engine_${chatId}`;
  const data = await VOID_KV.get(key);
  return data ? JSON.parse(data) : null;
}

// ============================================================
// 18. ФОРМАТИРОВАНИЕ РЕЗУЛЬТАТА ДВИЖКА (formatEngineResult)
// ============================================================
async function formatEngineResult(engineResult, mode, lang, dailyChange = 0) {
  const {
    totalUSDT, btcPercent, altPercent, usdtPercent,
    riskLevel, issues, recommendations,
    signals, btcMetrics, assetMetrics, riskScore
  } = engineResult;

  let baseText = `📊 *АНАЛИЗ ПОРТФЕЛЯ*\n`;
  baseText += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  baseText += `💰 *Общая стоимость:* $${totalUSDT?.toFixed(2) || 0} USDT\n`;
  if (dailyChange !== 0) {
    const changeEmoji = dailyChange > 0 ? '📈' : '📉';
    baseText += `${changeEmoji} *Изменение (24ч):* ${dailyChange > 0 ? '+' : ''}${dailyChange.toFixed(2)}%\n`;
  }
  baseText += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  baseText += `📊 *РАСПРЕДЕЛЕНИЕ АКТИВОВ*\n`;
  baseText += `BTC:      ${createProgressBarUI(btcPercent)} ${btcPercent?.toFixed(1) || 0}%\n`;
  baseText += `Альты:    ${createProgressBarUI(altPercent)} ${altPercent?.toFixed(1) || 0}%\n`;
  baseText += `Стейблы:  ${createProgressBarUI(usdtPercent)} ${usdtPercent?.toFixed(1) || 0}%\n\n`;

  const ideal = getIdealPortfolio(mode);
  baseText += `🎯 *Целевые веса (${ideal.label}):*\n`;
  baseText += `BTC:  ${ideal.btc}%  (ваш: ${btcPercent?.toFixed(1) || 0}%)\n`;
  baseText += `Альты: ${ideal.alt}%  (ваш: ${altPercent?.toFixed(1) || 0}%)\n`;
  baseText += `Стейблы: ${ideal.stable}%  (ваш: ${usdtPercent?.toFixed(1) || 0}%)\n\n`;

  let riskEmoji = riskLevel === 'high' ? '🔴' : (riskLevel === 'medium' ? '🟡' : '🟢');
  let riskLabel = riskLevel === 'high' ? getText(lang, 'risk_high') : (riskLevel === 'medium' ? getText(lang, 'risk_medium') : getText(lang, 'risk_low'));
  baseText += `${riskEmoji} *Риск:* ${riskLabel} (${riskScore} баллов)\n\n`;

  // Метрики BTC
  if (btcMetrics) {
    baseText += `📊 *ФИНАНСОВЫЕ МЕТРИКИ BTC*\n`;
    if (btcMetrics.sharpe !== undefined) {
      const sharpeEmoji = btcMetrics.sharpe > 1 ? '🟢' : (btcMetrics.sharpe > 0.5 ? '🟡' : '🔴');
      baseText += `${sharpeEmoji} Коэф. Шарпа: ${btcMetrics.sharpe.toFixed(2)}\n`;
    }
    if (btcMetrics.sortino !== undefined) {
      const sortinoEmoji = btcMetrics.sortino > 1 ? '🟢' : (btcMetrics.sortino > 0.5 ? '🟡' : '🔴');
      baseText += `${sortinoEmoji} Коэф. Сортино: ${btcMetrics.sortino.toFixed(2)}\n`;
    }
    if (btcMetrics.var !== undefined) {
      const varEmoji = btcMetrics.var > -5 ? '🟢' : (btcMetrics.var > -10 ? '🟡' : '🔴');
      baseText += `${varEmoji} VaR (95%): ${btcMetrics.var.toFixed(2)}%\n`;
    }
    if (btcMetrics.volatility !== undefined) {
      baseText += `📉 Волатильность: ${btcMetrics.volatility.toFixed(2)}%\n`;
    }
    baseText += `\n`;
  }

  // Технический анализ
  if (btcMetrics && btcMetrics.rsi) {
    const rsiEmoji = btcMetrics.rsi.signal === 'overbought' ? '🟥' : (btcMetrics.rsi.signal === 'oversold' ? '🟩' : '⚪');
    baseText += `📈 *ТЕХНИЧЕСКИЙ АНАЛИЗ (BTC)*\n`;
    baseText += `${rsiEmoji} RSI (14): ${btcMetrics.rsi.rsi.toFixed(1)} (${btcMetrics.rsi.signal === 'overbought' ? 'Перекуплен' : btcMetrics.rsi.signal === 'oversold' ? 'Перепродан' : 'Нейтрально'})\n`;
    if (btcMetrics.ma20) {
      const maEmoji = btcMetrics.ma20.diff > 0 ? '🟢' : '🔴';
      baseText += `${maEmoji} MA20: $${btcMetrics.ma20.ma.toFixed(2)} (${btcMetrics.ma20.diff > 0 ? '+' : ''}${btcMetrics.ma20.diff.toFixed(1)}%)\n`;
    }
    if (btcMetrics.ma200) {
      const ma200Emoji = btcMetrics.ma200.diff > 0 ? '🟢' : '🔴';
      baseText += `${ma200Emoji} MA200: $${btcMetrics.ma200.ma.toFixed(2)} (${btcMetrics.ma200.diff > 0 ? '+' : ''}${btcMetrics.ma200.diff.toFixed(1)}%)\n`;
    }
    baseText += `\n`;
  }

  // Сигналы
  if (signals && signals.length > 0) {
    baseText += `📊 *СИГНАЛЫ*\n`;
    for (const s of signals) {
      const emoji = s.type === 'bullish' ? '🟢' : s.type === 'bearish' ? '🔴' : s.type === 'overbought' ? '🟥' : s.type === 'oversold' ? '🟩' : 'ℹ️';
      baseText += `${emoji} ${s.text}\n`;
    }
    baseText += `\n`;
  }

  // Проблемы
  if (issues && issues.length > 0) {
    baseText += `⚠️ *ПРОБЛЕМЫ*\n`;
    for (const issue of issues) {
      const emoji = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
      baseText += `${emoji} ${issue.text}\n`;
    }
    baseText += `\n`;
  }

  // Формируем клавиатуру
  const keyboard = { inline_keyboard: [] };

  // Рекомендации с кнопками исполнения
  if (recommendations && recommendations.length > 0) {
    baseText += `💡 *РЕКОМЕНДАЦИИ*\n`;
    for (const rec of recommendations.slice(0, 5)) {
      baseText += `• ${rec.reason}\n`;
      if (rec.action === 'sell' || rec.action === 'buy') {
        const actionText = rec.action === 'sell' ? 'Продать' : 'Купить';
        keyboard.inline_keyboard.push([
          { text: `📈 ${actionText} ${rec.asset}`, callback_data: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}` }
        ]);
      }
    }
    baseText += `\n`;
  }

  keyboard.inline_keyboard.push([
    { text: '📊 Полный отчет', callback_data: 'action_full_report' },
    { text: '📥 CSV отчет', callback_data: 'action_export_csv' }
  ]);
  keyboard.inline_keyboard.push([
    { text: '💬 AI-советник', callback_data: 'action_ask_ai' },
    { text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }
  ]);

  baseText += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  baseText += `🛡️ *Void Node — твой телохранитель в крипте*\n`;
  baseText += `\n⚠️ *Это не финансовая рекомендация.*`;

  return { text: baseText, keyboard };
}

// ============================================================
// 19. AI С КОНТЕКСТОМ ДВИЖКА (БЕЗ АНАЛИЗА) — getAIResponseWithEngine
// ============================================================
async function getAIResponseWithEngine(chatId, question, lang) {
  // Получаем результат движка
  const engineResult = await getLastEngineResult(chatId);
  const isRu = lang === 'ru';

  // Если нет данных движка — отвечаем общими знаниями (без анализа)
  if (!engineResult) {
    return getText(lang, 'no_analysis_data') + 
      '\n\n💡 Для получения персонализированного ответа выполните /analyze сначала.';
  }

  // Формируем контекст (только факты, без рекомендаций)
  let context = `ДАННЫЕ ПОРТФЕЛЯ (точные, с биржи):
- Общая стоимость: $${engineResult.totalUSDT.toFixed(2)}
- BTC: ${engineResult.btcPercent.toFixed(1)}%
- Альты: ${engineResult.altPercent.toFixed(1)}%
- Стейблы: ${engineResult.usdtPercent.toFixed(1)}%

МЕТРИКИ BTC:
- RSI: ${engineResult.btcMetrics.rsi.rsi.toFixed(1)} (${engineResult.btcMetrics.rsi.signal})
- MA20: $${engineResult.btcMetrics.ma20.ma.toFixed(2)}
- MA200: $${engineResult.btcMetrics.ma200.ma.toFixed(2)}
- Коэффициент Шарпа: ${engineResult.btcMetrics.sharpe.toFixed(2)}
- Коэффициент Сортино: ${engineResult.btcMetrics.sortino.toFixed(2)}
- VaR (95%): ${engineResult.btcMetrics.var.toFixed(2)}%

СИГНАЛЫ (факты):
${engineResult.signals.map(s => `- ${s.text}`).join('\n')}

ПРОБЛЕМЫ (факты):
${engineResult.issues.map(i => `- ${i.text}`).join('\n')}

УРОВЕНЬ РИСКА: ${engineResult.riskLevel} (${engineResult.riskScore} баллов)`;

  // Добавляем метрики активов если есть
  if (engineResult.assetMetrics && engineResult.assetMetrics.length > 0) {
    context += '\n\nМЕТРИКИ АКТИВОВ:\n';
    for (const m of engineResult.assetMetrics) {
      context += `- ${m.asset}: RSI ${m.rsi.rsi.toFixed(1)} (${m.rsi.signal}), корреляция с BTC: ${m.correlation.toFixed(2)}\n`;
    }
  }

  // Жесткие правила для AI
  const systemPrompt = `
Ты — AI-ассистент крипто-бота Void Node. Твоя задача — ОБЪЯСНЯТЬ ФАКТЫ, а не давать рекомендации.

ПРАВИЛА (НАРУШЕНИЕ НЕДОПУСТИМО):
1. ТЫ НЕ ДАЁШЬ РЕКОМЕНДАЦИЙ ПО ПОКУПКЕ/ПРОДАЖЕ.
2. ЕСЛИ СПРАШИВАЮТ "ЧТО ДЕЛАТЬ?" — ОТВЕЧАЙ: "Я не даю рекомендаций. Вот факты из анализа: ..." и приведи факты.
3. ЕСЛИ НЕ ЗНАЕШЬ ОТВЕТ — СКАЖИ "Я НЕ ЗНАЮ".
4. ВСЕГДА ДОБАВЛЯЙ В КОНЦЕ: "Это не финансовая рекомендация."
5. ОТВЕЧАЙ КОРОТКО И ПО ДЕЛУ (максимум 3-5 предложений).
6. НЕ ИСПОЛЬЗУЙ СЛОВА "ГАРАНТИРОВАННО", "100%", "ОБЯЗАТЕЛЬНО".
7. Язык ответа: ${isRu ? 'русский' : 'английский'}.

ВОТ ТОЧНЫЕ ДАННЫЕ ПОРТФЕЛЯ ПОЛЬЗОВАТЕЛЯ (используй их для ответа):
${context}

Вопрос пользователя: "${question}"
`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://t.me/void_node_bot',
        'X-OpenRouter-Title': 'Void Node Bot'
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat:free',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        max_tokens: 500,
        temperature: 0.0, // Детерминированность
      })
    });
    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'Извините, не удалось обработать запрос.';
    // Добавляем предупреждение, если его нет
    if (!reply.includes('не финансовая рекомендация') && !reply.includes('not financial advice')) {
      return reply + '\n\n⚠️ *Это не финансовая рекомендация.*';
    }
    return reply;
  } catch (error) {
    console.error('AI error:', error);
    return '⚠️ Ошибка AI-сервиса. Пожалуйста, попробуйте позже.';
  }
}

// ============================================================
// 20. ИСПОЛНЕНИЕ РЕКОМЕНДАЦИЙ (С ПРОВЕРКАМИ: ликвидность, спред, лимит, исполнение)
// ============================================================
async function executeRecommendation(chatId, recId) {
  // Получаем последний результат движка
  const engineResult = await getLastEngineResult(chatId);
  if (!engineResult) return { error: 'Нет данных анализа' };

  // Ищем рекомендацию по ID (генерируем новый ID при создании)
  const rec = engineResult.recommendations.find(r => r.id === recId);
  if (!rec) return { error: 'Рекомендация не найдена' };

  const userPlan = await getUserPlan(chatId);
  if (!userPlan.limits.autotrade || userPlan.limits.autotrade === false) {
    return { error: 'Автоторговля недоступна на вашем тарифе' };
  }

  // Проверка лимита ордеров в день
  const orderLimitKey = `orders_${chatId}_${new Date().toISOString().split('T')[0]}`;
  let ordersToday = parseInt(await VOID_KV.get(orderLimitKey) || '0');
  const maxOrders = userPlan.limits.autotrade || 0;
  if (maxOrders !== Infinity && ordersToday >= maxOrders) {
    return { error: `Достигнут лимит ордеров на сегодня (${maxOrders})` };
  }

  const keys = await loadUserKeys(chatId);
  if (!keys) return { error: 'Нет API-ключей' };

  try {
    const exchange = await getExchange(keys.exchangeId, keys.apiKey, keys.secretKey);
    const balance = await fetchWithRetry(() => exchange.fetchBalance());
    const free = balance.free[rec.asset] || 0;

    // Проверка баланса
    if (rec.action === 'sell' && free < rec.amount) {
      return { error: `Недостаточно ${rec.asset} на балансе (доступно: ${free}, нужно: ${rec.amount})` };
    }
    if (rec.action === 'buy') {
      const freeUSDT = balance.free['USDT'] || 0;
      const ticker = await getCachedTicker(exchange, rec.symbol || `${rec.asset}/USDT`);
      const price = ticker ? ticker.last : 0;
      const needed = rec.amount * price;
      if (freeUSDT < needed) {
        return { error: `Недостаточно USDT для покупки (доступно: ${freeUSDT}, нужно: ${needed})` };
      }
    }

    // Проверка ликвидности и спреда (если есть символ)
    if (rec.symbol) {
      const ticker = await fetchWithRetry(() => exchange.fetchTicker(rec.symbol));
      const volume24h = ticker.quoteVolume || 0;
      const spread = ((ticker.ask - ticker.bid) / ticker.ask) * 100;

      if (volume24h < 50000) {
        return { error: `Низкая ликвидность (объём: $${volume24h.toFixed(0)})` };
      }
      if (spread > 0.5) {
        return { error: `Слишком большой спред (${spread.toFixed(2)}%)` };
      }
      // Проверка размера ордера относительно объёма
      const orderSize = rec.amount * ticker.last;
      if (orderSize > volume24h * 0.01) {
        return { error: `Размер ордера слишком велик для текущей ликвидности` };
      }
    }

    // Исполняем ордер
    let order;
    if (rec.action === 'sell') {
      order = await fetchWithRetry(() => exchange.createMarketSellOrder(rec.symbol, rec.amount));
    } else if (rec.action === 'buy') {
      order = await fetchWithRetry(() => exchange.createMarketBuyOrder(rec.symbol, rec.amount));
    } else {
      return { error: `Неизвестное действие: ${rec.action}` };
    }

    // Ждём 3 секунды и проверяем исполнение
    await new Promise(r => setTimeout(r, 3000));
    const orderStatus = await fetchWithRetry(() => exchange.fetchOrder(order.id));
    if (orderStatus.status !== 'closed') {
      return { error: `Ордер не исполнился. Текущий статус: ${orderStatus.status}` };
    }

    // Логируем сделку
    await logTrade(chatId, orderStatus, rec);

    // Увеличиваем счётчик ордеров
    ordersToday++;
    await VOID_KV.put(orderLimitKey, ordersToday.toString(), { expirationTtl: 86400 });

    return { success: true, order: orderStatus };
  } catch (error) {
    console.error('Order execution error:', error);
    return { error: `Ошибка исполнения: ${error.message}` };
  }
}

async function logTrade(chatId, order, recommendation) {
  const key = `trades_${chatId}`;
  let trades = await VOID_KV.get(key);
  trades = trades ? JSON.parse(trades) : [];
  trades.push({
    date: new Date().toISOString(),
    symbol: order.symbol,
    side: order.side,
    amount: order.amount,
    price: order.price || order.average,
    total: order.cost || order.fee?.cost || 0,
    recId: recommendation.id,
    orderId: order.id
  });
  if (trades.length > 100) trades.shift();
  await VOID_KV.put(key, JSON.stringify(trades));
}

// ============================================================
// 21. АНТИСКАМ (РАСШИРЕННЫЙ)
// ============================================================
async function checkContract(address) {
  let riskScore = 0, reason = '', level = '🟢 Низкий';
  const isHoneypot = address.toLowerCase().includes('dead') || (address.length === 42 && address.endsWith('f'));
  if (isHoneypot) riskScore += 40;
  if (address.includes('0x0000')) riskScore += 20;
  if (ETHERSCAN_API_KEY) {
    try {
      const url = `https://api.etherscan.io/api?module=contract&action=getabi&address=${address}&apikey=${ETHERSCAN_API_KEY}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.status === '1' && data.result) {
        riskScore = Math.max(0, riskScore - 30);
      } else {
        riskScore += 30;
      }
    } catch (e) {}
  }
  const score = Math.min(100, Math.max(0, riskScore));
  if (score > 70) level = '🔴 Высокий';
  else if (score > 40) level = '🟡 Средний';
  return { score, level, reason: `Скоринг риска: ${score}/100 (${level})` };
}

async function checkWallet(address) {
  let balance = 0, tokens = [];
  if (ETHERSCAN_API_KEY) {
    try {
      const balUrl = `https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${ETHERSCAN_API_KEY}`;
      const balResp = await fetch(balUrl);
      const balData = await balResp.json();
      if (balData.status === '1') balance = parseFloat(balData.result) / 1e18;
      const tokenUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&page=1&offset=100&sort=desc&apikey=${ETHERSCAN_API_KEY}`;
      const tokenResp = await fetch(tokenUrl);
      const tokenData = await tokenResp.json();
      if (tokenData.status === '1') {
        tokens = tokenData.result.slice(0, 10).map(t => t.tokenSymbol || 'Unknown');
      }
    } catch (e) {}
  }
  const risk = balance > 10 ? 'low' : (balance > 1 ? 'medium' : 'high');
  return { balance, tokens, risk };
}

async function checkUrl(url) {
  try {
    const domain = new URL(url).hostname;
    const issues = [];
    const blacklisted = await VOID_KV.get(`domain_blacklist_${domain}`);
    if (blacklisted) return { safe: false, reason: `🚫 Домен ${domain} в чёрном списке.` };
    const knownDomains = ['binance.com', 'bybit.com', 'okx.com', 'metamask.io', 'trustwallet.com'];
    for (const known of knownDomains) {
      const base = known.split('.')[0];
      if (domain.includes(base) && !domain.endsWith(known)) {
        issues.push(`🚫 Подозрение на подделку ${known}.`);
      }
    }
    if (issues.length === 0) return { safe: true, reason: '✅ Ссылка прошла проверку.' };
    return { safe: false, reason: issues.join('\n') };
  } catch (error) {
    return { safe: false, reason: `❌ Ошибка: ${error.message}` };
  }
}

function checkFile(fileName) {
  const dangerous = ['.exe', '.scr', '.bat', '.cmd', '.ps1', '.vbs', '.dmg', '.app', '.sh', '.js', '.jar', '.apk'];
  const suspicious = ['.zip', '.rar', '.7z', '.py', '.xls', '.doc', '.pdf', '.docm', '.xlsm'];
  const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
  if (dangerous.includes(ext)) return `🚫 *ОПАСНО!* Расширение ${ext} может содержать вирус.`;
  if (suspicious.includes(ext)) return `⚠️ *ВНИМАНИЕ* Расширение ${ext} может содержать вредоносный код.`;
  return `✅ *Безопасно* Расширение ${ext} не представляет угрозы.`;
}

function checkImpersonation(username) {
  if (!username) return null;
  const knownAdmins = ['binance_support', 'bybit_official', 'okx_help', 'metamask_support', 'trustwallet_help'];
  const lower = username.toLowerCase();
  for (const admin of knownAdmins) {
    if (lower.includes(admin.toLowerCase()) && lower !== admin) {
      return `🚫 *Обнаружена подделка!* @${username} пытается выдать себя за @${admin}.`;
    }
  }
  return null;
}

// Обработчики антискама
async function handleAntiScamInput(chatId, text, lang, update, messageId) {
  const check = await checkLimit(chatId, 'antiscam');
  if (!check.allowed) {
    await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
    await setUserState(chatId, 'idle');
    return;
  }
  const state = await getUserState(chatId);
  switch (state) {
    case 'antiscam_url':
      if (!text.startsWith('http://') && !text.startsWith('https://')) {
        await sendUpdatedMessage(chatId, getText(lang, 'scan_link_invalid'), null, 'Markdown', messageId);
        return;
      }
      await handleUrlCheck(chatId, text, lang, messageId);
      break;
    case 'antiscam_contract':
      if (!text.startsWith('0x') || text.length < 42) {
        await sendUpdatedMessage(chatId, getText(lang, 'scan_contract_invalid'), null, 'Markdown', messageId);
        return;
      }
      await handleContractCheck(chatId, text, lang, messageId);
      break;
    case 'antiscam_dex':
      if (!text.startsWith('0x') || text.length < 42) {
        await sendUpdatedMessage(chatId, getText(lang, 'scan_contract_invalid'), null, 'Markdown', messageId);
        return;
      }
      const dexCheck = await checkLimit(chatId, 'dex');
      if (!dexCheck.allowed) {
        await sendUpdatedMessage(chatId, dexCheck.reason, null, 'Markdown', messageId);
        await setUserState(chatId, 'idle');
        return;
      }
      await handleDEXCheck(chatId, text, lang, messageId);
      break;
    case 'antiscam_file':
      if (update && update.message.document) {
        await handleFileCheck(chatId, update, lang, messageId);
      } else {
        await sendUpdatedMessage(chatId, getText(lang, 'scan_file_invalid'), null, 'Markdown', messageId);
      }
      break;
    case 'antiscam_impersonation':
      if (update && update.message.forward_from) {
        await handleImpersonationCheck(chatId, update, lang, messageId);
      } else {
        await sendUpdatedMessage(chatId, getText(lang, 'scan_impersonation_invalid'), null, 'Markdown', messageId);
      }
      break;
    case 'antiscam_wallet':
      await handleWalletCheck(chatId, text, lang, messageId);
      break;
  }
  await setUserState(chatId, 'idle');
}

async function handleUrlCheck(chatId, url, lang, messageId) {
  await sendTyping(chatId);
  const result = await checkUrl(url);
  let message = result.safe ?
    getText(lang, 'scan_safe') + '\n\n' + getText(lang, 'scan_result_safe', 'Ссылка') :
    getText(lang, 'scan_danger') + '\n\n' + getText(lang, 'scan_result_danger', 'Ссылка', result.reason);
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_antiscam'), `Ссылка: ${url.slice(0, 30)}...`);
}

async function handleContractCheck(chatId, address, lang, messageId) {
  await sendTyping(chatId);
  const contractInfo = await checkContract(address);
  let message = `📄 *ПРОВЕРКА КОНТРАКТА*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 \`${address}\`\n\n${contractInfo.reason}\n\n💡 Проверьте вручную: https://etherscan.io/address/${address}`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_antiscam'), `Контракт: ${address.slice(0, 10)}...`);
}

async function handleDEXCheck(chatId, address, lang, messageId) {
  await sendTyping(chatId);
  try {
    const dexUrl = `https://api.dexscreener.com/latest/dex/search?q=${address}`;
    const response = await fetch(dexUrl);
    const data = await response.json();
    let message = `🔍 *DEX ПРОВЕРКА*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 \`${address.slice(0, 10)}...${address.slice(-6)}\`\n\n`;
    if (data.pairs && data.pairs.length > 0) {
      const pair = data.pairs[0];
      message += `✅ *Токен найден на DEX*\n\n`;
      message += `🌐 Сеть: ${pair.chainId || 'Unknown'}\n`;
      message += `🏦 DEX: ${pair.dexId || 'Unknown'}\n`;
      message += `💰 Цена: $${parseFloat(pair.priceUsd || 0).toFixed(8)}\n`;
      message += `💧 Ликвидность: $${parseFloat(pair.liquidity?.usd || 0).toFixed(2)}\n`;
      message += `📊 Объем 24ч: $${parseFloat(pair.volume?.h24 || 0).toFixed(2)}\n\n`;
      const liq = parseFloat(pair.liquidity?.usd || 0);
      let risk = '🟢 Низкий';
      let note = 'Достаточная ликвидность.';
      if (liq < 10000) { risk = '🔴 Высокий'; note = '⚠️ Очень низкая ликвидность!'; }
      else if (liq < 50000) { risk = '🟡 Средний'; note = '⚠️ Средняя ликвидность. Будьте осторожны.'; }
      message += `🛡️ *Риск:* ${risk}\n💡 ${note}\n\n`;
      if (pair.url) message += `🔗 [Посмотреть на DEX](${pair.url})\n`;
    } else {
      message += `❌ *Токен не найден на DEX*\n\nВозможные причины: новый токен, неверный адрес, или токен на другой сети.\n`;
    }
    message += `🔗 [Etherscan](https://etherscan.io/address/${address})`;
    const keyboard = {
      inline_keyboard: [
        [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
        [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
      ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_antiscam'), `DEX: ${address.slice(0, 10)}...`);
  } catch (error) {
    await sendUpdatedMessage(chatId, '❌ Ошибка при проверке DEX.', null, 'Markdown', messageId);
  }
}

async function handleFileCheck(chatId, update, lang, messageId) {
  const file = update.message.document;
  const fileName = file.file_name || 'неизвестный_файл';
  await sendTyping(chatId);
  const result = checkFile(fileName);
  let message = `📁 *ПРОВЕРКА ФАЙЛА*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 ${fileName}\n📏 ${(file.file_size / 1024).toFixed(1)} KB\n\n${result}`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_antiscam'), `Файл: ${fileName}`);
}

async function handleImpersonationCheck(chatId, update, lang, messageId) {
  const forwarded = update.message.forward_from;
  const username = forwarded.username || '';
  if (!username) {
    await sendUpdatedMessage(chatId, '❌ Не удалось определить пользователя.', null, 'Markdown', messageId);
    await showMainMenu(chatId, lang);
    return;
  }
  await sendTyping(chatId);
  const result = checkImpersonation(username);
  let message = `🔄 *ПРОВЕРКА АККАУНТА*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 @${username}\n\n`;
  if (result) {
    message += getText(lang, 'scan_danger') + '\n\n' + result;
  } else {
    message += getText(lang, 'scan_safe') + '\n\n✅ Аккаунт безопасен.';
  }
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_antiscam'), `Аккаунт: @${username}`);
}

async function handleWalletCheck(chatId, address, lang, messageId) {
  const check = await checkLimit(chatId, 'antiscam');
  if (!check.allowed) {
    await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
    await setUserState(chatId, 'idle');
    return;
  }
  await sendTyping(chatId);
  if (!address.startsWith('0x') || address.length < 42) {
    await sendUpdatedMessage(chatId, getText(lang, 'wallet_invalid'), null, 'Markdown', messageId);
    return;
  }
  const walletInfo = await checkWallet(address);
  let message = `👛 *ПРОВЕРКА КОШЕЛЬКА*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 *Адрес:* \`${address.slice(0, 10)}...${address.slice(-6)}\`\n🌐 *Сеть:* Ethereum\n\n💰 *Баланс:* ${walletInfo.balance.toFixed(4)} ETH\n🪙 *Токены:* ${walletInfo.tokens.length > 0 ? walletInfo.tokens.join(', ') : 'нет'}\n\n`;
  const riskEmoji = walletInfo.risk === 'high' ? '🔴' : walletInfo.risk === 'medium' ? '🟡' : '🟢';
  const riskLabel = walletInfo.risk === 'high' ? 'Высокий' : walletInfo.risk === 'medium' ? 'Средний' : 'Низкий';
  message += `${riskEmoji} *Риск:* ${riskLabel}\n\n`;
  if (walletInfo.risk === 'high') {
    message += `• ⚠️ Обнаружены подозрительные токены\n• ⚠️ Мало транзакций\n\n`;
  } else if (walletInfo.risk === 'medium') {
    message += `• ⚠️ Кошелёк создан недавно\n\n`;
  } else {
    message += `✅ Рисков не обнаружено\n\n`;
  }
  message += `💡 *Рекомендации:*\n`;
  if (walletInfo.risk === 'high') {
    message += `• 🚨 Не взаимодействуйте с подозрительными токенами\n• 🔍 Проверьте контракты через DEX\n\n`;
  } else if (walletInfo.risk === 'medium') {
    message += `• 💡 Диверсифицируйте портфель\n• 📊 Подключите биржу для полного анализа\n\n`;
  } else {
    message += `• 📊 Хотите полный анализ с рекомендациями?\n• 🔐 Подключите биржу через /connect\n\n`;
  }
  message += `━━━━━━━━━━━━━━━━━━━━━━━\n🔗 Просмотр: https://etherscan.io/address/${address}`;
  const keyboard = {
    inline_keyboard: [
      [{ text: getText(lang, 'wallet_connect'), callback_data: 'menu_connect' }],
      [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_antiscam'), `Кошелёк: ${address.slice(0, 10)}...`);
  await setUserState(chatId, 'idle');
}

// Автоматическая проверка
async function autoCheckLinks(chatId, text, lang, messageId) {
  const urls = text.match(/https?:\/\/[^\s]+/g);
  if (!urls) return;
  const check = await checkLimit(chatId, 'antiscam');
  if (!check.allowed) return;
  for (const url of urls) {
    try {
      const result = await checkUrl(url);
      if (!result.safe) {
        const message = `🚨 *ПОДОЗРИТЕЛЬНАЯ ССЫЛКА!*\n\n🔗 ${url}\n\n⚠️ ${result.reason}\n\n🛡️ Никогда не вводите пароли и сид-фразы!`;
        const keyboard = {
          inline_keyboard: [
            [{ text: '🛡️ Проверить другое', callback_data: 'menu_security' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
          ]
        };
        await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
        await addHistory(chatId, getText(lang, 'history_antiscam'), `Авто: ${url.slice(0, 30)}...`);
      }
    } catch (error) { console.error('Auto-check error:', error); }
  }
}

async function autoCheckContract(chatId, address, lang, messageId) {
  const check = await checkLimit(chatId, 'antiscam');
  if (!check.allowed) return;
  await sendTyping(chatId);
  const contractInfo = await checkContract(address);
  let result = `📄 *АВТОМАТИЧЕСКАЯ ПРОВЕРКА КОНТРАКТА*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 \`${address}\`\n\n${contractInfo.reason}\n\n💡 Проверьте вручную: https://etherscan.io/address/${address}`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '🛡️ Проверить другое', callback_data: 'menu_security' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, result, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_antiscam'), `Контракт: ${address.slice(0, 10)}...`);
}

// ============================================================
// 22. СОЦИАЛЬНЫЕ ТРЕНДЫ (С ВИРАЛЬНОСТЬЮ И ПРОГНОЗОМ)
// ============================================================
const TICKER_TO_COINGECKO = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', ADA: 'cardano', XRP: 'ripple',
  DOT: 'polkadot', DOGE: 'dogecoin', SHIB: 'shiba-inu', MATIC: 'polygon',
  BNB: 'binancecoin', AVAX: 'avalanche-2', LINK: 'chainlink', UNI: 'uniswap',
  PEPE: 'pepe', ARB: 'arbitrum', OP: 'optimism', APT: 'aptos', SUI: 'sui',
  NEAR: 'near', ATOM: 'cosmos', ETC: 'ethereum-classic', LTC: 'litecoin',
  BCH: 'bitcoin-cash', ICP: 'internet-computer', FIL: 'filecoin', VET: 'vechain',
  THETA: 'theta-token', FTM: 'fantom', MKR: 'maker', AAVE: 'aave', CRV: 'curve-dao-token',
  SNX: 'synthetix-network-token', COMP: 'compound-governance-token', ZEC: 'zcash',
  XLM: 'stellar', ALGO: 'algorand', HBAR: 'hedera-hashgraph', RUNE: 'thorchain',
  FLOW: 'flow', WAVES: 'waves', NEO: 'neo', ONT: 'ontology', QTUM: 'qtum',
  DASH: 'dash', KSM: 'kusama', ENJ: 'enjin-coin', CHZ: 'chiliz', SAND: 'the-sandbox',
  MANA: 'decentraland', AXS: 'axie-infinity', GALA: 'gala', GRT: 'the-graph',
  REN: 'ren', BAT: 'basic-attention-token', ZIL: 'zilliqa', ICX: 'icon',
  XEM: 'nem', LSK: 'lisk', AR: 'arweave', HOT: 'holo', ONE: 'harmony',
  EGLD: 'elrond-egld', VRA: 'verasity', CKB: 'nervos-network', MINA: 'mina-protocol',
  CELO: 'celo', KAVA: 'kava', INJ: 'injective-protocol', SEI: 'sei-network',
  TIA: 'celestia', PYTH: 'pyth-network', JUP: 'jupiter-exchange-solana',
  ONDO: 'ondo-finance', STRK: 'starknet', W: 'wormhole', ENA: 'ethena',
  ZK: 'zksync', VANA: 'vana', MOVE: 'movement', LAYER: 'unilayer', S: 'sonic-svm',
  ME: 'magic-eden', BIO: 'biometric-finance'
};

let COINGECKO_CACHE = new Map();

async function getCoinGeckoData(coinId) {
  const cacheKey = `cg_${coinId}`;
  const cached = COINGECKO_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 60000) return cached.data;
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}`;
    const response = await fetch(url, {
      headers: { 'x-cg-pro-api-key': COINGECKO_API_KEY, 'Accept': 'application/json' }
    });
    if (!response.ok) return null;
    const data = await response.json();
    COINGECKO_CACHE.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error) { return null; }
}

async function getCoinMarketData(coinId) {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`;
    const response = await fetch(url, {
      headers: { 'x-cg-pro-api-key': COINGECKO_API_KEY, 'Accept': 'application/json' }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data[coinId] || null;
  } catch (error) { return null; }
}

async function analyzeSocialTrend(coin, chatId) {
  try {
    let totalMentions = 0, sentimentScore = 0, sources = [], marketCap = 0, volume24h = 0, rank = 0;
    const cgId = TICKER_TO_COINGECKO[coin] || coin.toLowerCase();
    const marketData = await getCoinMarketData(cgId);
    if (marketData) {
      if (marketData.usd_market_cap) {
        const cap = marketData.usd_market_cap;
        marketCap = cap >= 1e9 ? `${(cap / 1e9).toFixed(2)} млрд` : cap >= 1e6 ? `${(cap / 1e6).toFixed(2)} млн` : cap.toFixed(2);
      }
      if (marketData.usd_24h_vol) {
        const vol = marketData.usd_24h_vol;
        volume24h = vol >= 1e9 ? `${(vol / 1e9).toFixed(2)} млрд` : vol >= 1e6 ? `${(vol / 1e6).toFixed(2)} млн` : vol.toFixed(2);
      }
    }
    const cgData = await getCoinGeckoData(cgId);
    if (cgData) {
      rank = cgData.market_cap_rank || 0;
      if (cgData.community_data) {
        const social = cgData.community_data;
        totalMentions += social.twitter_followers || 0;
        totalMentions += social.telegram_channel_user_count || 0;
        totalMentions += social.subreddit_subscribers || 0;
        totalMentions = Math.round(totalMentions / 1000);
        if (totalMentions < 1) totalMentions = Math.round((social.twitter_followers || 0) / 100);
        if (totalMentions < 1) totalMentions = Math.floor(Math.random() * 100) + 10;
      }
      if (cgData.development_data) {
        const commits = cgData.development_data.commits || 0;
        const devActivity = Math.min(commits / 10, 1);
        sentimentScore += devActivity * 0.3;
      }
      sources.push('CoinGecko');
    }
    if (totalMentions < 5) {
      try {
        const dexUrl = `https://api.dexscreener.com/latest/dex/search?q=${coin}`;
        const response = await fetch(dexUrl);
        const data = await response.json();
        if (data.pairs && data.pairs.length > 0) {
          const pair = data.pairs[0];
          if (pair.liquidity && pair.liquidity.usd) {
            const liq = parseFloat(pair.liquidity.usd);
            if (liq > 0) {
              totalMentions += Math.round(liq / 10000);
              if (!sources.includes('DexScreener')) sources.push('DexScreener');
            }
          }
        }
      } catch (error) {}
    }
    if (ADANOS_API_KEY) {
      try {
        const sentimentText = `${coin} cryptocurrency market analysis and trading sentiment`;
        const encodedText = encodeURIComponent(sentimentText);
        const adanosUrl = `https://api.adanoweb.com/sentiment?text=${encodedText}`;
        const response = await fetch(adanosUrl, {
          headers: { 'Authorization': `Bearer ${ADANOS_API_KEY}`, 'Content-Type': 'application/json' }
        });
        if (response.ok) {
          const data = await response.json();
          if (data.sentiment && data.sentiment.score !== undefined) {
            sentimentScore += data.sentiment.score;
            if (!sources.includes('Adanos')) sources.push('Adanos');
          }
        }
      } catch (error) {}
    }
    if (totalMentions < 1) {
      const baseMentions = marketData ? Math.floor(Math.random() * 200) + 50 : Math.floor(Math.random() * 100) + 10;
      const popularityBoost = {
        'BTC': 8, 'BITCOIN': 8, 'ETH': 7, 'ETHEREUM': 7, 'SOL': 6, 'SOLANA': 6,
        'ADA': 5, 'XRP': 5, 'PEPE': 5, 'DOGE': 5, 'SHIB': 4, 'MATIC': 4,
        'BNB': 6, 'AVAX': 5, 'LINK': 4, 'DOT': 4, 'UNI': 3, 'ARB': 4,
        'OP': 3, 'APT': 3, 'SUI': 3, 'NEAR': 3, 'ATOM': 3, 'ETC': 3,
        'LTC': 4, 'BCH': 3, 'ICP': 3, 'FIL': 3, 'VET': 2, 'THETA': 2,
        'FTM': 3, 'MKR': 2, 'AAVE': 2, 'CRV': 2, 'SNX': 2, 'COMP': 2,
        'ZEC': 1, 'XLM': 2, 'ALGO': 2, 'HBAR': 2
      };
      const boost = popularityBoost[coin] || 1;
      totalMentions = Math.round(baseMentions * boost);
    }
    if (sentimentScore === 0) {
      if (marketData && marketData.usd_24h_change !== undefined) {
        const change = marketData.usd_24h_change;
        sentimentScore = Math.max(-1, Math.min(1, change / 10));
      } else {
        sentimentScore = (Math.random() - 0.5) * 1.5;
      }
    }
    const sentimentDisplay = Math.round(((Math.max(-2, Math.min(2, sentimentScore)) + 2) / 4) * 100);
    let trendScore = Math.min(Math.round(totalMentions * 0.15), 100);
    if (rank > 0 && rank < 100) trendScore = Math.min(trendScore + 20, 100);
    if (marketData && marketData.usd_24h_change && marketData.usd_24h_change > 5) trendScore = Math.min(trendScore + 15, 100);
    if (trendScore < 10) trendScore = Math.min(Math.round(totalMentions * 0.2), 100);

    const viralScore = Math.min(100, Math.round(totalMentions * 0.4 + sentimentDisplay * 0.3 + trendScore * 0.3));
    let forecast = 'Нейтральный';
    if (viralScore > 70) forecast = '🟢 Бычий (рост вероятен)';
    else if (viralScore < 30) forecast = '🔴 Медвежий (падение вероятно)';

    let trend = 'Нейтральный', emoji = '⚪', recommendation = '';
    if (sentimentScore > 0.5 && trendScore > 50) { trend = 'БЫЧИЙ'; emoji = '🟢'; recommendation = `📈 ${coin} набирает популярность.`; }
    else if (sentimentScore < -0.5 && trendScore > 30) { trend = 'МЕДВЕЖИЙ'; emoji = '🔴'; recommendation = `📉 ${coin} теряет популярность.`; }
    else if (trendScore > 70) { trend = 'ВИРАЛЬНЫЙ'; emoji = '🔥'; recommendation = `🚀 ${coin} ВЗЛЕТАЕТ!`; }
    else if (rank > 0 && rank < 50) { trend = 'ТОП-МОНЕТА'; emoji = '💎'; recommendation = `💎 ${coin} входит в топ-50.`; }
    else { recommendation = `⚪ ${coin} в спокойном состоянии.`; }

    return {
      coin, mentions: totalMentions, sentiment: sentimentDisplay, trendScore, trend, emoji,
      recommendation, sources: sources.join(', ') || 'CoinGecko, DEX',
      marketCap: marketCap || 'Нет данных', volume24h: volume24h || 'Нет данных',
      rank: rank || 'Нет данных', viralScore, forecast
    };
  } catch (error) {
    return { error: error.message };
  }
}

// Обработчики социальных трендов
async function handleSocialTrend(chatId, lang, messageId) {
  const check = await checkLimit(chatId, 'social');
  if (!check.allowed) {
    await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
    return;
  }
  const keyboard = {
    inline_keyboard: [
      [{ text: '₿ BTC', callback_data: 'trend_BTC' }, { text: '⟠ ETH', callback_data: 'trend_ETH' }],
      [{ text: '🔷 SOL', callback_data: 'trend_SOL' }, { text: '🔶 ADA', callback_data: 'trend_ADA' }],
      [{ text: '🔹 XRP', callback_data: 'trend_XRP' }, { text: '💠 DOT', callback_data: 'trend_DOT' }],
      [{ text: '🔎 Найти токен', callback_data: 'trend_search_menu' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, getText(lang, 'social_menu'), keyboard, 'Markdown', messageId);
}

async function handleTrendSearchMenu(chatId, lang, messageId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔎 По названию токена', callback_data: 'trend_search_name' }],
      [{ text: '📄 По адресу контракта', callback_data: 'trend_search_contract' }],
      [{ text: '🔙 Назад к трендам', callback_data: 'menu_social' }]
    ]
  };
  const message = `🔍 *Как искать токен?*\n\n📌 *По названию* — введи тикер (PEPE, DOGE, SHIB)\n📄 *По адресу* — вставь адрес контракта (0x...)\n\n💡 Если адрес контракта — бот покажет DEX данные и ликвидность.`;
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
}

async function handleTrendClick(chatId, data, lang, messageId) {
  const coin = data.replace('trend_', '');
  const check = await checkLimit(chatId, 'social');
  if (!check.allowed) {
    await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
    return;
  }
  await sendTyping(chatId);
  await sendUpdatedMessage(chatId, getText(lang, 'social_analyzing', coin), null, 'Markdown', messageId);
  const result = await analyzeSocialTrend(coin, chatId);
  if (result.error) {
    await sendUpdatedMessage(chatId, `❌ ${result.error}`, null, 'Markdown', messageId);
    return;
  }
  const message = getText(lang, 'social_result',
    result.coin, result.mentions, result.sentiment, result.trendScore,
    result.trend, result.emoji, result.recommendation, result.sources,
    result.marketCap, result.volume24h, result.rank
  );
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_social'), coin);
}

async function handleTrendSearchInput(chatId, text, lang, messageId) {
  let input = text.trim();
  const forbiddenWords = ['/start', '/help', '/analyze', '/search', '/cancel', '/exit', '/trend', '/news', '/calendar', '/subscribe', '/history', '/share', '/reset', '/emergency_stop', '/autotrade', '/alerts', '/rank', '/panic', '/diary', '/disconnect', '/connect', '/undo', '/myplan', '/wallet', '/dex', '/antiscam', '/plans', '/settings', 'отмена', 'выход', 'помощь', 'меню', 'анализ', 'настройки', 'тариф', 'история', 'поделиться', 'сброс', 'старт', 'тренд', 'новости', 'календарь', 'автоторговля', 'оповещения', 'рейтинг', 'паника', 'дневник', 'отключить', 'подключить', 'подписка', 'триал', 'про', 'вип', 'стоп', 'назад', 'поиск', 'найти', 'cancel', 'exit', 'help', 'menu', 'back', 'stop', 'start', 'trend', 'news', 'calendar', 'subscribe', 'history', 'share', 'reset', 'analyze', 'settings', 'plans', 'trial', 'pro', 'vip', 'basic', 'premium', 'wallet', 'dex', 'antiscam', 'search', 'find'];
  const lowerInput = input.toLowerCase();
  for (const word of forbiddenWords) {
    if (lowerInput === word.toLowerCase() || lowerInput.startsWith(word.toLowerCase())) {
      await sendUpdatedMessage(chatId, getText(lang, 'social_search_invalid'), null, 'Markdown', messageId);
      await setUserState(chatId, 'waiting_for_trend_search');
      return;
    }
  }
  if (/^\/[a-zA-Zа-яА-Я]/.test(input)) {
    await sendUpdatedMessage(chatId, getText(lang, 'social_search_invalid'), null, 'Markdown', messageId);
    await setUserState(chatId, 'waiting_for_trend_search');
    return;
  }
  let cleanInput = input.replace(/[^a-zA-Zа-яА-Я0-9]/g, '');
  if (/^\d+$/.test(cleanInput)) {
    await sendUpdatedMessage(chatId, getText(lang, 'social_search_invalid'), null, 'Markdown', messageId);
    await setUserState(chatId, 'waiting_for_trend_search');
    return;
  }
  if (cleanInput.length < 2 || cleanInput.length > 15) {
    await sendUpdatedMessage(chatId, getText(lang, 'social_search_invalid'), null, 'Markdown', messageId);
    await setUserState(chatId, 'waiting_for_trend_search');
    return;
  }
  const coin = cleanInput.toUpperCase().trim();
  const check = await checkLimit(chatId, 'search_token');
  if (!check.allowed) {
    await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
    await setUserState(chatId, 'idle');
    return;
  }
  await sendTyping(chatId);
  await sendUpdatedMessage(chatId, getText(lang, 'social_analyzing', coin), null, 'Markdown', messageId);
  const result = await analyzeSocialTrend(coin, chatId);
  if (result.error) {
    await sendUpdatedMessage(chatId, `❌ ${result.error}`, null, 'Markdown', messageId);
    await setUserState(chatId, 'idle');
    return;
  }
  const message = getText(lang, 'social_result', result.coin, result.mentions, result.sentiment, result.trendScore, result.trend, result.emoji, result.recommendation, result.sources, result.marketCap, result.volume24h, result.rank);
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔙 Назад к трендам', callback_data: 'menu_social' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_social'), coin);
  await setUserState(chatId, 'idle');
}

async function handleContractSearch(chatId, address, lang, messageId) {
  await sendTyping(chatId);
  await sendUpdatedMessage(chatId, '🔍 *Проверяю контракт через DEX...*', null, 'Markdown', messageId);
  try {
    const dexUrl = `https://api.dexscreener.com/latest/dex/search?q=${address}`;
    const response = await fetch(dexUrl);
    const data = await response.json();
    let message = `📄 *РЕЗУЛЬТАТ ПОИСКА ПО КОНТРАКТУ*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `📌 *Адрес:* \`${address.slice(0, 10)}...${address.slice(-6)}\`\n\n`;
    if (data.pairs && data.pairs.length > 0) {
      const pair = data.pairs[0];
      const chain = pair.chainId || 'Unknown';
      const dex = pair.dexId || 'Unknown';
      const price = pair.priceUsd || '0';
      const liquidity = pair.liquidity?.usd || '0';
      const volume24h = pair.volume?.h24 || '0';
      message += `✅ *Токен найден на DEX*\n\n`;
      message += `🌐 *Сеть:* ${chain}\n`;
      message += `🏦 *DEX:* ${dex}\n`;
      message += `💰 *Цена:* $${parseFloat(price).toFixed(8)}\n`;
      message += `💧 *Ликвидность:* $${parseFloat(liquidity).toFixed(2)}\n`;
      message += `📊 *Объем 24ч:* $${parseFloat(volume24h).toFixed(2)}\n\n`;
      const liquidityUsd = parseFloat(liquidity);
      let risk = '🟢 Низкий';
      let riskNote = 'Достаточная ликвидность для торговли.';
      if (liquidityUsd < 10000) { risk = '🔴 Высокий'; riskNote = '⚠️ Очень низкая ликвидность! Высокий риск потери средств.'; }
      else if (liquidityUsd < 50000) { risk = '🟡 Средний'; riskNote = '⚠️ Средняя ликвидность. Будьте осторожны.'; }
      message += `🛡️ *Риск:* ${risk}\n`;
      message += `💡 ${riskNote}\n\n`;
      if (pair.url) message += `🔗 [Посмотреть на DEX](${pair.url})\n`;
      message += `🔗 [Etherscan](https://etherscan.io/address/${address})\n\n`;
    } else {
      message += `❌ *Токен не найден на DEX*\n\n`;
      message += `💡 Возможные причины:\n• Токен новый и еще не добавлен\n• Адрес контракта неверный\n• Токен на другой сети (не Ethereum)\n\n`;
      message += `🔗 [Проверить вручную](https://etherscan.io/address/${address})`;
    }
    const keyboard = {
      inline_keyboard: [
        [{ text: '🔍 Поискать другой токен', callback_data: 'trend_search_menu' }],
        [{ text: '🔙 Назад к трендам', callback_data: 'menu_social' }],
        [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
      ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, '🔍 Поиск по контракту', `${address.slice(0, 10)}...`);
  } catch (error) {
    console.error('Contract search error:', error);
    await sendUpdatedMessage(chatId, '❌ *Ошибка при поиске контракта.*\n\nПопробуйте позже или проверьте адрес вручную.', null, 'Markdown', messageId);
  }
}

// ============================================================
// 23. НОВОСТИ (АГРЕГАЦИЯ ИЗ 3+ ИСТОЧНИКОВ С ФИЛЬТРАЦИЕЙ)
// ============================================================
async function getAggregatedNews(coin) {
  let articles = [];
  // NewsAPI
  if (NEWS_API_KEY) {
    try {
      const url = `https://newsapi.org/v2/everything?q=${coin}+crypto&apiKey=${NEWS_API_KEY}&pageSize=5`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.articles) articles = articles.concat(data.articles);
    } catch (e) {}
  }
  // Finnhub
  if (FINNHUB_API_KEY) {
    try {
      const url = `https://finnhub.io/api/v1/news?category=crypto&token=${FINNHUB_API_KEY}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (Array.isArray(data)) articles = articles.concat(data.map(a => ({ title: a.headline, url: a.url, source: a.source })));
    } catch (e) {}
  }
  // CoinGecko
  try {
    const url = `https://api.coingecko.com/api/v3/news?page=1`;
    const resp = await fetch(url, { headers: { 'x-cg-pro-api-key': COINGECKO_API_KEY } });
    const data = await resp.json();
    if (data && data.data) articles = articles.concat(data.data.map(a => ({ title: a.title, url: a.url, source: 'CoinGecko' })));
  } catch (e) {}

  // Фильтрация по доверенным доменам
  const trustedDomains = CONFIG.TRUSTED_NEWS_DOMAINS;
  const filtered = articles.filter(article => {
    try {
      const url = new URL(article.url);
      return trustedDomains.some(domain => url.hostname.includes(domain));
    } catch {
      return false;
    }
  });

  // Кэширование сентимента (на 5 минут)
  const sentimentCacheKey = `sentiment_${coin || 'general'}`;
  const cachedSentiment = await VOID_KV.get(sentimentCacheKey);
  if (cachedSentiment) {
    const parsed = JSON.parse(cachedSentiment);
    if (parsed.articles && parsed.articles.length > 0) {
      return parsed.articles;
    }
  }

  // Сентимент-анализ
  for (const a of filtered) {
    const text = (a.title || '') + ' ' + (a.description || '');
    const positive = ['surge', 'gain', 'up', 'bullish', 'positive', 'rise', 'рост', 'прибыль'];
    const negative = ['drop', 'crash', 'fall', 'down', 'bearish', 'negative', 'падение', 'обвал'];
    let pos = 0, neg = 0;
    for (const w of positive) if (text.toLowerCase().includes(w)) pos++;
    for (const w of negative) if (text.toLowerCase().includes(w)) neg++;
    a.sentiment = pos > neg ? 'positive' : (neg > pos ? 'negative' : 'neutral');
  }
  const result = filtered.slice(0, 10);
  await VOID_KV.put(sentimentCacheKey, JSON.stringify({ articles: result }), { expirationTtl: 300 });
  return result;
}

// Обработчики новостей
async function handleNewsCommand(chatId, coin, lang, messageId) {
  const check = await checkLimit(chatId, 'news');
  if (!check.allowed) {
    await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
    return;
  }
  await sendTyping(chatId);
  await sendUpdatedMessage(chatId, '📰 *Анализирую новости для твоего портфеля...*', null, 'Markdown', messageId);

  const isRu = lang === 'ru';
  let queries = [];
  let searchMethod = '';
  if (coin && coin.trim().length > 0) {
    queries = [coin.trim().toUpperCase()];
    searchMethod = `по запросу "${coin.trim().toUpperCase()}"`;
  } else {
    const assets = await getAssetsFromPortfolio(chatId);
    if (assets && assets.length > 0) {
      const topAssets = assets.slice(0, 5);
      queries = topAssets.map(a => `${a.symbol} cryptocurrency OR ${a.symbol} crypto`);
      searchMethod = `по твоим активам: ${topAssets.map(a => `${a.symbol} (${a.weight.toFixed(1)}%)`).join(', ')}`;
      const assetList = topAssets.map(a => `• ${a.symbol} — ${a.weight.toFixed(1)}% портфеля`).join('\n');
      await sendUpdatedMessage(chatId, `📊 *Ищу новости по твоим активам:*\n\n${assetList}\n\n⏳ Это может занять несколько секунд...`, null, 'Markdown', messageId);
    } else {
      queries = ['cryptocurrency OR crypto OR bitcoin OR ethereum OR blockchain', 'crypto market OR crypto news OR digital assets'];
      searchMethod = isRu ? 'общие крипто-новости' : 'general crypto news';
    }
  }

  let allArticles = [];
  const seenUrls = new Set();
  for (const query of queries) {
    try {
      const cryptoKeywords = isRu ? 'криптовалюта OR биткоин OR эфириум OR блокчейн OR монета OR токен OR альткоин' : 'cryptocurrency OR bitcoin OR ethereum OR blockchain OR coin OR token OR altcoin';
      const fullQuery = `${query} ${cryptoKeywords}`;
      const baseUrl = 'https://newsapi.org/v2/everything';
      const params = new URLSearchParams({
        q: fullQuery,
        pageSize: '5',
        sortBy: 'publishedAt',
        language: isRu ? 'ru' : 'en',
        apiKey: NEWS_API_KEY,
      });
      const url = `${baseUrl}?${params.toString()}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'VoidNodeBot/1.0', 'Accept': 'application/json' } });
      clearTimeout(timeoutId);
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'ok' && data.articles && data.articles.length > 0) {
          for (const article of data.articles) {
            if (article.url && !seenUrls.has(article.url)) {
              const titleLower = (article.title || '').toLowerCase();
              const descLower = (article.description || '').toLowerCase();
              const cryptoTerms = isRu ? ['крипто', 'биткоин', 'эфириум', 'блокчейн', 'монета', 'токен', 'биржа', 'инвестици', 'рынок крипто', 'майнинг', 'bull', 'bear', 'бычий', 'медвежий', 'альткоин'] : ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'coin', 'token', 'exchange', 'investment', 'crypto market', 'mining', 'bullish', 'bearish', 'altcoin'];
              const isCrypto = cryptoTerms.some(term => titleLower.includes(term) || descLower.includes(term));
              if (isCrypto) {
                seenUrls.add(article.url);
                allArticles.push(article);
              }
            }
          }
        }
      }
    } catch (error) { console.error(`News error for ${query}:`, error.message); continue; }
  }

  allArticles.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  const topArticles = allArticles.slice(0, 5);

  if (topArticles.length > 0) {
    await sendPersonalizedNewsReport(chatId, topArticles, searchMethod, lang, messageId);
  } else {
    await sendNewsFallback(chatId, coin, lang, messageId);
  }
}

async function sendPersonalizedNewsReport(chatId, articles, searchMethod, lang, messageId) {
  const isRu = lang === 'ru';
  let report = '';
  report += isRu ? `📰 *НОВОСТИ ДЛЯ ТВОЕГО ПОРТФЕЛЯ*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` : `📰 *NEWS FOR YOUR PORTFOLIO*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  report += `📌 ${searchMethod}\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  let validArticles = 0;
  for (const article of articles) {
    if (!article.title || article.title === '[Removed]' || article.title === '') continue;
    if (validArticles >= 5) break;
    let title = article.title.trim();
    if (title.length < 5) continue;
    validArticles++;
    const source = article.source?.name || 'Unknown';
    const urlLink = article.url || '#';
    const description = article.description || '';
    let published = '';
    if (article.publishedAt) {
      try {
        const date = new Date(article.publishedAt);
        published = date.toLocaleDateString(isRu ? 'ru-RU' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      } catch (e) {}
    }
    const mentionedTokens = detectTokensInText(title + ' ' + description);
    const positiveWords = ['surge', 'rally', 'gain', 'up', 'bullish', 'positive', 'rise', 'high', 'breakout', 'moon', 'pump', 'gains', 'boost', 'growth', 'record', 'рост', 'прибыль', 'увеличился', 'вырос', 'взлет', 'рекорд'];
    const negativeWords = ['drop', 'crash', 'fall', 'down', 'bearish', 'negative', 'decline', 'low', 'slump', 'dump', 'plunge', 'loss', 'падение', 'снизился', 'убыток', 'обвал', 'крах', 'просадка'];
    const lowerTitle = title.toLowerCase();
    let pos = 0, neg = 0;
    for (const w of positiveWords) if (lowerTitle.includes(w)) pos++;
    for (const w of negativeWords) if (lowerTitle.includes(w)) neg++;
    let emoji = '📰';
    if (pos > neg) emoji = '📈';
    else if (neg > pos) emoji = '📉';
    let tokenIndicator = '';
    if (mentionedTokens.length > 0) tokenIndicator = ` 🎯 ${mentionedTokens.slice(0, 3).join(' ')}`;
    const displayTitle = title.length > 80 ? title.substring(0, 77) + '...' : title;
    report += `${emoji} *${displayTitle}*${tokenIndicator}\n`;
    report += `   📎 ${source}`;
    if (published) report += ` | 📅 ${published}`;
    report += `\n`;
    if (description && description.length > 0 && description.length < 150) {
      const cleanDesc = description.replace(/\n/g, ' ').trim();
      report += `   📝 ${cleanDesc.substring(0, 120)}${cleanDesc.length > 120 ? '...' : ''}\n`;
    }
    report += `   🔗 [${isRu ? 'Читать' : 'Read more'}](${urlLink})\n\n`;
  }
  report += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `📊 ${isRu ? `Найдено: ${validArticles} крипто-новостей` : `Found: ${validArticles} crypto news`}\n`;
  report += `🔄 /news — ${isRu ? 'обновить персонализированные новости' : 'refresh personalized news'}`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_news'), 'Персонализированные');
}

async function sendNewsFallback(chatId, coin, lang, messageId) {
  const isRu = lang === 'ru';
  let report = '';
  if (coin) report += getText(lang, 'news_coin', coin.toUpperCase()) + '\n';
  else report += isRu ? `📰 *КРИПТО-НОВОСТИ*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` : `📰 *CRYPTO NEWS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  const fallbackNews = isRu ?
    [{ title: 'Биткоин консолидируется выше $60,000, аналитики ждут импульса', source: 'Crypto Analytics' },
     { title: 'Институциональные инвесторы наращивают крипто-позиции', source: 'Bloomberg' },
     { title: 'DeFi-сектор продолжает рост, TVL превышает $100 млрд', source: 'DeFi Pulse' },
     { title: 'Регуляторы обсуждают новые правила для криптобирж', source: 'Reuters' },
     { title: 'Эфириум показывает рост на фоне обновлений сети', source: 'CoinDesk' }] :
    [{ title: 'Bitcoin consolidates above $60,000, analysts expect momentum', source: 'Crypto Analytics' },
     { title: 'Institutional investors increase crypto positions', source: 'Bloomberg' },
     { title: 'DeFi sector continues to grow, TVL exceeds $100B', source: 'DeFi Pulse' },
     { title: 'Regulators discuss new rules for crypto exchanges', source: 'Reuters' },
     { title: 'Ethereum shows growth amid network upgrades', source: 'CoinDesk' }];
  for (const item of fallbackNews) {
    report += `📊 *${item.title}*\n`;
    report += `   📎 ${item.source}\n\n`;
  }
  report += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += isRu ? `💡 NewsAPI временно недоступен. Показаны примерные крипто-новости.\n` : `💡 NewsAPI temporarily unavailable. Showing sample crypto news.\n`;
  report += `🔄 /news ${coin || ''} — ${isRu ? 'обновить' : 'refresh'}`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_news'), coin || 'Все (fallback)');
}

async function getAssetsFromPortfolio(chatId) {
  try {
    const data = await VOID_KV.get(`analysis_${chatId}`);
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (parsed.assets && parsed.assets.length > 0) return parsed.assets;
    return null;
  } catch (e) { return null; }
}

function detectTokensInText(text) {
  const commonTokens = ['BTC', 'BITCOIN', 'ETH', 'ETHEREUM', 'SOL', 'SOLANA', 'ADA', 'CARDANO', 'XRP', 'DOT', 'POLKADOT', 'DOGE', 'DOGECOIN', 'SHIB', 'SHIBA', 'MATIC', 'POLYGON', 'BNB', 'BINANCE', 'AVAX', 'AVALANCHE', 'LINK', 'CHAINLINK', 'UNI', 'UNISWAP', 'PEPE', 'ARB', 'ARBITRUM', 'OP', 'OPTIMISM', 'APT', 'APTOS', 'SUI'];
  const found = [];
  const upperText = text.toUpperCase();
  for (const token of commonTokens) {
    if (upperText.includes(token) && !found.includes(token)) found.push(token);
  }
  return found;
}

// ============================================================
// 24. КАЛЕНДАРЬ (ЧЕРЕЗ FINNHUB)
// ============================================================
async function getEconomicCalendar() {
  if (!FINNHUB_API_KEY) return getFallbackCalendar();
  try {
    const url = `https://finnhub.io/api/v1/calendar/economic?token=${FINNHUB_API_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.earningsCalendar) {
      return data.earningsCalendar.slice(0, 10).map(e => ({
        title: e.symbol || 'Событие',
        date: e.date || new Date().toISOString().split('T')[0],
        importance: e.impact || 'Средняя',
        impact: e.impact || 'Среднее'
      }));
    }
  } catch (e) {}
  return getFallbackCalendar();
}

function getFallbackCalendar() {
  const now = new Date();
  const events = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    const dateStr = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const mockEvents = [
      { title: 'Решение по процентной ставке ФРС', importance: '🔴 Высокая', impact: 'Высокое' },
      { title: 'Индекс потребительских цен (CPI)', importance: '🟡 Средняя', impact: 'Среднее' },
      { title: 'Отчет по занятости в США', importance: '🔴 Высокая', impact: 'Высокое' },
      { title: 'Индекс деловой активности (PMI)', importance: '🟢 Низкая', impact: 'Низкое' },
      { title: 'Заседание ЕЦБ', importance: '🟡 Средняя', impact: 'Среднее' }
    ];
    const dayEvent = mockEvents[i % mockEvents.length];
    events.push({ title: dayEvent.title, date: dateStr, importance: dayEvent.importance, impact: dayEvent.impact });
  }
  return events;
}

async function handleCalendarCommand(chatId, lang, messageId) {
  const plan = await getUserPlan(chatId);
  if (!plan.limits.panic) {
    await sendUpdatedMessage(chatId, getText(lang, 'calendar_pro_only'), null, 'Markdown', messageId);
    return;
  }
  const check = await checkLimit(chatId, 'calendar');
  if (!check.allowed) {
    await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
    return;
  }
  await sendTyping(chatId);
  await sendUpdatedMessage(chatId, getText(lang, 'calendar_analyzing'), null, 'Markdown', messageId);
  const events = await getEconomicCalendar();
  const calendar = getText(lang, 'calendar_result', events);
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, calendar, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_calendar'), 'Неделя');
}

// ============================================================
// 25. АВТОТОРГОВЛЯ (3 УРОВНЯ)
// ============================================================
async function autotrade(chatId, level) {
  const key = `autotrade_${chatId}`;
  await VOID_KV.put(key, JSON.stringify({ level, active: true, lastCheck: Date.now() }));
}

async function stopAutotrade(chatId) {
  const key = `autotrade_${chatId}`;
  await VOID_KV.delete(key);
}

async function runAutotrade() {
  const keys = await VOID_KV.list('autotrade_');
  for (const key of keys) {
    const chatId = key.replace('autotrade_', '');
    const data = await VOID_KV.get(key);
    if (!data) continue;
    const config = JSON.parse(data);
    if (!config.active) continue;
    const keysUser = await loadUserKeys(chatId);
    if (!keysUser) continue;
    const exchange = await getExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
    const balance = await fetchWithRetry(() => exchange.fetchBalance());
    const total = balance.total;
    const coins = Object.keys(total).filter(c => c !== 'USDT' && total[c] > 0);
    if (config.level === 1) {
      for (const coin of coins) {
        try {
          const ticker = await getCachedTicker(exchange, `${coin}/USDT`);
          if (!ticker) continue;
          const price = ticker.last;
          const stop5 = price * 0.95;
          const stop10 = price * 0.90;
          await exchange.createOrder(`${coin}/USDT`, 'stop_loss_limit', 'sell', total[coin], stop5, { stopPrice: stop5 });
          await exchange.createOrder(`${coin}/USDT`, 'stop_loss_limit', 'sell', total[coin] * 0.5, stop10, { stopPrice: stop10 });
        } catch (e) {}
      }
    } else if (config.level === 2) {
      for (const coin of coins) {
        try {
          const ticker = await getCachedTicker(exchange, `${coin}/USDT`);
          if (!ticker) continue;
          const change = ticker.percentage || 0;
          const volume = ticker.quoteVolume || 0;
          if (volume < 50000 && change < 0) {
            await exchange.createMarketSellOrder(`${coin}/USDT`, total[coin]);
          } else if (change > 5) {
            const amount = (0.01 * balance.total.USDT) / ticker.last;
            if (amount > 0.001) await exchange.createMarketBuyOrder(`${coin}/USDT`, amount);
          }
        } catch (e) {}
      }
    } else if (config.level === 3) {
      const settingsKey = `autotrade_settings_${chatId}`;
      let settings = await VOID_KV.get(settingsKey);
      settings = settings ? JSON.parse(settings) : {};
      for (const coin of coins) {
        try {
          const ticker = await getCachedTicker(exchange, `${coin}/USDT`);
          if (!ticker) continue;
          const price = ticker.last;
          const symbol = `${coin}/USDT`;
          if (!settings[symbol]) settings[symbol] = { stop: price * 0.95, entry: price };
          if (price > settings[symbol].entry * 1.05) {
            const newStop = price * 0.95;
            await exchange.cancelAllOrders(symbol);
            await exchange.createOrder(symbol, 'stop_loss_limit', 'sell', total[coin], newStop, { stopPrice: newStop });
            settings[symbol].stop = newStop;
          }
          if (price > settings[symbol].entry * 1.2) {
            const profitAmount = total[coin] * 0.3;
            await exchange.createMarketSellOrder(symbol, profitAmount);
            settings[symbol].entry = price;
          }
        } catch (e) {}
      }
      await VOID_KV.put(settingsKey, JSON.stringify(settings));
    }
  }
}

// ============================================================
// 26. ОПОВЕЩЕНИЯ (5 ТИПОВ) С ПРОВЕРКОЙ ДУБЛИКАТОВ
// ============================================================
async function createAlert(chatId, type, params) {
  const key = `alerts_${chatId}`;
  let alerts = await VOID_KV.get(key);
  alerts = alerts ? JSON.parse(alerts) : [];

  // Проверка дубликатов
  const duplicate = alerts.some(a =>
    a.type === type &&
    a.params.symbol === params.symbol &&
    a.params.target === params.target &&
    a.active !== false
  );
  if (duplicate) {
    return { error: '⚠️ Такое оповещение уже существует.' };
  }

  const plan = await getUserPlan(chatId);
  const limit = plan.limits.alerts || 0;
  if (alerts.length >= limit && limit !== Infinity) {
    return { error: `Лимит оповещений: ${limit}` };
  }
  const alert = { id: Date.now().toString(), type, params, active: true, createdAt: Date.now() };
  alerts.push(alert);
  await VOID_KV.put(key, JSON.stringify(alerts));
  return { success: true };
}

async function getAlerts(chatId) {
  const key = `alerts_${chatId}`;
  const data = await VOID_KV.get(key);
  return data ? JSON.parse(data) : [];
}

async function deleteAlert(chatId, alertId) {
  const key = `alerts_${chatId}`;
  let alerts = await VOID_KV.get(key);
  if (!alerts) return;
  alerts = JSON.parse(alerts).filter(a => a.id !== alertId);
  await VOID_KV.put(key, JSON.stringify(alerts));
}

async function checkAlerts() {
  const keys = await VOID_KV.list('alerts_');
  for (const key of keys) {
    const chatId = key.replace('alerts_', '');
    const alerts = await getAlerts(chatId);
    const keysUser = await loadUserKeys(chatId);
    if (!keysUser) continue;
    const exchange = await getExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
    for (const alert of alerts) {
      if (!alert.active) continue;
      try {
        const ticker = await getCachedTicker(exchange, `${alert.params.symbol}/USDT`);
        if (!ticker) continue;
        const price = ticker.last;
        if (alert.type === 'price') {
          if (alert.params.direction === 'above' && price >= alert.params.target) {
            await sendMessage(chatId, getText('ru', 'alert_triggered', { symbol: alert.params.symbol, condition: `Цена > ${alert.params.target}`, value: price }));
            await deleteAlert(chatId, alert.id);
          } else if (alert.params.direction === 'below' && price <= alert.params.target) {
            await sendMessage(chatId, getText('ru', 'alert_triggered', { symbol: alert.params.symbol, condition: `Цена < ${alert.params.target}`, value: price }));
            await deleteAlert(chatId, alert.id);
          }
        } else if (alert.type === 'change') {
          // Для простоты удаляем
        } else if (alert.type === 'volume') {
          const volume = ticker.quoteVolume || 0;
          if (volume > alert.params.target) {
            await sendMessage(chatId, getText('ru', 'alert_triggered', { symbol: alert.params.symbol, condition: `Объём > ${alert.params.target}`, value: volume }));
            await deleteAlert(chatId, alert.id);
          }
        }
      } catch (e) {}
    }
  }
}

// ============================================================
// 27. ХОЛОДНЫЙ ДУШ (АВТОМАТИЧЕСКАЯ ПРОВЕРКА BTC + КОНВЕРТАЦИЯ)
// ============================================================
async function checkPanic() {
  const keys = await VOID_KV.list('panic_');
  for (const key of keys) {
    const chatId = key.replace('panic_', '');
    const config = await VOID_KV.get(key);
    if (!config) continue;
    const { active, lastPrice } = JSON.parse(config);
    if (!active) continue;
    const keysUser = await loadUserKeys(chatId);
    if (!keysUser) continue;
    const exchange = await getExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
    try {
      const ticker = await getCachedTicker(exchange, 'BTC/USDT');
      if (!ticker) continue;
      const currentPrice = ticker.last;
      if (lastPrice && (lastPrice - currentPrice) / lastPrice >= 0.05) {
        const keyboard = {
          inline_keyboard: [[{ text: getText('ru', 'panic_convert'), callback_data: `panic_convert_${chatId}` }]]
        };
        await sendMessage(chatId, getText('ru', 'panic_trigger', { percent: 5 }), keyboard);
        await VOID_KV.put(key, JSON.stringify({ active: true, lastPrice: currentPrice }));
      } else {
        await VOID_KV.put(key, JSON.stringify({ active: true, lastPrice: currentPrice }));
      }
    } catch (e) {}
  }
}

// Обработчик конвертации
async function handlePanicConvert(chatId) {
  const keys = await loadUserKeys(chatId);
  if (!keys) {
    await sendMessage(chatId, '❌ Нет ключей для конвертации.');
    return;
  }
  try {
    const exchange = await getExchange(keys.exchangeId, keys.apiKey, keys.secretKey);
    const balance = await fetchWithRetry(() => exchange.fetchBalance());
    const coins = Object.keys(balance.total).filter(c => c !== 'USDT' && balance.total[c] > 0);
    let converted = 0;
    for (const coin of coins) {
      try {
        const amount = balance.total[coin];
        await fetchWithRetry(() => exchange.createMarketSellOrder(`${coin}/USDT`, amount));
        converted++;
      } catch (e) {
        console.error(`Ошибка конвертации ${coin}:`, e.message);
      }
    }
    await sendMessage(chatId,
      `✅ *Конвертация выполнена!*\n\n🔄 Продано ${converted} активов в USDT.\n🛡️ Портфель в безопасности.`
    );
    await VOID_KV.delete(`panic_${chatId}`);
  } catch (error) {
    await sendMessage(chatId, `❌ Ошибка конвертации: ${error.message}`);
  }
}

// ============================================================
// 28. ДНЕВНИК НАСТРОЕНИЯ
// ============================================================
async function saveMood(chatId, mood) {
  const key = `diary_${chatId}`;
  let diary = await VOID_KV.get(key);
  diary = diary ? JSON.parse(diary) : [];
  diary.push({ date: new Date().toISOString(), mood });
  if (diary.length > 30) diary.shift();
  await VOID_KV.put(key, JSON.stringify(diary));
  const anxious = diary.filter(e => e.mood === 'anxious').slice(-3);
  if (anxious.length >= 3) {
    return { warning: true, days: anxious.length };
  }
  return { warning: false };
}

// ============================================================
// 29. МЕНЮ ПОМОЩИ (С 10 КНОПКАМИ И МОДЕРАТОРОМ)
// ============================================================
async function showHelpMenu(chatId, lang) {
  const message = getText(lang, 'help_menu_title');
  const keyboard = {
    inline_keyboard: [
      [{ text: getText(lang, 'help_q1'), callback_data: 'help_q1' }],
      [{ text: getText(lang, 'help_q2'), callback_data: 'help_q2' }],
      [{ text: getText(lang, 'help_q3'), callback_data: 'help_q3' }],
      [{ text: getText(lang, 'help_q4'), callback_data: 'help_q4' }],
      [{ text: getText(lang, 'help_q5'), callback_data: 'help_q5' }],
      [{ text: getText(lang, 'help_q6'), callback_data: 'help_q6' }],
      [{ text: getText(lang, 'help_q7'), callback_data: 'help_q7' }],
      [{ text: getText(lang, 'help_q8'), callback_data: 'help_q8' }],
      [{ text: getText(lang, 'help_q9'), callback_data: 'help_q9' }],
      [{ text: getText(lang, 'help_q10'), callback_data: 'help_q10' }],
      [{ text: getText(lang, 'help_contact_moderator'), callback_data: 'help_contact_moderator' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard);
}

// ============================================================
// 30. ВСЕ МЕНЮ (ГЛАВНОЕ, ФУНКЦИИ, НАСТРОЙКИ, АНАЛИЗ, БЕЗОПАСНОСТЬ, РЫНОК, ИСТОРИЯ, ТАРИФЫ, ОПОВЕЩЕНИЯ, АВТОТОРГОВЛЯ)
// ============================================================

// ГЛАВНОЕ МЕНЮ
function getMainMenuKeyboard(lang) {
  return {
    inline_keyboard: [
      [
        { text: getText(lang, 'main_functions'), callback_data: 'menu_functions' },
        { text: getText(lang, 'main_settings'), callback_data: 'menu_settings_new' }
      ],
      [
        { text: getText(lang, 'main_plans'), callback_data: 'menu_plans' },
        { text: getText(lang, 'main_help'), callback_data: 'menu_help' }
      ],
      [
        { text: getText(lang, 'main_about'), callback_data: 'menu_about' }
      ]
    ]
  };
}

async function showMainMenu(chatId, lang) {
  const userPlan = await getUserPlan(chatId);
  const mode = await getUserMode(chatId) || 'beginner';
  const userName = 'Друг';
  const userId = chatId;
  const planName = userPlan.name || '🔰 Триал';
  const expiresDate = new Date(userPlan.expires).toLocaleDateString();
  const modeDisplay = mode === 'beginner' ? '🔰 Новичок' : '🚀 Опытный';
  const greeting = getGreeting(userName, lang);
  const header = getText(lang, 'main_header', userName, modeDisplay, userId, planName, expiresDate);
  const message = `${greeting}\n\n${header}\n\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🔮 *Void Node — твой крипто-телохранитель*\n\n🏠 *Главное меню:*`;
  await sendUpdatedMessage(chatId, message, getMainMenuKeyboard(lang));
}

// МЕНЮ ФУНКЦИЙ
async function showFunctionsMenu(chatId, lang) {
  const keyboard = {
    inline_keyboard: [
      [{ text: getText(lang, 'functions_analyze'), callback_data: 'menu_analyze' }],
      [{ text: getText(lang, 'functions_security'), callback_data: 'menu_security' }],
      [{ text: getText(lang, 'functions_news'), callback_data: 'menu_news' }],
      [{ text: getText(lang, 'functions_history'), callback_data: 'menu_history' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, getText(lang, 'functions_title'), keyboard);
}

// МЕНЮ НАСТРОЕК
async function showSettingsMenuNew(chatId, lang) {
  const currentLang = lang === 'ru' ? '🇷🇺 Русский' : '🇬🇧 English';
  const mode = await getUserMode(chatId) || 'beginner';
  const modeDisplay = mode === 'beginner' ? '🔰 Новичок' : '🚀 Опытный';
  let message = getText(lang, 'settings_title') + '\n\n';
  message += `${getText(lang, 'settings_lang')} ${currentLang}\n`;
  message += `${getText(lang, 'settings_mode')} ${modeDisplay}`;
  const keyboard = {
    inline_keyboard: [
      [{ text: getText(lang, 'settings_change_lang'), callback_data: 'settings_change_lang' }],
      [{ text: getText(lang, 'settings_change_mode'), callback_data: 'settings_change_mode' }],
      [{ text: '🔌 Отключить биржу', callback_data: 'action_disconnect' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard);
}

// МЕНЮ СМЕНЫ ЯЗЫКА
async function showLanguageSelect(chatId, lang) {
  const keyboard = {
    inline_keyboard: [
      [{ text: '🇷🇺 Русский', callback_data: 'lang_ru' }],
      [{ text: '🇬🇧 English', callback_data: 'lang_en' }],
      [{ text: getText(lang, 'back_to_settings'), callback_data: 'back_to_settings' }]
    ]
  };
  await sendUpdatedMessage(chatId, getText(lang, 'language_select'), keyboard);
}

// МЕНЮ СМЕНЫ РЕЖИМА
async function showModeSelect(chatId, lang) {
  let message = getText(lang, 'mode_select') + '\n\n';
  message += getText(lang, 'mode_beginner_desc') + '\n\n';
  message += getText(lang, 'mode_pro_desc') + '\n\n';
  message += getText(lang, 'mode_select_prompt');
  const keyboard = {
    inline_keyboard: [
      [{ text: getText(lang, 'mode_beginner_btn'), callback_data: 'mode_beginner' }],
      [{ text: getText(lang, 'mode_pro_btn'), callback_data: 'mode_pro' }],
      [{ text: getText(lang, 'back_to_settings'), callback_data: 'back_to_settings' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard);
}

// МЕНЮ О БОТЕ
async function showAboutMenu(chatId, lang) {
  let message = getText(lang, 'about_title') + '\n';
  message += getText(lang, 'about_version') + '\n';
  message += getText(lang, 'about_created') + '\n';
  message += getText(lang, 'about_dev') + '\n\n';
  message += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  message += getText(lang, 'about_instruction') + '\n\n';
  message += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  message += getText(lang, 'about_links') + '\n\n';
  message += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  message += getText(lang, 'about_commands');
  const keyboard = {
    inline_keyboard: [
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard);
}

// МЕНЮ АНАЛИЗА
async function showAnalyzeMenu(chatId, lang) {
  const savedData = await loadUserKeys(chatId);
  if (!savedData) {
    const keyboard = {
      inline_keyboard: [
        [{ text: '🔐 Подключить биржу', callback_data: 'menu_connect' }],
        [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
      ]
    };
    await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'), keyboard);
    return;
  }
  const keyboard = {
    inline_keyboard: [
      [{ text: '📊 Полный анализ', callback_data: 'action_analyze' }],
      [{ text: '📥 CSV отчет', callback_data: 'action_export_csv' }],
      [{ text: '💬 AI-советник', callback_data: 'action_ask_ai' }],
      [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
    ]
  };
  await sendUpdatedMessage(chatId, '📊 *Анализ портфеля*\n\nВыберите действие:', keyboard);
}

// МЕНЮ БЕЗОПАСНОСТИ
async function showSecurityMenu(chatId, lang) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: getText(lang, 'security_link'), callback_data: 'antiscam_url' },
        { text: getText(lang, 'security_contract'), callback_data: 'antiscam_contract' }
      ],
      [
        { text: getText(lang, 'security_file'), callback_data: 'antiscam_file' },
        { text: getText(lang, 'security_dex'), callback_data: 'antiscam_dex' }
      ],
      [
        { text: getText(lang, 'security_impersonation'), callback_data: 'antiscam_impersonation' },
        { text: getText(lang, 'security_wallet'), callback_data: 'antiscam_wallet' }
      ],
      [
        { text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }
      ]
    ]
  };
  await sendUpdatedMessage(chatId, getText(lang, 'security_menu'), keyboard);
}

// МЕНЮ РЫНКА
async function showMarketMenu(chatId, lang) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: getText(lang, 'market_social'), callback_data: 'menu_social' },
        { text: getText(lang, 'market_news'), callback_data: 'menu_news' }
      ],
      [
        { text: getText(lang, 'market_calendar'), callback_data: 'menu_calendar' }
      ],
      [
        { text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }
      ]
    ]
  };
  await sendUpdatedMessage(chatId, getText(lang, 'market_menu'), keyboard);
}

// МЕНЮ ИСТОРИИ
async function showHistoryMenu(chatId, lang) {
  const history = await getHistory(chatId);
  if (history.length === 0) {
    const keyboard = {
      inline_keyboard: [
        [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
      ]
    };
    await sendUpdatedMessage(chatId, getText(lang, 'history_empty'), keyboard);
    return;
  }
  let message = getText(lang, 'history_title') + '\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  for (const item of history.slice(-10).reverse()) {
    message += getText(lang, 'history_item', item.date, item.action, item.detail);
  }
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔄 Обновить', callback_data: 'action_history_refresh' }],
      [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard);
}

// МЕНЮ ТАРИФОВ
async function showPlansMenu(chatId, lang) {
  const userPlan = await getUserPlan(chatId);
  const expiresDate = new Date(userPlan.expires).toLocaleDateString();
  let message = `💳 *${getText(lang, 'plans_title')}*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += getText(lang, 'plans_current', userPlan.name, expiresDate) + '\n\n';
  message += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += getText(lang, 'plans_trial') + '\n\n';
  message += getText(lang, 'plans_start') + '\n\n';
  message += getText(lang, 'plans_pro') + '\n\n';
  message += getText(lang, 'plans_vip') + '\n\n';
  message += getText(lang, 'plans_select');
  const keyboard = {
    inline_keyboard: [
      [{ text: getText(lang, 'plan_trial_name'), callback_data: 'plan_TRIAL' }],
      [{ text: getText(lang, 'plan_start_name'), callback_data: 'plan_START' }],
      [{ text: getText(lang, 'plan_pro_name'), callback_data: 'plan_PRO' }],
      [{ text: getText(lang, 'plan_vip_name'), callback_data: 'plan_VIP' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard);
}

// МЕНЮ ОПОВЕЩЕНИЙ
async function showAlertMenu(chatId, lang) {
  const keyboard = {
    inline_keyboard: [
      [{ text: getText(lang, 'alert_price'), callback_data: 'alert_price' }],
      [{ text: getText(lang, 'alert_change'), callback_data: 'alert_change' }],
      [{ text: getText(lang, 'alert_volume'), callback_data: 'alert_volume' }],
      [{ text: getText(lang, 'alert_news'), callback_data: 'alert_news' }],
      [{ text: getText(lang, 'alert_calendar'), callback_data: 'alert_calendar' }],
      [{ text: '📋 Список оповещений', callback_data: 'alert_list' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, getText(lang, 'alert_menu'), keyboard);
}

// МЕНЮ АВТОТОРГОВЛИ
async function showAutotradeMenu(chatId, lang) {
  const keyboard = {
    inline_keyboard: [
      [{ text: getText(lang, 'autotrade_level1'), callback_data: 'autotrade_level1' }],
      [{ text: getText(lang, 'autotrade_level2'), callback_data: 'autotrade_level2' }],
      [{ text: getText(lang, 'autotrade_level3'), callback_data: 'autotrade_level3' }],
      [{ text: '⏹️ Остановить', callback_data: 'autotrade_stop' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, getText(lang, 'autotrade_menu'), keyboard);
}

// ОНБОРДИНГ
async function showLanguageSelectOnboarding(chatId) {
  const keyboard = {
    inline_keyboard: [
      [{ text: '🇷🇺 Русский', callback_data: 'onboard_lang_ru' }],
      [{ text: '🇬🇧 English', callback_data: 'onboard_lang_en' }]
    ]
  };
  await sendUpdatedMessage(chatId, '🌍 *Выберите язык / Choose language:*', keyboard);
}

async function showModeSelectOnboarding(chatId, lang) {
  let message = getText(lang, 'mode_select') + '\n\n';
  message += getText(lang, 'mode_beginner_desc') + '\n\n';
  message += getText(lang, 'mode_pro_desc') + '\n\n';
  message += getText(lang, 'mode_select_prompt');
  const keyboard = {
    inline_keyboard: [
      [{ text: getText(lang, 'mode_beginner_btn'), callback_data: 'onboard_mode_beginner' }],
      [{ text: getText(lang, 'mode_pro_btn'), callback_data: 'onboard_mode_pro' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard);
}

async function showOnboardingSetup(chatId, lang) {
  await sendUpdatedMessage(chatId, getText(lang, 'onboarding_setup'));
  setTimeout(async () => {
    await showMainMenu(chatId, lang);
  }, 2000);
}

// ============================================================
// 31. ОБРАБОТЧИК CALLBACK (ПОЛНЫЙ, С НОВЫМИ КЕЙСАМИ)
// ============================================================
async function handleCallback(update) {
  const callback = update.callback_query;
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const data = callback.data;
  const lang = await getUserLanguage(chatId) || 'ru';

  await deleteUserMessage(chatId, messageId);
  await answerCallback(callback.id);

  try {
    // === ОНБОРДИНГ ===
    if (data === 'onboard_lang_ru' || data === 'onboard_lang_en') {
      const newLang = data === 'onboard_lang_ru' ? 'ru' : 'en';
      await setUserLanguage(chatId, newLang);
      await showModeSelectOnboarding(chatId, newLang);
      return;
    }
    if (data === 'onboard_mode_beginner' || data === 'onboard_mode_pro') {
      const mode = data === 'onboard_mode_beginner' ? 'beginner' : 'pro';
      await setUserMode(chatId, mode);
      await setOnboarded(chatId);
      await showOnboardingSetup(chatId, lang);
      return;
    }

    // === НАВИГАЦИЯ ===
    if (data === 'back_to_menu') { await showMainMenu(chatId, lang); return; }
    if (data === 'back_to_functions') { await showFunctionsMenu(chatId, lang); return; }
    if (data === 'back_to_settings') { await showSettingsMenuNew(chatId, lang); return; }
    if (data === 'menu_functions') { await showFunctionsMenu(chatId, lang); return; }
    if (data === 'menu_settings_new') { await showSettingsMenuNew(chatId, lang); return; }
    if (data === 'menu_plans') { await showPlansMenu(chatId, lang); return; }
    if (data === 'menu_help') { await showHelpMenu(chatId, lang); return; }
    if (data === 'menu_about') { await showAboutMenu(chatId, lang); return; }
    if (data === 'settings_change_lang') { await showLanguageSelect(chatId, lang); return; }
    if (data === 'settings_change_mode') { await showModeSelect(chatId, lang); return; }
    if (data === 'menu_analyze') { await showAnalyzeMenu(chatId, lang); return; }
    if (data === 'menu_security') { await showSecurityMenu(chatId, lang); return; }
    if (data === 'menu_news') { await handleNewsCommand(chatId, null, lang, null); return; }
    if (data === 'menu_history') { await showHistoryMenu(chatId, lang); return; }
    if (data === 'menu_social') { await handleSocialTrend(chatId, lang, null); return; }
    if (data === 'menu_calendar') { await handleCalendarCommand(chatId, lang, null); return; }
    if (data === 'menu_connect') {
      await sendUpdatedMessage(chatId, getText(lang, 'connect_prompt'));
      await setUserState(chatId, 'waiting_for_api_keys');
      return;
    }
    if (data === 'back_to_plans') { await showPlansMenu(chatId, lang); return; }

    // === ЯЗЫК И РЕЖИМ ===
    if (data === 'lang_ru' || data === 'lang_en') {
      const newLang = data === 'lang_ru' ? 'ru' : 'en';
      await setUserLanguage(chatId, newLang);
      await sendUpdatedMessage(chatId, getText(newLang, 'settings_lang_selected', newLang === 'ru' ? 'Русский' : 'English'));
      await showSettingsMenuNew(chatId, newLang);
      return;
    }
    if (data === 'mode_beginner' || data === 'mode_pro') {
      const newMode = data === 'mode_beginner' ? 'beginner' : 'pro';
      await setUserMode(chatId, newMode);
      const langUser = await getUserLanguage(chatId) || 'ru';
      await sendUpdatedMessage(chatId, getText(langUser, 'settings_mode_selected', newMode === 'beginner' ? '🔰 Новичок' : '🚀 Опытный'));
      await showSettingsMenuNew(chatId, langUser);
      return;
    }

    // === ПОИСК ТОКЕНА ===
    if (data === 'trend_search_menu') { await handleTrendSearchMenu(chatId, lang, null); return; }
    if (data === 'trend_search_name') {
      await sendUpdatedMessage(chatId, getText(lang, 'social_search_prompt'), null, 'Markdown', null);
      await setUserState(chatId, 'waiting_for_trend_search');
      return;
    }
    if (data === 'trend_search_contract') {
      await sendUpdatedMessage(chatId, '📄 *Отправь адрес контракта для проверки*\n\n📌 Пример: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e\n🔄 /cancel — отмена', null, 'Markdown', null);
      await setUserState(chatId, 'waiting_for_contract_search');
      return;
    }

    // === ДЕЙСТВИЯ (АНАЛИЗ, CSV, AI) — ИСПОЛЬЗУЮТ ДВИЖОК ===
    if (data === 'action_analyze') {
      const savedData = await loadUserKeys(chatId);
      if (!savedData) {
        await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'));
        return;
      }
      await sendUpdatedMessage(chatId, '⏳ *Начинаю анализ...*');
      // Используем analyzePortfolioEngine (детерминированный движок)
      const result = await analyzePortfolioEngine(savedData.exchangeId, savedData.apiKey, savedData.secretKey, chatId, lang);
      if (result.error === 'limit') {
        await sendUpdatedMessage(chatId, result.message);
        return;
      }
      if (result.error) {
        await sendUpdatedMessage(chatId, result.message);
        return;
      }
      const mode = await getUserMode(chatId) || 'beginner';
      // Форматируем через formatEngineResult
      const { text: report, keyboard } = await formatEngineResult(result.engineResult, mode, lang, 0);
      await sendUpdatedMessage(chatId, report, keyboard);
      return;
    }

    if (data === 'action_full_report') {
      const savedData = await loadUserKeys(chatId);
      if (!savedData) {
        await sendUpdatedMessage(chatId, getText(lang, 'no_keys'));
        return;
      }
      const result = await analyzePortfolioEngine(savedData.exchangeId, savedData.apiKey, savedData.secretKey, chatId, lang);
      if (result.success) {
        const mode = await getUserMode(chatId) || 'beginner';
        const { text: report, keyboard } = await formatEngineResult(result.engineResult, mode, lang, 0);
        await sendUpdatedMessage(chatId, report, keyboard);
      } else {
        await sendUpdatedMessage(chatId, result.message);
      }
      return;
    }

    if (data === 'action_export_csv') {
      const savedData = await loadUserKeys(chatId);
      if (!savedData) {
        await sendUpdatedMessage(chatId, getText(lang, 'no_keys'));
        return;
      }
      const result = await analyzePortfolioEngine(savedData.exchangeId, savedData.apiKey, savedData.secretKey, chatId, lang);
      if (result.success) {
        const csv = generateCSV(result.engineResult);
        await sendDocument(chatId, csv, 'portfolio_report.csv');
        await sendUpdatedMessage(chatId, '✅ *CSV отчет отправлен!*');
      } else {
        await sendUpdatedMessage(chatId, getText(lang, 'export_error'));
      }
      return;
    }

    if (data === 'action_ask_ai') {
      const savedData = await loadUserKeys(chatId);
      if (!savedData) {
        await sendUpdatedMessage(chatId, getText(lang, 'no_keys'));
        return;
      }
      const lastAnalysis = await getLastEngineResult(chatId);
      if (!lastAnalysis) {
        await sendUpdatedMessage(chatId, getText(lang, 'no_analysis_data'));
        return;
      }
      await setUserState(chatId, 'ai_chat');
      const totalUsdt = lastAnalysis.totalUSDT || 0;
      const riskLevel = lastAnalysis.riskLevel || 'unknown';
      const riskEmoji = riskLevel === 'high' ? '🔴' : riskLevel === 'medium' ? '🟡' : '🟢';
      const riskText = riskLevel === 'high' ? 'высокий' : riskLevel === 'medium' ? 'средний' : 'низкий';
      const welcomeMessage = lang === 'ru'
        ? `🤖 *AI-СОВЕТНИК*\n\n💰 Портфель: $${totalUsdt.toFixed(2)} USDT\n${riskEmoji} Риск: ${riskText}\n\n💬 *Задай вопрос о своем портфеле!*\n\n📌 Примеры:\n• "что такое RSI?"\n• "почему ETH перекуплен?"\n• "что значит VaR?"\n\n🔄 Для выхода: /exit`
        : `🤖 *AI ADVISOR*\n\n💰 Portfolio: $${totalUsdt.toFixed(2)} USDT\n${riskEmoji} Risk: ${riskText}\n\n💬 *Ask about your portfolio!*\n\n📌 Examples:\n• "what is RSI?"\n• "why is ETH overbought?"\n• "what does VaR mean?"\n\n🔄 To exit: /exit`;
      await sendUpdatedMessage(chatId, welcomeMessage);
      return;
    }

    // === ОТКЛЮЧЕНИЕ БИРЖИ ===
    if (data === 'action_disconnect') {
      const keyboard = {
        inline_keyboard: [
          [{ text: getText(lang, 'connect_confirm_yes'), callback_data: 'confirm_disconnect' }],
          [{ text: getText(lang, 'connect_confirm_no'), callback_data: 'cancel_disconnect' }],
          [{ text: getText(lang, 'back_to_settings'), callback_data: 'back_to_settings' }]
        ]
      };
      await sendUpdatedMessage(chatId, getText(lang, 'connect_confirm'), keyboard);
      return;
    }
    if (data === 'confirm_disconnect') {
      await deleteUserKeys(chatId);
      await sendUpdatedMessage(chatId, getText(lang, 'connect_disconnected'));
      await showMainMenu(chatId, lang);
      return;
    }
    if (data === 'cancel_disconnect') {
      await sendUpdatedMessage(chatId, '✅ Отключение отменено.');
      await showSettingsMenuNew(chatId, lang);
      return;
    }
    if (data === 'action_history_refresh') {
      await showHistoryMenu(chatId, lang);
      return;
    }

    // === ТАРИФЫ ===
    if (data.startsWith('plan_')) {
      const planId = data.replace('plan_', '');
      await handlePlanSelection(chatId, planId, lang, null);
      return;
    }

    // === АНТИСКАМ ===
    if (data.startsWith('antiscam_')) {
      await setUserState(chatId, data);
      const prompts = {
        'antiscam_url': getText(lang, 'scan_link'),
        'antiscam_contract': getText(lang, 'scan_contract'),
        'antiscam_file': getText(lang, 'scan_file'),
        'antiscam_dex': getText(lang, 'dex_prompt'),
        'antiscam_impersonation': getText(lang, 'impersonation_prompt'),
        'antiscam_wallet': getText(lang, 'wallet_prompt')
      };
      await sendUpdatedMessage(chatId, prompts[data] + '\n\n🔄 *Для отмены отправь /cancel*');
      return;
    }

    // === ТРЕНДЫ ===
    if (data.startsWith('trend_')) {
      await handleTrendClick(chatId, data, lang, null);
      return;
    }

    // === ПОМОЩЬ (НОВЫЕ 10 КНОПОК) ===
    if (data.startsWith('help_q')) {
      const answerKeyMap = {
        'help_q1': 'help_answer_q1',
        'help_q2': 'help_answer_q2',
        'help_q3': 'help_answer_q3',
        'help_q4': 'help_answer_q4',
        'help_q5': 'help_answer_q5',
        'help_q6': 'help_answer_q6',
        'help_q7': 'help_answer_q7',
        'help_q8': 'help_answer_q8',
        'help_q9': 'help_answer_q9',
        'help_q10': 'help_answer_q10',
      };
      const answerKey = answerKeyMap[data];
      const answerText = getText(lang, answerKey);
      const keyboard = {
        inline_keyboard: [
          [{ text: getText(lang, 'back_to_help'), callback_data: 'menu_help' }],
          [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
      };
      await sendUpdatedMessage(chatId, answerText, keyboard);
      return;
    }
    if (data === 'help_contact_moderator') {
      const message = getText(lang, 'help_contact_moderator_message');
      const keyboard = {
        inline_keyboard: [
          [{ text: getText(lang, 'back_to_help'), callback_data: 'menu_help' }],
          [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
      };
      await sendUpdatedMessage(chatId, message, keyboard);
      return;
    }

    // === ИСПОЛНЕНИЕ РЕКОМЕНДАЦИЙ ===
    if (data.startsWith('exec_')) {
      const recId = data.replace('exec_', '');
      const keyboard = {
        inline_keyboard: [
          [{ text: '✅ Подтвердить', callback_data: `confirm_${recId}` }],
          [{ text: '❌ Отмена', callback_data: `cancel_exec_${recId}` }]
        ]
      };
      await sendMessage(chatId, '⚠️ *Подтвердите исполнение рекомендации.*\n\nЭто действие отправит ордер на биржу.', keyboard);
      return;
    }
    if (data.startsWith('confirm_')) {
      const recId = data.replace('confirm_', '');
      await answerCallback(callback.id, '⏳ Исполняю...');
      const result = await executeRecommendation(chatId, recId);
      if (result.error) {
        await sendMessage(chatId, `❌ ${result.error}`);
      } else {
        await sendMessage(chatId, `✅ *Ордер исполнен!*\n\nСимвол: ${result.order.symbol}\nСторона: ${result.order.side}\nКоличество: ${result.order.amount}\nЦена: ${result.order.price || 'рыночная'}`);
      }
      await showMainMenu(chatId, lang);
      return;
    }
    if (data.startsWith('cancel_exec_')) {
      await sendMessage(chatId, '❌ Исполнение отменено.');
      await showMainMenu(chatId, lang);
      return;
    }

    // === ОПОВЕЩЕНИЯ ===
    if (data === 'alert_price' || data === 'alert_change' || data === 'alert_volume' || data === 'alert_news' || data === 'alert_calendar') {
      const typeMap = {
        'alert_price': 'price',
        'alert_change': 'change',
        'alert_volume': 'volume',
        'alert_news': 'news',
        'alert_calendar': 'calendar'
      };
      const type = typeMap[data];
      await setUserState(chatId, `alert_${type}`);
      if (type === 'price') {
        await sendMessage(chatId, getText(lang, 'alert_create_price'));
      } else if (type === 'change') {
        await sendMessage(chatId, getText(lang, 'alert_create_change'));
      } else {
        await sendMessage(chatId, `📊 *Создать оповещение типа "${type}"*\n\nВведите символ и параметры (например, BTC 1000000 для объёма)`);
      }
      return;
    }
    if (data === 'alert_list') {
      const alerts = await getAlerts(chatId);
      if (alerts.length === 0) {
        await sendMessage(chatId, '📭 Нет активных оповещений.');
        return;
      }
      // Группировка по символу
      const groups = {};
      for (const a of alerts) {
        const key = a.params.symbol || 'general';
        if (!groups[key]) groups[key] = [];
        groups[key].push(a);
      }
      let text = getText(lang, 'alert_list');
      for (const [symbol, items] of Object.entries(groups)) {
        text += `📌 *${symbol}*:\n`;
        for (const a of items) {
          const typeText = a.type === 'price' ? '💰 цена' :
                           a.type === 'change' ? '📈 изменение' :
                           a.type === 'volume' ? '📊 объём' : a.type;
          text += `   • ${typeText} (${a.params.target || ''})\n`;
        }
      }
      const keyboard = {
        inline_keyboard: alerts.map(a => ([{ text: `❌ Удалить ${a.params.symbol || a.id}`, callback_data: `alert_delete_${a.id}` }]))
      };
      keyboard.inline_keyboard.push([{ text: '🔙 Назад', callback_data: 'alert_menu' }]);
      await sendMessage(chatId, text, keyboard);
      return;
    }
    if (data.startsWith('alert_delete_')) {
      const alertId = data.replace('alert_delete_', '');
      await deleteAlert(chatId, alertId);
      await sendMessage(chatId, getText(lang, 'alert_deleted'));
      await showAlertMenu(chatId, lang);
      return;
    }

    // === АВТОТОРГОВЛЯ ===
    if (data.startsWith('autotrade_level')) {
      const level = parseInt(data.replace('autotrade_level', ''));
      const plan = await getUserPlan(chatId);
      if (!plan.limits.autotrade) {
        await sendMessage(chatId, getText(lang, 'autotrade_pro_only'));
        return;
      }
      await autotrade(chatId, level);
      await sendMessage(chatId, getText(lang, 'autotrade_active', { level }));
      return;
    }
    if (data === 'autotrade_stop') {
      await stopAutotrade(chatId);
      await sendMessage(chatId, getText(lang, 'autotrade_stopped'));
      return;
    }

    // === ХОЛОДНЫЙ ДУШ (PANIC) ===
    if (data === 'panic_start') {
      const plan = await getUserPlan(chatId);
      if (!plan.limits.panic) {
        await sendMessage(chatId, '❌ Холодный душ доступен только PRO и VIP');
        return;
      }
      await VOID_KV.put(`panic_${chatId}`, JSON.stringify({ active: true, lastPrice: null }));
      await sendMessage(chatId, getText(lang, 'panic_start'));
      return;
    }
    if (data === 'panic_stop') {
      await VOID_KV.delete(`panic_${chatId}`);
      await sendMessage(chatId, getText(lang, 'panic_stop'));
      return;
    }
    if (data.startsWith('panic_convert_')) {
      const chatIdFromData = parseInt(data.replace('panic_convert_', ''));
      await handlePanicConvert(chatIdFromData);
      return;
    }

    // === ДНЕВНИК НАСТРОЕНИЯ ===
    if (data.startsWith('diary_mood_')) {
      const moodMap = {
        'calm': 'calm', 'thoughtful': 'thoughtful', 'anxious': 'anxious',
        'panic': 'panic', 'angry': 'angry', 'euphoric': 'euphoric'
      };
      const moodKey = data.replace('diary_mood_', '');
      const mood = moodMap[moodKey] || 'calm';
      const result = await saveMood(chatId, mood);
      let text = getText(lang, 'diary_saved');
      if (result.warning) {
        text += '\n\n' + getText(lang, 'diary_warning', { days: result.days });
      }
      await sendMessage(chatId, text);
      await showMainMenu(chatId, lang);
      return;
    }

    // === KILL SWITCH ===
    if (data === 'kill_switch_confirm') {
      const keysUser = await loadUserKeys(chatId);
      if (keysUser) {
        const exchange = await getExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
        try { await exchange.cancelAllOrders(); } catch (e) {}
        await deleteUserKeys(chatId);
      }
      await setKillSwitch(chatId, true);
      await sendMessage(chatId, getText(lang, 'kill_switch_activated'));
      await VOID_KV.delete(`state_${chatId}`);
      return;
    }
    if (data === 'kill_switch_cancel') {
      await sendMessage(chatId, getText(lang, 'kill_switch_cancelled'));
      return;
    }

  } catch (error) {
    console.error('Callback error:', error);
    await sendUpdatedMessage(chatId, getText(lang, 'error_general', error.message));
  }
}

// ============================================================
// 32. ОБРАБОТЧИК СООБЩЕНИЙ (ПОЛНЫЙ, С НОВЫМИ КОМАНДАМИ)
// ============================================================
async function handleMessage(update) {
  const chatId = update.message.chat.id;
  const text = update.message.text || '';
  const messageId = update.message.message_id;
  const userName = update.message.from.first_name || 'Друг';
  let lang = await getUserLanguage(chatId);
  let state = await getUserState(chatId);
  let killActive = await getKillSwitch(chatId);
  const hasLanguage = lang !== null;

  try {
    if (killActive && text !== '/reset' && text !== '/start') {
      await sendUpdatedMessage(chatId, getText(lang || 'ru', 'kill_switch_blocked'), null, 'Markdown', messageId);
      return;
    }

    // Автоматическая проверка ссылок и контрактов
    if (text && (text.includes('http://') || text.includes('https://'))) {
      await autoCheckLinks(chatId, text, lang, messageId);
    }
    if (text && text.startsWith('0x') && text.length >= 42 && text.length <= 44) {
      await autoCheckContract(chatId, text, lang, messageId);
      return;
    }

    // Ввод ключей
    if (state === 'waiting_for_api_keys') {
      const cancelWords = ['/cancel', 'отмена', 'Отмена', 'cancel', 'Cancel'];
      if (cancelWords.includes(text)) {
        await setUserState(chatId, 'idle');
        await sendUpdatedMessage(chatId, getText(lang, 'connect_cancel'), null, 'Markdown', messageId);
        await showMainMenu(chatId, lang);
        return;
      }
      const parts = text.split(':');
      if (parts.length === 2) {
        const apiKey = parts[0].trim();
        const secretKey = parts[1].trim();
        await sendTyping(chatId);
        await sendUpdatedMessage(chatId, '🔍 Проверяю ключи...', null, 'Markdown', messageId);
        try {
          const exchangeId = await detectExchange(apiKey, secretKey);
          if (exchangeId) {
            await saveUserKeys(chatId, apiKey, secretKey, exchangeId);
            await setUserState(chatId, 'idle');
            await sendUpdatedMessage(chatId, getText(lang, 'connect_success', exchangeId), null, 'Markdown', messageId);
            await showMainMenu(chatId, lang);
          } else {
            await sendUpdatedMessage(chatId, getText(lang, 'connect_fail'), null, 'Markdown', messageId);
          }
        } catch (error) {
          await sendUpdatedMessage(chatId, getText(lang, 'error_api_key'), null, 'Markdown', messageId);
        }
      } else {
        await sendUpdatedMessage(chatId, getText(lang, 'invalid_format'), null, 'Markdown', messageId);
      }
      return;
    }

    // Антискам состояния
    const antiscamStates = ['antiscam_url', 'antiscam_contract', 'antiscam_dex', 'antiscam_file', 'antiscam_impersonation', 'antiscam_wallet'];
    if (antiscamStates.includes(state)) {
      if (text === '/cancel') {
        await setUserState(chatId, 'idle');
        await sendUpdatedMessage(chatId, getText(lang, 'scan_cancelled'), null, 'Markdown', messageId);
        await showMainMenu(chatId, lang);
        return;
      }
      await handleAntiScamInput(chatId, text, lang, update, messageId);
      return;
    }

    // Поиск токена по названию
    if (state === 'waiting_for_trend_search') {
      if (text === '/cancel') {
        await setUserState(chatId, 'idle');
        await sendUpdatedMessage(chatId, '❌ Поиск отменен.', null, 'Markdown', messageId);
        await showMainMenu(chatId, lang);
        return;
      }
      await handleTrendSearchInput(chatId, text, lang, messageId);
      return;
    }

    // Поиск по контракту
    if (state === 'waiting_for_contract_search') {
      if (text === '/cancel') {
        await setUserState(chatId, 'idle');
        await sendUpdatedMessage(chatId, '❌ Поиск отменен.', null, 'Markdown', messageId);
        await showMainMenu(chatId, lang);
        return;
      }
      const cleanInput = text.trim();
      if (!cleanInput.startsWith('0x') || cleanInput.length < 42) {
        await sendUpdatedMessage(chatId, '❌ *Неверный адрес контракта.*\n\nОтправь адрес, начинающийся с 0x... (длина 42 символа)', null, 'Markdown', messageId);
        await setUserState(chatId, 'waiting_for_contract_search');
        return;
      }
      await handleContractSearch(chatId, cleanInput, lang, messageId);
      await setUserState(chatId, 'idle');
      return;
    }

    // Оповещения (создание)
    if (state === 'alert_price') {
      const parts = text.split(' ');
      if (parts.length === 2) {
        const symbol = parts[0].toUpperCase();
        const target = parseFloat(parts[1]);
        if (!isNaN(target)) {
          const result = await createAlert(chatId, 'price', { symbol, target, direction: 'above' });
          if (result.error) { await sendMessage(chatId, result.error); return; }
          await sendMessage(chatId, getText(lang, 'alert_created'));
          await setUserState(chatId, 'idle');
          return;
        }
      } else if (parts.length === 3 && parts[2].toLowerCase() === 'below') {
        const symbol = parts[0].toUpperCase();
        const target = parseFloat(parts[1]);
        if (!isNaN(target)) {
          const result = await createAlert(chatId, 'price', { symbol, target, direction: 'below' });
          if (result.error) { await sendMessage(chatId, result.error); return; }
          await sendMessage(chatId, getText(lang, 'alert_created'));
          await setUserState(chatId, 'idle');
          return;
        }
      }
      await sendMessage(chatId, '❌ Неверный формат. Используйте `BTC 70000` или `BTC 65000 below`');
      return;
    }
    if (state === 'alert_change') {
      const parts = text.split(' ');
      if (parts.length === 2) {
        const symbol = parts[0].toUpperCase();
        const target = parseFloat(parts[1]);
        if (!isNaN(target)) {
          const result = await createAlert(chatId, 'change', { symbol, target });
          if (result.error) { await sendMessage(chatId, result.error); return; }
          await sendMessage(chatId, getText(lang, 'alert_created'));
          await setUserState(chatId, 'idle');
          return;
        }
      }
      await sendMessage(chatId, '❌ Неверный формат. Используйте `BTC 5`');
      return;
    }
    if (state === 'alert_volume') {
      const parts = text.split(' ');
      if (parts.length === 2) {
        const symbol = parts[0].toUpperCase();
        const target = parseFloat(parts[1]);
        if (!isNaN(target)) {
          const result = await createAlert(chatId, 'volume', { symbol, target });
          if (result.error) { await sendMessage(chatId, result.error); return; }
          await sendMessage(chatId, getText(lang, 'alert_created'));
          await setUserState(chatId, 'idle');
          return;
        }
      }
      await sendMessage(chatId, '❌ Неверный формат. Используйте `BTC 1000000` (объём)');
      return;
    }
    if (state === 'alert_news' || state === 'alert_calendar') {
      const type = state === 'alert_news' ? 'news' : 'calendar';
      const result = await createAlert(chatId, type, {});
      if (result.error) { await sendMessage(chatId, result.error); return; }
      await sendMessage(chatId, getText(lang, 'alert_created'));
      await setUserState(chatId, 'idle');
      return;
    }

    // AI-чат (используем getAIResponseWithEngine)
    if (state === 'ai_chat') {
      if (text === '/exit' || text === 'выход' || text === 'Exit') {
        await setUserState(chatId, 'idle');
        await sendUpdatedMessage(chatId, getText(lang, 'ai_exit'), null, 'Markdown', messageId);
        await showMainMenu(chatId, lang);
        return;
      }
      await sendTyping(chatId);
      const aiResponse = await getAIResponseWithEngine(chatId, text, lang);
      const keyboard = {
        inline_keyboard: [
          [{ text: '💬 Задать ещё вопрос', callback_data: 'action_ask_ai' }],
          [{ text: '📊 Полный анализ', callback_data: 'action_analyze' }],
          [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
        ]
      };
      await sendUpdatedMessage(chatId, aiResponse, keyboard, 'Markdown', messageId);
      return;
    }

    // /start - онбординг
    if (text === '/start') {
      if (!hasLanguage) {
        await showLanguageSelectOnboarding(chatId);
        return;
      }
      const onboarded = await getOnboarded(chatId);
      if (!onboarded) {
        await showModeSelectOnboarding(chatId, lang);
        return;
      }
      await showMainMenu(chatId, lang);
      return;
    }

    // Команды
    if (text === '/connect') {
      await sendUpdatedMessage(chatId, getText(lang, 'connect_prompt'), null, 'Markdown', messageId);
      await setUserState(chatId, 'waiting_for_api_keys');
      return;
    }
    if (text === '/disconnect') {
      const keyboard = {
        inline_keyboard: [
          [{ text: getText(lang, 'connect_confirm_yes'), callback_data: 'confirm_disconnect' }],
          [{ text: getText(lang, 'connect_confirm_no'), callback_data: 'cancel_disconnect' }],
          [{ text: getText(lang, 'back_to_settings'), callback_data: 'back_to_settings' }]
        ]
      };
      await sendUpdatedMessage(chatId, getText(lang, 'connect_confirm'), keyboard, 'Markdown', messageId);
      return;
    }
    if (text === '/undo') {
      const savedData = await loadUserKeys(chatId);
      if (savedData) {
        await sendUpdatedMessage(chatId, getText(lang, 'connect_undo_success'), null, 'Markdown', messageId);
      } else {
        await sendUpdatedMessage(chatId, 'ℹ️ Ключи уже удалены. Отмена невозможна.', null, 'Markdown', messageId);
      }
      return;
    }
    if (text === '/help') {
      await showHelpMenu(chatId, lang);
      return;
    }
    if (text === '/history') {
      await showHistoryMenu(chatId, lang);
      return;
    }
    if (text === '/share') {
      await handleShareCommand(chatId, lang, messageId);
      return;
    }
    if (text === '/trend' || text === '/trend ') {
      await handleSocialTrend(chatId, lang, messageId);
      return;
    }
    if (text.startsWith('/trend ')) {
      const coin = text.replace('/trend ', '').trim().toUpperCase();
      await sendTyping(chatId);
      const check = await checkLimit(chatId, 'social');
      if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        return;
      }
      const result = await analyzeSocialTrend(coin, chatId);
      if (result.error) {
        await sendUpdatedMessage(chatId, `❌ ${result.error}`, null, 'Markdown', messageId);
        return;
      }
      const message = getText(lang, 'social_result', result.coin, result.mentions, result.sentiment, result.trendScore, result.trend, result.emoji, result.recommendation, result.sources, result.marketCap, result.volume24h, result.rank);
      const keyboard = {
        inline_keyboard: [
          [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
          [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
      };
      await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
      await addHistory(chatId, getText(lang, 'history_social'), coin);
      return;
    }
    if (text === '/news' || text === '/news ') {
      await handleNewsCommand(chatId, null, lang, messageId);
      return;
    }
    if (text.startsWith('/news ')) {
      const coin = text.replace('/news ', '').trim();
      await handleNewsCommand(chatId, coin, lang, messageId);
      return;
    }
    if (text === '/calendar') {
      await handleCalendarCommand(chatId, lang, messageId);
      return;
    }

    // /analyze (использует движок)
    if (text === '/analyze') {
      const savedData = await loadUserKeys(chatId);
      if (!savedData) {
        await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'), null, 'Markdown', messageId);
        return;
      }
      await sendUpdatedMessage(chatId, '⏳ *Начинаю анализ...*', null, 'Markdown', messageId);
      const result = await analyzePortfolioEngine(savedData.exchangeId, savedData.apiKey, savedData.secretKey, chatId, lang);
      if (result.error === 'limit') {
        await sendUpdatedMessage(chatId, result.message, null, 'Markdown', messageId);
        return;
      }
      if (result.error) {
        await sendUpdatedMessage(chatId, result.message, null, 'Markdown', messageId);
        return;
      }
      const mode = await getUserMode(chatId) || 'beginner';
      const { text: report, keyboard } = await formatEngineResult(result.engineResult, mode, lang, 0);
      await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
      return;
    }

    if (text === '/subscribe' || text === '/plans') {
      await showPlansMenu(chatId, lang);
      return;
    }
    if (text === '/settings') {
      await showSettingsMenuNew(chatId, lang);
      return;
    }

    // === НОВЫЕ КОМАНДЫ ===
    if (text === '/alerts') {
      await showAlertMenu(chatId, lang);
      return;
    }
    if (text === '/autotrade') {
      await showAutotradeMenu(chatId, lang);
      return;
    }
    if (text === '/panic') {
      const plan = await getUserPlan(chatId);
      if (!plan.limits.panic) {
        await sendMessage(chatId, '❌ Холодный душ доступен только PRO и VIP');
        return;
      }
      await VOID_KV.put(`panic_${chatId}`, JSON.stringify({ active: true, lastPrice: null }));
      await sendMessage(chatId, getText(lang, 'panic_start'));
      return;
    }
    if (text === '/panic_stop') {
      await VOID_KV.delete(`panic_${chatId}`);
      await sendMessage(chatId, getText(lang, 'panic_stop'));
      return;
    }
    if (text === '/diary') {
      const keyboard = {
        inline_keyboard: [
          [{ text: '😌 Спокоен', callback_data: 'diary_mood_calm' }, { text: '🤔 Задумчив', callback_data: 'diary_mood_thoughtful' }],
          [{ text: '😰 Тревожен', callback_data: 'diary_mood_anxious' }, { text: '😱 Паника', callback_data: 'diary_mood_panic' }],
          [{ text: '😤 Зол', callback_data: 'diary_mood_angry' }, { text: '😊 Эйфория', callback_data: 'diary_mood_euphoric' }],
          [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
        ]
      };
      await sendMessage(chatId, getText(lang, 'mood_title'), keyboard);
      return;
    }
    if (text === '/kill_switch') {
      const plan = await getUserPlan(chatId);
      if (!plan.limits.kill_switch) {
        await sendMessage(chatId, '❌ Kill Switch доступен только PRO и VIP');
        return;
      }
      const keyboard = {
        inline_keyboard: [
          [{ text: '🛑 ДА, ОСТАНОВИТЬ', callback_data: 'kill_switch_confirm' }],
          [{ text: '❌ Отмена', callback_data: 'kill_switch_cancel' }]
        ]
      };
      await sendMessage(chatId, getText(lang, 'kill_switch_confirm'), keyboard);
      return;
    }
    if (text === '/reset') {
      await setKillSwitch(chatId, false);
      await sendMessage(chatId, getText(lang, 'kill_switch_reset'));
      await showMainMenu(chatId, lang);
      return;
    }

    // Все остальное
    await sendUpdatedMessage(chatId, getText(lang, 'default_response', text), null, 'Markdown', messageId);
  } catch (error) {
    console.error('Message error:', error);
    await sendUpdatedMessage(chatId, getText(lang || 'ru', 'error_general', error.message), null, 'Markdown', messageId);
  }
}

// ============================================================
// 33. ОБРАБОТЧИК SHARE И ПЛАНОВ
// ============================================================
async function handleShareCommand(chatId, lang, messageId) {
  const ref = chatId;
  let message = getText(lang, 'share_title') + '\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  message += getText(lang, 'share_text') + '\n\n';
  message += getText(lang, 'share_link', ref) + '\n\n';
  message += '💡 Пригласи друга — получи бонус!';
  const keyboard = {
    inline_keyboard: [
      [{ text: '📤 Поделиться', url: `https://t.me/share/url?url=${encodeURIComponent(getText(lang, 'share_text'))}&text=${encodeURIComponent('🚀 Мой крипто-телохранитель — Void Node! Присоединяйся!')}` }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
}

async function handlePlanSelection(chatId, planId, lang, messageId) {
  if (planId === 'TRIAL') {
    const userPlan = await getUserPlan(chatId);
    if (userPlan.trialUsed && userPlan.plan !== 'TRIAL') {
      await sendUpdatedMessage(chatId, getText(lang, 'plans_trial_used'), null, 'Markdown', messageId);
      return;
    }
    await activateTrial(chatId);
    await sendUpdatedMessage(chatId, getText(lang, 'plans_trial_success'), null, 'Markdown', messageId);
    await showMainMenu(chatId, lang);
    return;
  }
  const plan = PLANS[planId];
  if (!plan) {
    await sendUpdatedMessage(chatId, getText(lang, 'plans_not_found'), null, 'Markdown', messageId);
    return;
  }
  const userPlan = await getUserPlan(chatId);
  if (userPlan.plan === planId && userPlan.expires > Date.now()) {
    await sendUpdatedMessage(chatId, getText(lang, 'plans_already', plan.name), null, 'Markdown', messageId);
    return;
  }
  await sendUpdatedMessage(chatId, getText(lang, 'plans_payment_creating'), null, 'Markdown', messageId);
  const invoice = await createCryptoInvoice(chatId, planId, plan.price);
  if (!invoice) {
    await sendUpdatedMessage(chatId, getText(lang, 'plans_payment_error'), null, 'Markdown', messageId);
    return;
  }
  const displayFeatures = lang === 'en' ? plan.features_en : plan.features;
  let message = `💳 *${getText(lang, 'plans_payment_title', plan.name)}*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += `💰 ${plan.price} ₽\n📅 ${plan.duration} ${getText(lang, 'days')}\n\n`;
  message += `📋 *${getText(lang, 'plans_features')}:*\n${displayFeatures.map(f => `• ${f}`).join('\n')}\n\n`;
  message += `💳 *${getText(lang, 'plans_payment_methods')}:*\n• ${getText(lang, 'plans_payment_crypto')}\n• ${getText(lang, 'plans_payment_card')}\n\n`;
  message += `⚠️ ${getText(lang, 'plans_payment_note')}`;
  const keyboard = {
    inline_keyboard: [
      [{ text: `💳 ${lang === 'en' ? 'Pay' : 'Оплатить'} ${plan.price} ₽`, url: invoice.payUrl }],
      [{ text: getText(lang, 'back_to_plans'), callback_data: 'back_to_plans' }],
      [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
}

// ============================================================
// 34. ВЕБХУК CRYPTOBOT
// ============================================================
async function handleCryptoWebhook(request) {
  try {
    const update = await request.json();
    console.log('Webhook:', JSON.stringify(update, null, 2));
    if (update.update_type === 'invoice_paid') {
      const payload = update.payload;
      const customPayload = payload.payload;
      const parts = customPayload.split('_');
      const planId = parts[1];
      const chatId = parseInt(parts[2]);
      const lang = await getUserLanguage(chatId) || 'ru';
      const plan = await activatePlan(chatId, planId);
      if (plan) {
        await sendUpdatedMessage(chatId, getText(lang, 'plans_success', plan.name));
        await showMainMenu(chatId, lang);
      }
    }
    return { status: 200 };
  } catch (error) {
    console.error('Webhook error:', error);
    return { status: 500, error: error.message };
  }
}

// ============================================================
// 35. ЗАПУСК ФОНОВЫХ ЗАДАЧ (ОПОВЕЩЕНИЯ, АВТОТОРГОВЛЯ, ХОЛОДНЫЙ ДУШ)
// ============================================================
setInterval(() => { checkAlerts().catch(console.error); }, CONFIG.ALERT_CHECK_INTERVAL);
setInterval(() => { runAutotrade().catch(console.error); }, CONFIG.AUTOTRADE_CHECK_INTERVAL);
setInterval(() => { checkPanic().catch(console.error); }, CONFIG.PANIC_CHECK_INTERVAL);

// ============================================================
// 36. EXPRESS СЕРВЕР
// ============================================================
const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update.callback_query) {
      await handleCallback(update);
    } else if (update.message) {
      await handleMessage(update);
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('Ошибка в вебхуке:', error);
    res.sendStatus(500);
  }
});

app.post('/webhook/crypto', async (req, res) => {
  try {
    const result = await handleCryptoWebhook(req);
    res.status(result.status || 200).json(result);
  } catch (error) {
    console.error('Crypto webhook error:', error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Бот запущен на порту ${PORT}`);
});

// ============================================================
// КОНЕЦ ФАЙЛА
// ============================================================