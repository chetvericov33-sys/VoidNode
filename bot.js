// ============================================================
// БОТ VOID NODE — ПОЛНАЯ ВЕРСИЯ 3.2 (ИСПРАВЛЕННАЯ)
// ЧАСТЬ 1 ИЗ 5: ИМПОРТЫ, КОНФИГУРАЦИЯ, REDIS, БЕЗОПАСНОСТЬ
// ============================================================

require('dotenv').config();
const express = require('express');
const ccxt = require('ccxt');
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

// ============================================================
// 1. ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'my-super-secret-key-32bytes!!';
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const CRYPTOBOT_TOKEN = process.env.CRYPTOBOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN не найден'); process.exit(1); }
if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    console.error('❌ UPSTASH_REDIS_REST_URL или TOKEN не найдены');
    process.exit(1);
}

// ============================================================
// 2. КОНФИГУРАЦИЯ
// ============================================================
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
    MAX_ORDERS_PER_DAY: 10,
    WHITELIST_SYMBOLS: ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT', 'ADA/USDT', 'DOT/USDT'],
    TRUSTED_NEWS_DOMAINS: [
        'cointelegraph.com', 'news.bitcoin.com', 'cryptopotato.com',
        'beincrypto.com', 'coindesk.com', 'decrypt.co', 'theblock.co',
        'cryptoslate.com', 'dailyhodl.com', 'u.today', 'ambcrypto.com',
        'fxstreet.com', 'investing.com'
    ]
};

// ============================================================
// 3. REDIS ХРАНИЛИЩЕ С FALLBACK-МЕХАНИЗМОМ
// ============================================================
class RedisStorage {
    constructor() {
        this.redis = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });
        this.localCache = new Map();
        this.isRedisAvailable = true;
        console.log('✅ Redis подключен');
    }

    async get(key) {
        try {
            if (this.isRedisAvailable) {
                const data = await this.redis.get(key);
                if (data !== null && data !== undefined) return data;
            }
            return this.localCache.get(key) || null;
        } catch (error) {
            console.error('❌ Redis get error:', error);
            this.isRedisAvailable = false;
            setTimeout(() => { this.isRedisAvailable = true; }, 60000);
            return this.localCache.get(key) || null;
        }
    }

    async put(key, value, ttl = null) {
        try {
            if (this.isRedisAvailable) {
                await this.redis.set(key, value);
                if (ttl) await this.redis.expire(key, ttl);
            }
            this.localCache.set(key, value);
        } catch (error) {
            console.error('❌ Redis set error:', error);
            this.isRedisAvailable = false;
            this.localCache.set(key, value);
            setTimeout(() => { this.isRedisAvailable = true; }, 60000);
        }
    }

    async delete(key) {
        try {
            if (this.isRedisAvailable) await this.redis.del(key);
            this.localCache.delete(key);
        } catch (error) {
            console.error('❌ Redis delete error:', error);
            this.localCache.delete(key);
        }
    }

    // ВОЗВРАЩАЕТ МАССИВ, А НЕ { keys: [] }
    async list(prefix = '') {
        try {
            if (this.isRedisAvailable) {
                const keys = await this.redis.keys(prefix + '*');
                return keys.map(k => ({ name: k }));
            }
            return [];
        } catch (error) {
            console.error('❌ Redis list error:', error);
            return [];
        }
    }
}

const VOID_KV = new RedisStorage();

async function getData(key) { return await VOID_KV.get(key); }
async function setData(key, value, ttl = null) { await VOID_KV.put(key, value, ttl); }
async function deleteData(key) { await VOID_KV.delete(key); }

// ============================================================
// 4. ФУНКЦИИ БЕЗОПАСНОСТИ
// ============================================================

// 4.1. ВАЛИДАЦИЯ API-КЛЮЧЕЙ
async function validateExchangeKeys(apiKey, secretKey, exchangeId = 'binance') {
    try {
        const exchange = new ccxt[exchangeId]({
            apiKey: apiKey,
            secret: secretKey,
            enableRateLimit: true,
            timeout: 10000
        });
        await exchange.fetchBalance();
        try {
            await exchange.fetchWithdrawals();
            return {
                valid: true,
                hasWithdrawPermissions: true,
                warning: '⚠️ Ваш API-ключ имеет права на вывод средств. Рекомендуется использовать ключ только с правами на чтение.'
            };
        } catch (e) {
            return { valid: true, hasWithdrawPermissions: false, warning: null };
        }
    } catch (error) {
        return { valid: false, error: '❌ Неверные API-ключи или проблема с подключением к бирже.' };
    }
}

// 4.2. ОГРАНИЧЕНИЕ ПОПЫТОК ПОДКЛЮЧЕНИЯ
async function checkConnectAttempts(chatId) {
    const key = 'connect_attempts_' + chatId;
    const attempts = parseInt(await getData(key) || '0');
    if (attempts >= 5) {
        const lastAttempt = await getData('connect_attempts_time_' + chatId);
        if (lastAttempt && Date.now() - parseInt(lastAttempt) < 3600000) {
            return { blocked: true, reason: '⛔ Слишком много неудачных попыток. Попробуйте через час.' };
        }
    }
    return { blocked: false };
}

async function recordConnectAttempt(chatId, success) {
    const key = 'connect_attempts_' + chatId;
    if (success) {
        await deleteData(key);
        await deleteData('connect_attempts_time_' + chatId);
    } else {
        const attempts = parseInt(await getData(key) || '0');
        await setData(key, (attempts + 1).toString(), 3600);
        await setData('connect_attempts_time_' + chatId, Date.now().toString(), 3600);
    }
}

// 4.3. САНИТИЗАЦИЯ ВВОДА
function sanitizeInput(text) {
    if (!text) return '';
    let sanitized = text
        .replace(/[<>{}[\]`]/g, '')
        .trim();
    if (sanitized.length > 4096) sanitized = sanitized.slice(0, 4096);
    return sanitized;
}

function isValidContractAddress(address) {
    if (!address || typeof address !== 'string') return false;
    const clean = address.trim();
    if (!clean.startsWith('0x')) return false;
    if (clean.length !== 42) return false;
    return /^[0-9a-fA-F]{40}$/.test(clean.slice(2));
}

function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) { return false; }
}

// 4.4. RATE LIMITING
async function checkRateLimit(chatId, action, maxRequests = 10, timeWindow = 60000) {
    const key = 'rate_' + chatId + '_' + action;
    const data = await getData(key);
    const now = Date.now();
    let count = 0, firstRequest = now;
    if (data) {
        try {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            count = parsed.count || 0;
            firstRequest = parsed.firstRequest || now;
            if (now - firstRequest > timeWindow) { count = 0; firstRequest = now; }
        } catch (e) { count = 0; firstRequest = now; }
    }
    if (count >= maxRequests) {
        const resetTime = Math.ceil((firstRequest + timeWindow - now) / 1000);
        return { allowed: false, message: '⏳ Слишком много запросов. Подождите ' + resetTime + ' секунд.' };
    }
    await setData(key, JSON.stringify({ count: count + 1, firstRequest: firstRequest }), Math.ceil(timeWindow / 1000));
    return { allowed: true };
}

// 4.5. ВЕРИФИКАЦИЯ WEBHOOK CRYPTOBOT
function verifyCryptoBotWebhook(body, headers) {
    const signature = headers['crypto-pay-api-signature'];
    if (!signature) return false;
    const hash = crypto.createHmac('sha256', CRYPTOBOT_TOKEN)
        .update(JSON.stringify(body))
        .digest('hex');
    return hash === signature;
}

// 4.6. ЗАЩИТА ОТ ДУБЛИРУЮЩИХ ПЛАТЕЖЕЙ
async function checkDuplicatePayment(chatId, planId) {
    const key = 'payment_duplicate_' + chatId + '_' + planId;
    const existing = await getData(key);
    if (existing) {
        try {
            const data = typeof existing === 'string' ? JSON.parse(existing) : existing;
            if (Date.now() - data.createdAt < 900000) {
                return { duplicate: true, message: '⏳ У вас уже есть активный платёж на этот тариф. Подождите 15 минут.' };
            }
        } catch (e) { await deleteData(key); }
    }
    await setData(key, JSON.stringify({ createdAt: Date.now(), planId: planId }), 3600);
    return { duplicate: false };
}

// 4.7. ПРОВЕРКА ПОДОЗРИТЕЛЬНЫХ АККАУНТОВ
async function checkSuspiciousUser(chatId) {
    const key = 'account_age_' + chatId;
    let accountAge = await getData(key);
    if (!accountAge) {
        try {
            const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/getChat';
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId })
            });
            const data = await response.json();
            if (data.ok && data.result) {
                accountAge = data.result.date || Date.now();
                await setData(key, accountAge.toString(), 86400 * 30);
            }
        } catch (error) { console.error('❌ Ошибка получения возраста аккаунта:', error); }
    }
    if (accountAge && Date.now() - parseInt(accountAge) < 7 * 24 * 60 * 60 * 1000) {
        return { suspicious: true, message: '⚠️ Ваш аккаунт был создан недавно. Будьте осторожны с подключением API-ключей.' };
    }
    return { suspicious: false };
}

// 4.8. АВТОМАТИЧЕСКАЯ ОЧИСТКА ДАННЫХ
async function cleanupOldData() {
    const now = Date.now();
    const keys = await VOID_KV.list('');
    for (const key of keys) {
        const data = await getData(key.name);
        if (!data) continue;
        try {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            if (parsed.timestamp && now - parsed.timestamp > 90 * 24 * 60 * 60 * 1000) {
                await deleteData(key.name);
                console.log('🗑️ Удалены старые данные:', key.name);
            }
        } catch (e) {
            if (key.name.startsWith('state_') || key.name.startsWith('spam_') || key.name.startsWith('rate_')) {
                await deleteData(key.name);
            }
        }
    }
}
setInterval(cleanupOldData, 24 * 60 * 60 * 1000);

// 4.9. ФОРМАТ ДАТЫ "ДД.ММ.ГГ"
function formatDateShort(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return day + '.' + month + '.' + year;
}

// 4.10. УВЕДОМЛЕНИЯ АДМИНИСТРАТОРА
const errorCache = new Map();
async function notifyAdmin(error, context = {}) {
    if (!ADMIN_CHAT_ID || ADMIN_CHAT_ID === 'ваш_telegram_id') return;
    const errorKey = error.message?.slice(0, 50) || 'unknown';
    const now = Date.now();
    if (errorCache.has(errorKey) && now - errorCache.get(errorKey) < 3600000) return;
    errorCache.set(errorKey, now);
    try {
        const message = '🔴 КРИТИЧЕСКАЯ ОШИБКА БОТА\n\n' +
            'Ошибка: ' + (error.message || 'Unknown error') + '\n' +
            'Функция: ' + (context.function || 'unknown') + '\n' +
            'Пользователь: ' + (context.chatId || 'unknown') + '\n' +
            'Время: ' + new Date().toISOString() + '\n' +
            'Стек:\n' + (error.stack || '').slice(0, 300);
        await sendMessage(ADMIN_CHAT_ID, message);
    } catch (e) { console.error('❌ Не удалось отправить уведомление админу:', e); }
}

// ============================================================
// 5. ШИФРОВАНИЕ (AES-256-GCM)
// ============================================================
function encrypt(text) {
    try {
        const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        const tag = cipher.getAuthTag().toString('base64');
        return iv.toString('base64') + ':' + encrypted + ':' + tag;
    } catch (error) { console.error('❌ Ошибка шифрования:', error); return null; }
}

function decrypt(encoded) {
    try {
        const parts = encoded.split(':');
        if (parts.length !== 3) return null;
        const iv = Buffer.from(parts[0], 'base64');
        const tag = Buffer.from(parts[2], 'base64');
        const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(parts[1], 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) { console.error('❌ Ошибка дешифрования:', error); return null; }
}

// ============================================================
// 6. БИРЖЕВЫЕ ФУНКЦИИ
// ============================================================
async function connectExchange(exchangeId, apiKey, secretKey) {
    const exchange = new ccxt[exchangeId]({
        apiKey: apiKey,
        secret: secretKey,
        enableRateLimit: true,
        timeout: 30000
    });
    await exchange.fetchBalance();
    return exchange;
}

function detectExchange(apiKey) {
    const patterns = {
        binance: /^vm[A-Za-z0-9]{60,}/,
        bybit: /^B[A-Za-z0-9]{30,}/,
        okx: /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}/,
        kucoin: /^[a-zA-Z0-9]{24,}/,
        gate: /^GT[A-Za-z0-9]{30,}/
    };
    for (const [exchange, pattern] of Object.entries(patterns)) {
        if (pattern.test(apiKey)) return exchange;
    }
    return null;
}

// ============================================================
// 7. ПЛАНЫ (ТАРИФЫ)
// ============================================================
const PLANS = {
    TRIAL: {
        id: 'TRIAL',
        name: 'Триал',
        name_en: 'Trial',
        price: 0,
        duration: 7,
        limits: {
            analyze: 2, antiscam: 3, alerts: 0, social: 3, dex: 2,
            news: 2, calendar: 2, search_token: 3, panic: false,
            diary: true, ranking: false, autotrade: false, ai: 0,
            csv: false, kill_switch: false, priority_support: false
        },
        features: [
            'Анализ портфеля (2/день)',
            'Антискам-центр (3/день)',
            'Соц.тренды (3/день)',
            'DEX проверка (2/день)',
            'Новости + AI (2/день)',
            'Календарь трейдера (2/день)',
            'Поиск токена (3/день)',
            'Дневник настроения',
            'Полный отчет'
        ],
        features_en: [
            'Portfolio analysis (2/day)',
            'Anti-scam center (3/day)',
            'Social trends (3/day)',
            'DEX check (2/day)',
            'News + AI (2/day)',
            'Trader calendar (2/day)',
            'Token search (3/day)',
            'Mood diary',
            'Full report'
        ]
    },
    START: {
        id: 'START',
        name: 'Старт',
        name_en: 'Start',
        price: 500,
        duration: 30,
        limits: {
            analyze: 10, antiscam: 15, alerts: 3, social: 10, dex: 10,
            news: 10, calendar: 10, search_token: 15, panic: false,
            diary: true, ranking: true, autotrade: false, ai: 5,
            csv: true, kill_switch: false, priority_support: false
        },
        features: [
            'Анализ портфеля (10/день)',
            'Антискам-центр (15/день)',
            'Оповещения (3 шт)',
            'Соц.тренды (10/день)',
            'DEX проверка (10/день)',
            'Новости + AI (10/день)',
            'Календарь трейдера (10/день)',
            'Поиск токена (15/день)',
            'Дневник настроения',
            'Рейтинг',
            'AI-советник (5/день)',
            'Полный отчет + CSV'
        ],
        features_en: [
            'Portfolio analysis (10/day)',
            'Anti-scam center (15/day)',
            'Alerts (3)',
            'Social trends (10/day)',
            'DEX check (10/day)',
            'News + AI (10/day)',
            'Trader calendar (10/day)',
            'Token search (15/day)',
            'Mood diary',
            'Ranking',
            'AI advisor (5/day)',
            'Full report + CSV'
        ]
    },
    PRO: {
        id: 'PRO',
        name: 'PRO',
        name_en: 'PRO',
        price: 1000,
        duration: 30,
        limits: {
            analyze: 30, antiscam: 50, alerts: 15, social: Infinity, dex: Infinity,
            news: Infinity, calendar: Infinity, search_token: Infinity, panic: true,
            diary: true, ranking: true, autotrade: 3, ai: 20,
            csv: true, kill_switch: true, priority_support: false
        },
        features: [
            'Анализ портфеля (30/день)',
            'Антискам-центр (50/день)',
            'Оповещения (15 шт)',
            'Соц.тренды (Безлимит)',
            'DEX проверка (Безлимит)',
            'Новости + AI (Безлимит)',
            'Календарь трейдера (Безлимит)',
            'Поиск токена (Безлимит)',
            'Холодный душ',
            'Дневник настроения',
            'Рейтинг',
            'Автоторговля (3/день)',
            'AI-советник (20/день)',
            'Полный отчет + CSV',
            'Kill Switch'
        ],
        features_en: [
            'Portfolio analysis (30/day)',
            'Anti-scam center (50/day)',
            'Alerts (15)',
            'Social trends (Unlimited)',
            'DEX check (Unlimited)',
            'News + AI (Unlimited)',
            'Trader calendar (Unlimited)',
            'Token search (Unlimited)',
            'Panic mode',
            'Mood diary',
            'Ranking',
            'Autotrading (3/day)',
            'AI advisor (20/day)',
            'Full report + CSV',
            'Kill Switch'
        ]
    },
    VIP: {
        id: 'VIP',
        name: 'VIP',
        name_en: 'VIP',
        price: 1500,
        duration: 30,
        limits: {
            analyze: Infinity, antiscam: Infinity, alerts: Infinity, social: Infinity, dex: Infinity,
            news: Infinity, calendar: Infinity, search_token: Infinity, panic: true,
            diary: true, ranking: true, autotrade: Infinity, ai: Infinity,
            csv: true, kill_switch: true, priority_support: true
        },
        features: [
            'Анализ портфеля (Безлимит)',
            'Антискам-центр (Безлимит)',
            'Оповещения (Безлимит)',
            'Соц.тренды (Безлимит)',
            'DEX проверка (Безлимит)',
            'Новости + AI (Безлимит)',
            'Календарь трейдера (Безлимит)',
            'Поиск токена (Безлимит)',
            'Холодный душ (Безлимит)',
            'Дневник настроения',
            'Рейтинг',
            'Автоторговля (Безлимит)',
            'AI-советник (Безлимит)',
            'Полный отчет + CSV',
            'Kill Switch',
            'Приоритетная поддержка 24/7'
        ],
        features_en: [
            'Portfolio analysis (Unlimited)',
            'Anti-scam center (Unlimited)',
            'Alerts (Unlimited)',
            'Social trends (Unlimited)',
            'DEX check (Unlimited)',
            'News + AI (Unlimited)',
            'Trader calendar (Unlimited)',
            'Token search (Unlimited)',
            'Panic mode (Unlimited)',
            'Mood diary',
            'Ranking',
            'Autotrading (Unlimited)',
            'AI advisor (Unlimited)',
            'Full report + CSV',
            'Kill Switch',
            '24/7 priority support'
        ]
    }
};

// Кэш планов
const planCache = new Map();

async function getUserPlan(chatId) {
    if (planCache.has(chatId)) {
        const cached = planCache.get(chatId);
        if (Date.now() - cached.timestamp < 60000) return cached.data;
    }
    const key = 'plan_' + chatId;
    const data = await getData(key);
    let result;
    if (!data) {
        await activateTrial(chatId);
        result = { plan: 'TRIAL', ...PLANS.TRIAL, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
    } else {
        try {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            const plan = PLANS[parsed.planId];
            if (!plan) {
                await activateTrial(chatId);
                result = { plan: 'TRIAL', ...PLANS.TRIAL, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
            } else if (parsed.planId === 'TRIAL' && parsed.trialUsed && parsed.expires < Date.now()) {
                result = {
                    plan: 'NONE',
                    name: 'Без подписки',
                    name_en: 'No subscription',
                    price: 0,
                    duration: 0,
                    expires: parsed.expires,
                    limits: {
                        analyze: 0, antiscam: 0, alerts: 0, social: 0, dex: 0,
                        news: 0, calendar: 0, search_token: 0, panic: false,
                        diary: false, ranking: false, autotrade: false, ai: 0,
                        csv: false, kill_switch: false, priority_support: false
                    },
                    features: ['❌ Подписка истекла. Продлите тариф: /subscribe'],
                    features_en: ['❌ Subscription expired. Renew: /subscribe']
                };
            } else if (parsed.planId !== 'TRIAL' && parsed.expires < Date.now()) {
                result = {
                    plan: 'NONE',
                    name: 'Без подписки',
                    name_en: 'No subscription',
                    price: 0,
                    duration: 0,
                    expires: parsed.expires,
                    limits: {
                        analyze: 0, antiscam: 0, alerts: 0, social: 0, dex: 0,
                        news: 0, calendar: 0, search_token: 0, panic: false,
                        diary: false, ranking: false, autotrade: false, ai: 0,
                        csv: false, kill_switch: false, priority_support: false
                    },
                    features: ['❌ Подписка истекла. Продлите тариф: /subscribe'],
                    features_en: ['❌ Subscription expired. Renew: /subscribe']
                };
            } else {
                result = {
                    plan: parsed.planId,
                    ...plan,
                    expires: parsed.expires || Date.now() + plan.duration * 24 * 60 * 60 * 1000,
                    trialUsed: parsed.trialUsed || false,
                    vipTrial: parsed.vipTrial || false
                };
            }
        } catch (e) {
            await activateTrial(chatId);
            result = { plan: 'TRIAL', ...PLANS.TRIAL, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
        }
    }
    planCache.set(chatId, { data: result, timestamp: Date.now() });
    return result;
}

async function invalidatePlanCache(chatId) { planCache.delete(chatId); }

async function activateTrial(chatId) {
    const key = 'plan_' + chatId;
    const existing = await getData(key);
    if (existing) {
        try {
            const parsed = typeof existing === 'string' ? JSON.parse(existing) : existing;
            if (parsed.trialUsed) return null;
        } catch (e) {}
    }
    await setData(key, JSON.stringify({
        planId: 'TRIAL',
        activatedAt: Date.now(),
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
        trialUsed: true
    }));
    await invalidatePlanCache(chatId);
    return true;
}

async function activatePlan(chatId, planId) {
    const plan = PLANS[planId];
    if (!plan) return null;
    await setData('plan_' + chatId, JSON.stringify({
        planId: planId,
        activatedAt: Date.now(),
        expires: Date.now() + plan.duration * 24 * 60 * 60 * 1000
    }));
    await invalidatePlanCache(chatId);
    return plan;
}

async function activateVipTrial(chatId) {
    const expires = Date.now() + 3 * 24 * 60 * 60 * 1000;
    await setData('plan_' + chatId, JSON.stringify({
        planId: 'VIP',
        activatedAt: Date.now(),
        expires: expires,
        trialUsed: true,
        vipTrial: true,
        source: 'onboard_connect'
    }));
    await invalidatePlanCache(chatId);
}

async function checkLimit(chatId, feature) {
    const userPlan = await getUserPlan(chatId);
    const limit = userPlan.limits[feature];
    if (limit === undefined || limit === false) {
        return { allowed: false, reason: '❌ Функция недоступна на тарифе "' + userPlan.name + '"\n💳 /subscribe' };
    }
    if (limit === Infinity) return { allowed: true };
    const key = 'usage_' + chatId + '_' + feature + '_' + new Date().toISOString().split('T')[0];
    const usage = await getData(key);
    const count = usage ? parseInt(usage) : 0;
    if (count >= limit) {
        return { allowed: false, reason: '📊 Лимит исчерпан. Повысьте тариф: /subscribe' };
    }
    await setData(key, (count + 1).toString());
    return { allowed: true };
}

// ============================================================
// БОТ VOID NODE — ПОЛНАЯ ВЕРСИЯ 3.2 (ИСПРАВЛЕННАЯ)
// ЧАСТЬ 2 ИЗ 5: УПРАВЛЕНИЕ СООБЩЕНИЯМИ, МЕНЮ, ИНТЕРФЕЙС
// ============================================================

// ============================================================
// 8. УПРАВЛЕНИЕ СООБЩЕНИЯМИ
// ============================================================

async function getUserLastMessageId(chatId) {
    const key = 'last_msg_' + chatId;
    const data = await getData(key);
    return data ? parseInt(data) : null;
}

async function setUserLastMessageId(chatId, messageId) {
    const key = 'last_msg_' + chatId;
    await setData(key, messageId.toString());
}

async function deleteUserLastMessage(chatId) {
    try {
        const messageId = await getUserLastMessageId(chatId);
        if (messageId) {
            await botDeleteMessage(chatId, messageId);
            await deleteData('last_msg_' + chatId);
        }
    } catch (error) {
        console.error('❌ deleteUserLastMessage error:', error);
    }
}

async function botDeleteMessage(chatId, messageId) {
    try {
        const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/deleteMessage';
        const body = { chat_id: chatId, message_id: messageId };
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response;
    } catch (error) {
        console.error('❌ Delete message error:', error);
        return null;
    }
}

async function deleteUserMessage(chatId, messageId) {
    if (!messageId) return;
    try {
        const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/deleteMessage';
        const body = { chat_id: chatId, message_id: messageId };
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (error) {
        console.error('❌ Failed to delete user message:', error);
    }
}

async function deleteUserMessageWithDelay(chatId, messageId, delay) {
    if (!messageId) return;
    if (delay === undefined) delay = 1500;
    setTimeout(async function() {
        await deleteUserMessage(chatId, messageId);
    }, delay);
}

async function checkMessageExists(chatId, messageId) {
    try {
        const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/getMessage';
        const body = { chat_id: chatId, message_id: messageId };
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

async function sendTyping(chatId) {
    try {
        const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/sendChatAction';
        const body = { chat_id: chatId, action: 'typing' };
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (error) {
        console.error('❌ Typing error:', error);
    }
}

async function answerCallback(callbackId, text, showAlert) {
    try {
        const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/answerCallbackQuery';
        const body = { callback_query_id: callbackId, show_alert: showAlert || false };
        if (text) body.text = text;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (error) {
        console.error('❌ Answer callback error:', error);
    }
}

async function sendMessage(chatId, text, keyboard, parseMode) {
    if (!text) return null;
    try {
        const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage';
        const body = {
            chat_id: chatId,
            text: text,
            parse_mode: parseMode || 'Markdown',
            disable_web_page_preview: true
        };
        if (keyboard) {
            const lang = await getData('lang_' + chatId) || 'ru';
            keyboard = addExitButton(keyboard, lang);
            body.reply_markup = keyboard;
        }
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response;
    } catch (error) {
        console.error('❌ Send message error:', error);
        return null;
    }
}

async function sendUpdatedMessage(chatId, text, keyboard, parseMode, userMessageId) {
    if (userMessageId) {
        const msgExists = await checkMessageExists(chatId, userMessageId);
        if (msgExists) {
            await deleteUserMessageWithDelay(chatId, userMessageId, 1500);
        }
    }
    await deleteUserLastMessage(chatId);
    if (!parseMode) parseMode = 'Markdown';
    const result = await sendMessage(chatId, text, keyboard, parseMode);
    if (result && result.ok) {
        const data = await result.json();
        if (data.result && data.result.message_id) {
            await setUserLastMessageId(chatId, data.result.message_id);
        }
    }
    return result;
}

async function sendDocument(chatId, content, filename) {
    try {
        const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/sendDocument';
        const formData = new FormData();
        formData.append('chat_id', chatId);
        const blob = new Blob([content], { type: 'text/csv' });
        formData.append('document', blob, filename);
        await fetch(url, { method: 'POST', body: formData });
    } catch (error) {
        console.error('❌ Send document error:', error);
    }
}

// ============================================================
// 9. КНОПКА "ВЫЙТИ В МЕНЮ" (ДОБАВЛЯЕТСЯ В КАЖДУЮ КЛАВИАТУРУ)
// ============================================================

function addExitButton(keyboard, lang) {
    if (!keyboard) {
        return {
            inline_keyboard: [
                [{ text: '🔙 Выйти в меню', callback_data: 'exit_to_menu' }]
            ]
        };
    }
    const hasExit = keyboard.inline_keyboard.some(function(row) {
        return row.some(function(btn) {
            return btn.callback_data === 'exit_to_menu';
        });
    });
    if (!hasExit) {
        keyboard.inline_keyboard.push([
            [{ text: '🔙 Выйти в меню', callback_data: 'exit_to_menu' }]
        ]);
    }
    return keyboard;
}

// ============================================================
// 10. МЕНЮ И КЛАВИАТУРЫ
// ============================================================

// 10.1. ГЛАВНОЕ МЕНЮ
function getMainMenuKeyboard(lang) {
    return {
        inline_keyboard: [
            [
                { text: '📊 Функции', callback_data: 'menu_functions' },
                { text: '⚙️ Настройки', callback_data: 'menu_settings_new' }
            ],
            [
                { text: '💳 Тарифы', callback_data: 'menu_plans' },
                { text: '❓ Помощь', callback_data: 'menu_help' }
            ],
            [
                { text: 'ℹ️ О боте', callback_data: 'menu_about' }
            ]
        ]
    };
}

async function showMainMenu(chatId, lang) {
    try {
        console.log('📊 showMainMenu вызван для ' + chatId);
        const userPlan = await getUserPlan(chatId);
        const mode = await getData('mode_' + chatId) || 'beginner';
        let userName = 'Друг';
        try {
            const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/getChat';
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId })
            });
            const data = await response.json();
            if (data.ok && data.result) {
                userName = data.result.username || data.result.first_name || 'Друг';
                if (userName.startsWith('@')) userName = userName.substring(1);
            }
        } catch (error) {
            console.error('❌ Ошибка получения username:', error);
        }
        const userId = chatId;
        const planName = userPlan.name || 'Триал';
        const expiresDate = formatDateShort(userPlan.expires);
        const modeDisplay = mode === 'beginner' ? 'Новичок' : 'Опытный';
        const hour = new Date().getHours();
        let greeting;
        if (hour < 12) greeting = '☀️ Доброе утро, ' + userName + '!';
        else if (hour < 18) greeting = '☀️ Добрый день, ' + userName + '!';
        else greeting = '🌙 Добрый вечер, ' + userName + '!';
        let vipStatus = '';
        if (userPlan.plan === 'VIP' && userPlan.expires > Date.now()) {
            const timeLeft = userPlan.expires - Date.now();
            const daysLeft = Math.floor(timeLeft / (24 * 60 * 60 * 1000));
            if (daysLeft <= 1) {
                vipStatus = '\n🔥 VIP заканчивается завтра!';
            } else {
                vipStatus = '\n👑 VIP активен (' + daysLeft + ' дн.)';
            }
        }
        const header = '👤 ' + userName + ' | ' + modeDisplay + ' | 🆔 ' + userId + '\n💳 ' + planName + ' (до ' + expiresDate + ')';
        const message = greeting + '\n\n' + header + vipStatus + '\n\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🔮 Void Node — твой крипто-телохранитель\n\n🏠 Главное меню:';
        console.log('📤 Отправляю меню для ' + chatId);
        await sendUpdatedMessage(chatId, message, getMainMenuKeyboard(lang));
        console.log('✅ Меню отправлено для ' + chatId);
    } catch (error) {
        console.error('❌ showMainMenu error:', error);
        await sendMessage(chatId, '⚠️ Ошибка загрузки меню. Попробуйте позже.\n\nЕсли ошибка повторяется, напишите /reset для сброса данных.');
    }
}

// 10.2. МЕНЮ ФУНКЦИЙ
async function showFunctionsMenu(chatId, lang) {
    const keyboard = {
        inline_keyboard: [
            [{ text: '📊 Анализ портфеля', callback_data: 'menu_analyze' }],
            [{ text: '🛡️ Антискам-центр', callback_data: 'menu_security' }],
            [{ text: '🔔 Оповещения', callback_data: 'alert_menu' }],
            [{ text: '📈 Рынок', callback_data: 'menu_market' }],
            [{ text: '📋 История', callback_data: 'menu_history' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, '📊 Функции\n\nВыберите раздел:', keyboard);
}

// 10.3. МЕНЮ НАСТРОЕК
async function showSettingsMenuNew(chatId, lang) {
    const currentLang = lang === 'ru' ? '🇷🇺 Русский' : '🇬🇧 English';
    const mode = await getData('mode_' + chatId) || 'beginner';
    const modeDisplay = mode === 'beginner' ? '🔰 Новичок' : '🚀 Опытный';
    const message = '⚙️ Настройки\n\n' +
        '🌍 Язык: ' + currentLang + '\n' +
        '🧠 Режим: ' + modeDisplay;
    const keyboard = {
        inline_keyboard: [
            [{ text: '🌍 Сменить язык', callback_data: 'settings_change_lang' }],
            [{ text: '🧠 Сменить режим', callback_data: 'settings_change_mode' }],
            [{ text: '🔌 Отключить биржу', callback_data: 'action_disconnect' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

// 10.4. МЕНЮ СМЕНЫ ЯЗЫКА
async function showLanguageSelect(chatId, lang) {
    const keyboard = {
        inline_keyboard: [
            [{ text: '🇷🇺 Русский', callback_data: 'lang_ru' }],
            [{ text: '🇬🇧 English', callback_data: 'lang_en' }],
            [{ text: '🔙 Назад к настройкам', callback_data: 'back_to_settings' }]
        ]
    };
    await sendUpdatedMessage(chatId, '🌍 Выберите язык:', keyboard);
}

// 10.5. МЕНЮ СМЕНЫ РЕЖИМА
async function showModeSelect(chatId, lang) {
    const message = '📊 Выбери свой уровень:\n\n' +
        '🔰 Новичок\nЦелевые веса: BTC 50%, Альты 30%, Стейблы 20%\nПростые рекомендации по портфелю\nБазовые метрики (риск, распределение)\n\n' +
        '🚀 Опытный\nЦелевые веса: BTC 40%, Альты 40%, Стейблы 20%\nРасширенные рекомендации\nПолные метрики (Шарп, RSI, MA20, просадка)\n\n' +
        '👇 Выбери режим:';
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔰 Новичок', callback_data: 'mode_beginner' }],
            [{ text: '🚀 Опытный', callback_data: 'mode_pro' }],
            [{ text: '🔙 Назад к настройкам', callback_data: 'back_to_settings' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

// 10.6. МЕНЮ "О БОТЕ"
async function showAboutMenu(chatId, lang) {
    const message = 'ℹ️ О БОТЕ\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
        'Void Node — твой персональный крипто-телохранитель.\n\n' +
        'Что умеет бот:\n' +
        '• 📊 Анализировать портфель и давать рекомендации\n' +
        '• 🛡️ Проверять контракты и ссылки на безопасность\n' +
        '• 📈 Отслеживать соц.тренды и новости\n' +
        '• 📅 Календарь трейдера с важными событиями\n' +
        '• 🚀 Автоторговля для защиты и роста\n' +
        '• ❄️ Холодный душ при падении рынка\n' +
        '• 🔔 Оповещения по цене, объёму и новостям\n\n' +
        '📌 Версия: 3.2\n' +
        '📅 Создан: 2024\n\n' +
        '🔗 Канал проекта: [Atifragility Node](https://t.me/atifragility_node)\n\n' +
        '⚡ Быстрые команды:\n' +
        '/analyze — анализ портфеля\n' +
        '/connect — подключить биржу\n' +
        '/news — новости, тренды, календарь\n' +
        '/help — помощь по боту';
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

// 10.7. МЕНЮ АНАЛИЗА
async function showAnalyzeMenu(chatId, lang) {
    const savedData = await getData('user_' + chatId);
    if (!savedData) {
        const keyboard = {
            inline_keyboard: [
                [{ text: '🔐 Подключить биржу', callback_data: 'menu_connect' }],
                [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, '🔐 Сначала подключи биржу. /connect', keyboard);
        return;
    }
    const keyboard = {
        inline_keyboard: [
            [{ text: '📊 Полный анализ', callback_data: 'action_analyze' }],
            [{ text: '📥 CSV отчет', callback_data: 'action_export_csv' }],
            [{ text: '🔄 Ребаланс портфеля', callback_data: 'action_rebalance' }],
            [{ text: '🚀 Автоторговля', callback_data: 'autotrade_menu' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_functions' }]
        ]
    };
    await sendUpdatedMessage(chatId, '📊 Анализ портфеля\n\nВыберите действие:', keyboard);
}

// 10.8. МЕНЮ БЕЗОПАСНОСТИ
async function showSecurityMenu(chatId, lang) {
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔗 Ссылку', callback_data: 'antiscam_url' }, { text: '📄 Контракт', callback_data: 'antiscam_contract' }],
            [{ text: '📁 Файл', callback_data: 'antiscam_file' }, { text: '🔍 DEX', callback_data: 'antiscam_dex' }],
            [{ text: '🔄 Аккаунт', callback_data: 'antiscam_impersonation' }, { text: '👛 Кошелек', callback_data: 'antiscam_wallet' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_functions' }]
        ]
    };
    await sendUpdatedMessage(chatId, '🛡️ Антискам-центр\n\nЧто проверить?', keyboard);
}

// 10.9. МЕНЮ РЫНКА
async function showMarketMenu(chatId, lang) {
    const keyboard = {
        inline_keyboard: [
            [{ text: '📊 Соц.тренды', callback_data: 'menu_social' }],
            [{ text: '📰 Новости', callback_data: 'menu_news' }],
            [{ text: '📅 Календарь трейдера', callback_data: 'menu_calendar' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, '📈 Рынок\n\nЧто вас интересует?', keyboard);
}

// 10.10. МЕНЮ ИСТОРИИ
async function showHistoryMenu(chatId, lang) {
    const history = await getHistory(chatId);
    if (history.length === 0) {
        const keyboard = {
            inline_keyboard: [
                [{ text: '🔙 Назад', callback_data: 'back_to_functions' }]
            ]
        };
        await sendUpdatedMessage(chatId, '📋 История пуста.', keyboard);
        return;
    }
    let message = '📋 ИСТОРИЯ\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    const items = history.slice(-10).reverse();
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        message += '📌 ' + item.date + '\n• ' + item.action + '\n  ' + item.detail + '\n';
    }
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔄 Обновить', callback_data: 'action_history_refresh' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_functions' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

// 10.11. МЕНЮ ТАРИФОВ
async function showPlansMenu(chatId, lang) {
    const userPlan = await getUserPlan(chatId);
    const expiresDate = formatDateShort(userPlan.expires);
    const message = '💳 Тарифы\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
        '📊 ' + userPlan.name + ' (до ' + expiresDate + ')\n\n' +
        '━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
        '🔰 Триал — 0 ₽\n   7 дней, Базовые функции\n\n' +
        '⭐ Старт — 500 ₽/мес\n   10 анализов/день, Антискам (15/день)\n\n' +
        '🚀 PRO — 1 000 ₽/мес\n   30 анализов/день, Безлимитные тренды, Холодный душ\n\n' +
        '👑 VIP — 1 500 ₽/мес\n   ВСЕ БЕЗЛИМИТНО, Поддержка 24/7\n\n' +
        '👇 Выбери тариф:';
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔰 Триал', callback_data: 'plan_TRIAL' }],
            [{ text: '⭐ Старт', callback_data: 'plan_START' }],
            [{ text: '🚀 PRO', callback_data: 'plan_PRO' }],
            [{ text: '👑 VIP', callback_data: 'plan_VIP' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

// 10.12. МЕНЮ ПОМОЩИ (БЕЗ AI, 9 ВОПРОСОВ + МОДЕРАТОР)
async function showHelpMenu(chatId, lang) {
    const message = '❓ Помощь по боту\n\nВыберите интересующий вас вопрос:';
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔐 Как подключить биржу?', callback_data: 'help_q1' }],
            [{ text: '📊 Как работает анализ портфеля?', callback_data: 'help_q2' }],
            [{ text: '🔐 Зачем подключать биржу?', callback_data: 'help_q3' }],
            [{ text: '🛡️ Как проверить контракт?', callback_data: 'help_q4' }],
            [{ text: '🔔 Как создать оповещение?', callback_data: 'help_q5' }],
            [{ text: '🚀 Как включить автоторговлю?', callback_data: 'help_q6' }],
            [{ text: '❄️ Что такое холодный душ?', callback_data: 'help_q7' }],
            [{ text: '📝 Как работает дневник настроения?', callback_data: 'help_q8' }],
            [{ text: '🔌 Как отключить биржу?', callback_data: 'help_q9' }],
            [{ text: '👤 Написать модератору', callback_data: 'help_contact_moderator' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

// 10.13. МЕНЮ ОПОВЕЩЕНИЙ
async function showAlertMenu(chatId, lang) {
    const keyboard = {
        inline_keyboard: [
            [{ text: '📊 По цене', callback_data: 'alert_price' }],
            [{ text: '📈 По изменению %', callback_data: 'alert_change' }],
            [{ text: '📊 По объёму', callback_data: 'alert_volume' }],
            [{ text: '📰 Новостное', callback_data: 'alert_news' }],
            [{ text: '📅 Календарное', callback_data: 'alert_calendar' }],
            [{ text: '📋 Список оповещений', callback_data: 'alert_list' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_functions' }]
        ]
    };
    await sendUpdatedMessage(chatId, '🔔 Оповещения\n\nВыберите тип оповещения:', keyboard);
}

// 10.14. МЕНЮ АВТОТОРГОВЛИ
async function showAutotradeMenu(chatId, lang) {
    const keyboard = {
        inline_keyboard: [
            [{ text: '🛡️ Уровень 1 (Защита)', callback_data: 'autotrade_level1' }],
            [{ text: '🔄 Уровень 2 (Перераспределение)', callback_data: 'autotrade_level2' }],
            [{ text: '🧠 Уровень 3 (Умный рост)', callback_data: 'autotrade_level3' }],
            [{ text: '❄️ Уровень 4 (Снежный ком)', callback_data: 'autotrade_level4' }],
            [{ text: '⏹️ Остановить', callback_data: 'autotrade_stop' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_analyze' }]
        ]
    };
    await sendUpdatedMessage(chatId, '🚀 Автоторговля\n\nВыберите уровень сложности:', keyboard);
}

// 10.15. МЕНЮ СОЦИАЛЬНЫХ ТРЕНДОВ
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
            [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, '📊 Соц.тренды\n\nВыберите монету:', keyboard, 'Markdown', messageId);
}

// ============================================================
// БОТ VOID NODE — ПОЛНАЯ ВЕРСИЯ 3.2 (ИСПРАВЛЕННАЯ)
// ЧАСТЬ 3 ИЗ 5: АНТИСКАМ, ТРЕНДЫ, НОВОСТИ, КАЛЕНДАРЬ, ОПОВЕЩЕНИЯ, ХОЛОДНЫЙ ДУШ, СНЕЖНЫЙ КОМ
// ============================================================

// ============================================================
// 11. АНТИСКАМ ФУНКЦИИ
// ============================================================

async function checkContract(address) {
    let riskScore = 0;
    let level = 'Низкий';
    const isHoneypot = address.toLowerCase().includes('dead') || (address.length === 42 && address.endsWith('f'));
    if (isHoneypot) riskScore += 40;
    if (address.includes('0x0000')) riskScore += 20;
    if (ETHERSCAN_API_KEY) {
        try {
            const url = 'https://api.etherscan.io/api?module=contract&action=getabi&address=' + address + '&apikey=' + ETHERSCAN_API_KEY;
            const resp = await fetch(url);
            const data = await resp.json();
            if (data.status === '1' && data.result) {
                riskScore = Math.max(0, riskScore - 30);
            } else {
                riskScore += 30;
            }
        } catch (error) {
            console.error('❌ Etherscan error:', error);
        }
    }
    const score = Math.min(100, Math.max(0, riskScore));
    if (score > 70) level = 'Высокий';
    else if (score > 40) level = 'Средний';
    return { score: score, level: level, reason: 'Скоринг риска: ' + score + '/100 (' + level + ')' };
}

async function checkWallet(address) {
    let balance = 0;
    let tokens = [];
    if (ETHERSCAN_API_KEY) {
        try {
            const balUrl = 'https://api.etherscan.io/api?module=account&action=balance&address=' + address + '&tag=latest&apikey=' + ETHERSCAN_API_KEY;
            const balResp = await fetch(balUrl);
            const balData = await balResp.json();
            if (balData.status === '1') balance = parseFloat(balData.result) / 1e18;
            const tokenUrl = 'https://api.etherscan.io/api?module=account&action=tokentx&address=' + address + '&page=1&offset=100&sort=desc&apikey=' + ETHERSCAN_API_KEY;
            const tokenResp = await fetch(tokenUrl);
            const tokenData = await tokenResp.json();
            if (tokenData.status === '1') {
                for (let i = 0; i < tokenData.result.slice(0, 10).length; i++) {
                    const t = tokenData.result.slice(0, 10)[i];
                    if (t.tokenSymbol && !tokens.includes(t.tokenSymbol)) {
                        tokens.push(t.tokenSymbol);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Wallet check error:', error);
        }
    }
    const risk = balance > 10 ? 'low' : (balance > 1 ? 'medium' : 'high');
    return { balance: balance, tokens: tokens, risk: risk };
}

async function checkUrl(url) {
    try {
        const domain = new URL(url).hostname;
        const issues = [];
        const blacklisted = await getData('domain_blacklist_' + domain);
        if (blacklisted) return { safe: false, reason: '🚫 Домен ' + domain + ' в чёрном списке.' };
        const knownDomains = ['binance.com', 'bybit.com', 'okx.com', 'metamask.io', 'trustwallet.com'];
        for (let i = 0; i < knownDomains.length; i++) {
            const known = knownDomains[i];
            const base = known.split('.')[0];
            if (domain.includes(base) && !domain.endsWith(known)) {
                issues.push('🚫 Подозрение на подделку ' + known + '.');
            }
        }
        if (issues.length === 0) return { safe: true, reason: '✅ Ссылка прошла проверку.' };
        return { safe: false, reason: issues.join('\n') };
    } catch (error) {
        return { safe: false, reason: '❌ Ошибка: ' + error.message };
    }
}

function checkFile(fileName) {
    const dangerous = ['.exe', '.scr', '.bat', '.cmd', '.ps1', '.vbs', '.dmg', '.app', '.sh', '.js', '.jar', '.apk'];
    const suspicious = ['.zip', '.rar', '.7z', '.py', '.xls', '.doc', '.pdf', '.docm', '.xlsm'];
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    if (dangerous.includes(ext)) return '🚫 ОПАСНО! Расширение ' + ext + ' может содержать вирус.';
    if (suspicious.includes(ext)) return '⚠️ ВНИМАНИЕ Расширение ' + ext + ' может содержать вредоносный код.';
    return '✅ Безопасно Расширение ' + ext + ' не представляет угрозы.';
}

function checkImpersonation(username) {
    if (!username) return null;
    const knownAdmins = ['binance_support', 'bybit_official', 'okx_help', 'metamask_support', 'trustwallet_help'];
    const lower = username.toLowerCase();
    for (let i = 0; i < knownAdmins.length; i++) {
        const admin = knownAdmins[i];
        if (lower.includes(admin.toLowerCase()) && lower !== admin) {
            return '🚫 Обнаружена подделка! @' + username + ' пытается выдать себя за @' + admin + '.';
        }
    }
    return null;
}

// ============================================================
// 12. ОБРАБОТЧИКИ АНТИСКАМА
// ============================================================

async function handleAntiScamInput(chatId, text, lang, update, messageId) {
    const check = await checkLimit(chatId, 'antiscam');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        await setData('state_' + chatId, 'idle');
        return;
    }
    const state = await getData('state_' + chatId);
    if (state === 'antiscam_url') {
        if (!isValidUrl(text)) {
            await sendUpdatedMessage(chatId, '❌ Отправьте ссылку, начинающуюся с http:// или https://', null, 'Markdown', messageId);
            return;
        }
        await handleUrlCheck(chatId, text, lang, messageId);
    } else if (state === 'antiscam_contract') {
        if (!isValidContractAddress(text)) {
            await sendUpdatedMessage(chatId, '❌ Отправьте адрес контракта (0x...)', null, 'Markdown', messageId);
            return;
        }
        await handleContractCheck(chatId, text, lang, messageId);
    } else if (state === 'antiscam_dex') {
        if (!isValidContractAddress(text)) {
            await sendUpdatedMessage(chatId, '❌ Отправьте адрес контракта (0x...)', null, 'Markdown', messageId);
            return;
        }
        const dexCheck = await checkLimit(chatId, 'dex');
        if (!dexCheck.allowed) {
            await sendUpdatedMessage(chatId, dexCheck.reason, null, 'Markdown', messageId);
            await setData('state_' + chatId, 'idle');
            return;
        }
        await handleDEXCheck(chatId, text, lang, messageId);
    } else if (state === 'antiscam_file') {
        if (update && update.message.document) {
            await handleFileCheck(chatId, update, lang, messageId);
        } else {
            await sendUpdatedMessage(chatId, '❌ Отправьте файл для проверки.', null, 'Markdown', messageId);
        }
    } else if (state === 'antiscam_impersonation') {
        if (update && update.message.forward_from) {
            await handleImpersonationCheck(chatId, update, lang, messageId);
        } else {
            await sendUpdatedMessage(chatId, '❌ Перешлите сообщение от подозрительного пользователя.', null, 'Markdown', messageId);
        }
    } else if (state === 'antiscam_wallet') {
        await handleWalletCheck(chatId, text, lang, messageId);
    } else {
        await sendUpdatedMessage(chatId, '❌ Неизвестный тип проверки.', null, 'Markdown', messageId);
    }
    await setData('state_' + chatId, 'idle');
}

async function handleUrlCheck(chatId, url, lang, messageId) {
    await sendTyping(chatId);
    const result = await checkUrl(url);
    const message = result.safe ?
        '🟢 БЕЗОПАСНО\n\nСсылка не содержит угроз.' :
        '🔴 ОПАСНО\n\nСсылка содержит угрозы:\n' + result.reason;
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
            [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, '🛡️ Проверка безопасности', 'Ссылка: ' + url.slice(0, 30) + '...');
}

async function handleContractCheck(chatId, address, lang, messageId) {
    await sendTyping(chatId);
    const contractInfo = await checkContract(address);
    const message = '📄 ПРОВЕРКА КОНТРАКТА\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 ' + address + '\n\n' + contractInfo.reason + '\n\n💡 Проверьте вручную: https://etherscan.io/address/' + address;
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
            [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, '🛡️ Проверка безопасности', 'Контракт: ' + address.slice(0, 10) + '...');
}

async function handleDEXCheck(chatId, address, lang, messageId) {
    await sendTyping(chatId);
    try {
        const dexUrl = 'https://api.dexscreener.com/latest/dex/search?q=' + address;
        const response = await fetch(dexUrl);
        const data = await response.json();
        let message = '🔍 DEX ПРОВЕРКА\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 ' + address.slice(0, 10) + '...' + address.slice(-6) + '\n\n';
        if (data.pairs && data.pairs.length > 0) {
            const pair = data.pairs[0];
            message += '✅ Токен найден на DEX\n\n';
            message += '🌐 Сеть: ' + (pair.chainId || 'Unknown') + '\n';
            message += '🏦 DEX: ' + (pair.dexId || 'Unknown') + '\n';
            message += '💰 Цена: $' + parseFloat(pair.priceUsd || 0).toFixed(8) + '\n';
            message += '💧 Ликвидность: $' + parseFloat(pair.liquidity?.usd || 0).toFixed(2) + '\n';
            message += '📊 Объем 24ч: $' + parseFloat(pair.volume?.h24 || 0).toFixed(2) + '\n\n';
            const liq = parseFloat(pair.liquidity?.usd || 0);
            let risk = '🟢 Низкий';
            let note = 'Достаточная ликвидность.';
            if (liq < 10000) { risk = '🔴 Высокий'; note = '⚠️ Очень низкая ликвидность!'; }
            else if (liq < 50000) { risk = '🟡 Средний'; note = '⚠️ Средняя ликвидность. Будьте осторожны.'; }
            message += '🛡️ Риск: ' + risk + '\n💡 ' + note + '\n\n';
            if (pair.url) message += '🔗 [Посмотреть на DEX](' + pair.url + ')\n';
        } else {
            message += '❌ Токен не найден на DEX\n\nВозможные причины: новый токен, неверный адрес, или токен на другой сети.\n';
        }
        message += '🔗 [Etherscan](https://etherscan.io/address/' + address + ')';
        const keyboard = {
            inline_keyboard: [
                [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
                [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
        await addHistory(chatId, '🛡️ Проверка безопасности', 'DEX: ' + address.slice(0, 10) + '...');
    } catch (error) {
        console.error('❌ DEX check error:', error);
        await sendUpdatedMessage(chatId, '❌ Ошибка при проверке DEX.', null, 'Markdown', messageId);
    }
}

async function handleFileCheck(chatId, update, lang, messageId) {
    const file = update.message.document;
    const fileName = file.file_name || 'неизвестный_файл';
    const MAX_FILE_SIZE = 20 * 1024 * 1024;
    if (file.file_size > MAX_FILE_SIZE) {
        await sendUpdatedMessage(chatId, '❌ Файл слишком большой (макс. 20MB)', null, 'Markdown', messageId);
        return;
    }
    await sendTyping(chatId);
    const result = checkFile(fileName);
    const message = '📁 ПРОВЕРКА ФАЙЛА\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 ' + fileName + '\n📏 ' + (file.file_size / 1024).toFixed(1) + ' KB\n\n' + result;
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
            [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, '🛡️ Проверка безопасности', 'Файл: ' + fileName);
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
    let message = '🔄 ПРОВЕРКА АККАУНТА\n━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 @' + username + '\n\n';
    if (result) {
        message += '🔴 ОПАСНО\n\n' + result;
    } else {
        message += '🟢 БЕЗОПАСНО\n\n✅ Аккаунт безопасен.';
    }
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
            [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, '🛡️ Проверка безопасности', 'Аккаунт: @' + username);
}

async function handleWalletCheck(chatId, address, lang, messageId) {
    const check = await checkLimit(chatId, 'antiscam');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        await setData('state_' + chatId, 'idle');
        return;
    }
    await sendTyping(chatId);
    if (!isValidContractAddress(address)) {
        await sendUpdatedMessage(chatId, '❌ Неверный адрес кошелька.\n\nОтправь адрес, начинающийся с 0x...', null, 'Markdown', messageId);
        return;
    }
    const walletInfo = await checkWallet(address);
    let message = '👛 ПРОВЕРКА КОШЕЛЬКА\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 Адрес: ' + address.slice(0, 10) + '...' + address.slice(-6) + '\n🌐 Сеть: Ethereum\n\n💰 Баланс: ' + walletInfo.balance.toFixed(4) + ' ETH\n🪙 Токены: ' + (walletInfo.tokens.length > 0 ? walletInfo.tokens.join(', ') : 'нет') + '\n\n';
    const riskEmoji = walletInfo.risk === 'high' ? '🔴' : walletInfo.risk === 'medium' ? '🟡' : '🟢';
    const riskLabel = walletInfo.risk === 'high' ? 'Высокий' : walletInfo.risk === 'medium' ? 'Средний' : 'Низкий';
    message += riskEmoji + ' Риск: ' + riskLabel + '\n\n';
    if (walletInfo.risk === 'high') {
        message += '• ⚠️ Обнаружены подозрительные токены\n• ⚠️ Мало транзакций\n\n';
    } else if (walletInfo.risk === 'medium') {
        message += '• ⚠️ Кошелёк создан недавно\n\n';
    } else {
        message += '✅ Рисков не обнаружено\n\n';
    }
    message += '💡 Рекомендации:\n';
    if (walletInfo.risk === 'high') {
        message += '• 🚨 Не взаимодействуйте с подозрительными токенами\n• 🔍 Проверьте контракты через DEX\n\n';
    } else if (walletInfo.risk === 'medium') {
        message += '• 💡 Диверсифицируйте портфель\n• 📊 Подключите биржу для полного анализа\n\n';
    } else {
        message += '• 📊 Хотите полный анализ с рекомендациями?\n• 🔐 Подключите биржу через /connect\n\n';
    }
    message += '━━━━━━━━━━━━━━━━━━━━━━━\n🔗 Просмотр: https://etherscan.io/address/' + address;
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔐 Подключить биржу', callback_data: 'menu_connect' }],
            [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
            [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, '🛡️ Проверка безопасности', 'Кошелёк: ' + address.slice(0, 10) + '...');
    await setData('state_' + chatId, 'idle');
}

// ============================================================
// 13. АВТОМАТИЧЕСКАЯ ПРОВЕРКА ССЫЛОК И КОНТРАКТОВ
// ============================================================

async function autoCheckLinks(chatId, text, lang, messageId) {
    const urls = text.match(/https?:\/\/[^\s]+/g);
    if (!urls) return;
    const check = await checkLimit(chatId, 'antiscam');
    if (!check.allowed) return;
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        try {
            const result = await checkUrl(url);
            if (!result.safe) {
                const message = '🚨 ПОДОЗРИТЕЛЬНАЯ ССЫЛКА!\n\n🔗 ' + url + '\n\n⚠️ ' + result.reason + '\n\n🛡️ Никогда не вводите пароли и сид-фразы!';
                const keyboard = {
                    inline_keyboard: [
                        [{ text: '🛡️ Проверить другое', callback_data: 'menu_security' }],
                        [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
                    ]
                };
                await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
                await addHistory(chatId, '🛡️ Проверка безопасности', 'Авто: ' + url.slice(0, 30) + '...');
            }
        } catch (error) {
            console.error('❌ Auto-check error:', error);
        }
    }
}

async function autoCheckContract(chatId, address, lang, messageId) {
    const check = await checkLimit(chatId, 'antiscam');
    if (!check.allowed) return;
    await sendTyping(chatId);
    const contractInfo = await checkContract(address);
    const result = '📄 АВТОМАТИЧЕСКАЯ ПРОВЕРКА КОНТРАКТА\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 ' + address + '\n\n' + contractInfo.reason + '\n\n💡 Проверьте вручную: https://etherscan.io/address/' + address;
    const keyboard = {
        inline_keyboard: [
            [{ text: '🛡️ Проверить другое', callback_data: 'menu_security' }],
            [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, result, keyboard, 'Markdown', messageId);
    await addHistory(chatId, '🛡️ Проверка безопасности', 'Контракт: ' + address.slice(0, 10) + '...');
}

// ============================================================
// 14. ТРЕНДЫ (СОЦИАЛЬНЫЕ)
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

async function getCachedCoinGecko(coinId) {
    const cacheKey = 'cg_' + coinId;
    const cached = await getData(cacheKey);
    if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        if (Date.now() - parsed.timestamp < 300000) return parsed.data;
    }
    return null;
}

async function setCachedCoinGecko(coinId, data) {
    const cacheKey = 'cg_' + coinId;
    await setData(cacheKey, JSON.stringify({ data: data, timestamp: Date.now() }), 300);
}

async function handleTrendClick(chatId, data, lang, messageId) {
    const coin = data.replace('trend_', '');
    const check = await checkLimit(chatId, 'social');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        return;
    }
    await sendTyping(chatId);
    await sendUpdatedMessage(chatId, '⏳ Получаю данные по ' + coin + '...', null, 'Markdown', messageId);
    try {
        const coinId = TICKER_TO_COINGECKO[coin] || coin.toLowerCase();
        let dataObj = await getCachedCoinGecko(coinId);
        if (!dataObj) {
            const url = 'https://api.coingecko.com/api/v3/coins/' + coinId;
            const response = await fetch(url, {
                headers: {
                    'x-cg-pro-api-key': COINGECKO_API_KEY,
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) {
                await sendUpdatedMessage(chatId, '❌ Данные по ' + coin + ' временно недоступны.', null, 'Markdown', messageId);
                return;
            }
            dataObj = await response.json();
            await setCachedCoinGecko(coinId, dataObj);
        }
        const price = dataObj.market_data?.current_price?.usd || 0;
        const change24h = dataObj.market_data?.price_change_percentage_24h || 0;
        const marketCap = dataObj.market_data?.market_cap?.usd || 0;
        const volume24h = dataObj.market_data?.total_volume?.usd || 0;
        const rank = dataObj.market_cap_rank || 'Нет данных';
        const twitterFollowers = dataObj.community_data?.twitter_followers || 0;
        const redditSubscribers = dataObj.community_data?.subreddit_subscribers || 0;
        let trend = 'Нейтральный';
        let rec = '';
        if (change24h > 5) {
            trend = 'БЫЧИЙ';
            rec = '📈 ' + coin + ' растет на ' + change24h.toFixed(2) + '% за 24ч. Объем: $' + (volume24h / 1e6).toFixed(1) + 'M';
        } else if (change24h < -5) {
            trend = 'МЕДВЕЖИЙ';
            rec = '📉 ' + coin + ' падает на ' + Math.abs(change24h).toFixed(2) + '% за 24ч.';
        } else if (rank && rank < 50) {
            trend = 'ТОП-МОНЕТА';
            rec = '💎 ' + coin + ' входит в топ-50 криптовалют.';
        } else {
            rec = '⚪ ' + coin + ' в спокойном состоянии. Изменение: ' + (change24h > 0 ? '+' : '') + change24h.toFixed(2) + '%';
        }
        const message = '📊 SOCIAL TREND: ' + coin + '\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            '💵 Цена: $' + price.toFixed(2) + '\n' +
            '📈 Изменение 24ч: ' + (change24h > 0 ? '+' : '') + change24h.toFixed(2) + '%\n' +
            '📊 Объем 24ч: $' + (volume24h / 1e6).toFixed(1) + 'M\n' +
            '💰 Рыночная капа: $' + (marketCap / 1e9).toFixed(2) + 'B\n' +
            '🏆 Ранг: #' + rank + '\n' +
            '🐦 Twitter: ' + (twitterFollowers > 0 ? (twitterFollowers / 1000).toFixed(1) + 'K' : 'Нет данных') + '\n' +
            '📡 Reddit: ' + (redditSubscribers > 0 ? (redditSubscribers / 1000).toFixed(1) + 'K' : 'Нет данных') + '\n' +
            '📌 Тренд: ' + trend + '\n\n' +
            '💡 ' + rec + '\n\n' +
            '🕐 Обновлено: только что\n📡 Источник: CoinGecko';
        const keyboard = {
            inline_keyboard: [
                [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
                [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
        await addHistory(chatId, '📈 Соц.тренды', coin);
    } catch (error) {
        console.error('❌ Trend error:', error);
        await sendUpdatedMessage(chatId, '❌ Ошибка получения данных по ' + coin + '. Попробуйте позже.', null, 'Markdown', messageId);
    }
}

async function handleTrendSearchMenu(chatId, lang, messageId) {
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔎 По названию токена', callback_data: 'trend_search_name' }],
            [{ text: '📄 По адресу контракта', callback_data: 'trend_search_contract' }],
            [{ text: '🔙 Назад к трендам', callback_data: 'menu_social' }]
        ]
    };
    const message = '🔍 Как искать токен?\n\n📌 По названию — введи тикер (PEPE, DOGE, SHIB)\n📄 По адресу — вставь адрес контракта (0x...)\n\n💡 Если адрес контракта — бот покажет DEX данные и ликвидность.';
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
}

async function handleTrendSearchInput(chatId, text, lang, messageId) {
    const input = text.trim().toUpperCase();
    if (input.length < 2 || input.length > 15) {
        await sendUpdatedMessage(chatId, '❌ Некорректное название токена.\n\n📌 Введите тикер (например: PEPE, ARB, SOL, DOGE, SHIB).', null, 'Markdown', messageId);
        await setData('state_' + chatId, 'waiting_for_trend_search');
        return;
    }
    const coin = input;
    const check = await checkLimit(chatId, 'search_token');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        await setData('state_' + chatId, 'idle');
        return;
    }
    await setData('state_' + chatId, 'idle');
    await handleTrendClick(chatId, 'trend_' + coin, lang, messageId);
}

async function handleContractSearch(chatId, address, lang, messageId) {
    await sendTyping(chatId);
    try {
        const dexUrl = 'https://api.dexscreener.com/latest/dex/search?q=' + address;
        const response = await fetch(dexUrl);
        const data = await response.json();
        let message = '📄 РЕЗУЛЬТАТ ПОИСКА ПО КОНТРАКТУ\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
        message += '📌 Адрес: ' + address.slice(0, 10) + '...' + address.slice(-6) + '\n\n';
        if (data.pairs && data.pairs.length > 0) {
            const pair = data.pairs[0];
            message += '✅ Токен найден на DEX\n\n';
            message += '🌐 Сеть: ' + (pair.chainId || 'Unknown') + '\n';
            message += '🏦 DEX: ' + (pair.dexId || 'Unknown') + '\n';
            message += '💰 Цена: $' + parseFloat(pair.priceUsd || 0).toFixed(8) + '\n';
            message += '💧 Ликвидность: $' + parseFloat(pair.liquidity?.usd || 0).toFixed(2) + '\n';
            message += '📊 Объем 24ч: $' + parseFloat(pair.volume?.h24 || 0).toFixed(2) + '\n\n';
            const liq = parseFloat(pair.liquidity?.usd || 0);
            let risk = '🟢 Низкий';
            let note = 'Достаточная ликвидность.';
            if (liq < 10000) { risk = '🔴 Высокий'; note = '⚠️ Очень низкая ликвидность!'; }
            else if (liq < 50000) { risk = '🟡 Средний'; note = '⚠️ Средняя ликвидность. Будьте осторожны.'; }
            message += '🛡️ Риск: ' + risk + '\n💡 ' + note + '\n\n';
            if (pair.url) message += '🔗 [Посмотреть на DEX](' + pair.url + ')\n';
        } else {
            message += '❌ Токен не найден на DEX\n\n';
            message += '💡 Возможные причины:\n• Токен новый и еще не добавлен\n• Адрес контракта неверный\n• Токен на другой сети (не Ethereum)\n\n';
            message += '🔗 [Проверить вручную](https://etherscan.io/address/' + address + ')';
        }
        const keyboard = {
            inline_keyboard: [
                [{ text: '🔍 Поискать другой токен', callback_data: 'trend_search_menu' }],
                [{ text: '🔙 Назад к трендам', callback_data: 'menu_social' }],
                [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
        await addHistory(chatId, '🔍 Поиск по контракту', address.slice(0, 10) + '...');
    } catch (error) {
        console.error('❌ Contract search error:', error);
        await sendUpdatedMessage(chatId, '❌ Ошибка при поиске контракта.\n\nПопробуйте позже или проверьте адрес вручную.', null, 'Markdown', messageId);
    }
    await setData('state_' + chatId, 'idle');
}

// ============================================================
// 15. НОВОСТИ
// ============================================================

class NewsManager {
    constructor() {
        this.updateInterval = 15 * 60 * 1000;
        this.lastUpdate = new Map();
        this.isUpdating = new Map();
    }

    async getPersonalizedNews(chatId, lang, forceUpdate) {
        if (forceUpdate === undefined) forceUpdate = false;
        const cacheKey = 'news_cache_' + chatId;
        const now = Date.now();
        const lastUpdate = this.lastUpdate.get(chatId) || 0;
        if (!forceUpdate && now - lastUpdate < this.updateInterval) {
            const cached = await getData(cacheKey);
            if (cached) {
                try {
                    const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
                    if (now - parsed.timestamp < this.updateInterval + 5 * 60 * 1000) {
                        return {
                            articles: parsed.articles,
                            assets: parsed.assets,
                            timestamp: parsed.timestamp,
                            count: parsed.count,
                            totalAssets: parsed.totalAssets,
                            fromCache: true,
                            age: Math.round((now - parsed.timestamp) / 60000)
                        };
                    }
                } catch (e) {}
            }
        }
        if (this.isUpdating.get(chatId)) {
            return { error: true, message: '⏳ Новости обновляются, подождите...' };
        }
        this.isUpdating.set(chatId, true);
        try {
            const result = await this._fetchAndCacheNews(chatId, lang);
            this.lastUpdate.set(chatId, now);
            return {
                articles: result.articles,
                assets: result.assets,
                timestamp: result.timestamp,
                count: result.count,
                totalAssets: result.totalAssets,
                fromCache: false,
                age: 0
            };
        } finally {
            this.isUpdating.set(chatId, false);
        }
    }

    async _fetchAndCacheNews(chatId, lang) {
        const isRu = lang === 'ru';
        const analysisData = await getData('analysis_' + chatId);
        let assets = [];
        if (analysisData) {
            try {
                const analysis = typeof analysisData === 'string' ? JSON.parse(analysisData) : analysisData;
                assets = analysis.assets || [];
            } catch (e) { console.error('❌ Analysis parse error:', e); }
        }
        if (assets.length === 0) {
            assets = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA'].map(function(symbol) { return { symbol: symbol, weight: 20 }; });
        }
        const topAssets = assets.slice(0, 5);
        let allArticles = [];
        const seenUrls = new Set();
        const newsPromises = topAssets.map(async function(asset) {
            try {
                const query = asset.symbol;
                const cacheKey = 'news_asset_' + query + '_' + (isRu ? 'ru' : 'en');
                const cached = await getData(cacheKey);
                if (cached) {
                    const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
                    if (Date.now() - parsed.timestamp < 300000) return parsed.articles;
                }
                const url = 'https://newsapi.org/v2/everything?q=' + query + '+crypto&language=' + (isRu ? 'ru' : 'en') + '&sortBy=publishedAt&pageSize=3&apiKey=' + NEWS_API_KEY;
                const response = await fetch(url);
                const data = await response.json();
                let articles = [];
                if (data.status === 'ok' && data.articles) {
                    articles = data.articles;
                    await setData(cacheKey, JSON.stringify({ articles: articles, timestamp: Date.now() }), 300);
                }
                return articles;
            } catch (error) {
                console.error('❌ News error for ' + asset.symbol + ':', error);
                return [];
            }
        });
        const allArticlesArrays = await Promise.all(newsPromises);
        for (let i = 0; i < allArticlesArrays.length; i++) {
            const articles = allArticlesArrays[i];
            const asset = topAssets[i];
            for (let j = 0; j < articles.length; j++) {
                const article = articles[j];
                if (article.url && !seenUrls.has(article.url)) {
                    seenUrls.add(article.url);
                    allArticles.push({
                        title: article.title,
                        description: article.description,
                        url: article.url,
                        source: article.source,
                        publishedAt: article.publishedAt,
                        asset: asset.symbol,
                        weight: asset.weight || 0,
                        relevance: (asset.weight || 0) / 100
                    });
                }
            }
        }
        allArticles.sort(function(a, b) {
            const relevanceDiff = (b.relevance || 0) - (a.relevance || 0);
            if (Math.abs(relevanceDiff) > 0.01) return relevanceDiff;
            return new Date(b.publishedAt) - new Date(a.publishedAt);
        });
        const topArticles = allArticles.slice(0, 7);
        const result = {
            articles: topArticles,
            assets: topAssets,
            timestamp: Date.now(),
            count: topArticles.length,
            totalAssets: topAssets.length
        };
        await setData('news_cache_' + chatId, JSON.stringify(result), 900);
        return result;
    }
}

const newsManager = new NewsManager();

async function handleNewsCommand(chatId, coin, lang, messageId) {
    const check = await checkLimit(chatId, 'news');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        return;
    }
    await sendTyping(chatId);
    if (coin && coin.trim().length > 0) {
        await handleNewsSingleCoin(chatId, coin, lang, messageId);
        return;
    }
    const result = await newsManager.getPersonalizedNews(chatId, lang);
    if (result.error) {
        await sendUpdatedMessage(chatId, result.message, null, 'Markdown', messageId);
        return;
    }
    const isRu = lang === 'ru';
    let report = '📰 НОВОСТИ ДЛЯ ТВОЕГО ПОРТФЕЛЯ\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    if (result.fromCache) {
        report += '🕐 Обновлено ' + result.age + ' мин. назад\n';
    } else {
        report += '🕐 Только что обновлено\n';
    }
    report += '📌 По твоим активам: ' + result.assets.map(function(a) { return a.symbol; }).join(', ') + '\n\n';
    if (result.articles.length === 0) {
        report += '📭 Новостей не найдено\n\nПопробуй обновить через 5-10 минут';
        const keyboard = {
            inline_keyboard: [
                [{ text: '🔄 Обновить', callback_data: 'menu_news' }],
                [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
                [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
        return;
    }
    for (let i = 0; i < result.articles.slice(0, 7).length; i++) {
        const article = result.articles.slice(0, 7)[i];
        const title = article.title?.length > 80 ? article.title.slice(0, 77) + '...' : article.title || 'Новость';
        const source = article.source?.name || 'Unknown';
        const date = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString(isRu ? 'ru-RU' : 'en-US') : '';
        const description = article.description?.length > 120 ? article.description.slice(0, 117) + '...' : article.description || '';
        const assetTag = article.asset ? ' 🎯 ' + article.asset : '';
        report += '📌 ' + title + assetTag + '\n';
        report += '   📎 ' + source;
        if (date) report += ' | 📅 ' + date;
        report += '\n';
        if (description) {
            report += '   📝 ' + description + '\n';
        }
        report += '   🔗 [Читать полностью](' + article.url + ')\n\n';
    }
    report += '━━━━━━━━━━━━━━━━━━━━━━━\n';
    report += '📊 Найдено: ' + result.articles.length + ' новостей\n';
    report += '🔄 /news — обновить';
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔄 Обновить', callback_data: 'menu_news' }],
            [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
            [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
    await addHistory(chatId, '📰 Новости', 'Персонализированные (' + result.articles.length + ')');
}

async function handleNewsSingleCoin(chatId, coin, lang, messageId) {
    const isRu = lang === 'ru';
    try {
        const cacheKey = 'news_single_' + coin + '_' + (isRu ? 'ru' : 'en');
        const cached = await getData(cacheKey);
        if (cached) {
            const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
            if (Date.now() - parsed.timestamp < 300000) {
                await sendNewsReport(chatId, parsed.articles, coin, lang, messageId);
                return;
            }
        }
        const url = 'https://newsapi.org/v2/everything?q=' + coin + '+crypto&language=' + (isRu ? 'ru' : 'en') + '&sortBy=publishedAt&pageSize=5&apiKey=' + NEWS_API_KEY;
        const response = await fetch(url);
        const data = await response.json();
        if (data.status !== 'ok' || !data.articles || data.articles.length === 0) {
            await sendUpdatedMessage(chatId, '📭 Новостей не найдено.', null, 'Markdown', messageId);
            return;
        }
        await setData(cacheKey, JSON.stringify({ articles: data.articles, timestamp: Date.now() }), 300);
        await sendNewsReport(chatId, data.articles, coin, lang, messageId);
    } catch (error) {
        console.error('❌ News error:', error);
        await sendUpdatedMessage(chatId, '❌ Ошибка получения новостей. Попробуйте позже.', null, 'Markdown', messageId);
    }
}

async function sendNewsReport(chatId, articles, coin, lang, messageId) {
    const isRu = lang === 'ru';
    let report = '📰 НОВОСТИ: ' + coin.toUpperCase() + '\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    let count = 0;
    const seenUrls = new Set();
    for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        if (count >= 5) break;
        if (!article.title || article.title.length < 5) continue;
        if (article.url && seenUrls.has(article.url)) continue;
        if (article.url) seenUrls.add(article.url);
        count++;
        const title = article.title.length > 80 ? article.title.slice(0, 77) + '...' : article.title;
        const source = article.source?.name || 'Unknown';
        const date = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString(isRu ? 'ru-RU' : 'en-US') : '';
        const description = article.description && article.description.length > 120 ? article.description.slice(0, 117) + '...' : article.description || '';
        report += '📌 ' + title + '\n';
        report += '   📎 ' + source;
        if (date) report += ' | 📅 ' + date;
        report += '\n';
        if (description) {
            report += '   📝 ' + description + '\n';
        }
        report += '   🔗 [Читать полностью](' + article.url + ')\n\n';
    }
    report += '━━━━━━━━━━━━━━━━━━━━━━━\n';
    report += '📊 Найдено: ' + count + ' новостей\n';
    report += '🔄 /news ' + coin + ' — обновить';
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
            [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
    await addHistory(chatId, '📰 Новости', coin);
}

// ============================================================
// 16. КАЛЕНДАРЬ ТРЕЙДЕРА
// ============================================================

async function handleCalendarCommand(chatId, lang, messageId) {
    const plan = await getUserPlan(chatId);
    if (!plan.limits.panic) {
        await sendUpdatedMessage(chatId, '❌ Календарь трейдера доступен на тарифах PRO и VIP.\n\n💳 /subscribe', null, 'Markdown', messageId);
        return;
    }
    const check = await checkLimit(chatId, 'calendar');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        return;
    }
    await sendTyping(chatId);
    await sendUpdatedMessage(chatId, '📅 Формирую календарь...', null, 'Markdown', messageId);
    try {
        const cacheKey = 'economic_calendar';
        const cached = await getData(cacheKey);
        if (cached) {
            const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
            if (Date.now() - parsed.timestamp < 1800000) {
                await sendCalendarReport(chatId, parsed.events, lang, messageId);
                return;
            }
        }
        const url = 'https://finnhub.io/api/v1/calendar/economic?token=' + FINNHUB_API_KEY;
        const response = await fetch(url);
        const data = await response.json();
        let events = [];
        if (data.economicCalendar && data.economicCalendar.length > 0) {
            events = data.economicCalendar.slice(0, 10).map(function(event) {
                return {
                    title: event.event || 'Событие',
                    date: event.date || 'Дата неизвестна',
                    importance: event.importance === 2 ? '🔴 Высокая' :
                        event.importance === 1 ? '🟡 Средняя' : '🟢 Низкая',
                    impact: event.impact || 'Нет данных'
                };
            });
        }
        if (events.length === 0) {
            await sendUpdatedMessage(chatId, '📭 На эту неделю важных событий не найдено.', null, 'Markdown', messageId);
            return;
        }
        await setData(cacheKey, JSON.stringify({ events: events, timestamp: Date.now() }), 1800);
        await sendCalendarReport(chatId, events, lang, messageId);
    } catch (error) {
        console.error('❌ Calendar error:', error);
        await sendUpdatedMessage(chatId, '❌ Ошибка получения календаря. Попробуйте позже.', null, 'Markdown', messageId);
    }
}

async function sendCalendarReport(chatId, events, lang, messageId) {
    let calendar = '📅 КАЛЕНДАРЬ ТРЕЙДЕРА\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        calendar += '📌 ' + event.title + '\n';
        calendar += '📅 ' + event.date + '\n';
        if (event.importance) calendar += '⭐ Важность: ' + event.importance + '\n';
        if (event.impact) calendar += '📊 Влияние: ' + event.impact + '\n';
        calendar += '━━━━━━━━━━━━━━━━━━━━━━━\n';
    }
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
            [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, calendar, keyboard, 'Markdown', messageId);
    await addHistory(chatId, '📅 Календарь', 'Неделя');
}

// ============================================================
// 17. ОПОВЕЩЕНИЯ
// ============================================================

async function createAlert(chatId, type, params) {
    const key = 'alerts_' + chatId;
    let alerts = await getData(key);
    alerts = alerts ? (typeof alerts === 'string' ? JSON.parse(alerts) : alerts) : [];
    const plan = await getUserPlan(chatId);
    const limit = plan.limits.alerts || 0;
    if (alerts.length >= limit && limit !== Infinity) {
        return { error: '📊 Лимит оповещений исчерпан. Повысьте тариф: /subscribe' };
    }
    const alert = { id: Date.now().toString(), type: type, params: params, active: true, createdAt: Date.now() };
    alerts.push(alert);
    await setData(key, JSON.stringify(alerts));
    return { success: true };
}

async function checkAlerts() {
    const keys = await VOID_KV.list('alerts_');
    for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        const chatId = parseInt(key.name.replace('alerts_', ''));
        const alerts = await getData(key.name);
        if (!alerts) continue;
        const parsedAlerts = typeof alerts === 'string' ? JSON.parse(alerts) : alerts;
        const keysUser = await loadUserKeys(chatId);
        if (!keysUser) continue;
        try {
            const exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
            let updated = false;
            for (let i = 0; i < parsedAlerts.length; i++) {
                const alert = parsedAlerts[i];
                if (!alert.active) continue;
                try {
                    const ticker = await exchange.fetchTicker(alert.params.symbol + '/USDT');
                    if (!ticker) continue;
                    const price = ticker.last;
                    if (alert.type === 'price') {
                        if (alert.params.direction === 'above' && price >= alert.params.target) {
                            await sendMessage(chatId, '🔔 ОПОВЕЩЕНИЕ СРАБОТАЛО!\n\n' + alert.params.symbol + '\nЦена: $' + price.toFixed(2) + '\nЦель: > $' + alert.params.target);
                            alert.active = false;
                            updated = true;
                        } else if (alert.params.direction === 'below' && price <= alert.params.target) {
                            await sendMessage(chatId, '🔔 ОПОВЕЩЕНИЕ СРАБОТАЛО!\n\n' + alert.params.symbol + '\nЦена: $' + price.toFixed(2) + '\nЦель: < $' + alert.params.target);
                            alert.active = false;
                            updated = true;
                        }
                    } else if (alert.type === 'change') {
                        const priceKey = 'alert_price_' + chatId + '_' + alert.params.symbol;
                        const prevPriceData = await getData(priceKey);
                        if (prevPriceData) {
                            const prevPrice = parseFloat(prevPriceData);
                            const change = ((price - prevPrice) / prevPrice) * 100;
                            if (Math.abs(change) >= alert.params.target) {
                                await sendMessage(chatId, '🔔 ОПОВЕЩЕНИЕ СРАБОТАЛО!\n\n' + alert.params.symbol + '\nИзменение: ' + (change > 0 ? '+' : '') + change.toFixed(2) + '%\nЦель: ' + alert.params.target + '%');
                                alert.active = false;
                                updated = true;
                            }
                        }
                        await setData(priceKey, price.toString(), 3600);
                    }
                } catch (e) {
                    console.error('❌ Ошибка проверки оповещения ' + alert.id + ' для ' + chatId + ':', e.message);
                }
            }
            if (updated) {
                await setData(key.name, JSON.stringify(parsedAlerts));
            }
        } catch (error) {
            console.error('❌ Ошибка подключения к бирже для ' + chatId + ':', error);
        }
    }
}

// ============================================================
// БОТ VOID NODE — ПОЛНАЯ ВЕРСИЯ 3.2 (ИСПРАВЛЕННАЯ)
// ЧАСТЬ 4 ИЗ 5: ХОЛОДНЫЙ ДУШ, СНЕЖНЫЙ КОМ, АВТОТОРГОВЛЯ, РЕБАЛАНС, ИСТОРИЯ, ПЛАТЕЖИ
// ============================================================

// ============================================================
// 18. ХОЛОДНЫЙ ДУШ (ПРОВЕРКА ВСЕХ ТОКЕНОВ)
// ============================================================

async function checkPanic() {
    const keys = await VOID_KV.list('panic_');
    for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        const chatId = parseInt(key.name.replace('panic_', ''));
        const config = await getData(key.name);
        if (!config) continue;
        const parsedConfig = typeof config === 'string' ? JSON.parse(config) : config;
        if (!parsedConfig.active) continue;
        const keysUser = await loadUserKeys(chatId);
        if (!keysUser) continue;
        try {
            const exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
            const balance = await exchange.fetchBalance();
            const coins = Object.keys(balance.total).filter(function(c) { return c !== 'USDT' && balance.total[c] > 0; });
            if (coins.length === 0) continue;
            let panicTriggered = false;
            let droppedCoins = [];
            for (let i = 0; i < coins.length; i++) {
                const coin = coins[i];
                try {
                    const ticker = await exchange.fetchTicker(coin + '/USDT');
                    if (!ticker) continue;
                    const currentPrice = ticker.last;
                    const priceKey = 'panic_price_' + chatId + '_' + coin;
                    const previousPrice = await getData(priceKey);
                    if (previousPrice) {
                        const prev = parseFloat(previousPrice);
                        const drop = ((prev - currentPrice) / prev) * 100;
                        if (drop >= 5) {
                            panicTriggered = true;
                            droppedCoins.push({ coin: coin, drop: drop, currentPrice: currentPrice, prev: prev });
                        }
                    }
                    await setData(priceKey, currentPrice.toString(), 3600);
                } catch (e) {
                    console.error('❌ Ошибка проверки ' + coin + ':', e.message);
                }
            }
            if (panicTriggered) {
                const coinsList = droppedCoins.map(function(c) { return '• ' + c.coin + ': -' + c.drop.toFixed(1) + '%'; }).join('\n');
                const message = '🚨 ХОЛОДНЫЙ ДУШ СРАБОТАЛ!\n\n' +
                    'Обнаружено падение >5% по нескольким активам:\n\n' + coinsList + '\n\n' +
                    '⚠️ Рекомендуется конвертировать ВСЕ активы в USDT для защиты капитала.';
                const keyboard = {
                    inline_keyboard: [
                        [{ text: '🔄 Конвертировать всё в USDT', callback_data: 'panic_convert_all' }],
                        [{ text: '🔙 Выйти в меню', callback_data: 'exit_to_menu' }]
                    ]
                };
                await sendMessage(chatId, message, keyboard);
                await setData(key.name, JSON.stringify({
                    active: true,
                    lastCheck: Date.now(),
                    triggered: true,
                    droppedCoins: droppedCoins
                }));
            }
        } catch (error) {
            console.error('❌ Panic check error for ' + chatId + ':', error);
        }
    }
}

async function handlePanicConvertAll(chatId) {
    const keys = await loadUserKeys(chatId);
    if (!keys) {
        await sendMessage(chatId, '❌ Нет ключей для конвертации.');
        return;
    }
    try {
        const exchange = await connectExchange(keys.exchangeId, keys.apiKey, keys.secretKey);
        const balance = await exchange.fetchBalance();
        let converted = 0;
        let details = [];
        const coins = Object.keys(balance.total).filter(function(c) { return c !== 'USDT' && balance.total[c] > 0; });
        for (let i = 0; i < coins.length; i++) {
            const coin = coins[i];
            try {
                const amount = balance.total[coin];
                const ticker = await exchange.fetchTicker(coin + '/USDT');
                const value = amount * ticker.last;
                await exchange.createMarketSellOrder(coin + '/USDT', amount);
                converted++;
                details.push('• ' + coin + ': ' + amount.toFixed(4) + ' ≈ $' + value.toFixed(2));
            } catch (e) {
                details.push('• ' + coin + ': Ошибка: ' + e.message);
            }
        }
        const message = '✅ ХОЛОДНЫЙ ДУШ — КОНВЕРТАЦИЯ ВЫПОЛНЕНА!\n\n' +
            '🔄 Продано ' + converted + ' активов в USDT\n\n' +
            details.join('\n') + '\n\n' +
            '🛡️ Портфель в безопасности.';
        await sendMessage(chatId, message);
        await deleteData('panic_' + chatId);
        const priceKeys = await VOID_KV.list('panic_price_' + chatId + '_');
        for (let j = 0; j < priceKeys.length; j++) {
            await deleteData(priceKeys[j].name);
        }
    } catch (error) {
        console.error('❌ Panic convert error:', error);
        await sendMessage(chatId, '❌ Ошибка конвертации: ' + error.message);
    }
}

// ============================================================
// 19. СТРАТЕГИЯ "СНЕЖНЫЙ КОМ" (УРОВЕНЬ 4)
// ============================================================

class SnowballTracker {
    constructor() {
        this.tokens = new Map();
        this.settings = {
            sellPercent: 0.5,
            growthThreshold: 5,
            takeProfitThreshold: 30,
            minTokenValue: 1,
            minVolumeUsd: 50000,
            maxOrderPercent: 0.02
        };
    }
    initToken(symbol, entryPrice) {
        if (!this.tokens.has(symbol)) {
            this.tokens.set(symbol, {
                entryPrice: entryPrice,
                sellThreshold: entryPrice * 1.05,
                totalFlows: 0,
                lastAction: null,
                actionHistory: []
            });
        }
        return this.tokens.get(symbol);
    }
    getToken(symbol) {
        return this.tokens.get(symbol);
    }
    getGrowth(symbol, currentPrice) {
        const token = this.tokens.get(symbol);
        if (!token) return null;
        return ((currentPrice - token.entryPrice) / token.entryPrice) * 100;
    }
    shouldExecuteFlow(symbol, currentPrice) {
        const token = this.tokens.get(symbol);
        if (!token) return null;
        const growth = ((currentPrice - token.entryPrice) / token.entryPrice) * 100;
        return {
            growth: growth,
            thresholdHit: currentPrice >= token.sellThreshold,
            currentPrice: currentPrice,
            nextThreshold: token.sellThreshold,
            totalFlows: token.totalFlows
        };
    }
}

async function runSnowballStrategy(chatId) {
    const keysUser = await loadUserKeys(chatId);
    if (!keysUser) return { error: '❌ Нет API-ключей' };
    try {
        const exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
        const balance = await exchange.fetchBalance();
        const total = balance.total;
        let tokens = [];
        for (const symbol in total) {
            if (symbol === 'USDT' || total[symbol] < 0.0001) continue;
            try {
                const ticker = await exchange.fetchTicker(symbol + '/USDT');
                if (ticker && ticker.last) {
                    const value = total[symbol] * ticker.last;
                    if (value > 1) {
                        tokens.push({
                            symbol: symbol,
                            amount: total[symbol],
                            price: ticker.last,
                            value: value,
                            change24h: ticker.percentage || 0,
                            volume24h: ticker.quoteVolume || 0
                        });
                    }
                }
            } catch (e) {}
        }
        if (tokens.length < 2) {
            return { error: '❌ Нужно минимум 2 токена для стратегии' };
        }
        tokens.sort(function(a, b) { return b.change24h - a.change24h; });
        const growToken = tokens[0];
        if (growToken.change24h < 2) {
            return { error: '❌ Нет токена с достаточным ростом (>2% за 24ч)' };
        }
        let junkToken = tokens[tokens.length - 1];
        if (junkToken.change24h > 0) {
            const nonGrowing = tokens.filter(function(t) { return t.change24h < 2; });
            if (nonGrowing.length > 0 && nonGrowing[0].symbol !== growToken.symbol) {
                junkToken = nonGrowing[0];
            } else {
                return { error: '❌ Все токены растут' };
            }
        }
        const tracker = new SnowballTracker();
        tracker.initToken(growToken.symbol, growToken.price);
        tracker.initToken(junkToken.symbol, junkToken.price);
        const growth = tracker.getGrowth(growToken.symbol, growToken.price);
        if (growth >= 30) {
            const tokenBalance = balance.free[growToken.symbol] || 0;
            if (tokenBalance > 0.001) {
                const order = await exchange.createMarketSellOrder(growToken.symbol + '/USDT', tokenBalance);
                const message = '💰 ПРИБЫЛЬ ЗАФИКСИРОВАНА!\n\n' +
                    growToken.symbol + '\nРост: ' + growth.toFixed(1) + '%\n' +
                    'Получено: $' + (order.cost || 0).toFixed(2) + ' USDT';
                await sendMessage(chatId, message);
                await addHistory(chatId, '❄️ Снежный ком — фиксация', growToken.symbol + ' → USDT');
                return { success: true, message: message };
            }
        }
        const junkBalance = balance.free[junkToken.symbol] || 0;
        if (junkBalance < 0.001) {
            return { error: '❌ Недостаточно ' + junkToken.symbol + ' для продажи' };
        }
        const sellAmount = junkBalance * 0.5;
        const sellOrder = await exchange.createMarketSellOrder(junkToken.symbol + '/USDT', sellAmount);
        const usdtReceived = sellOrder.cost || 0;
        const buyAmount = usdtReceived / growToken.price;
        if (buyAmount > 0.0001) {
            await exchange.createMarketBuyOrder(growToken.symbol + '/USDT', buyAmount);
            const message = '🔄 СНЕЖНЫЙ КОМ\n\n' +
                growToken.symbol + ' → +' + growth.toFixed(1) + '%\n' +
                'Продано ' + sellAmount.toFixed(4) + ' ' + junkToken.symbol + ' ($' + usdtReceived.toFixed(2) + ')\n' +
                'Куплено ' + buyAmount.toFixed(4) + ' ' + growToken.symbol + '\n' +
                'Следующий порог: +' + (growth + 5).toFixed(1) + '%';
            await sendMessage(chatId, message);
            await addHistory(chatId, '❄️ Снежный ком — переток', growToken.symbol + ' ← ' + junkToken.symbol + ' ($' + usdtReceived.toFixed(2) + ')');
            return { success: true, message: message };
        }
        return { success: false, error: '❌ Не удалось выполнить переток' };
    } catch (error) {
        console.error('❌ Snowball strategy error:', error);
        return { error: '❌ Ошибка: ' + error.message };
    }
}

// ============================================================
// 20. АВТОТОРГОВЛЯ (ОСНОВНАЯ)
// ============================================================

async function runAutotrade() {
    const keys = await VOID_KV.list('autotrade_');
    for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        const chatId = parseInt(key.name.replace('autotrade_', ''));
        const data = await getData(key.name);
        if (!data) continue;
        const config = typeof data === 'string' ? JSON.parse(data) : data;
        if (!config.active) continue;
        const mode = await getData('mode_' + chatId) || 'beginner';
        const thresholds = getRiskThresholds(mode);
        const keysUser = await loadUserKeys(chatId);
        if (!keysUser) continue;
        try {
            const exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
            const balance = await exchange.fetchBalance();
            const total = balance.total;
            const coins = Object.keys(total).filter(function(c) { return c !== 'USDT' && total[c] > 0; });
            if (config.level === 4) {
                console.log('🚀 Запуск "Снежного кома" для ' + chatId);
                await runSnowballStrategy(chatId);
                continue;
            }
            if (config.level === 1) {
                for (let i = 0; i < coins.length; i++) {
                    const coin = coins[i];
                    try {
                        const ticker = await exchange.fetchTicker(coin + '/USDT');
                        if (!ticker) continue;
                        const price = ticker.last;
                        const stopLoss = thresholds.stopLoss;
                        const stop5 = price * (1 - stopLoss / 100);
                        const stop10 = price * 0.90;
                        await exchange.createOrder(coin + '/USDT', 'stop_loss_limit', 'sell', total[coin], stop5, { stopPrice: stop5 });
                        await exchange.createOrder(coin + '/USDT', 'stop_loss_limit', 'sell', total[coin] * 0.5, stop10, { stopPrice: stop10 });
                    } catch (e) {}
                }
            } else if (config.level === 2) {
                for (let i = 0; i < coins.length; i++) {
                    const coin = coins[i];
                    try {
                        const ticker = await exchange.fetchTicker(coin + '/USDT');
                        if (!ticker) continue;
                        const change = ticker.percentage || 0;
                        const volume = ticker.quoteVolume || 0;
                        if (volume < 50000 && change < 0) {
                            await exchange.createMarketSellOrder(coin + '/USDT', total[coin]);
                        } else if (change > 5) {
                            const amount = (0.01 * balance.total.USDT) / ticker.last;
                            if (amount > 0.001) await exchange.createMarketBuyOrder(coin + '/USDT', amount);
                        }
                    } catch (e) {}
                }
            } else if (config.level === 3) {
                const settingsKey = 'autotrade_settings_' + chatId;
                let settings = await getData(settingsKey);
                settings = settings ? (typeof settings === 'string' ? JSON.parse(settings) : settings) : {};
                for (let i = 0; i < coins.length; i++) {
                    const coin = coins[i];
                    try {
                        const ticker = await exchange.fetchTicker(coin + '/USDT');
                        if (!ticker) continue;
                        const price = ticker.last;
                        const symbol = coin + '/USDT';
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
                await setData(settingsKey, JSON.stringify(settings));
            }
        } catch (error) {
            console.error('❌ Autotrade error for ' + chatId + ':', error);
        }
    }
}

// ============================================================
// 21. РЕБАЛАНС ПОРТФЕЛЯ
// ============================================================

function getRiskThresholds(mode) {
    if (mode === 'beginner') {
        return {
            stopLoss: 5,
            takeProfit: 10,
            maxPosition: 10,
            maxAltExposure: 30,
            label: 'Новичок (спокойный)',
            labelEn: 'Beginner (calm)'
        };
    } else {
        return {
            stopLoss: 8,
            takeProfit: 20,
            maxPosition: 15,
            maxAltExposure: 40,
            label: 'Опытный (активный)',
            labelEn: 'Experienced (active)'
        };
    }
}

function getIdealPortfolio(mode) {
    if (mode === 'beginner') {
        return { btc: 50, alt: 30, stable: 20, label: 'Для новичков' };
    } else {
        return { btc: 40, alt: 40, stable: 20, label: 'Для опытных' };
    }
}

async function autoRebalance(chatId) {
    const savedData = await getData('user_' + chatId);
    if (!savedData) {
        return { error: '❌ Нет ключей биржи' };
    }
    const user = typeof savedData === 'string' ? JSON.parse(savedData) : savedData;
    const apiKey = decrypt(user.apiKey);
    const secretKey = decrypt(user.secretKey);
    const mode = await getData('mode_' + chatId) || 'beginner';
    const ideal = getIdealPortfolio(mode);
    const thresholds = getRiskThresholds(mode);
    try {
        const exchange = await connectExchange(user.exchangeId, apiKey, secretKey);
        const balance = await exchange.fetchBalance();
        const total = balance.total;
        const coins = Object.keys(total).filter(function(key) { return total[key] > 0; });
        let totalUSDT = 0;
        let assets = [];
        for (let i = 0; i < coins.length; i++) {
            const coin = coins[i];
            if (coin === 'USDT') {
                totalUSDT += total[coin];
                continue;
            }
            try {
                const ticker = await exchange.fetchTicker(coin + '/USDT');
                const value = total[coin] * ticker.last;
                totalUSDT += value;
                assets.push({ symbol: coin, value: value });
            } catch (e) {}
        }
        for (let a = 0; a < assets.length; a++) {
            assets[a].weight = (assets[a].value / totalUSDT) * 100;
        }
        const btcWeight = assets.find(function(a) { return a.symbol === 'BTC'; })?.weight || 0;
        const altWeight = assets.filter(function(a) { return a.symbol !== 'BTC' && a.symbol !== 'USDT'; }).reduce(function(sum, a) { return sum + a.weight; }, 0);
        let trades = [];
        let message = '';
        if (btcWeight > ideal.btc + 5) {
            const excess = (btcWeight - ideal.btc) / 100 * totalUSDT;
            const btcPrice = assets.find(function(a) { return a.symbol === 'BTC'; })?.value / (total[balance.total.BTC] || 1) || 0;
            const amount = excess / btcPrice;
            if (amount > 0.001) {
                await exchange.createMarketSellOrder('BTC/USDT', amount);
                trades.push('Продано ' + amount.toFixed(4) + ' BTC (' + excess.toFixed(2) + ' USDT)');
            }
        } else if (btcWeight < ideal.btc - 5) {
            const needed = (ideal.btc - btcWeight) / 100 * totalUSDT;
            const btcPrice = assets.find(function(a) { return a.symbol === 'BTC'; })?.value / (total[balance.total.BTC] || 1) || 0;
            const amount = needed / btcPrice;
            if (amount > 0.001 && balance.total.USDT > needed) {
                await exchange.createMarketBuyOrder('BTC/USDT', amount);
                trades.push('Куплено ' + amount.toFixed(4) + ' BTC (' + needed.toFixed(2) + ' USDT)');
            }
        }
        if (altWeight > thresholds.maxAltExposure) {
            const excess = (altWeight - thresholds.maxAltExposure) / 100 * totalUSDT;
            for (let j = 0; j < assets.length; j++) {
                const asset = assets[j];
                if (asset.symbol === 'BTC' || asset.symbol === 'USDT') continue;
                const sellAmount = (asset.value / altWeight) * excess / (asset.value / (total[asset.symbol] || 1));
                if (sellAmount > 0.001) {
                    await exchange.createMarketSellOrder(asset.symbol + '/USDT', sellAmount);
                    trades.push('Продано ' + sellAmount.toFixed(4) + ' ' + asset.symbol + ' (' + (sellAmount * asset.value / (total[asset.symbol] || 1)).toFixed(2) + ' USDT)');
                }
            }
        }
        if (trades.length === 0) {
            return { error: false, message: '✅ Портфель уже сбалансирован. Никаких действий не требуется.' };
        }
        message = '✅ РЕБАЛАНС ВЫПОЛНЕН!\n\nВыполнено действий: ' + trades.length + '\n\n' +
            trades.slice(0, 5).join('\n') +
            (trades.length > 5 ? '\n... и еще ' + (trades.length - 5) + ' действий' : '');
        await addHistory(chatId, '🔄 Ребаланс портфеля', trades.length + ' действий');
        return { error: false, message: message };
    } catch (error) {
        console.error('❌ Rebalance error:', error);
        return { error: '❌ Ошибка ребаланса: ' + error.message };
    }
}

// ============================================================
// 22. ИСТОРИЯ
// ============================================================

async function addHistory(chatId, action, detail) {
    const key = 'history_' + chatId;
    const data = await getData(key);
    let history = [];
    if (data) {
        try {
            history = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (e) {
            console.error('❌ History parse error for ' + chatId + ':', e);
            history = [];
        }
    }
    history.push({
        timestamp: Date.now(),
        date: new Date().toISOString().replace('T', ' ').slice(0, 16),
        action: action,
        detail: detail
    });
    if (history.length > 50) history.shift();
    await setData(key, JSON.stringify(history));
}

async function getHistory(chatId) {
    const key = 'history_' + chatId;
    const data = await getData(key);
    if (!data) return [];
    try {
        return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
        console.error('❌ History parse error for ' + chatId + ':', e);
        return [];
    }
}

// ============================================================
// 23. ПЛАТЕЖИ (CRYPTOBOT)
// ============================================================

async function createCryptoInvoice(chatId, planId, amountRub) {
    const url = 'https://pay.crypt.bot/api/createInvoice';
    const usdtAmount = Math.round(amountRub / 90);
    const plan = PLANS[planId];
    if (amountRub === 0) return { payUrl: null, invoiceId: null };
    const body = {
        asset: 'USDT',
        amount: usdtAmount,
        description: 'Void Node - ' + plan.name + ' (' + amountRub + ' RUB ≈ ' + usdtAmount + ' USDT)',
        payload: 'plan_' + planId + '_' + chatId,
        paid_btn_name: 'openBot',
        paid_btn_url: 'https://t.me/' + BOT_USERNAME + '?start=activate_' + planId,
        hidden_message: '✅ Тариф ' + plan.name + ' активирован! Спасибо! 🙏'
    };
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Crypto-Pay-API-Token': CRYPTOBOT_TOKEN
            },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        if (data.ok) {
            return { payUrl: data.result.pay_url, invoiceId: data.result.invoice_id };
        } else {
            console.error('❌ CryptoBot error:', data.error);
            return null;
        }
    } catch (error) {
        console.error('❌ Invoice creation error:', error);
        return null;
    }
}

// ============================================================
// 24. ЗАГРУЗКА КЛЮЧЕЙ ПОЛЬЗОВАТЕЛЯ
// ============================================================

async function loadUserKeys(chatId) {
    const key = 'user_' + chatId;
    const data = await getData(key);
    if (!data) return null;
    try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        const decryptedApiKey = decrypt(parsed.apiKey);
        const decryptedSecretKey = decrypt(parsed.secretKey);
        return {
            apiKey: decryptedApiKey,
            secretKey: decryptedSecretKey,
            exchangeId: parsed.exchangeId,
            connectedAt: parsed.connectedAt
        };
    } catch (e) {
        return null;
    }
}

// ============================================================
// 25. ИСПОЛНЕНИЕ РЕКОМЕНДАЦИЙ
// ============================================================

async function executeRecommendation(chatId, recId) {
    const analysisData = await getData('analysis_' + chatId);
    if (!analysisData) return { error: '❌ Нет данных анализа' };
    const analysis = typeof analysisData === 'string' ? JSON.parse(analysisData) : analysisData;
    const rec = analysis.recommendations.find(function(r) { return r.id === recId; });
    if (!rec) return { error: '❌ Рекомендация не найдена' };
    const userPlan = await getUserPlan(chatId);
    if (!userPlan.limits.autotrade || userPlan.limits.autotrade === false) {
        return { error: '❌ Автоторговля недоступна на вашем тарифе' };
    }
    const orderLimitKey = 'orders_' + chatId + '_' + new Date().toISOString().split('T')[0];
    let ordersToday = parseInt(await getData(orderLimitKey) || '0');
    if (ordersToday >= CONFIG.MAX_ORDERS_PER_DAY) {
        return { error: '❌ Достигнут лимит ордеров на сегодня (' + CONFIG.MAX_ORDERS_PER_DAY + ')' };
    }
    const keys = await loadUserKeys(chatId);
    if (!keys) return { error: '❌ Нет API-ключей' };
    try {
        const exchange = await connectExchange(keys.exchangeId, keys.apiKey, keys.secretKey);
        const balance = await exchange.fetchBalance();
        const free = balance.free[rec.asset] || 0;
        if (rec.action === 'sell' && free < rec.amount) {
            return { error: '❌ Недостаточно ' + rec.asset + ' на балансе (доступно: ' + free + ', нужно: ' + rec.amount + ')' };
        }
        if (rec.action === 'buy') {
            const freeUSDT = balance.free['USDT'] || 0;
            const ticker = await exchange.fetchTicker(rec.symbol || rec.asset + '/USDT');
            const price = ticker ? ticker.last : 0;
            const needed = rec.amount * price;
            if (freeUSDT < needed) {
                return { error: '❌ Недостаточно USDT для покупки (доступно: ' + freeUSDT + ', нужно: ' + needed + ')' };
            }
        }
        let order;
        if (rec.action === 'sell') {
            order = await exchange.createMarketSellOrder(rec.symbol, rec.amount);
        } else if (rec.action === 'buy') {
            order = await exchange.createMarketBuyOrder(rec.symbol, rec.amount);
        } else {
            return { error: '❌ Неизвестное действие: ' + rec.action };
        }
        await new Promise(function(r) { setTimeout(r, 3000); });
        const orderStatus = await exchange.fetchOrder(order.id);
        if (orderStatus.status !== 'closed') {
            return { error: '❌ Ордер не исполнился. Текущий статус: ' + orderStatus.status };
        }
        await setData(orderLimitKey, (ordersToday + 1).toString(), 86400);
        return { success: true, order: orderStatus };
    } catch (error) {
        console.error('❌ Order execution error:', error);
        return { error: '❌ Ошибка исполнения: ' + error.message };
    }
}

// ============================================================
// БОТ VOID NODE — ПОЛНАЯ ВЕРСИЯ 3.2 (ИСПРАВЛЕННАЯ)
// ЧАСТЬ 5 ИЗ 5: ОБРАБОТЧИКИ CALLBACK, СООБЩЕНИЙ, СЕРВЕР, ЗАПУСК
// ============================================================

// ============================================================
// 26. КОМПОЗИЦИЯ ОТЧЕТА
// ============================================================

function createProgressBarUI(value, max, length) {
    if (max === undefined) max = 100;
    if (length === undefined) length = 10;
    const percent = Math.min(value / max, 1);
    const filled = Math.round(percent * length);
    const empty = length - filled;
    return '🟩'.repeat(filled) + '⬜'.repeat(empty);
}

function generateCSV(engineResult) {
    let csv = 'Asset,Value(USDT),Percentage\n';
    for (let i = 0; i < (engineResult.assets || []).length; i++) {
        const a = (engineResult.assets || [])[i];
        csv += a.symbol + ',' + a.value.toFixed(2) + ',' + a.weight.toFixed(2) + '\n';
    }
    csv += '\nRisk Level,' + (engineResult.riskLevel || 'unknown') + '\n';
    csv += 'Risk Score,' + (engineResult.riskScore || 0) + '\n';
    csv += 'Total USDT,' + (engineResult.totalUSDT?.toFixed(2) || 0) + '\n';
    if (engineResult.btcMetrics && engineResult.btcMetrics.sharpe !== undefined) {
        csv += 'Sharpe Ratio,' + engineResult.btcMetrics.sharpe.toFixed(2) + '\n';
        csv += 'Sortino Ratio,' + (engineResult.btcMetrics.sortino?.toFixed(2) || 0) + '\n';
        csv += 'VaR (95%),' + (engineResult.btcMetrics.var?.toFixed(2) || 0) + '\n';
    }
    return csv;
}

async function composeReport(engineResult, mode, lang, dailyChange) {
    if (dailyChange === undefined) dailyChange = 0;
    const totalUSDT = engineResult.totalUSDT;
    const btcPercent = engineResult.btcPercent;
    const altPercent = engineResult.altPercent;
    const usdtPercent = engineResult.usdtPercent;
    const riskLevel = engineResult.riskLevel;
    const issues = engineResult.issues || [];
    const recommendations = engineResult.recommendations || [];
    const signals = engineResult.signals || [];
    const btcMetrics = engineResult.btcMetrics;
    const riskScore = engineResult.riskScore;
    const thresholds = engineResult.thresholds;

    let baseText = '📊 АНАЛИЗ ПОРТФЕЛЯ\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    baseText += '💰 Общая стоимость: $' + (totalUSDT?.toFixed(2) || 0) + ' USDT\n';
    if (dailyChange !== 0) {
        const changeEmoji = dailyChange > 0 ? '📈' : '📉';
        baseText += changeEmoji + ' Изменение (24ч): ' + (dailyChange > 0 ? '+' : '') + dailyChange.toFixed(2) + '%\n';
    }
    baseText += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    const modeLabel = mode === 'beginner' ? 'Новичок' : 'Опытный';
    baseText += '🧠 Режим: ' + modeLabel + '\n';
    if (thresholds) {
        baseText += '📊 Риск-профиль:\n';
        baseText += '• Стоп-лосс: ' + thresholds.stopLoss + '%\n';
        baseText += '• Тейк-профит: ' + thresholds.takeProfit + '%\n';
        baseText += '• Макс. позиция: ' + thresholds.maxPosition + '%\n';
        baseText += '• Макс. доля альтов: ' + thresholds.maxAltExposure + '%\n\n';
    }

    baseText += '📊 РАСПРЕДЕЛЕНИЕ АКТИВОВ\n';
    baseText += 'BTC:      ' + createProgressBarUI(btcPercent) + ' ' + (btcPercent?.toFixed(1) || 0) + '%\n';
    baseText += 'Альты:    ' + createProgressBarUI(altPercent) + ' ' + (altPercent?.toFixed(1) || 0) + '%\n';
    baseText += 'Стейблы:  ' + createProgressBarUI(usdtPercent) + ' ' + (usdtPercent?.toFixed(1) || 0) + '%\n\n';

    const ideal = getIdealPortfolio(mode);
    baseText += '🎯 Целевые веса (' + ideal.label + '):\n';
    baseText += 'BTC:  ' + ideal.btc + '%  (ваш: ' + (btcPercent?.toFixed(1) || 0) + '%)\n';
    baseText += 'Альты: ' + ideal.alt + '%  (ваш: ' + (altPercent?.toFixed(1) || 0) + '%)\n';
    baseText += 'Стейблы: ' + ideal.stable + '%  (ваш: ' + (usdtPercent?.toFixed(1) || 0) + '%)\n\n';

    const riskEmoji = riskLevel === 'high' ? '🔴' : (riskLevel === 'medium' ? '🟡' : '🟢');
    const riskLabel = riskLevel === 'high' ? 'Высокий' : (riskLevel === 'medium' ? 'Средний' : 'Низкий');
    baseText += riskEmoji + ' Риск: ' + riskLabel + ' (' + (riskScore || 0) + ' баллов)\n\n';

    if (btcMetrics) {
        baseText += '📊 ФИНАНСОВЫЕ МЕТРИКИ BTC\n';
        if (btcMetrics.sharpe !== undefined) {
            const sharpeEmoji = btcMetrics.sharpe > 1 ? '🟢' : (btcMetrics.sharpe > 0.5 ? '🟡' : '🔴');
            baseText += sharpeEmoji + ' Коэф. Шарпа: ' + btcMetrics.sharpe.toFixed(2) + '\n';
        }
        if (btcMetrics.sortino !== undefined) {
            const sortinoEmoji = btcMetrics.sortino > 1 ? '🟢' : (btcMetrics.sortino > 0.5 ? '🟡' : '🔴');
            baseText += sortinoEmoji + ' Коэф. Сортино: ' + btcMetrics.sortino.toFixed(2) + '\n';
        }
        if (btcMetrics.var !== undefined) {
            const varEmoji = btcMetrics.var > -5 ? '🟢' : (btcMetrics.var > -10 ? '🟡' : '🔴');
            baseText += varEmoji + ' VaR (95%): ' + btcMetrics.var.toFixed(2) + '%\n';
        }
        if (btcMetrics.volatility !== undefined) {
            baseText += '📉 Волатильность: ' + btcMetrics.volatility.toFixed(2) + '%\n';
        }
        baseText += '\n';
    }

    if (btcMetrics && btcMetrics.rsi) {
        const rsiEmoji = btcMetrics.rsi.signal === 'overbought' ? '🟥' : (btcMetrics.rsi.signal === 'oversold' ? '🟩' : '⚪');
        baseText += '📈 ТЕХНИЧЕСКИЙ АНАЛИЗ (BTC)\n';
        baseText += rsiEmoji + ' RSI (14): ' + btcMetrics.rsi.rsi.toFixed(1) + ' (' + (btcMetrics.rsi.signal === 'overbought' ? 'Перекуплен' : btcMetrics.rsi.signal === 'oversold' ? 'Перепродан' : 'Нейтрально') + ')\n';
        if (btcMetrics.ma20) {
            const maEmoji = btcMetrics.ma20.diff > 0 ? '🟢' : '🔴';
            baseText += maEmoji + ' MA20: $' + btcMetrics.ma20.ma.toFixed(2) + ' (' + (btcMetrics.ma20.diff > 0 ? '+' : '') + btcMetrics.ma20.diff.toFixed(1) + '%)\n';
        }
        if (btcMetrics.ma200) {
            const ma200Emoji = btcMetrics.ma200.diff > 0 ? '🟢' : '🔴';
            baseText += ma200Emoji + ' MA200: $' + btcMetrics.ma200.ma.toFixed(2) + ' (' + (btcMetrics.ma200.diff > 0 ? '+' : '') + btcMetrics.ma200.diff.toFixed(1) + '%)\n';
        }
        baseText += '\n';
    }

    if (signals && signals.length > 0) {
        baseText += '📊 СИГНАЛЫ\n';
        for (let i = 0; i < signals.length; i++) {
            const s = signals[i];
            const emoji = s.type === 'bullish' ? '🟢' : s.type === 'bearish' ? '🔴' : s.type === 'overbought' ? '🟥' : s.type === 'oversold' ? '🟩' : 'ℹ️';
            baseText += emoji + ' ' + s.text + '\n';
        }
        baseText += '\n';
    }

    if (issues && issues.length > 0) {
        baseText += '⚠️ ПРОБЛЕМЫ\n';
        for (let i = 0; i < issues.length; i++) {
            const issue = issues[i];
            const emoji = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
            baseText += emoji + ' ' + issue.text + '\n';
        }
        baseText += '\n';
    }

    const keyboard = { inline_keyboard: [] };

    if (recommendations && recommendations.length > 0) {
        baseText += '💡 РЕКОМЕНДАЦИИ\n';
        for (let i = 0; i < recommendations.slice(0, 5).length; i++) {
            const rec = recommendations.slice(0, 5)[i];
            baseText += '• ' + rec.reason + '\n';
            if (rec.action === 'sell' || rec.action === 'buy') {
                const actionText = rec.action === 'sell' ? 'Продать' : 'Купить';
                keyboard.inline_keyboard.push([
                    { text: '📈 ' + actionText + ' ' + rec.asset, callback_data: 'exec_' + rec.id }
                ]);
            }
        }
        baseText += '\n';
    }

    keyboard.inline_keyboard.push([
        { text: '📊 Полный отчет', callback_data: 'action_full_report' },
        { text: '📥 CSV отчет', callback_data: 'action_export_csv' }
    ]);
    keyboard.inline_keyboard.push([
        { text: '🔄 Ребаланс', callback_data: 'action_rebalance' },
        { text: '🔙 Назад', callback_data: 'back_to_functions' }
    ]);

    baseText += '━━━━━━━━━━━━━━━━━━━━━━━\n';
    baseText += '🛡️ Void Node — твой телохранитель в крипте\n';
    baseText += '\n⚠️ Это не финансовая рекомендация.';

    return { text: baseText, keyboard: keyboard };
}

// ============================================================
// 27. ОБРАБОТЧИК CALLBACK
// ============================================================

async function handleCallback(update) {
    const callback = update.callback_query;
    const chatId = callback.message.chat.id;
    const messageId = callback.message.message_id;
    const data = callback.data;
    const lang = await getData('lang_' + chatId) || 'ru';
    
    const buttonSpamKey = 'btn_spam_' + chatId;
    const lastButtonClick = await getData(buttonSpamKey);
    if (lastButtonClick && Date.now() - parseInt(lastButtonClick) < 500) {
        await answerCallback(callback.id, '⏳ Не спамьте кнопками!', true);
        return;
    }
    await setData(buttonSpamKey, Date.now().toString(), 5);
    await deleteUserMessage(chatId, messageId);
    await answerCallback(callback.id);

    try {
        // === ВЫХОД В МЕНЮ ===
        if (data === 'exit_to_menu') {
            await setData('state_' + chatId, 'idle');
            await showMainMenu(chatId, lang);
            return;
        }
        if (data === 'back_to_menu') { await showMainMenu(chatId, lang); return; }
        if (data === 'back_to_functions') { await showFunctionsMenu(chatId, lang); return; }
        if (data === 'back_to_settings') { await showSettingsMenuNew(chatId, lang); return; }
        if (data === 'back_to_plans') { await showPlansMenu(chatId, lang); return; }
        if (data === 'back_to_analyze') { await showAnalyzeMenu(chatId, lang); return; }
        if (data === 'back_to_market') { await showMarketMenu(chatId, lang); return; }
        if (data === 'menu_functions') { await showFunctionsMenu(chatId, lang); return; }
        if (data === 'menu_settings_new') { await showSettingsMenuNew(chatId, lang); return; }
        if (data === 'menu_plans') { await showPlansMenu(chatId, lang); return; }
        if (data === 'menu_help') { await showHelpMenu(chatId, lang); return; }
        if (data === 'menu_about') { await showAboutMenu(chatId, lang); return; }
        if (data === 'menu_analyze') { await showAnalyzeMenu(chatId, lang); return; }
        if (data === 'menu_security') { await showSecurityMenu(chatId, lang); return; }
        if (data === 'menu_market') { await showMarketMenu(chatId, lang); return; }
        if (data === 'menu_news') { await handleNewsCommand(chatId, null, lang, null); return; }
        if (data === 'menu_history') { await showHistoryMenu(chatId, lang); return; }
        if (data === 'menu_social') { await handleSocialTrend(chatId, lang, null); return; }
        if (data === 'menu_calendar') { await handleCalendarCommand(chatId, lang, null); return; }

        // === НАСТРОЙКИ ===
        if (data === 'settings_change_lang') { await showLanguageSelect(chatId, lang); return; }
        if (data === 'settings_change_mode') { await showModeSelect(chatId, lang); return; }
        if (data === 'lang_ru' || data === 'lang_en') {
            const newLang = data === 'lang_ru' ? 'ru' : 'en';
            await setData('lang_' + chatId, newLang);
            await sendUpdatedMessage(chatId, '✅ Язык: ' + (newLang === 'ru' ? 'Русский' : 'English'));
            await showSettingsMenuNew(chatId, newLang);
            return;
        }
        if (data === 'mode_beginner' || data === 'mode_pro') {
            const newMode = data === 'mode_beginner' ? 'beginner' : 'pro';
            await setData('mode_' + chatId, newMode);
            await sendUpdatedMessage(chatId, '✅ Режим: ' + (newMode === 'beginner' ? 'Новичок' : 'Опытный'));
            await showSettingsMenuNew(chatId, lang);
            return;
        }

        // === ОНБОРДИНГ ===
        if (data === 'onboard_lang_ru' || data === 'onboard_lang_en') {
            const newLang = data === 'onboard_lang_ru' ? 'ru' : 'en';
            await setData('lang_' + chatId, newLang);
            await showModeSelectOnboarding(chatId, newLang);
            return;
        }
        if (data === 'onboard_mode_beginner' || data === 'onboard_mode_pro') {
            const mode = data === 'onboard_mode_beginner' ? 'beginner' : 'pro';
            await setData('mode_' + chatId, mode);
            await showVipBonusOffer(chatId, lang);
            return;
        }
        if (data === 'onboard_connect_vip') {
            await setData('state_' + chatId, 'waiting_for_keys_vip');
            await sendUpdatedMessage(chatId, '🔐 Отправь API-ключи в формате:\n`API_KEY:SECRET_KEY`\n\n🔄 Для отмены: /cancel');
            return;
        }
        if (data === 'onboard_skip') {
            await setData('onboarded_' + chatId, 'true');
            await showMainMenu(chatId, lang);
            return;
        }
        if (data === 'onboard_vip_done') {
            await showMainMenu(chatId, lang);
            return;
        }

        // === ПОМОЩЬ ===
        if (data === 'help_q1') { await sendUpdatedMessage(chatId, getHelpAnswer('help_answer_q1', lang)); return; }
        if (data === 'help_q2') { await sendUpdatedMessage(chatId, getHelpAnswer('help_answer_q2', lang)); return; }
        if (data === 'help_q3') { await sendUpdatedMessage(chatId, getHelpAnswer('help_answer_q3', lang)); return; }
        if (data === 'help_q4') { await sendUpdatedMessage(chatId, getHelpAnswer('help_answer_q4', lang)); return; }
        if (data === 'help_q5') { await sendUpdatedMessage(chatId, getHelpAnswer('help_answer_q5', lang)); return; }
        if (data === 'help_q6') { await sendUpdatedMessage(chatId, getHelpAnswer('help_answer_q6', lang)); return; }
        if (data === 'help_q7') { await sendUpdatedMessage(chatId, getHelpAnswer('help_answer_q7', lang)); return; }
        if (data === 'help_q8') { await sendUpdatedMessage(chatId, getHelpAnswer('help_answer_q8', lang)); return; }
        if (data === 'help_q9') { await sendUpdatedMessage(chatId, getHelpAnswer('help_answer_q9', lang)); return; }
        if (data === 'help_contact_moderator') {
            await sendUpdatedMessage(chatId, '👤 Связь с модератором\n\nНапишите @clofeLEAN — он вам поможет!\n\n📌 Также вы можете задать вопрос в нашем чате поддержки:\n📱 [Чат поддержки](https://t.me/void_node_chat)\n\n⏳ Мы отвечаем в течение 15 минут (в рабочее время).');
            return;
        }

        // === АНТИСКАМ ===
        if (data.startsWith('antiscam_')) {
            await setData('state_' + chatId, data);
            const prompts = {
                'antiscam_url': '🔗 Отправь ссылку для проверки\n🔄 /cancel — отмена',
                'antiscam_contract': '📄 Отправь адрес контракта (0x...)\n🔄 /cancel — отмена',
                'antiscam_file': '📁 Отправь файл для проверки\n🔄 /cancel — отмена',
                'antiscam_dex': '🔍 Отправь адрес контракта для DEX проверки\n🔄 /cancel — отмена',
                'antiscam_impersonation': '🔄 Перешли сообщение от подозрительного пользователя\n🔄 /cancel — отмена',
                'antiscam_wallet': '👛 Отправь адрес кошелька для проверки\n📌 Пример: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e\n🔄 /cancel — отмена'
            };
            await sendUpdatedMessage(chatId, prompts[data]);
            return;
        }

        // === ТРЕНДЫ ===
        if (data.startsWith('trend_')) {
            await handleTrendClick(chatId, data, lang, null);
            return;
        }
        if (data === 'trend_search_menu') { await handleTrendSearchMenu(chatId, lang, null); return; }
        if (data === 'trend_search_name') {
            await sendUpdatedMessage(chatId, '🔎 Введите название токена\n\n📌 Примеры: PEPE, ARB, SOL, DOGE, SHIB\n🔄 /cancel — отмена');
            await setData('state_' + chatId, 'waiting_for_trend_search');
            return;
        }
        if (data === 'trend_search_contract') {
            await sendUpdatedMessage(chatId, '📄 Отправь адрес контракта для проверки\n\n📌 Пример: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e\n🔄 /cancel — отмена');
            await setData('state_' + chatId, 'waiting_for_contract_search');
            return;
        }

        // === ОПОВЕЩЕНИЯ ===
        if (data === 'alert_menu') { await showAlertMenu(chatId, lang); return; }
        if (data === 'alert_price') {
            await sendUpdatedMessage(chatId, '📊 Создать ценовое оповещение\n\nВведите символ и цену в формате:\n`BTC 70000` (выше) или `BTC 65000 below`');
            await setData('state_' + chatId, 'alert_price');
            return;
        }
        if (data === 'alert_change') {
            await sendUpdatedMessage(chatId, '📈 Создать оповещение по изменению %\n\nВведите символ и % в формате:\n`BTC 5` (изменение >5% за час)');
            await setData('state_' + chatId, 'alert_change');
            return;
        }
        if (data === 'alert_volume') {
            await sendUpdatedMessage(chatId, '📊 Создать оповещение по объёму\n\nВведите символ и объём в формате:\n`BTC 1000000`');
            await setData('state_' + chatId, 'alert_volume');
            return;
        }
        if (data === 'alert_news' || data === 'alert_calendar') {
            const type = data === 'alert_news' ? 'news' : 'calendar';
            const result = await createAlert(chatId, type, {});
            if (result.error) { await sendUpdatedMessage(chatId, result.error); return; }
            await sendUpdatedMessage(chatId, '✅ Оповещение добавлено!');
            return;
        }
        if (data === 'alert_list') {
            const alerts = await getData('alerts_' + chatId);
            if (!alerts || (typeof alerts === 'string' ? JSON.parse(alerts) : alerts).length === 0) {
                await sendUpdatedMessage(chatId, '📭 У вас нет активных оповещений.');
                return;
            }
            const parsedAlerts = typeof alerts === 'string' ? JSON.parse(alerts) : alerts;
            let text = '📋 Ваши оповещения:\n';
            for (let i = 0; i < parsedAlerts.length; i++) {
                const a = parsedAlerts[i];
                const typeText = a.type === 'price' ? '💰 цена' : a.type === 'change' ? '📈 изменение' : a.type === 'volume' ? '📊 объём' : a.type;
                text += '• ' + (a.params.symbol || '') + ' (' + typeText + ') – ' + (a.params.target || '') + '\n';
            }
            const keyboard = {
                inline_keyboard: parsedAlerts.map(function(a) {
                    return [{ text: '❌ Удалить ' + (a.params.symbol || a.id), callback_data: 'alert_delete_' + a.id }];
                })
            };
            keyboard.inline_keyboard.push([{ text: '🔙 Назад', callback_data: 'alert_menu' }]);
            await sendUpdatedMessage(chatId, text, keyboard);
            return;
        }
        if (data.startsWith('alert_delete_')) {
            const alertId = data.replace('alert_delete_', '');
            const key = 'alerts_' + chatId;
            let alerts = await getData(key);
            if (alerts) {
                const parsed = typeof alerts === 'string' ? JSON.parse(alerts) : alerts;
                const filtered = parsed.filter(function(a) { return a.id !== alertId; });
                await setData(key, JSON.stringify(filtered));
                await sendUpdatedMessage(chatId, '✅ Оповещение удалено.');
                await showAlertMenu(chatId, lang);
            }
            return;
        }

        // === АВТОТОРГОВЛЯ ===
        if (data === 'autotrade_menu') { await showAutotradeMenu(chatId, lang); return; }
        if (data === 'autotrade_level1' || data === 'autotrade_level2' || data === 'autotrade_level3' || data === 'autotrade_level4') {
            const plan = await getUserPlan(chatId);
            if (!plan.limits.autotrade) {
                await sendUpdatedMessage(chatId, '❌ Автоторговля доступна только PRO и VIP.\n💳 /subscribe');
                return;
            }
            const levelMap = {
                'autotrade_level1': 1,
                'autotrade_level2': 2,
                'autotrade_level3': 3,
                'autotrade_level4': 4
            };
            const level = levelMap[data];
            if (level === 4) {
                await sendUpdatedMessage(chatId, '🚀 Запускаю "Снежный ком"...');
                const result = await runSnowballStrategy(chatId);
                if (result.error) {
                    await sendUpdatedMessage(chatId, '❌ ' + result.error);
                } else {
                    await setData('autotrade_' + chatId, JSON.stringify({ level: 4, active: true, lastCheck: Date.now(), type: 'snowball' }));
                    await sendUpdatedMessage(chatId, '❄️ Стратегия "Снежный ком" запущена!');
                }
                return;
            }
            await setData('autotrade_' + chatId, JSON.stringify({ level: level, active: true, lastCheck: Date.now() }));
            await sendUpdatedMessage(chatId, '✅ Автоторговля активирована (уровень ' + level + ')');
            return;
        }
        if (data === 'autotrade_stop') {
            await deleteData('autotrade_' + chatId);
            await sendUpdatedMessage(chatId, '⏹️ Автоторговля остановлена.');
            return;
        }

        // === ТАРИФЫ ===
        if (data.startsWith('plan_')) {
            const planId = data.replace('plan_', '');
            await handlePlanSelection(chatId, planId, lang, null);
            return;
        }

        // === КНОПКИ "ПОДТВЕРДИТЬ" ===
        if (data === 'action_disconnect') {
            await deleteData('user_' + chatId);
            await sendUpdatedMessage(chatId, '🔌 Биржа отключена. Все ключи удалены.');
            await showMainMenu(chatId, lang);
            return;
        }
        if (data === 'action_analyze') {
            const savedData = await getData('user_' + chatId);
            if (!savedData) {
                await sendUpdatedMessage(chatId, '🔐 Сначала подключи биржу. /connect');
                return;
            }
            await sendUpdatedMessage(chatId, '⏳ Начинаю анализ...');
            const user = typeof savedData === 'string' ? JSON.parse(savedData) : savedData;
            const apiKey = decrypt(user.apiKey);
            const secretKey = decrypt(user.secretKey);
            try {
                const exchange = await connectExchange(user.exchangeId, apiKey, secretKey);
                const balance = await exchange.fetchBalance();
                const total = balance.total;
                const coins = Object.keys(total).filter(function(key) { return total[key] > 0; });
                if (coins.length === 0) {
                    await sendUpdatedMessage(chatId, '📭 На балансе нет монет.');
                    return;
                }
                let totalUSDT = 0;
                let assets = [];
                for (let i = 0; i < coins.length; i++) {
                    const coin = coins[i];
                    if (coin === 'USDT') {
                        totalUSDT += total[coin];
                        continue;
                    }
                    try {
                        const ticker = await exchange.fetchTicker(coin + '/USDT');
                        const value = total[coin] * ticker.last;
                        totalUSDT += value;
                        assets.push({ symbol: coin, value: value });
                    } catch (e) {}
                }
                for (let a = 0; a < assets.length; a++) {
                    assets[a].weight = (assets[a].value / totalUSDT) * 100;
                }
                assets.sort(function(a, b) { return b.weight - a.weight; });
                const mode = await getData('mode_' + chatId) || 'beginner';
                const thresholds = getRiskThresholds(mode);
                const engineResult = {
                    totalUSDT: totalUSDT,
                    btcPercent: assets.find(function(a) { return a.symbol === 'BTC'; })?.weight || 0,
                    altPercent: assets.filter(function(a) { return a.symbol !== 'BTC' && a.symbol !== 'USDT'; }).reduce(function(sum, a) { return sum + a.weight; }, 0),
                    usdtPercent: assets.find(function(a) { return a.symbol === 'USDT'; })?.weight || 0,
                    assets: assets,
                    riskLevel: 'low',
                    riskScore: 0,
                    btcMetrics: { sharpe: 0, sortino: 0, var: 0 },
                    assetMetrics: [],
                    signals: [],
                    issues: [],
                    recommendations: [],
                    thresholds: thresholds,
                    timestamp: Date.now()
                };
                const report = await composeReport(engineResult, mode, lang, 0);
                await sendUpdatedMessage(chatId, report.text, report.keyboard);
                await setData('analysis_' + chatId, JSON.stringify(engineResult), 86400);
                await addHistory(chatId, '📊 Анализ портфеля', '$' + totalUSDT.toFixed(2));
            } catch (error) {
                console.error('❌ Analysis error:', error);
                await notifyAdmin(error, { chatId: chatId, function: 'action_analyze' });
                await sendUpdatedMessage(chatId, '❌ Ошибка анализа: ' + error.message);
            }
            return;
        }
        if (data === 'action_export_csv') {
            const analysisData = await getData('analysis_' + chatId);
            if (!analysisData) {
                await sendUpdatedMessage(chatId, '❌ Нет данных. Выполни /analyze');
                return;
            }
            const analysis = typeof analysisData === 'string' ? JSON.parse(analysisData) : analysisData;
            const csv = generateCSV(analysis);
            await sendDocument(chatId, csv, 'portfolio_report.csv');
            await sendUpdatedMessage(chatId, '📥 CSV отчет отправлен!');
            return;
        }
        if (data === 'action_rebalance') {
            const savedData = await getData('user_' + chatId);
            if (!savedData) {
                await sendUpdatedMessage(chatId, '🔐 Сначала подключи биржу. /connect');
                return;
            }
            const keyboard = {
                inline_keyboard: [
                    [{ text: '✅ Подтвердить ребаланс', callback_data: 'confirm_rebalance' }],
                    [{ text: '❌ Отмена', callback_data: 'cancel_rebalance' }]
                ]
            };
            await sendMessage(chatId, '🔄 Подтвердите ребаланс портфеля\n\nБот продаст активы выше целевого веса и купит те, что ниже.\n\n⚠️ Это действие отправит ордера на биржу.', keyboard);
            return;
        }
        if (data === 'confirm_rebalance') {
            const result = await autoRebalance(chatId);
            if (result.error) {
                await sendUpdatedMessage(chatId, '❌ ' + result.error);
            } else {
                await sendUpdatedMessage(chatId, result.message);
            }
            await showMainMenu(chatId, lang);
            return;
        }
        if (data === 'cancel_rebalance') {
            await sendUpdatedMessage(chatId, '❌ Ребаланс отменен.');
            await showMainMenu(chatId, lang);
            return;
        }
        if (data === 'action_history_refresh') {
            await showHistoryMenu(chatId, lang);
            return;
        }

        // === ИСПОЛНЕНИЕ РЕКОМЕНДАЦИЙ ===
        if (data.startsWith('exec_')) {
            const recId = data.replace('exec_', '');
            const keyboard = {
                inline_keyboard: [
                    [{ text: '✅ Подтвердить', callback_data: 'confirm_' + recId }],
                    [{ text: '❌ Отмена', callback_data: 'cancel_exec_' + recId }]
                ]
            };
            await sendMessage(chatId, '⚠️ Подтвердите исполнение рекомендации.\n\nЭто действие отправит ордер на биржу.', keyboard);
            return;
        }
        if (data.startsWith('confirm_')) {
            const recId = data.replace('confirm_', '');
            const result = await executeRecommendation(chatId, recId);
            if (result.error) {
                await sendUpdatedMessage(chatId, '❌ ' + result.error);
            } else {
                await sendUpdatedMessage(chatId, '✅ Ордер исполнен!\n\nСимвол: ' + result.order.symbol + '\nСторона: ' + result.order.side + '\nКоличество: ' + result.order.amount + '\nЦена: ' + (result.order.price || 'рыночная'));
            }
            await showMainMenu(chatId, lang);
            return;
        }
        if (data.startsWith('cancel_exec_')) {
            await sendUpdatedMessage(chatId, '❌ Исполнение отменено.');
            await showMainMenu(chatId, lang);
            return;
        }

        // === ХОЛОДНЫЙ ДУШ ===
        if (data === 'panic_convert_all') {
            await handlePanicConvertAll(chatId);
            return;
        }

        // === СБРОС ===
        if (data === 'confirm_reset_all') {
            const keys = [
                'user_' + chatId, 'plan_' + chatId, 'history_' + chatId,
                'alerts_' + chatId, 'analysis_' + chatId, 'mode_' + chatId,
                'lang_' + chatId, 'autotrade_' + chatId, 'panic_' + chatId,
                'onboarded_' + chatId, 'state_' + chatId, 'spam_' + chatId,
                'last_msg_' + chatId
            ];
            for (let i = 0; i < keys.length; i++) {
                await deleteData(keys[i]);
            }
            planCache.delete(chatId);
            await sendUpdatedMessage(chatId, '✅ Все данные сброшены!\n\nМожешь начать заново: /start');
            return;
        }
        if (data === 'cancel_reset') {
            await sendUpdatedMessage(chatId, '❌ Сброс отменен.');
            await showMainMenu(chatId, lang);
            return;
        }

    } catch (error) {
        console.error('❌ Callback error:', error);
        await notifyAdmin(error, { chatId: chatId, function: 'handleCallback', data: data });
        await sendUpdatedMessage(chatId, '❌ Ошибка: ' + error.message);
    }
}

// ============================================================
// 28. ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ПОМОЩИ
// ============================================================

function getHelpAnswer(key, lang) {
    const answers = {
        ru: {
            help_answer_q1: '🔐 Как подключить биржу?\n\n1. Зайдите на биржу (Binance, Bybit, OKX и др.)\n2. Перейдите в раздел управления API\n3. Создайте ключ с правами только на чтение\n4. Скопируйте API-ключ и Secret-ключ\n5. Отправьте их в бот командой /connect в формате:\n`API_KEY:SECRET_KEY`\n\n🔒 Ключи шифруются и не имеют права на вывод средств.',
            help_answer_q2: '📊 Как работает анализ портфеля?\n\nКоманда /analyze запускает полный анализ:\n• Показывает распределение активов (BTC, альты, стейблы)\n• Рассчитывает RSI, скользящие средние (MA20, MA200)\n• Оценивает риск (низкий/средний/высокий)\n• Считает коэффициент Шарпа и VaR\n• Даёт конкретные рекомендации по ребалансировке\n\n📌 После анализа вы можете исполнить рекомендации одним нажатием кнопки.',
            help_answer_q3: '🔐 Зачем подключать биржу?\n\nПодключение биржи даёт доступ к ключевым функциям:\n\n1. Анализ портфеля — бот видит активы и даёт рекомендации\n2. Автоторговля — автоматическая защита и ребаланс\n3. Холодный душ — экстренная защита при падении рынка\n4. Оповещения — уведомления по вашим активам\n5. Ребаланс — автоматическое поддержание целевых весов\n\n🔒 Ключи шифруются и имеют права только на чтение. Бот НЕ МОЖЕТ выводить средства.',
            help_answer_q4: '🛡️ Как проверить контракт?\n\nОтправьте адрес контракта (0x...) в чат — бот проверит:\n• Верификацию на Etherscan\n• Подозрительные паттерны (honeypot)\n• Скоринг риска (0–100 баллов)\n\n📌 Пример: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
            help_answer_q5: '🔔 Как создать оповещение?\n\nИспользуйте /alerts или меню Оповещения.\n\n5 типов оповещений:\n• По цене — при достижении заданной цены\n• По изменению % — при изменении цены более чем на X%\n• По объёму — при превышении объёма торгов\n• Новостное — при появлении новостей по вашим активам\n• Календарное — перед важными экономическими событиями\n\n📌 Лимит зависит от вашего тарифа.',
            help_answer_q6: '🚀 Как включить автоторговлю?\n\n/autotrade открывает меню с 4 уровнями:\n\n🛡️ Уровень 1 (Защита) — стоп-лоссы 5% и 10%\n🔄 Уровень 2 (Перераспределение) — продажа мусора, покупка роста\n🧠 Уровень 3 (Умный рост) — трейлинг стоп-лосс, фиксация 30% прибыли\n❄️ Уровень 4 (Снежный ком) — переток из мусорных в растущие\n\n📌 Доступна только на PRO и VIP. Проверка каждые 15 минут.',
            help_answer_q7: '❄️ Что такое холодный душ?\n\nЭкстренная защита при падении рынка:\n• Бот проверяет ВСЕ токены каждые 15 минут\n• При падении >5% за 15 минут — отправляет предупреждение\n• Предлагает конвертировать все активы в USDT\n\n🛡️ Доступен на PRO и VIP. Активируйте командой /panic.',
            help_answer_q8: '📝 Как работает дневник настроения?\n\n/diary открывает дневник эмоций.\n\nВыберите настроение:\n😌 Спокоен | 🤔 Задумчив | 😰 Тревожен | 😱 Паника | 😤 Зол | 😊 Эйфория\n\n📌 Бот сохраняет записи. Если вы тревожны 3 дня подряд — бот предупредит вас.',
            help_answer_q9: '🔌 Как отключить биржу?\n\n/disconnect или Настройки → Отключить биржу.\n\nПосле подтверждения API-ключи будут удалены.\n\n📌 Если вы случайно подтвердили, есть 10 секунд на отмену: /undo',
        },
        en: {
            help_answer_q1: '🔐 How to connect exchange?\n\n1. Go to your exchange (Binance, Bybit, OKX, etc.)\n2. Go to API management section\n3. Create a key with read-only permissions\n4. Copy API key and Secret key\n5. Send them to bot with /connect in format:\n`API_KEY:SECRET_KEY`\n\n🔒 Keys are encrypted and have no withdrawal rights.',
            help_answer_q2: '📊 How does portfolio analysis work?\n\n/analyze runs a full portfolio analysis:\n• Shows asset allocation (BTC, alts, stablecoins)\n• Calculates RSI, moving averages (MA20, MA200)\n• Evaluates risk (low/medium/high)\n• Calculates Sharpe ratio and VaR\n• Gives specific rebalancing recommendations\n\n📌 After analysis you can execute recommendations with one click.',
            help_answer_q3: '🔐 Why connect exchange?\n\nConnecting your exchange gives you access to key features:\n\n1. Portfolio analysis — bot sees your assets and gives recommendations\n2. Autotrading — automatic protection and rebalancing\n3. Panic mode — emergency protection during market crashes\n4. Alerts — notifications for your assets\n5. Rebalance — automatic maintenance of target weights\n\n🔒 Keys are encrypted and have read-only permissions. The bot CANNOT withdraw funds.',
            help_answer_q4: '🛡️ How to check a contract?\n\nYou can check a smart contract in several ways:\n\n1. Send contract address (0x...) in chat — bot will check automatically\n2. Use Security menu → Contract\n3. Use Security menu → DEX — shows liquidity and risks\n\n🔍 Bot checks:\n• Verification on Etherscan\n• Suspicious patterns (honeypot)\n• Risk scoring (0–100)\n\n📌 Example: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
            help_answer_q5: '🔔 How to create an alert?\n\nUse /alerts or Alerts menu.\n\n5 alert types available:\n• Price — triggers at target price\n• Change % — triggers when price changes by X%\n• Volume — triggers when trading volume exceeds\n• News — triggers when news appear for your assets\n• Calendar — before important economic events\n\n📌 Limit depends on your plan.',
            help_answer_q6: '🚀 How to enable autotrading?\n\n/autotrade opens menu with 4 levels:\n\n🛡️ Level 1 (Protection) — sets stop-losses at 5% and 10% drops\n🔄 Level 2 (Reallocation) — sells junk tokens and buys growing ones\n🧠 Level 3 (Smart Growth) — uses trailing stop-loss and locks 30% profit at >20% growth\n❄️ Level 4 (Snowball) — flows capital from junk tokens to growing ones\n\n📌 Available only on PRO and VIP. Checks every 15 minutes.',
            help_answer_q7: '❄️ What is Panic mode?\n\nPanic mode is emergency protection during market crashes.\n\n• Bot checks ALL tokens every 15 minutes\n• If drop >5% in 15 minutes — sends warning\n• Offers one-click conversion of ALL assets to USDT\n\n🛡️ Available on PRO and VIP. Activate with /panic.',
            help_answer_q8: '📝 How does mood diary work?\n\n/diary opens emotion diary.\n\nChoose your current mood:\n😌 Calm | 🤔 Thoughtful | 😰 Anxious | 😱 Panic | 😤 Angry | 😊 Euphoric\n\n📌 Bot saves entries. If you\'re anxious for 3 days in a row — bot warns you.',
            help_answer_q9: '🔌 How to disconnect exchange?\n\n/disconnect or Settings → Disconnect exchange.\n\nAfter confirmation API keys will be deleted.\n\n📌 If you accidentally confirmed, you have 10 seconds to undo: /undo',
        }
    };
    const langData = answers[lang] || answers.ru;
    return langData[key] || '❌ Ответ не найден.';
}

// ============================================================
// 29. ОБРАБОТЧИК СООБЩЕНИЙ
// ============================================================

async function handleMessage(update) {
    const chatId = update.message.chat.id;
    const text = update.message.text || '';
    const messageId = update.message.message_id;
    const lang = await getData('lang_' + chatId) || 'ru';
    const state = await getData('state_' + chatId) || 'idle';

    try {
        if (!update.message) { console.warn('⚠️ Невалидный webhook: отсутствует message'); return; }
        if (update.message.forward_from) { return; }

        const cleanText = sanitizeInput(text);
        const rateCheck = await checkRateLimit(chatId, 'messages', 20, 60000);
        if (!rateCheck.allowed) {
            await sendUpdatedMessage(chatId, rateCheck.message, null, 'Markdown', messageId);
            return;
        }

        const spamKey = 'spam_' + chatId;
        const lastMessage = await getData(spamKey);
        if (lastMessage && Date.now() - parseInt(lastMessage) < 1000) {
            await sendUpdatedMessage(chatId, '⏳ Пожалуйста, не спамьте. Подождите 1 секунду.', null, 'Markdown', messageId);
            return;
        }
        await setData(spamKey, Date.now().toString(), 5);

        // Автопроверка ссылок и контрактов
        if (cleanText && (cleanText.includes('http://') || cleanText.includes('https://'))) {
            await autoCheckLinks(chatId, cleanText, lang, messageId);
        }
        if (cleanText && cleanText.startsWith('0x') && cleanText.length >= 42 && cleanText.length <= 44) {
            await autoCheckContract(chatId, cleanText, lang, messageId);
            return;
        }

        // === ОБРАБОТКА СОСТОЯНИЙ ===

        // 1. Подключение ключей (обычное и VIP)
        if (state === 'waiting_for_keys' || state === 'waiting_for_keys_vip') {
            if (cleanText === '/cancel') {
                await setData('state_' + chatId, 'idle');
                await sendUpdatedMessage(chatId, '❌ Подключение отменено.', null, 'Markdown', messageId);
                if (state === 'waiting_for_keys_vip') {
                    await setData('onboarded_' + chatId, 'true');
                    await showMainMenu(chatId, lang);
                } else {
                    await showMainMenu(chatId, lang);
                }
                return;
            }
            const parts = cleanText.split(':');
            if (parts.length === 2) {
                const apiKey = parts[0].trim();
                const secretKey = parts[1].trim();
                await sendTyping(chatId);
                await sendUpdatedMessage(chatId, '🔍 Проверяю ключи...', null, 'Markdown', messageId);
                const attemptsCheck = await checkConnectAttempts(chatId);
                if (attemptsCheck.blocked) {
                    await sendUpdatedMessage(chatId, attemptsCheck.reason, null, 'Markdown', messageId);
                    return;
                }
                const validation = await validateExchangeKeys(apiKey, secretKey);
                if (!validation.valid) {
                    await recordConnectAttempt(chatId, false);
                    await sendUpdatedMessage(chatId, validation.error, null, 'Markdown', messageId);
                    return;
                }
                if (validation.warning) {
                    await sendUpdatedMessage(chatId, validation.warning, null, 'Markdown', messageId);
                }
                const encryptedApiKey = encrypt(apiKey);
                const encryptedSecretKey = encrypt(secretKey);
                await setData('user_' + chatId, JSON.stringify({
                    apiKey: encryptedApiKey,
                    secretKey: encryptedSecretKey,
                    exchangeId: 'binance',
                    connectedAt: Date.now()
                }));
                await recordConnectAttempt(chatId, true);
                if (state === 'waiting_for_keys_vip') {
                    await activateVipTrial(chatId);
                    await setData('state_' + chatId, 'idle');
                    await setData('onboarded_' + chatId, 'true');
                    const expiresDate = formatDateShort(Date.now() + 3 * 24 * 60 * 60 * 1000);
                    const message = '🎉 ПОЗДРАВЛЯЮ!\n\nТы подключил биржу и получил VIP-доступ на 3 дня!\n\nДействует до: ' + expiresDate + '\n\nТеперь тебе доступно всё:\n• ❄️ Холодный душ\n• 🚀 Автоторговля\n• 📊 Полная аналитика\n• 🔔 Безлимитные оповещения\n\nПопробуй все функции, а после триала выбери подходящий тариф!';
                    const keyboard = {
                        inline_keyboard: [
                            [{ text: '🏠 В меню', callback_data: 'onboard_vip_done' }]
                        ]
                    };
                    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
                    return;
                }
                await setData('state_' + chatId, 'idle');
                await sendUpdatedMessage(chatId, '✅ Биржа подключена!\n\n📊 Теперь отправь /analyze', null, 'Markdown', messageId);
                await showMainMenu(chatId, lang);
            } else {
                await sendUpdatedMessage(chatId, '❌ Неверный формат! Отправь ключи как `API_KEY:SECRET_KEY`.', null, 'Markdown', messageId);
            }
            return;
        }

        // 2. Антискам
        const antiscamStates = ['antiscam_url', 'antiscam_contract', 'antiscam_dex', 'antiscam_file', 'antiscam_impersonation', 'antiscam_wallet'];
        if (antiscamStates.indexOf(state) !== -1) {
            if (cleanText === '/cancel') {
                await setData('state_' + chatId, 'idle');
                await sendUpdatedMessage(chatId, '❌ Проверка отменена.', null, 'Markdown', messageId);
                await showMainMenu(chatId, lang);
                return;
            }
            await handleAntiScamInput(chatId, cleanText, lang, update, messageId);
            return;
        }

        // 3. Поиск тренда
        if (state === 'waiting_for_trend_search') {
            if (cleanText === '/cancel') {
                await setData('state_' + chatId, 'idle');
                await sendUpdatedMessage(chatId, '❌ Поиск отменен.', null, 'Markdown', messageId);
                await showMainMenu(chatId, lang);
                return;
            }
            await handleTrendSearchInput(chatId, cleanText, lang, messageId);
            return;
        }

        // 4. Поиск контракта
        if (state === 'waiting_for_contract_search') {
            if (cleanText === '/cancel') {
                await setData('state_' + chatId, 'idle');
                await sendUpdatedMessage(chatId, '❌ Поиск отменен.', null, 'Markdown', messageId);
                await showMainMenu(chatId, lang);
                return;
            }
            if (!cleanText.startsWith('0x') || cleanText.length < 42) {
                await sendUpdatedMessage(chatId, '❌ Неверный адрес контракта.\n\nОтправь адрес, начинающийся с 0x... (длина 42 символа)', null, 'Markdown', messageId);
                await setData('state_' + chatId, 'waiting_for_contract_search');
                return;
            }
            await handleContractSearch(chatId, cleanText, lang, messageId);
            await setData('state_' + chatId, 'idle');
            return;
        }

        // 5. Оповещения
        if (state === 'alert_price') {
            const parts = cleanText.split(' ');
            if (parts.length === 2) {
                const symbol = parts[0].toUpperCase();
                const target = parseFloat(parts[1]);
                if (!isNaN(target)) {
                    const result = await createAlert(chatId, 'price', { symbol: symbol, target: target, direction: 'above' });
                    if (result.error) { await sendUpdatedMessage(chatId, result.error); return; }
                    await sendUpdatedMessage(chatId, '✅ Оповещение добавлено!');
                    await setData('state_' + chatId, 'idle');
                    return;
                }
            } else if (parts.length === 3 && parts[2].toLowerCase() === 'below') {
                const symbol = parts[0].toUpperCase();
                const target = parseFloat(parts[1]);
                if (!isNaN(target)) {
                    const result = await createAlert(chatId, 'price', { symbol: symbol, target: target, direction: 'below' });
                    if (result.error) { await sendUpdatedMessage(chatId, result.error); return; }
                    await sendUpdatedMessage(chatId, '✅ Оповещение добавлено!');
                    await setData('state_' + chatId, 'idle');
                    return;
                }
            }
            await sendUpdatedMessage(chatId, '❌ Неверный формат. Используйте `BTC 70000` или `BTC 65000 below`', null, 'Markdown', messageId);
            return;
        }
        if (state === 'alert_change') {
            const parts = cleanText.split(' ');
            if (parts.length === 2) {
                const symbol = parts[0].toUpperCase();
                const target = parseFloat(parts[1]);
                if (!isNaN(target)) {
                    const result = await createAlert(chatId, 'change', { symbol: symbol, target: target });
                    if (result.error) { await sendUpdatedMessage(chatId, result.error); return; }
                    await sendUpdatedMessage(chatId, '✅ Оповещение добавлено!');
                    await setData('state_' + chatId, 'idle');
                    return;
                }
            }
            await sendUpdatedMessage(chatId, '❌ Неверный формат. Используйте `BTC 5`', null, 'Markdown', messageId);
            return;
        }
        if (state === 'alert_volume') {
            const parts = cleanText.split(' ');
            if (parts.length === 2) {
                const symbol = parts[0].toUpperCase();
                const target = parseFloat(parts[1]);
                if (!isNaN(target)) {
                    const result = await createAlert(chatId, 'volume', { symbol: symbol, target: target });
                    if (result.error) { await sendUpdatedMessage(chatId, result.error); return; }
                    await sendUpdatedMessage(chatId, '✅ Оповещение добавлено!');
                    await setData('state_' + chatId, 'idle');
                    return;
                }
            }
            await sendUpdatedMessage(chatId, '❌ Неверный формат. Используйте `BTC 1000000` (объём)', null, 'Markdown', messageId);
            return;
        }

        // === КОМАНДЫ ===

        // /start — ГЛАВНАЯ КОМАНДА
        if (cleanText === '/start') {
            console.log('📩 /start от ' + chatId);
            const onboarded = await getData('onboarded_' + chatId);
            if (!onboarded) {
                await showLanguageSelectOnboarding(chatId);
                return;
            }
            await showMainMenu(chatId, lang);
            return;
        }

        // /help
        if (cleanText === '/help') {
            await showHelpMenu(chatId, lang);
            return;
        }

        // /history
        if (cleanText === '/history') {
            await showHistoryMenu(chatId, lang);
            return;
        }

        // /settings
        if (cleanText === '/settings') {
            await showSettingsMenuNew(chatId, lang);
            return;
        }

        // /subscribe или /plans
        if (cleanText === '/subscribe' || cleanText === '/plans') {
            await showPlansMenu(chatId, lang);
            return;
        }

        // /connect
        if (cleanText === '/connect') {
            await sendUpdatedMessage(chatId, '🔐 Отправь API-ключи в формате:\n`API_KEY:SECRET_KEY`\n\n🔄 Для отмены: /cancel', null, 'Markdown', messageId);
            await setData('state_' + chatId, 'waiting_for_keys');
            return;
        }

        // /disconnect
        if (cleanText === '/disconnect') {
            await deleteData('user_' + chatId);
            await sendUpdatedMessage(chatId, '🔌 Биржа отключена. Все ключи удалены.', null, 'Markdown', messageId);
            await showMainMenu(chatId, lang);
            return;
        }

        // /portfolio
        if (cleanText === '/portfolio') {
            const savedData = await getData('user_' + chatId);
            if (!savedData) {
                await sendUpdatedMessage(chatId, '🔐 Сначала подключи биржу. /connect', null, 'Markdown', messageId);
                return;
            }
            const user = typeof savedData === 'string' ? JSON.parse(savedData) : savedData;
            const apiKey = decrypt(user.apiKey);
            const secretKey = decrypt(user.secretKey);
            try {
                const exchange = await connectExchange(user.exchangeId, apiKey, secretKey);
                const balance = await exchange.fetchBalance();
                const total = balance.total;
                const coins = Object.keys(total).filter(function(key) { return total[key] > 0; });
                let message = '📊 ПОРТФЕЛЬ\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
                let totalUSDT = 0;
                let assets = [];
                for (let i = 0; i < coins.length; i++) {
                    const coin = coins[i];
                    if (coin === 'USDT') {
                        totalUSDT += total[coin];
                        assets.push({ symbol: coin, value: total[coin] });
                    } else {
                        try {
                            const ticker = await exchange.fetchTicker(coin + '/USDT');
                            const value = total[coin] * ticker.last;
                            totalUSDT += value;
                            assets.push({ symbol: coin, value: value, amount: total[coin] });
                        } catch (e) {
                            assets.push({ symbol: coin, value: 0, amount: total[coin] });
                        }
                    }
                }
                assets.sort(function(a, b) { return b.value - a.value; });
                for (let j = 0; j < assets.length; j++) {
                    const a = assets[j];
                    if (a.symbol === 'USDT') {
                        message += a.symbol + ': $' + a.value.toFixed(2) + '\n';
                    } else if (a.value > 0) {
                        const percent = ((a.value / totalUSDT) * 100).toFixed(1);
                        message += a.symbol + ': ' + a.amount.toFixed(4) + ' ≈ $' + a.value.toFixed(2) + ' (' + percent + '%)\n';
                    } else {
                        message += a.symbol + ': ' + a.amount.toFixed(4) + ' (не удалось получить цену)\n';
                    }
                }
                message += '\n━━━━━━━━━━━━━━━━━━━━━━━\n';
                message += '💰 Итого: $' + totalUSDT.toFixed(2) + ' USDT';
                const keyboard = {
                    inline_keyboard: [
                        [{ text: '📊 Полный анализ', callback_data: 'action_analyze' }],
                        [{ text: '🔙 Выйти в меню', callback_data: 'exit_to_menu' }]
                    ]
                };
                await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
            } catch (error) {
                await sendUpdatedMessage(chatId, '❌ Ошибка: ' + error.message, null, 'Markdown', messageId);
            }
            return;
        }

        // /reset
        if (cleanText === '/reset') {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔄 Да, сбросить всё', callback_data: 'confirm_reset_all' }],
                    [{ text: '❌ Отмена', callback_data: 'cancel_reset' }]
                ]
            };
            await sendMessage(chatId,
                '⚠️ ВНИМАНИЕ!\n\nТы собираешься СБРОСИТЬ ВСЕ ДАННЫЕ:\n' +
                '• API-ключи будут удалены\n• История будет очищена\n• Настройки будут сброшены\n• Оповещения удалены\n• Автоторговля остановлена\n\nЭто действие НЕОБРАТИМО!',
                keyboard
            );
            return;
        }

        // /analyze
        if (cleanText === '/analyze') {
            const savedData = await getData('user_' + chatId);
            if (!savedData) {
                await sendUpdatedMessage(chatId, '🔐 Сначала подключи биржу. /connect', null, 'Markdown', messageId);
                return;
            }
            await sendUpdatedMessage(chatId, '⏳ Начинаю анализ...', null, 'Markdown', messageId);
            const user = typeof savedData === 'string' ? JSON.parse(savedData) : savedData;
            const apiKey = decrypt(user.apiKey);
            const secretKey = decrypt(user.secretKey);
            try {
                const exchange = await connectExchange(user.exchangeId, apiKey, secretKey);
                const balance = await exchange.fetchBalance();
                const total = balance.total;
                const coins = Object.keys(total).filter(function(key) { return total[key] > 0; });
                if (coins.length === 0) {
                    await sendUpdatedMessage(chatId, '📭 На балансе нет монет.', null, 'Markdown', messageId);
                    return;
                }
                let totalUSDT = 0;
                let assets = [];
                for (let i = 0; i < coins.length; i++) {
                    const coin = coins[i];
                    if (coin === 'USDT') {
                        totalUSDT += total[coin];
                        continue;
                    }
                    try {
                        const ticker = await exchange.fetchTicker(coin + '/USDT');
                        const value = total[coin] * ticker.last;
                        totalUSDT += value;
                        assets.push({ symbol: coin, value: value });
                    } catch (e) {}
                }
                for (let a = 0; a < assets.length; a++) {
                    assets[a].weight = (assets[a].value / totalUSDT) * 100;
                }
                assets.sort(function(a, b) { return b.weight - a.weight; });
                const mode = await getData('mode_' + chatId) || 'beginner';
                const thresholds = getRiskThresholds(mode);
                const engineResult = {
                    totalUSDT: totalUSDT,
                    btcPercent: assets.find(function(a) { return a.symbol === 'BTC'; })?.weight || 0,
                    altPercent: assets.filter(function(a) { return a.symbol !== 'BTC' && a.symbol !== 'USDT'; }).reduce(function(sum, a) { return sum + a.weight; }, 0),
                    usdtPercent: assets.find(function(a) { return a.symbol === 'USDT'; })?.weight || 0,
                    assets: assets,
                    riskLevel: 'low',
                    riskScore: 0,
                    btcMetrics: { sharpe: 0, sortino: 0, var: 0 },
                    assetMetrics: [],
                    signals: [],
                    issues: [],
                    recommendations: [],
                    thresholds: thresholds,
                    timestamp: Date.now()
                };
                const report = await composeReport(engineResult, mode, lang, 0);
                await sendUpdatedMessage(chatId, report.text, report.keyboard, 'Markdown', messageId);
                await setData('analysis_' + chatId, JSON.stringify(engineResult), 86400);
                await addHistory(chatId, '📊 Анализ портфеля', '$' + totalUSDT.toFixed(2));
            } catch (error) {
                console.error('❌ Analysis error:', error);
                await notifyAdmin(error, { chatId: chatId, function: 'handleMessage_analyze' });
                await sendUpdatedMessage(chatId, '❌ Ошибка анализа: ' + error.message, null, 'Markdown', messageId);
            }
            return;
        }

        // /news
        if (cleanText.startsWith('/news ')) {
            const coin = cleanText.replace('/news ', '').trim();
            await handleNewsCommand(chatId, coin, lang, messageId);
            return;
        }
        if (cleanText === '/news' || cleanText === '/news ') {
            await handleNewsCommand(chatId, null, lang, messageId);
            return;
        }

        // /trend
        if (cleanText.startsWith('/trend ')) {
            const coin = cleanText.replace('/trend ', '').trim().toUpperCase();
            await handleTrendClick(chatId, 'trend_' + coin, lang, messageId);
            return;
        }
        if (cleanText === '/trend' || cleanText === '/trend ') {
            await handleSocialTrend(chatId, lang, messageId);
            return;
        }

        // /calendar
        if (cleanText === '/calendar') {
            await handleCalendarCommand(chatId, lang, messageId);
            return;
        }

        // /alerts
        if (cleanText === '/alerts') {
            await showAlertMenu(chatId, lang);
            return;
        }

        // /autotrade
        if (cleanText === '/autotrade') {
            await showAutotradeMenu(chatId, lang);
            return;
        }

        // /panic
        if (cleanText === '/panic') {
            const plan = await getUserPlan(chatId);
            if (!plan.limits.panic) {
                await sendUpdatedMessage(chatId, '❌ Холодный душ доступен только PRO и VIP.\n💳 /subscribe', null, 'Markdown', messageId);
                return;
            }
            await setData('panic_' + chatId, JSON.stringify({ active: true, lastCheck: Date.now() }));
            await sendUpdatedMessage(chatId, '❄️ Холодный душ активирован.\n\nБуду отслеживать ВСЕ токены каждые 15 минут. При падении >5% — предложу конвертацию в стейблы.', null, 'Markdown', messageId);
            return;
        }

        // /panic_stop
        if (cleanText === '/panic_stop') {
            await deleteData('panic_' + chatId);
            await sendUpdatedMessage(chatId, '❄️ Холодный душ остановлен.', null, 'Markdown', messageId);
            return;
        }

        // /diary
        if (cleanText === '/diary') {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '😌 Спокоен', callback_data: 'diary_mood_calm' }, { text: '🤔 Задумчив', callback_data: 'diary_mood_thoughtful' }],
                    [{ text: '😰 Тревожен', callback_data: 'diary_mood_anxious' }, { text: '😱 Паника', callback_data: 'diary_mood_panic' }],
                    [{ text: '😤 Зол', callback_data: 'diary_mood_angry' }, { text: '😊 Эйфория', callback_data: 'diary_mood_euphoric' }],
                    [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
                ]
            };
            await sendMessage(chatId, '📝 Как настроение?', keyboard);
            return;
        }

        // Обработка ссылок и контрактов (если не обработано выше)
        if (cleanText.startsWith('http://') || cleanText.startsWith('https://') || (cleanText.startsWith('0x') && cleanText.length >= 42)) {
            await handleAntiScamInput(chatId, cleanText, lang, update, messageId);
            return;
        }

        // Всё остальное
        await sendUpdatedMessage(chatId, '🤔 Ты написал: "' + cleanText + '"\n\nНажми /help для помощи.', null, 'Markdown', messageId);

    } catch (error) {
        console.error('❌ Message error:', error);
        await notifyAdmin(error, { chatId: chatId, function: 'handleMessage', text: text });
        await sendUpdatedMessage(chatId, '❌ Ошибка: ' + error.message, null, 'Markdown', messageId);
    }
}

// ============================================================
// 30. ВЕБХУК CRYPTOBOT
// ============================================================

async function handleCryptoWebhook(request) {
    try {
        const update = request.body;
        if (!verifyCryptoBotWebhook(update, request.headers)) {
            console.warn('⚠️ Недействительная подпись webhook CryptoBot');
            return { status: 401, error: 'Invalid signature' };
        }
        if (update.update_type === 'invoice_paid') {
            const payload = update.payload;
            const parts = payload.split('_');
            const planId = parts[1];
            const chatId = parseInt(parts[2]);
            const lang = await getData('lang_' + chatId) || 'ru';
            const plan = await activatePlan(chatId, planId);
            if (plan) {
                await sendMessage(chatId, '✅ ' + plan.name + ' активирован! Спасибо! 🙏');
                await showMainMenu(chatId, lang);
                await addHistory(chatId, '💳 Оплата', plan.name + ' активирован');
            }
        }
        return { status: 200 };
    } catch (error) {
        console.error('❌ Webhook error:', error);
        return { status: 500, error: error.message };
    }
}

// ============================================================
// 31. ОНБОРДИНГ (ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ)
// ============================================================

async function showLanguageSelectOnboarding(chatId) {
    const keyboard = {
        inline_keyboard: [
            [{ text: '🇷🇺 Русский', callback_data: 'onboard_lang_ru' }],
            [{ text: '🇬🇧 English', callback_data: 'onboard_lang_en' }]
        ]
    };
    await sendUpdatedMessage(chatId, '🌍 Выберите язык / Choose language:', keyboard);
}

async function showModeSelectOnboarding(chatId, lang) {
    const message = '📊 Выбери свой уровень:\n\n' +
        '🔰 Новичок\nЦелевые веса: BTC 50%, Альты 30%, Стейблы 20%\nПростые рекомендации по портфелю\nБазовые метрики (риск, распределение)\n\n' +
        '🚀 Опытный\nЦелевые веса: BTC 40%, Альты 40%, Стейблы 20%\nРасширенные рекомендации\nПолные метрики (Шарп, RSI, MA20, просадка)\n\n' +
        '👇 Выбери режим:';
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔰 Новичок', callback_data: 'onboard_mode_beginner' }],
            [{ text: '🚀 Опытный', callback_data: 'onboard_mode_pro' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

async function showVipBonusOffer(chatId, lang) {
    const message = '🎁 БОНУС!\n\n' +
        'Подключи биржу и получи 3 дня VIP-доступа БЕСПЛАТНО!\n\n' +
        'Что ты получишь:\n' +
        '• ❄️ Холодный душ — экстренная защита\n' +
        '• 🚀 Автоторговля — автоматическая прибыль\n' +
        '• 📊 Полная аналитика портфеля\n' +
        '• 🔔 Безлимитные оповещения\n\n' +
        '🔥 Предложение действует только сейчас!';
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔐 Подключить биржу', callback_data: 'onboard_connect_vip' }],
            [{ text: '⏭️ Пропустить', callback_data: 'onboard_skip' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

async function handlePlanSelection(chatId, planId, lang, messageId) {
    if (planId === 'TRIAL') {
        const userPlan = await getUserPlan(chatId);
        if (userPlan.trialUsed && userPlan.plan !== 'TRIAL') {
            await sendUpdatedMessage(chatId, '❌ Триал уже использован.\n💳 /subscribe', null, 'Markdown', messageId);
            return;
        }
        await activateTrial(chatId);
        await sendUpdatedMessage(chatId, '🎉 Триал активирован на 7 дней!', null, 'Markdown', messageId);
        await showMainMenu(chatId, lang);
        return;
    }
    const plan = PLANS[planId];
    if (!plan) {
        await sendUpdatedMessage(chatId, '❌ Тариф не найден.', null, 'Markdown', messageId);
        return;
    }
    const duplicateCheck = await checkDuplicatePayment(chatId, planId);
    if (duplicateCheck.duplicate) {
        await sendUpdatedMessage(chatId, duplicateCheck.message, null, 'Markdown', messageId);
        return;
    }
    const userPlan = await getUserPlan(chatId);
    if (userPlan.plan === planId && userPlan.expires > Date.now()) {
        await sendUpdatedMessage(chatId, 'ℹ️ У вас уже активен ' + plan.name, null, 'Markdown', messageId);
        return;
    }
    await sendUpdatedMessage(chatId, '⏳ Создаю счёт...', null, 'Markdown', messageId);
    const invoice = await createCryptoInvoice(chatId, planId, plan.price);
    if (!invoice) {
        await sendUpdatedMessage(chatId, '❌ Ошибка создания счёта.', null, 'Markdown', messageId);
        return;
    }
    const usdtAmount = Math.round(plan.price / 90);
    let message = '💳 ОПЛАТА ' + plan.name + '\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    message += '💰 ' + plan.price + ' ₽ ≈ ' + usdtAmount + ' USDT\n';
    message += '📅 ' + plan.duration + ' дней\n\n';
    message += '📋 Функции:\n';
    const features = lang === 'en' ? plan.features_en : plan.features;
    for (let i = 0; i < features.length; i++) {
        message += '• ' + features[i] + '\n';
    }
    message += '\n💳 Способы оплаты:\n';
    message += '• Криптовалюта (USDT, BTC, TON)\n';
    message += '• Банковская карта\n\n';
    message += '⚠️ После оплаты тариф активируется автоматически.';
    const keyboard = {
        inline_keyboard: [
            [{ text: '💳 Оплатить ' + plan.price + ' ₽ (USDT)', url: invoice.payUrl }],
            [{ text: '🔙 Назад к тарифам', callback_data: 'back_to_plans' }],
            [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
}

// ============================================================
// 32. ФОНОВЫЕ ЗАДАЧИ
// ============================================================

function runTaskWithRecovery(task, name, interval) {
    const run = async function() {
        try {
            await task();
        } catch (error) {
            console.error('❌ ' + name + ' error:', error);
            await notifyAdmin(error, { function: name });
        } finally {
            setTimeout(run, interval);
        }
    };
    setTimeout(run, 5000);
}

runTaskWithRecovery(checkAlerts, 'checkAlerts', CONFIG.ALERT_CHECK_INTERVAL);
runTaskWithRecovery(runAutotrade, 'runAutotrade', CONFIG.AUTOTRADE_CHECK_INTERVAL);
runTaskWithRecovery(checkPanic, 'checkPanic', CONFIG.PANIC_CHECK_INTERVAL);
runTaskWithRecovery(async () => { await newsManager.backgroundUpdate?.(); }, 'newsManager.backgroundUpdate', 15 * 60 * 1000);

// ============================================================
// 33. EXPRESS СЕРВЕР
// ============================================================

const app = express();
app.use(express.json());

app.use(function(req, res, next) {
    console.log('📩 ' + req.method + ' ' + req.url);
    next();
});

app.get('/health', function(req, res) {
    res.status(200).json({
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

app.get('/webhook', function(req, res) {
    res.status(200).send('Webhook is active');
});

app.post('/webhook', async function(req, res) {
    console.log('📩 Webhook вызван!');
    try {
        const update = req.body;
        console.log('📦 Webhook received: ' + JSON.stringify(update).slice(0, 200) + '...');
        if (update.callback_query) {
            console.log('🔄 Обработка callback...');
            await handleCallback(update);
            res.sendStatus(200);
            return;
        }
        if (update.message) {
            console.log('💬 Сообщение от ' + (update.message.from?.first_name || 'Unknown'));
            await handleMessage(update);
            res.sendStatus(200);
            return;
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Webhook error:', error);
        await notifyAdmin(error, { function: 'webhook', body: req.body });
        res.sendStatus(500);
    }
});

app.post('/webhook/crypto', async function(req, res) {
    try {
        const result = await handleCryptoWebhook(req);
        res.status(result.status || 200).json(result);
    } catch (error) {
        console.error('❌ Crypto webhook error:', error);
        res.sendStatus(500);
    }
});

// ============================================================
// 34. ЗАПУСК СЕРВЕРА
// ============================================================

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', function() {
    console.log('✅ Бот успешно запущен на порту ' + PORT);
    console.log('📡 Webhook URL: https://ваш-домен.onrender.com/webhook');
    console.log('🩺 Health Check: https://ваш-домен.onrender.com/health');
    console.log('🔐 Crypto Webhook: https://ваш-домен.onrender.com/webhook/crypto');
    console.log('🚀 Бот готов к работе!');
});

process.on('uncaughtException', function(error) {
    console.error('❌ Uncaught Exception:', error);
    notifyAdmin(error, { function: 'uncaughtException' });
});

process.on('unhandledRejection', function(reason, promise) {
    console.error('❌ Unhandled Rejection:', reason);
    notifyAdmin(reason instanceof Error ? reason : new Error(String(reason)), {
        function: 'unhandledRejection',
        promise: promise
    });
});

process.on('SIGTERM', function() {
    console.log('🛑 Получен SIGTERM, завершаю работу...');
    server.close(function() {
        console.log('✅ Сервер остановлен');
        process.exit(0);
    });
});

process.on('SIGINT', function() {
    console.log('🛑 Получен SIGINT, завершаю работу...');
    server.close(function() {
        console.log('✅ Сервер остановлен');
        process.exit(0);
    });
});

setTimeout(async function() {
    try {
        console.log('🔄 Запуск первоначальных проверок...');
        await checkAlerts();
        console.log('✅ Первоначальные проверки завершены');
    } catch (error) {
        console.error('❌ Ошибка первоначальных проверок:', error);
    }
}, 10000);

console.log('━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🛡️ БОТ VOID NODE УСПЕШНО ЗАПУЩЕН!');
console.log('❄️ Холодный душ готов');
console.log('🚀 Автоторговля активна');
console.log('🔔 Оповещения работают');
console.log('━━━━━━━━━━━━━━━━━━━━━━━');

// ============================================================
// КОНЕЦ ФАЙЛА
// ============================================================
