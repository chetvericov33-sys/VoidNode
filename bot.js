require('dotenv').config();
const express = require('express');
const ccxt = require('ccxt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Redis } = require('@upstash/redis');

require('./logger');

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

if (!BOT_TOKEN) {
    console.error('BOT_TOKEN не найден в переменных окружения');
    process.exit(1);
}
if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    console.error('UPSTASH_REDIS_REST_URL или TOKEN не найдены');
    process.exit(1);
}

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

class RedisStorage {
    constructor() {
        this.redis = new Redis({
            url: UPSTASH_REDIS_REST_URL,
            token: UPSTASH_REDIS_REST_TOKEN,
        });
        this.localCache = new Map();
        this.isRedisAvailable = true;
        console.log('Redis подключен');
    }

    async get(key) {
        try {
            if (this.isRedisAvailable) {
                const data = await this.redis.get(key);
                if (data !== null && data !== undefined) {
                    return data;
                }
            }
            if (this.localCache.has(key)) {
                return this.localCache.get(key);
            }
            return null;
        } catch (error) {
            console.error('Redis get error:', error);
            this.isRedisAvailable = false;
            setTimeout(() => { this.isRedisAvailable = true; }, 60000);
            return this.localCache.get(key) || null;
        }
    }

    async put(key, value, ttl = null) {
        try {
            if (this.isRedisAvailable) {
                await this.redis.set(key, value);
                if (ttl) {
                    await this.redis.expire(key, ttl);
                }
            }
            this.localCache.set(key, value);
        } catch (error) {
            console.error('Redis set error:', error);
            this.isRedisAvailable = false;
            this.localCache.set(key, value);
            setTimeout(() => { this.isRedisAvailable = true; }, 60000);
        }
    }

    async delete(key) {
        try {
            if (this.isRedisAvailable) {
                await this.redis.del(key);
            }
            this.localCache.delete(key);
        } catch (error) {
            console.error('Redis delete error:', error);
            this.localCache.delete(key);
        }
    }

    async list(prefix = '') {
        try {
            if (this.isRedisAvailable) {
                const keys = await this.redis.keys(prefix + '*');
                return { keys: keys.map(k => ({ name: k })) };
            }
            return { keys: [] };
        } catch (error) {
            console.error('Redis list error:', error);
            return { keys: [] };
        }
    }
}

const VOID_KV = new RedisStorage();

async function getData(key) {
    return await VOID_KV.get(key);
}

async function setData(key, value, ttl = null) {
    await VOID_KV.put(key, value, ttl);
}

async function deleteData(key) {
    await VOID_KV.delete(key);
}

async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }
            return response;
        } catch (error) {
            lastError = error;
            console.warn('Попытка ' + (i + 1) + '/' + retries + ' не удалась: ' + error.message);
            if (i < retries - 1) {
                const waitTime = delay * Math.pow(2, i);
                await new Promise(r => setTimeout(r, waitTime));
            }
        }
    }
    throw lastError;
}

const errorCache = new Map();

async function notifyAdmin(error, context = {}) {
    if (!ADMIN_CHAT_ID || ADMIN_CHAT_ID === 'ваш_telegram_id') {
        console.warn('ADMIN_CHAT_ID не настроен');
        return;
    }

    const errorKey = error.message?.slice(0, 50) || 'unknown';
    const now = Date.now();
    if (errorCache.has(errorKey) && now - errorCache.get(errorKey) < 3600000) {
        return;
    }
    errorCache.set(errorKey, now);

    try {
        const message = 'КРИТИЧЕСКАЯ ОШИБКА БОТА\n\n' +
            'Ошибка: ' + (error.message || 'Unknown error') + '\n' +
            'Функция: ' + (context.function || 'unknown') + '\n' +
            'Пользователь: ' + (context.chatId || 'unknown') + '\n' +
            'Время: ' + new Date().toISOString() + '\n' +
            'Стек:\n' + (error.stack || '').slice(0, 300);

        await sendMessage(ADMIN_CHAT_ID, message);
    } catch (e) {
        console.error('Не удалось отправить уведомление админу:', e);
    }
}

function encrypt(text) {
    try {
        const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        const tag = cipher.getAuthTag().toString('base64');
        return iv.toString('base64') + ':' + encrypted + ':' + tag;
    } catch (error) {
        console.error('Ошибка шифрования:', error);
        return null;
    }
}

function decrypt(encoded) {
    try {
        const parts = encoded.split(':');
        if (parts.length !== 3) return null;
        const ivBase64 = parts[0];
        const encrypted = parts[1];
        const tagBase64 = parts[2];
        const iv = Buffer.from(ivBase64, 'base64');
        const tag = Buffer.from(tagBase64, 'base64');
        const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        console.error('Ошибка дешифрования:', error);
        return null;
    }
}

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
                warning: 'Ваш API-ключ имеет права на вывод средств. Для безопасности рекомендуется использовать ключ только с правами на чтение.'
            };
        } catch (e) {
            return {
                valid: true,
                hasWithdrawPermissions: false,
                warning: null
            };
        }
    } catch (error) {
        console.error('Валидация ключей failed:', error);
        return {
            valid: false,
            error: 'Неверные API-ключи или проблема с подключением к бирже.'
        };
    }
}

const connectAttempts = new Map();

async function checkConnectAttempts(chatId) {
    const key = 'connect_attempts_' + chatId;
    const attempts = await getData(key) || 0;

    if (attempts >= 5) {
        const blockTime = 3600000;
        const lastAttempt = await getData('connect_attempts_time_' + chatId);
        if (lastAttempt && Date.now() - parseInt(lastAttempt) < blockTime) {
            return {
                blocked: true,
                reason: 'Слишком много неудачных попыток. Попробуйте через час.'
            };
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
        const attempts = await getData(key) || 0;
        await setData(key, (attempts + 1).toString(), 3600);
        await setData('connect_attempts_time_' + chatId, Date.now().toString(), 3600);
    }
}

function sanitizeInput(text) {
    if (!text) return '';

    let sanitized = text
        .replace(/[<>]/g, '')
        .replace(/[{}]/g, '')
        .replace(/[\[\]]/g, '')
        .replace(/[`]/g, '')
        .trim();

    if (sanitized.length > 4096) {
        sanitized = sanitized.slice(0, 4096);
    }

    return sanitized;
}

function isValidContractAddress(address) {
    if (!address || typeof address !== 'string') return false;
    const clean = address.trim();
    if (!clean.startsWith('0x')) return false;
    if (clean.length !== 42) return false;
    const hex = clean.slice(2);
    return /^[0-9a-fA-F]{40}$/.test(hex);
}

function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

async function checkRateLimit(chatId, action, maxRequests = 10, timeWindow = 60000) {
    const key = 'rate_' + chatId + '_' + action;
    const data = await getData(key);
    const now = Date.now();

    let count = 0;
    let firstRequest = now;

    if (data) {
        let parsed;
        try {
            parsed = typeof data === 'string' ? JSON.parse(data) : data;
            count = parsed.count || 0;
            firstRequest = parsed.firstRequest || now;
        } catch (e) {
            count = 0;
            firstRequest = now;
        }

        if (now - firstRequest > timeWindow) {
            count = 0;
            firstRequest = now;
        }
    }

    if (count >= maxRequests) {
        const resetTime = Math.ceil((firstRequest + timeWindow - now) / 1000);
        return {
            allowed: false,
            message: 'Слишком много запросов. Подождите ' + resetTime + ' секунд.'
        };
    }

    await setData(key, JSON.stringify({
        count: count + 1,
        firstRequest: firstRequest
    }), Math.ceil(timeWindow / 1000));

    return { allowed: true };
}

function verifyCryptoBotWebhook(body, headers) {
    const signature = headers['crypto-pay-api-signature'];
    if (!signature) return false;

    const token = CRYPTOBOT_TOKEN;
    const hash = crypto
        .createHmac('sha256', token)
        .update(JSON.stringify(body))
        .digest('hex');

    return hash === signature;
}

async function checkDuplicatePayment(chatId, planId) {
    const key = 'payment_duplicate_' + chatId + '_' + planId;
    const existing = await getData(key);

    if (existing) {
        let data;
        try {
            data = typeof existing === 'string' ? JSON.parse(existing) : existing;
            if (Date.now() - data.createdAt < 900000) {
                return {
                    duplicate: true,
                    message: 'У вас уже есть активный платёж на этот тариф. Подождите 15 минут.'
                };
            }
        } catch (e) {
            await deleteData(key);
        }
    }

    await setData(key, JSON.stringify({
        createdAt: Date.now(),
        planId: planId
    }), 3600);

    return { duplicate: false };
}

async function checkSuspiciousUser(chatId) {
    const accountAgeKey = 'account_age_' + chatId;
    let accountAge = await getData(accountAgeKey);

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
                const joinDate = data.result.date || Date.now();
                accountAge = joinDate;
                await setData(accountAgeKey, accountAge.toString(), 86400 * 30);
            }
        } catch (error) {
            console.error('Ошибка получения возраста аккаунта:', error);
        }
    }

    if (accountAge) {
        const age = typeof accountAge === 'string' ? parseInt(accountAge) : accountAge;
        if (Date.now() - age < 7 * 24 * 60 * 60 * 1000) {
            return {
                suspicious: true,
                message: 'Ваш аккаунт был создан недавно. Будьте осторожны с подключением API-ключей.'
            };
        }
    }

    return { suspicious: false };
}

function formatDateShort(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return day + '.' + month + '.' + year;
}

function addExitButton(keyboard, lang) {
    if (!keyboard) {
        return {
            inline_keyboard: [
                [{ text: 'Выйти в меню', callback_data: 'exit_to_menu' }]
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
            [{ text: 'Выйти в меню', callback_data: 'exit_to_menu' }]
        ]);
    }

    return keyboard;
}

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
    const messageId = await getUserLastMessageId(chatId);
    if (messageId) {
        try {
            await botDeleteMessage(chatId, messageId);
            await deleteData('last_msg_' + chatId);
        } catch (error) {
            console.error('Failed to delete message:', error);
        }
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
        console.error('Delete message error:', error);
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
        console.error('Failed to delete user message:', error);
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

async function sendUpdatedMessage(chatId, text, keyboard, parseMode, userMessageId) {
    if (userMessageId) {
        const msgExists = await checkMessageExists(chatId, userMessageId);
        if (msgExists) {
            await deleteUserMessageWithDelay(chatId, userMessageId, 1500);
        }
    }
    await deleteUserLastMessage(chatId);

    if (keyboard) {
        const lang = await getData('lang_' + chatId) || 'ru';
        keyboard = addExitButton(keyboard, lang);
    }

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
        console.error('Send message error:', error);
        return null;
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
        console.error('Typing error:', error);
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
        console.error('Answer callback error:', error);
    }
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
        console.error('Send document error:', error);
    }
}

async function cleanupOldData() {
    const now = Date.now();
    const keys = await VOID_KV.list('');

    for (const key of keys.keys) {
        const data = await getData(key.name);
        if (!data) continue;

        try {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            if (parsed.timestamp && now - parsed.timestamp > 90 * 24 * 60 * 60 * 1000) {
                await deleteData(key.name);
                console.log('Удалены старые данные:', key.name);
            }
        } catch (e) {
            if (key.name.startsWith('state_') ||
                key.name.startsWith('spam_') ||
                key.name.startsWith('rate_')) {
                await deleteData(key.name);
            }
        }
    }
}

setInterval(cleanupOldData, 24 * 60 * 60 * 1000);

const PLANS = {
    TRIAL: {
        id: 'TRIAL',
        name: 'Триал',
        name_en: 'Trial',
        price: 0,
        duration: 7,
        limits: {
            analyze: 2,
            antiscam: 3,
            alerts: 0,
            social: 3,
            dex: 2,
            news: 2,
            calendar: 2,
            search_token: 3,
            panic: false,
            diary: true,
            ranking: false,
            autotrade: false,
            ai: 0,
            csv: false,
            kill_switch: false,
            priority_support: false
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
            analyze: 10,
            antiscam: 15,
            alerts: 3,
            social: 10,
            dex: 10,
            news: 10,
            calendar: 10,
            search_token: 15,
            panic: false,
            diary: true,
            ranking: true,
            autotrade: false,
            ai: 5,
            csv: true,
            kill_switch: false,
            priority_support: false
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
            analyze: 30,
            antiscam: 50,
            alerts: 15,
            social: Infinity,
            dex: Infinity,
            news: Infinity,
            calendar: Infinity,
            search_token: Infinity,
            panic: true,
            diary: true,
            ranking: true,
            autotrade: 3,
            ai: 20,
            csv: true,
            kill_switch: true,
            priority_support: false
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
            analyze: Infinity,
            antiscam: Infinity,
            alerts: Infinity,
            social: Infinity,
            dex: Infinity,
            news: Infinity,
            calendar: Infinity,
            search_token: Infinity,
            panic: true,
            diary: true,
            ranking: true,
            autotrade: Infinity,
            ai: Infinity,
            csv: true,
            kill_switch: true,
            priority_support: true
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

const LANGUAGES = {
    ru: {
        language_select: 'Выберите язык / Choose language:',
        mode_select: 'Выбери свой уровень:',
        mode_beginner_desc: 'Новичок\nЦелевые веса: BTC 50%, Альты 30%, Стейблы 20%\nПростые рекомендации по портфелю\nБазовые метрики (риск, распределение)',
        mode_pro_desc: 'Опытный\nЦелевые веса: BTC 40%, Альты 40%, Стейблы 20%\nРасширенные рекомендации\nПолные метрики (Шарп, RSI, MA20, просадка)',
        mode_select_prompt: 'Выбери режим:',
        mode_beginner_btn: 'Новичок',
        mode_pro_btn: 'Опытный',
        onboarding_setup: 'Настройка бота...\n\nЯзык установлен\nРежим выбран\nПрофиль создан\n\nЗавершаем настройку...',
        onboarding_done: 'Готово!',
        main_header: function(name, mode, id, plan, expires) {
            return 'Пользователь: ' + name + ' | ' + mode + ' | ID: ' + id + '\nТариф: ' + plan + ' (до ' + expires + ')';
        },
        main_functions: 'Функции',
        main_settings: 'Настройки',
        main_plans: 'Тарифы',
        main_help: 'Помощь',
        main_about: 'О боте',
        back_to_menu: 'Назад в меню',
        functions_title: 'Функции',
        functions_analyze: 'Анализ портфеля',
        functions_security: 'Антискам-центр',
        functions_news: 'Новости',
        functions_history: 'История',
        back_to_functions: 'Назад к функциям',
        settings_title: 'Настройки',
        settings_lang: 'Язык:',
        settings_mode: 'Режим:',
        settings_change_lang: 'Сменить язык',
        settings_change_mode: 'Сменить режим',
        back_to_settings: 'Назад к настройкам',
        help_menu_title: 'Помощь по боту\n\nВыберите интересующий вас вопрос:',
        help_q1: 'Как подключить биржу?',
        help_q2: 'Как работает анализ портфеля?',
        help_q3: 'Зачем подключать биржу?',
        help_q4: 'Как проверить контракт?',
        help_q5: 'Как создать оповещение?',
        help_q6: 'Как включить автоторговлю?',
        help_q7: 'Что такое холодный душ?',
        help_q8: 'Как работает дневник настроения?',
        help_q9: 'Как отключить биржу?',
        help_contact_moderator: 'Написать модератору',
        back_to_help: 'Назад к помощи',
        help_answer_q1: 'Как подключить биржу?\n\n1. Зайдите на биржу (Binance, Bybit, OKX и др.)\n2. Перейдите в раздел управления API\n3. Создайте ключ с правами только на чтение\n4. Скопируйте API-ключ и Secret-ключ\n5. Отправьте их в бот командой /connect в формате:\nAPI_KEY:SECRET_KEY\n\nКлючи шифруются и не имеют права на вывод средств.',
        help_answer_q2: 'Как работает анализ портфеля?\n\nКоманда /analyze запускает полный анализ:\nПоказывает распределение активов (BTC, альты, стейблы)\nРассчитывает RSI, скользящие средние (MA20, MA200)\nОценивает риск (низкий/средний/высокий)\nСчитает коэффициент Шарпа и VaR\nДаёт конкретные рекомендации по ребалансировке\n\nПосле анализа вы можете исполнить рекомендации одним нажатием кнопки.',
        help_answer_q3: 'Зачем подключать биржу?\n\nПодключение биржи даёт тебе доступ к КЛЮЧЕВЫМ функциям бота:\n\n1. Анализ портфеля - бот видит твои активы и даёт персонализированные рекомендации\n\n2. Автоторговля - автоматическая защита и ребаланс портфеля\n\n3. Холодный душ - экстренная защита при падении рынка\n\n4. Оповещения - уведомления по твоим активам\n\n5. Ребаланс - автоматическое поддержание целевых весов\n\nБезопасность: ключи шифруются и имеют права только на чтение. Бот НЕ МОЖЕТ выводить средства.\n\nКак подключить: /connect',
        help_answer_q4: 'Как проверить контракт?\n\nОтправьте адрес контракта (0x...) в чат – бот проверит:\nВерификацию на Etherscan\nПодозрительные паттерны (honeypot)\nСкоринг риска (0–100 баллов)\n\nПример: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        help_answer_q5: 'Как создать оповещение?\n\nИспользуйте /alerts или меню Оповещения.\n\n5 типов оповещений:\nПо цене – при достижении заданной цены\nПо изменению % – при изменении цены более чем на X%\nПо объёму – при превышении объёма торгов\nНовостное – при появлении новостей по вашим активам\nКалендарное – перед важными экономическими событиями\n\nЛимит зависит от вашего тарифа.',
        help_answer_q6: 'Как включить автоторговлю?\n\n/autotrade открывает меню с 4 уровнями:\n\nУровень 1 (Защита) – стоп-лоссы 5% и 10%\nУровень 2 (Перераспределение) – продажа мусора, покупка роста\nУровень 3 (Умный рост) – трейлинг стоп-лосс, фиксация 30% прибыли\nУровень 4 (Снежный ком) – переток из мусорных в растущие\n\nДоступна только на PRO и VIP. Проверка каждые 15 минут.',
        help_answer_q7: 'Что такое холодный душ?\n\nЭкстренная защита при падении рынка:\nБот проверяет ВСЕ токены каждые 15 минут\nПри падении >5% за 15 минут – отправляет предупреждение\nПредлагает конвертировать все активы в USDT\n\nДоступен на PRO и VIP. Активируйте командой /panic.',
        help_answer_q8: 'Как работает дневник настроения?\n\n/diary открывает дневник эмоций.\n\nВыберите настроение:\nСпокоен | Задумчив | Тревожен | Паника | Зол | Эйфория\n\nБот сохраняет записи. Если вы тревожны 3 дня подряд - бот предупредит вас.',
        help_answer_q9: 'Как отключить биржу?\n\n/disconnect или Настройки → Отключить биржу.\n\nПосле подтверждения API-ключи будут удалены.\n\nЕсли вы случайно подтвердили, есть 10 секунд на отмену: /undo',
        help_contact_moderator_message: 'Связь с модератором\n\nНапишите @clofeLEAN - он вам поможет!\n\nТакже вы можете задать вопрос в нашем чате поддержки:\nЧат поддержки\n\nМы отвечаем в течение 15 минут (в рабочее время).',
        market_menu: 'Что вас интересует?',
        market_social: 'Соц.тренды',
        market_news: 'Новости',
        market_calendar: 'Календарь',
        back_to_market: 'Назад к рынку',
        social_menu: 'Выберите монету:',
        social_search: 'Найти токен',
        social_analyzing: function(coin) {
            return 'Получаю данные по ' + coin + '...';
        },
        social_search_prompt: 'Введите название токена\n\nПримеры: PEPE, ARB, SOL, DOGE, SHIB\n/cancel - отмена',
        social_search_invalid: 'Некорректное название токена.\n\nВведите тикер (например: PEPE, ARB, SOL, DOGE, SHIB).',
        news_analyzing: 'Получаю новости...',
        news_empty: 'Новостей не найдено.',
        news_coin: function(coin) {
            return 'НОВОСТИ: ' + coin + '\n\n';
        },
        news_personalized_header: 'НОВОСТИ ДЛЯ ТВОЕГО ПОРТФЕЛЯ\n\n',
        news_no_assets: 'Сначала выполни /analyze, чтобы я знал твой портфель.',
        news_no_news: 'Новостей по твоим активам не найдено.',
        calendar_analyzing: 'Формирую календарь...',
        calendar_empty: 'На эту неделю важных событий не найдено.',
        calendar_pro_only: 'Календарь трейдера доступен на тарифах PRO и VIP.\n\n/subscribe',
        calendar_result: function(events) {
            if (!events || events.length === 0) return 'На эту неделю важных событий не найдено.';
            var result = 'КАЛЕНДАРЬ ТРЕЙДЕРА\n\n';
            for (var i = 0; i < events.slice(0, 10).length; i++) {
                var event = events.slice(0, 10)[i];
                result += 'Событие: ' + (event.title || 'Событие') + '\n';
                result += 'Дата: ' + (event.date || 'Дата неизвестна') + '\n';
                if (event.importance) result += 'Важность: ' + event.importance + '\n';
                if (event.impact) result += 'Влияние: ' + event.impact + '\n';
                result += '\n';
            }
            return result;
        },
        settings_old: 'Настройки',
        settings_lang_old: 'Язык',
        settings_mode_old: 'Режим',
        settings_lang_selected: function(lang) {
            return 'Язык: ' + lang;
        },
        settings_mode_selected: function(mode) {
            return 'Режим: ' + mode;
        },
        settings_mode_beginner_old: 'Новичок',
        settings_mode_pro_old: 'Опытный',
        history_title: 'ИСТОРИЯ',
        history_empty: 'История пуста.',
        history_item: function(date, action, detail) {
            return date + '\n' + action + '\n  ' + detail + '\n';
        },
        history_analyze: 'Анализ портфеля',
        history_antiscam: 'Проверка безопасности',
        history_social: 'Соц.тренды',
        history_news: 'Новости',
        history_calendar: 'Календарь',
        mood_title: 'Как настроение?',
        mood_saved: 'Сохранено!',
        mood_warning: function(days) {
            return 'Внимание!\n\nТы тревожен ' + days + ' день подряд.\nВ таком состоянии опасно торговать.\n\nРекомендую:\nСделать перерыв\nВключить режим HODL\nНе принимать решений до завтра';
        },
        mood_calm: 'Спокоен',
        mood_thoughtful: 'Задумчив',
        mood_anxious: 'Тревожен',
        mood_panic: 'Паника',
        mood_angry: 'Зол',
        mood_euphoric: 'Эйфория',
        plans_title: 'Тарифы',
        plans_current: function(plan, expires) {
            return plan + '\nДо: ' + expires;
        },
        plans_trial: 'Триал - 0 ₽\n   7 дней\n   Базовые функции',
        plans_start: 'Старт - 500 ₽/мес\n   10 анализов/день\n   Антискам (15/день)',
        plans_pro: 'PRO - 1 000 ₽/мес\n   30 анализов/день\n   Безлимитные тренды\n   Холодный душ',
        plans_vip: 'VIP - 1 500 ₽/мес\n   ВСЕ БЕЗЛИМИТНО\n   Поддержка 24/7',
        plans_select: 'Выбери тариф:',
        plans_payment_creating: 'Создаю счёт...',
        plans_payment_error: 'Ошибка создания счёта.',
        plans_success: function(plan) {
            return plan + ' активирован!';
        },
        plans_already: function(plan) {
            return 'У вас уже активен ' + plan;
        },
        plans_not_found: 'Тариф не найден.',
        plans_trial_used: 'Триал уже использован.\n/subscribe',
        plans_trial_success: 'Триал активирован на 7 дней!',
        plans_payment_title: function(plan) {
            return 'ОПЛАТА ' + plan;
        },
        days: 'дней',
        plans_features: 'Функции',
        plans_payment_methods: 'Способы оплаты',
        plans_payment_crypto: 'Криптовалюта (USDT, BTC, TON)',
        plans_payment_card: 'Банковская карта',
        plans_payment_note: 'После оплаты тариф активируется автоматически.',
        plan_trial_name: 'Триал',
        plan_start_name: 'Старт',
        plan_pro_name: 'PRO',
        plan_vip_name: 'VIP',
        error_exchange: 'Биржа не отвечает. Попробуй через минуту.',
        error_api_key: 'Неверный ключ. Проверь инструкцию: /connect',
        error_general: function(err) {
            return 'Ошибка: ' + err;
        },
        cooldown: function(sec) {
            return 'Подожди ' + sec + ' сек.';
        },
        no_keys: 'Подключи биржу: /connect',
        no_analysis_data: 'Нет данных. Выполни /analyze',
        ai_mode: 'Задай вопрос по портфелю\nДля выхода: /exit',
        ai_thinking: 'Думаю...',
        ai_exit: 'Выход из AI.',
        export_error: 'Ошибка CSV.',
        issues_found: 'Проблемы:',
        suggested_actions: 'Рекомендации:',
        disconnect_success: 'Биржа отключена.',
        default_response: function(text) {
            return 'Ты написал: "' + text + '"\n\nНажми /help';
        },
        no_coins: 'На балансе нет монет.',
        risk_high: 'Высокий риск',
        risk_medium: 'Средний риск',
        risk_low: 'Низкий риск',
        wallet_invalid: 'Неверный адрес кошелька.\n\nОтправь адрес, начинающийся с 0x...',
        wallet_balance: function(balance, price) {
            return 'Баланс: ' + balance + ' ETH (≈ $' + price + ')';
        },
        wallet_tokens: function(tokens) {
            return 'Токены: ' + tokens + ' разных токенов';
        },
        wallet_risk_label: function(risk) {
            return 'Риск: ' + risk;
        },
        wallet_risk_high: 'Высокий',
        wallet_risk_medium: 'Средний',
        wallet_risk_low: 'Низкий',
        wallet_no_risks: 'Рисков не обнаружено',
        wallet_recommendations: 'Рекомендации:',
        wallet_connect: 'Подключить биржу',
        kill_switch_activated: 'KILL SWITCH АКТИВИРОВАН\n\nОрдера отменены\nКлючи удалены\nБот заблокирован\n\nДля разблокировки: /reset',
        kill_switch_cancel: 'Отменён.',
        kill_switch_no_keys: 'Нет биржи.',
        kill_switch_blocked: 'Бот заблокирован.\nДля разблокировки: /reset',
        kill_switch_reset: 'Бот разблокирован.\n\nПодключи биржу: /connect',
        kill_switch_confirm_yes: 'ДА, ОСТАНОВИТЬ',
        kill_switch_confirm_no: 'Отмена',
        kill_switch_pro_only: 'Kill Switch доступен на PRO и VIP.\n/subscribe',
        kill_switch_confirmation: 'ПОДТВЕРДИ KILL SWITCH\n\nЭто действие НЕОБРАТИМО!\n\nВсе ордера будут отменены\nКлючи будут удалены\nБот будет заблокирован',
        share_title: 'Поделиться Void Node',
        share_text: 'Void Node - твой крипто-телохранитель\n\nАнализ портфеля за 1 минуту\nАнтискам-центр\nСоц.тренды\nКалендарь трейдера\nAI-советник\n\nПрисоединяйся: @void_node_bot',
        share_link: function(ref) {
            return 'Твоя реферальная ссылка:\nhttps://t.me/' + BOT_USERNAME + '?start=ref_' + ref;
        },
        help_title: 'УМНАЯ ПОМОЩЬ\n\nПросто напиши свой вопрос, и я отвечу!\nДля выхода: /exit',
        help_ask: 'Задать свой вопрос',
        help_how_check: 'Как проверить токен?',
        help_sharpe: 'Коэффициент Шарпа',
        help_connect: 'Подключить биржу',
        help_antiscam: 'Антискам-центр',
        help_panic: 'Холодный душ',
        help_plans: 'Тарифы',
        help_out_of_scope: 'Я помогаю только с вопросами о боте Void Node!',
        help_ask_prompt: 'Напиши свой вопрос\n\nЯ отвечу на него максимально подробно.\nДля выхода из режима помощи отправь /exit',
        alert_menu: 'Оповещения\n\nВыберите тип оповещения:',
        alert_price: 'По цене',
        alert_change: 'По изменению %',
        alert_volume: 'По объёму',
        alert_news: 'Новостное',
        alert_calendar: 'Календарное',
        alert_create_price: 'Создать ценовое оповещение\n\nВведите символ и цену в формате:\nBTC 70000 (выше) или BTC 65000 below',
        alert_create_change: 'Создать оповещение по изменению %\n\nВведите символ и % в формате:\nBTC 5 (изменение >5% за час)',
        alert_created: 'Оповещение добавлено!',
        alert_list: 'Ваши оповещения:\n',
        alert_deleted: 'Оповещение удалено.',
        autotrade_menu: 'Автоторговля\n\nВыберите уровень сложности:',
        autotrade_level1: 'Уровень 1 (Защита)',
        autotrade_level2: 'Уровень 2 (Перераспределение)',
        autotrade_level3: 'Уровень 3 (Умный рост)',
        autotrade_level4: 'Уровень 4 (Снежный ком)',
        autotrade_active: function(level) {
            return 'Автоторговля активирована (уровень ' + level + ')';
        },
        autotrade_stopped: 'Автоторговля остановлена.',
        autotrade_pro_only: 'Автоторговля доступна только PRO и VIP.',
        panic_start: 'Холодный душ активирован.\n\nБуду отслеживать BTC каждые 15 минут. При падении >5% за 15 минут – предложу конвертацию в стейблы.',
        panic_stop: 'Холодный душ остановлен.',
        panic_trigger: function(percent) {
            return 'ХОЛОДНЫЙ ДУШ СРАБОТАЛ!\n\nОбнаружено падение >5% по нескольким активам.\n\nРекомендуется конвертировать ВСЕ активы в USDT.';
        },
        panic_convert: 'Конвертировать всё в USDT',
        panic_converted: 'Конвертация выполнена. Портфель в безопасности.',
        back_to_security: 'Назад к безопасности',
        back_to_plans: 'Назад к тарифам',
        back_to_history: 'Назад к истории',
        back_to_analyze: 'Назад к анализу',
        about_title: 'О БОТЕ',
        about_version: 'Версия: 2.0.0',
        about_created: 'Создан: 2024',
        about_dev: 'Разработчик: @void_node_dev',
        about_instruction: 'ИНСТРУКЦИЯ:\n\n1. Подключи биржу /connect\n2. Анализируй портфель /analyze\n3. Проверяй безопасность - отправь ссылку или контракт\n4. Следи за рынком /news\n5. Получи AI-совет /help',
        about_links: 'ПОЛЕЗНЫЕ ССЫЛКИ:\n\nTelegram',
        about_commands: 'Быстрые команды:\n/analyze - анализ портфеля\n/connect - подключить биржу\n/news - новости, тренды, календарь\n/help - умная помощь',
        menu: 'Void Node - твой крипто-телохранитель\n\nГлавное меню:',
        main_analyze: 'Анализ портфеля',
        main_security: 'Безопасность',
        main_market: 'Рынок',
        main_settings_old: 'Настройки',
        main_plans_old: 'Тарифы',
        main_history_old: 'История',
        main_help_old: 'Помощь',
        greeting_morning: function(name) {
            return 'Доброе утро, ' + name + '!';
        },
        greeting_afternoon: function(name) {
            return 'Добрый день, ' + name + '!';
        },
        greeting_evening: function(name) {
            return 'Добрый вечер, ' + name + '!';
        },
        onboard: 'Добро пожаловать в Void Node!\n\nЯ - твой крипто-телохранитель\n\nНачни с подключения биржи: /connect\nИли отправь мне ссылку или адрес контракта - я проверю!',
        onboard_skip: 'Пропустить',
        onboard_start: 'Начать!',
        connect_prompt: 'Подключи биржу\n\nОтправь API-ключи в формате:\nAPI_KEY:SECRET_KEY\n\nДля отмены: /cancel',
        connect_success: function(exchange) {
            return 'Биржа ' + exchange + ' подключена!\n\nТеперь отправь /analyze';
        },
        connect_fail: 'Не удалось подключить биржу.\n\nПроверь ключи и попробуй ещё раз.',
        connect_cancel: 'Подключение отменено.',
        connect_confirm: 'Точно отключить биржу?\n\nВсе ключи будут удалены.',
        connect_confirm_yes: 'Да, отключить',
        connect_confirm_no: 'Нет, оставить',
        connect_undo: 'Ключи будут удалены через 10 секунд. Отмена: /undo',
        connect_undo_success: 'Отмена выполнена! Ключи сохранены.',
        connect_disconnected: 'Биржа отключена. Все ключи удалены.',
        invalid_format: 'Неверный формат! Отправь ключи как API_KEY:SECRET_KEY.',
        analyzing_step: function(step, total, text) {
            return '[' + step + '/' + total + '] ' + text + '...';
        },
        analyzing_done: 'Анализ завершён!',
        analyzing_no_keys: 'Сначала подключи биржу. /connect',
        analyzing_limit: function(limit, remaining) {
            return 'Лимит: ' + limit + '/день. Осталось: ' + remaining + '\n/subscribe';
        },
        security_menu: 'Что проверить?',
        security_link: 'Ссылку',
        security_contract: 'Контракт',
        security_file: 'Файл',
        security_dex: 'DEX',
        security_impersonation: 'Аккаунт',
        security_wallet: 'Кошелек',
        scan_link: 'Отправь ссылку для проверки\n/cancel - отмена',
        scan_contract: 'Отправь адрес контракта (0x...)\n/cancel - отмена',
        scan_file: 'Отправь файл для проверки\n/cancel - отмена',
        dex_prompt: 'Отправь адрес контракта для DEX проверки\n/cancel - отмена',
        impersonation_prompt: 'Перешли сообщение от подозрительного пользователя\n/cancel - отмена',
        wallet_prompt: 'Отправь адрес кошелька для проверки\nПример: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e\n/cancel - отмена',
        scan_link_invalid: 'Отправьте ссылку, начинающуюся с http:// или https://',
        scan_contract_invalid: 'Отправьте адрес контракта (0x...)',
        scan_file_invalid: 'Отправьте файл для проверки.',
        scan_impersonation_invalid: 'Перешлите сообщение от подозрительного пользователя.',
        scan_timeout: 'Проверка заняла слишком много времени.',
        scan_cancelled: 'Проверка отменена.',
        scan_safe: 'БЕЗОПАСНО',
        scan_danger: 'ОПАСНО',
        scan_result_safe: function(type) {
            return 'БЕЗОПАСНО\n\n' + type + ' не содержит угроз.';
        },
        scan_result_danger: function(type, reason) {
            return 'ОПАСНО\n\n' + type + ' содержит угрозы:\n' + reason;
        },
        vip_bonus_title: 'БОНУС!',
        vip_bonus_subtitle: 'Получи 3 дня VIP-доступа БЕСПЛАТНО!',
        vip_bonus_connect: 'Просто подключи свою биржу, и я:',
        vip_bonus_panic: 'Включу ХОЛОДНЫЙ ДУШ',
        vip_bonus_autotrade: 'Дам АВТОТОРГОВЛЮ',
        vip_bonus_analytics: 'Открою ВСЕ аналитические функции',
        vip_bonus_alerts: 'Безлимитные оповещения',
        vip_bonus_offer: 'Предложение действует только сейчас!',
        vip_bonus_connect_btn: 'Подключить биржу',
        vip_bonus_skip_btn: 'Пропустить',
        vip_activated_title: 'ПОЗДРАВЛЯЮ!',
        vip_activated_subtitle: 'Ты подключил биржу и получил VIP-доступ на 3 дня!',
        vip_activated_valid: 'Действует до:',
        vip_activated_features: 'Теперь тебе доступно всё:',
        vip_activated_try: 'Попробуй все функции, а после триала выбери подходящий тариф!',
        vip_activated_btn: 'В меню',
        vip_reminder_text: function(expires) {
            return 'Привет! Твой VIP-доступ заканчивается завтра (' + expires + ').\n\nТы уже видел, как холодный душ спасает портфель.\nТы знаешь, как автоторговля приносит прибыль.\n\nЯ не хочу, чтобы ты терял эти возможности.\nПродли доступ сейчас - и оставайся под защитой.\n\n/subscribe - выбери свой тариф';
        },
        vip_reminder_btn_plans: 'Выбрать тариф',
        vip_reminder_btn_analyze: 'Анализ портфеля',
        vip_renewed: function(plan) {
            return 'Спасибо, что остаёшься со мной! ' + plan + ' активирован.\n\nПортфель снова под защитой. Если что - я рядом: /help';
        }
    },
    en: {
        language_select: 'Choose language:',
        mode_select: 'Choose your level:',
        mode_beginner_desc: 'Beginner\nTarget weights: BTC 50%, Alts 30%, Stable 20%\nSimple portfolio recommendations\nBasic metrics (risk, allocation)',
        mode_pro_desc: 'Experienced\nTarget weights: BTC 40%, Alts 40%, Stable 20%\nAdvanced recommendations\nFull metrics (Sharpe, RSI, MA20, drawdown)',
        mode_select_prompt: 'Select mode:',
        mode_beginner_btn: 'Beginner',
        mode_pro_btn: 'Experienced',
        onboarding_setup: 'Setting up bot...\n\nLanguage set\nMode selected\nProfile created\n\nFinishing setup...',
        onboarding_done: 'Done!',
        main_header: function(name, mode, id, plan, expires) {
            return 'User: ' + name + ' | ' + mode + ' | ID: ' + id + '\nPlan: ' + plan + ' (until ' + expires + ')';
        },
        main_functions: 'Functions',
        main_settings: 'Settings',
        main_plans: 'Plans',
        main_help: 'Help',
        main_about: 'About',
        back_to_menu: 'Back to menu',
        functions_title: 'Functions',
        functions_analyze: 'Analyze portfolio',
        functions_security: 'Anti-scam center',
        functions_news: 'News',
        functions_history: 'History',
        back_to_functions: 'Back to functions',
        settings_title: 'Settings',
        settings_lang: 'Language:',
        settings_mode: 'Mode:',
        settings_change_lang: 'Change language',
        settings_change_mode: 'Change mode',
        back_to_settings: 'Back to settings',
        help_menu_title: 'Help\n\nSelect a question:',
        help_q1: 'How to connect exchange?',
        help_q2: 'How does portfolio analysis work?',
        help_q3: 'Why connect exchange?',
        help_q4: 'How to check a contract?',
        help_q5: 'How to create an alert?',
        help_q6: 'How to enable autotrading?',
        help_q7: 'What is Panic mode?',
        help_q8: 'How does mood diary work?',
        help_q9: 'How to disconnect exchange?',
        help_contact_moderator: 'Contact moderator',
        back_to_help: 'Back to help',
        help_answer_q1: 'How to connect exchange?\n\n1. Go to your exchange (Binance, Bybit, OKX, etc.)\n2. Go to API management section\n3. Create a key with read-only permissions\n4. Copy API key and Secret key\n5. Send them to bot with /connect in format:\nAPI_KEY:SECRET_KEY\n\nKeys are encrypted and have no withdrawal rights.',
        help_answer_q2: 'How does portfolio analysis work?\n\n/analyze runs a full portfolio analysis:\n\nShows asset allocation (BTC, alts, stablecoins)\nCalculates RSI, moving averages (MA20, MA200)\nEvaluates risk (low/medium/high)\nCalculates Sharpe ratio and VaR\nGives specific rebalancing recommendations\n\nAfter analysis you can execute recommendations with one click.',
        help_answer_q3: 'Why connect exchange?\n\nConnecting your exchange gives you access to KEY features:\n\n1. Portfolio analysis - bot sees your assets and gives personalized recommendations\n\n2. Autotrading - automatic protection and rebalancing\n\n3. Panic mode - emergency protection during market crashes\n\n4. Alerts - notifications for your assets\n\n5. Rebalance - automatic maintenance of target weights\n\nSecurity: keys are encrypted and have read-only permissions. The bot CANNOT withdraw funds.\n\nHow to connect: /connect',
        help_answer_q4: 'How to check a contract?\n\nYou can check a smart contract in several ways:\n\n1. Send contract address (0x...) in chat - bot will check automatically\n2. Use Security menu → Contract\n3. Use Security menu → DEX - shows liquidity and risks\n\nBot checks:\nVerification on Etherscan\nSuspicious patterns (honeypot)\nRisk scoring (0-100)\n\nExample: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        help_answer_q5: 'How to create an alert?\n\nUse /alerts or Alerts menu.\n\n5 alert types available:\nPrice - triggers at target price\nChange % - triggers when price changes by X%\nVolume - triggers when trading volume exceeds\nNews - triggers when news appear for your assets\nCalendar - before important economic events\n\nLimit depends on your plan.\nYou can view and delete alerts via menu.',
        help_answer_q6: 'How to enable autotrading?\n\n/autotrade opens menu with 4 levels:\n\nLevel 1 (Protection) - sets stop-losses at 5% and 10% drops\n\nLevel 2 (Reallocation) - sells junk tokens and buys growing ones\n\nLevel 3 (Smart Growth) - uses trailing stop-loss and locks 30% profit at >20% growth\n\nLevel 4 (Snowball) - flows capital from junk tokens to growing ones\n\nAutotrading checks portfolio every 15 minutes. Available only on PRO and VIP.',
        help_answer_q7: 'What is Panic mode?\n\nPanic mode is emergency protection during market crashes.\n\nBot checks ALL tokens every 15 minutes\nIf drop >5% in 15 minutes - sends warning\nOffers one-click conversion of ALL assets to USDT\n\nHelps preserve capital during crashes.\n\nAvailable on PRO and VIP. Activate with /panic.',
        help_answer_q8: 'How does mood diary work?\n\n/diary opens emotion diary.\n\nChoose your current mood:\nCalm | Thoughtful | Anxious | Panic | Angry | Euphoric\n\nBot saves entries and analyzes them.\nIf you\'re anxious for 3 days in a row - bot warns you not to trade.\n\nHelps control psychological state and avoid impulsive decisions.',
        help_answer_q9: 'How to disconnect exchange?\n\n/disconnect or Settings → Disconnect exchange.\n\nAfter confirmation:\nAPI keys will be deleted\nBot will stop analyzing portfolio\nAll portfolio data will be erased\n\nYou can always reconnect with /connect.\n\nIf you accidentally confirmed, you have 10 seconds to undo: /undo',
        help_contact_moderator_message: 'Contact moderator\n\nWrite to @clofeLEAN - he will help you!\n\nAlso you can ask in our support chat:\nSupport chat\n\nWe reply within 15 minutes (working hours).\n\nVIP users have 24/7 priority support.',
        market_menu: 'What interests you?',
        market_social: 'Social trends',
        market_news: 'News',
        market_calendar: 'Calendar',
        back_to_market: 'Back to market',
        social_menu: 'Select coin:',
        social_search: 'Find token',
        social_analyzing: function(coin) {
            return 'Getting data for ' + coin + '...';
        },
        social_search_prompt: 'Enter token name\n\nExamples: PEPE, ARB, SOL, DOGE, SHIB\n/cancel - cancel',
        social_search_invalid: 'Invalid token name.\n\nEnter a ticker (e.g., PEPE, ARB, SOL, DOGE, SHIB).',
        news_analyzing: 'Fetching news...',
        news_empty: 'No news found.',
        news_coin: function(coin) {
            return 'NEWS: ' + coin + '\n\n';
        },
        news_personalized_header: 'NEWS FOR YOUR PORTFOLIO\n\n',
        news_no_assets: 'Please run /analyze first so I know your portfolio.',
        news_no_news: 'No news found for your assets.',
        calendar_analyzing: 'Generating calendar...',
        calendar_empty: 'No important events this week.',
        calendar_pro_only: 'Trader Calendar available on PRO and VIP plans.\n\n/subscribe',
        calendar_result: function(events) {
            if (!events || events.length === 0) return 'No important events this week.';
            var result = 'TRADER CALENDAR\n\n';
            for (var i = 0; i < events.slice(0, 10).length; i++) {
                var event = events.slice(0, 10)[i];
                result += 'Event: ' + (event.title || 'Event') + '\n';
                result += 'Date: ' + (event.date || 'Date unknown') + '\n';
                if (event.importance) result += 'Importance: ' + event.importance + '\n';
                if (event.impact) result += 'Impact: ' + event.impact + '\n';
                result += '\n';
            }
            return result;
        },
        settings_old: 'Settings',
        settings_lang_old: 'Language',
        settings_mode_old: 'Mode',
        settings_lang_selected: function(lang) {
            return 'Language: ' + lang;
        },
        settings_mode_selected: function(mode) {
            return 'Mode: ' + mode;
        },
        settings_mode_beginner_old: 'Beginner',
        settings_mode_pro_old: 'Pro',
        history_title: 'HISTORY',
        history_empty: 'History is empty.',
        history_item: function(date, action, detail) {
            return date + '\n' + action + '\n  ' + detail + '\n';
        },
        history_analyze: 'Portfolio analysis',
        history_antiscam: 'Security check',
        history_social: 'Social trends',
        history_news: 'News',
        history_calendar: 'Calendar',
        mood_title: 'How are you feeling?',
        mood_saved: 'Saved!',
        mood_warning: function(days) {
            return 'Warning!\n\nYou\'ve been anxious for ' + days + ' days in a row.\nIt\'s dangerous to trade in this state.\n\nI recommend:\nTake a break\nEnable HODL mode\nDon\'t make decisions until tomorrow';
        },
        mood_calm: 'Calm',
        mood_thoughtful: 'Thoughtful',
        mood_anxious: 'Anxious',
        mood_panic: 'Panic',
        mood_angry: 'Angry',
        mood_euphoric: 'Euphoric',
        plans_title: 'Plans',
        plans_current: function(plan, expires) {
            return plan + '\nUntil: ' + expires;
        },
        plans_trial: 'Trial - 0 ₽\n   7 days\n   Basic features',
        plans_start: 'Start - 500 ₽/mo\n   10 analyses/day\n   Anti-scam (15/day)',
        plans_pro: 'PRO - 1 000 ₽/mo\n   30 analyses/day\n   Unlimited trends\n   Panic mode',
        plans_vip: 'VIP - 1 500 ₽/mo\n   UNLIMITED\n   24/7 support',
        plans_select: 'Select plan:',
        plans_payment_creating: 'Creating invoice...',
        plans_payment_error: 'Payment error.',
        plans_success: function(plan) {
            return plan + ' activated!';
        },
        plans_already: function(plan) {
            return 'You already have ' + plan;
        },
        plans_not_found: 'Plan not found.',
        plans_trial_used: 'Trial already used.\n/subscribe',
        plans_trial_success: 'Trial activated for 7 days!',
        plans_payment_title: function(plan) {
            return 'PAYMENT ' + plan;
        },
        days: 'days',
        plans_features: 'Features',
        plans_payment_methods: 'Payment methods',
        plans_payment_crypto: 'Cryptocurrency (USDT, BTC, TON)',
        plans_payment_card: 'Bank card',
        plans_payment_note: 'After payment, the plan will be activated automatically.',
        plan_trial_name: 'Trial',
        plan_start_name: 'Start',
        plan_pro_name: 'PRO',
        plan_vip_name: 'VIP',
        error_exchange: 'Exchange not responding. Try again in a minute.',
        error_api_key: 'Invalid key. Check instructions: /connect',
        error_general: function(err) {
            return 'Error: ' + err;
        },
        cooldown: function(sec) {
            return 'Wait ' + sec + ' sec.';
        },
        no_keys: 'Connect exchange: /connect',
        no_analysis_data: 'No data. Run /analyze',
        ai_mode: 'Ask about your portfolio\nTo exit: /exit',
        ai_thinking: 'Thinking...',
        ai_exit: 'Exited AI.',
        export_error: 'CSV error.',
        issues_found: 'Issues:',
        suggested_actions: 'Recommendations:',
        disconnect_success: 'Exchange disconnected.',
        default_response: function(text) {
            return 'You wrote: "' + text + '"\n\nPress /help';
        },
        no_coins: 'No coins in balance.',
        risk_high: 'High risk',
        risk_medium: 'Medium risk',
        risk_low: 'Low risk',
        wallet_invalid: 'Invalid wallet address.\n\nSend a valid address starting with 0x...',
        wallet_balance: function(balance, price) {
            return 'Balance: ' + balance + ' ETH (≈ $' + price + ')';
        },
        wallet_tokens: function(tokens) {
            return 'Tokens: ' + tokens + ' different tokens';
        },
        wallet_risk_label: function(risk) {
            return 'Risk: ' + risk;
        },
        wallet_risk_high: 'High',
        wallet_risk_medium: 'Medium',
        wallet_risk_low: 'Low',
        wallet_no_risks: 'No risks detected',
        wallet_recommendations: 'Recommendations:',
        wallet_connect: 'Connect Exchange',
        kill_switch_activated: 'KILL SWITCH ACTIVATED\n\nOrders cancelled\nKeys deleted\nBot locked\n\nTo unlock: /reset',
        kill_switch_cancel: 'Cancelled.',
        kill_switch_no_keys: 'No exchange.',
        kill_switch_blocked: 'Bot locked.\nTo unlock: /reset',
        kill_switch_reset: 'Bot unlocked.\n\nConnect exchange: /connect',
        kill_switch_confirm_yes: 'YES, STOP',
        kill_switch_confirm_no: 'Cancel',
        kill_switch_pro_only: 'Kill Switch available on PRO and VIP.\n/subscribe',
        kill_switch_confirmation: 'CONFIRM KILL SWITCH\n\nThis action is IRREVERSIBLE!\n\nAll orders will be cancelled\nKeys will be deleted\nBot will be locked',
        share_title: 'Share Void Node',
        share_text: 'Void Node - your crypto guardian\n\nPortfolio analysis in 1 minute\nAnti-scam center\nSocial trends\nTrader calendar\nAI advisor\n\nJoin: @void_node_bot',
        share_link: function(ref) {
            return 'Your referral link:\nhttps://t.me/' + BOT_USERNAME + '?start=ref_' + ref;
        },
        help_title: 'SMART HELP\n\nJust write your question, and I\'ll answer!\nTo exit: /exit',
        help_ask: 'Ask your own question',
        help_how_check: 'How to check token?',
        help_sharpe: 'Sharpe ratio',
        help_connect: 'Connect exchange',
        help_antiscam: 'Anti-scam center',
        help_panic: 'Panic mode',
        help_plans: 'Plans',
        help_out_of_scope: 'I only help with questions about the Void Node bot!',
        help_ask_prompt: 'Write your question\n\nI will answer in detail.\nTo exit help mode: /exit',
        alert_menu: 'Alerts\n\nSelect alert type:',
        alert_price: 'Price',
        alert_change: 'Change %',
        alert_volume: 'Volume',
        alert_news: 'News',
        alert_calendar: 'Calendar',
        alert_create_price: 'Create price alert\n\nEnter symbol and price in format:\nBTC 70000 (above) or BTC 65000 below',
        alert_create_change: 'Create change % alert\n\nEnter symbol and % in format:\nBTC 5 (change >5% per hour)',
        alert_created: 'Alert created!',
        alert_list: 'Your alerts:\n',
        alert_deleted: 'Alert deleted.',
        autotrade_menu: 'Autotrading\n\nChoose difficulty level:',
        autotrade_level1: 'Level 1 (Protection)',
        autotrade_level2: 'Level 2 (Reallocation)',
        autotrade_level3: 'Level 3 (Smart Growth)',
        autotrade_level4: 'Level 4 (Snowball)',
        autotrade_active: function(level) {
            return 'Autotrading activated (level ' + level + ')';
        },
        autotrade_stopped: 'Autotrading stopped.',
        autotrade_pro_only: 'Autotrading is available only for PRO and VIP.',
        panic_start: 'Panic mode activated.\n\nI will monitor BTC every 15 minutes. If drop >5% in 15 minutes - I will suggest converting to stables.',
        panic_stop: 'Panic mode stopped.',
        panic_trigger: function(percent) {
            return 'PANIC MODE TRIGGERED!\n\nDetected drop >5% across multiple assets.\n\nIt\'s recommended to convert ALL assets to USDT.';
        },
        panic_convert: 'Convert all to USDT',
        panic_converted: 'Conversion completed. Portfolio is safe.',
        back_to_security: 'Back to Security',
        back_to_plans: 'Back to Plans',
        back_to_history: 'Back to History',
        back_to_analyze: 'Back to Analysis',
        about_title: 'ABOUT BOT',
        about_version: 'Version: 2.0.0',
        about_created: 'Created: 2024',
        about_dev: 'Developer: @void_node_dev',
        about_instruction: 'INSTRUCTION:\n\n1. Connect exchange /connect\n2. Analyze portfolio /analyze\n3. Check security - send link or contract\n4. Follow market /news\n5. Get AI advice /help',
        about_links: 'USEFUL LINKS:\n\nTelegram',
        about_commands: 'Quick commands:\n/analyze - portfolio analysis\n/connect - connect exchange\n/news - news, trends, calendar\n/help - smart help',
        menu: 'Void Node - your crypto guardian\n\nMain menu:',
        main_analyze: 'Analyze portfolio',
        main_security: 'Security',
        main_market: 'Market',
        main_settings_old: 'Settings',
        main_plans_old: 'Plans',
        main_history_old: 'History',
        main_help_old: 'Help',
        greeting_morning: function(name) {
            return 'Good morning, ' + name + '!';
        },
        greeting_afternoon: function(name) {
            return 'Good afternoon, ' + name + '!';
        },
        greeting_evening: function(name) {
            return 'Good evening, ' + name + '!';
        },
        onboard: 'Welcome to Void Node!\n\nI am your crypto guardian\n\nStart by connecting exchange: /connect\nOr just send me a link or contract address - I\'ll check it!',
        onboard_skip: 'Skip',
        onboard_start: 'Start!',
        connect_prompt: 'Connect exchange\n\nSend API keys as:\nAPI_KEY:SECRET_KEY\n\nTo cancel: /cancel',
        connect_success: function(exchange) {
            return exchange + ' connected!\n\nNow send /analyze';
        },
        connect_fail: 'Failed to connect.\n\nCheck your keys and try again.',
        connect_cancel: 'Cancelled.',
        connect_confirm: 'Really disconnect exchange?\n\nAll keys will be deleted.',
        connect_confirm_yes: 'Yes, disconnect',
        connect_confirm_no: 'No, keep',
        connect_undo: 'Keys will be deleted in 10 seconds. Undo: /undo',
        connect_undo_success: 'Undo successful! Keys saved.',
        connect_disconnected: 'Exchange disconnected. All keys deleted.',
        invalid_format: 'Invalid format! Send as API_KEY:SECRET_KEY.',
        analyzing_step: function(step, total, text) {
            return '[' + step + '/' + total + '] ' + text + '...';
        },
        analyzing_done: 'Analysis complete!',
        analyzing_no_keys: 'Connect exchange first. /connect',
        analyzing_limit: function(limit, remaining) {
            return 'Limit: ' + limit + '/day. Remaining: ' + remaining + '\n/subscribe';
        },
        security_menu: 'What to check?',
        security_link: 'Link',
        security_contract: 'Contract',
        security_file: 'File',
        security_dex: 'DEX',
        security_impersonation: 'Account',
        security_wallet: 'Wallet',
        scan_link: 'Send link to check\n/cancel - cancel',
        scan_contract: 'Send contract address (0x...)\n/cancel - cancel',
        scan_file: 'Send file to check\n/cancel - cancel',
        dex_prompt: 'Send contract address for DEX check\n/cancel - cancel',
        impersonation_prompt: 'Forward message from suspicious user\n/cancel - cancel',
        wallet_prompt: 'Send wallet address to check\nExample: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e\n/cancel - cancel',
        scan_link_invalid: 'Send a link starting with http:// or https://',
        scan_contract_invalid: 'Send a contract address (0x...)',
        scan_file_invalid: 'Send a file to check.',
        scan_impersonation_invalid: 'Forward a message from a suspicious user.',
        scan_timeout: 'Check took too long.',
        scan_cancelled: 'Check cancelled.',
        scan_safe: 'SAFE',
        scan_danger: 'DANGER',
        scan_result_safe: function(type) {
            return 'SAFE\n\n' + type + ' contains no threats.';
        },
        scan_result_danger: function(type, reason) {
            return 'DANGER\n\n' + type + ' contains threats:\n' + reason;
        },
        vip_bonus_title: 'BONUS!',
        vip_bonus_subtitle: 'Get 3 days of VIP access for FREE!',
        vip_bonus_connect: 'Just connect your exchange, and I will:',
        vip_bonus_panic: 'Activate PANIC MODE',
        vip_bonus_autotrade: 'Give AUTOTRADING',
        vip_bonus_analytics: 'Unlock ALL analytics',
        vip_bonus_alerts: 'Unlimited alerts',
        vip_bonus_offer: 'Offer valid only now!',
        vip_bonus_connect_btn: 'Connect exchange',
        vip_bonus_skip_btn: 'Skip',
        vip_activated_title: 'CONGRATULATIONS!',
        vip_activated_subtitle: 'You connected your exchange and got 3 days of VIP access!',
        vip_activated_valid: 'Valid until:',
        vip_activated_features: 'Now you have access to everything:',
        vip_activated_try: 'Try all features, then choose a plan that suits you!',
        vip_activated_btn: 'To menu',
        vip_reminder_text: function(expires) {
            return 'Hey! Your VIP access expires tomorrow (' + expires + ').\n\nYou\'ve already seen how panic mode saves your portfolio.\nYou know how autotrading brings profit.\n\nI don\'t want you to lose these opportunities.\nRenew now - and stay protected.\n\n/subscribe - choose your plan';
        },
        vip_reminder_btn_plans: 'Choose plan',
        vip_reminder_btn_analyze: 'Portfolio analysis',
        vip_renewed: function(plan) {
            return 'Thanks for staying with me! ' + plan + ' activated.\n\nYour portfolio is protected again. I\'m here if you need me: /help';
        }
    }
};

function getText(lang, key) {
    var strings = LANGUAGES[lang] || LANGUAGES.ru;
    var text = strings[key];
    if (text === undefined) {
        var fallbackText = LANGUAGES.ru[key];
        if (typeof fallbackText === 'function') {
            var args = Array.prototype.slice.call(arguments, 2);
            return fallbackText.apply(null, args);
        }
        return fallbackText || 'Ошибка: отсутствует перевод для "' + key + '"';
    }
    if (typeof text === 'function') {
        var args = Array.prototype.slice.call(arguments, 2);
        return text.apply(null, args);
    }
    return text;
}

var planCache = new Map();

async function getUserPlan(chatId) {
    if (planCache.has(chatId)) {
        var cached = planCache.get(chatId);
        if (Date.now() - cached.timestamp < 60000) {
            return cached.data;
        }
    }

    var key = 'plan_' + chatId;
    var data = await getData(key);

    var result;
    if (!data) {
        await activateTrial(chatId);
        result = { plan: 'TRIAL', ...PLANS.TRIAL, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
    } else {
        var parsed;
        try {
            parsed = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (e) {
            console.error('Ошибка парсинга плана для ' + chatId + ':', e);
            await deleteData(key);
            await activateTrial(chatId);
            result = { plan: 'TRIAL', ...PLANS.TRIAL, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
            planCache.set(chatId, { data: result, timestamp: Date.now() });
            return result;
        }
        
        var plan = PLANS[parsed.planId];
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
                features: ['Подписка истекла. Продлите тариф: /subscribe'],
                features_en: ['Subscription expired. Renew: /subscribe']
            };
        } else if (parsed.planId !== 'TRIAL' && parsed.expires < Date.now()) {
            if (parsed.vipTrial) {
                var notifiedKey = 'vip_expired_notified_' + chatId;
                var alreadyNotified = await getData(notifiedKey);
                if (!alreadyNotified) {
                    var lang = await getData('lang_' + chatId) || 'ru';
                    await sendMessage(chatId,
                        'VIP-доступ закончился. Было круто! Надеюсь, тебе понравилось.\n\nНо это не прощание! Ты всегда можешь вернуться: /subscribe\nЯ рядом, если что: /help'
                    );
                    await setData(notifiedKey, 'true', 86400);
                }
            }
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
                features: ['Подписка истекла. Продлите тариф: /subscribe'],
                features_en: ['Subscription expired. Renew: /subscribe']
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
    }

    planCache.set(chatId, { data: result, timestamp: Date.now() });
    return result;
}

async function invalidatePlanCache(chatId) {
    planCache.delete(chatId);
}

async function activateTrial(chatId) {
    var key = 'plan_' + chatId;
    var existing = await getData(key);
    if (existing) {
        var parsed;
        try {
            parsed = typeof existing === 'string' ? JSON.parse(existing) : existing;
            if (parsed.trialUsed) {
                return null;
            }
        } catch (e) {
            console.error('Ошибка парсинга при активации триала:', e);
        }
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
    var plan = PLANS[planId];
    if (!plan) return null;
    var key = 'plan_' + chatId;
    await setData(key, JSON.stringify({
        planId: planId,
        activatedAt: Date.now(),
        expires: Date.now() + plan.duration * 24 * 60 * 60 * 1000
    }));
    await invalidatePlanCache(chatId);
    return plan;
}

async function activateVipTrial(chatId) {
    var key = 'plan_' + chatId;
    var expires = Date.now() + 3 * 24 * 60 * 60 * 1000;
    await setData(key, JSON.stringify({
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
    var userPlan = await getUserPlan(chatId);
    var limit = userPlan.limits[feature];
    if (limit === undefined || limit === false) {
        return { allowed: false, reason: 'Функция недоступна на тарифе "' + userPlan.name + '"\n/subscribe' };
    }
    if (limit === Infinity) return { allowed: true };
    var key = 'usage_' + chatId + '_' + feature + '_' + new Date().toISOString().split('T')[0];
    var usage = await getData(key);
    var count = usage ? parseInt(usage) : 0;
    if (count >= limit) {
        return { allowed: false, reason: 'Лимит функции "' + feature + '" исчерпан. Повысьте тариф: /subscribe' };
    }
    await setData(key, (count + 1).toString());
    return { allowed: true };
}

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

function createProgressBarUI(value, max, length) {
    if (max === undefined) max = 100;
    if (length === undefined) length = 10;
    var percent = Math.min(value / max, 1);
    var filled = Math.round(percent * length);
    var empty = length - filled;
    return '🟩'.repeat(filled) + '⬜'.repeat(empty);
}

async function connectExchange(apiKey, secretKey, exchangeId) {
    if (!exchangeId) exchangeId = 'binance';
    try {
        var exchange = new ccxt[exchangeId]({
            apiKey: apiKey,
            secret: secretKey,
            enableRateLimit: true,
            timeout: 30000
        });
        await exchange.fetchBalance();
        return exchange;
    } catch (error) {
        console.error('Ошибка подключения к бирже ' + exchangeId + ':', error);
        throw error;
    }
}

function detectExchange(apiKey) {
    var patterns = {
        binance: /^vm[A-Za-z0-9]{60,}/,
        bybit: /^B[A-Za-z0-9]{30,}/,
        okx: /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}/,
        kucoin: /^[a-zA-Z0-9]{24,}/,
        gate: /^GT[A-Za-z0-9]{30,}/
    };
    for (var exchange in patterns) {
        if (patterns[exchange].test(apiKey)) return exchange;
    }
    return null;
}

async function addHistory(chatId, action, detail) {
    var key = 'history_' + chatId;
    var data = await getData(key);
    var history = [];
    if (data) {
        try {
            history = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (e) {
            console.error('History parse error for ' + chatId + ':', e);
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
    var key = 'history_' + chatId;
    var data = await getData(key);
    if (!data) return [];
    try {
        return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
        console.error('History parse error for ' + chatId + ':', e);
        return [];
    }
}

async function createCryptoInvoice(chatId, planId, amountRub) {
    var url = 'https://pay.crypt.bot/api/createInvoice';
    var usdtAmount = Math.round(amountRub / 90);
    var plan = PLANS[planId];
    if (amountRub === 0) return { payUrl: null, invoiceId: null };
    var body = {
        asset: 'USDT',
        amount: usdtAmount,
        description: 'Void Node - ' + plan.name + ' (' + amountRub + ' RUB ≈ ' + usdtAmount + ' USDT)',
        payload: 'plan_' + planId + '_' + chatId,
        paid_btn_name: 'openBot',
        paid_btn_url: 'https://t.me/' + BOT_USERNAME + '?start=activate_' + planId,
        hidden_message: 'Тариф ' + plan.name + ' активирован! Спасибо!'
    };
    try {
        var response = await fetchWithRetry(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Crypto-Pay-API-Token': CRYPTOBOT_TOKEN
            },
            body: JSON.stringify(body)
        });
        var data = await response.json();
        if (data.ok) {
            return { payUrl: data.result.pay_url, invoiceId: data.result.invoice_id };
        } else {
            console.error('CryptoBot error:', data.error);
            return null;
        }
    } catch (error) {
        console.error('Invoice creation error:', error);
        return null;
    }
}

const aiRouter = require('./ai_router');

async function checkContract(address) {
    var riskScore = 0;
    var level = 'Низкий';
    var isHoneypot = address.toLowerCase().includes('dead') || (address.length === 42 && address.endsWith('f'));
    if (isHoneypot) riskScore += 40;
    if (address.includes('0x0000')) riskScore += 20;
    if (ETHERSCAN_API_KEY) {
        try {
            var url = 'https://api.etherscan.io/api?module=contract&action=getabi&address=' + address + '&apikey=' + ETHERSCAN_API_KEY;
            var resp = await fetchWithRetry(url);
            var data = await resp.json();
            if (data.status === '1' && data.result) {
                riskScore = Math.max(0, riskScore - 30);
            } else {
                riskScore += 30;
            }
        } catch (error) {
            console.error('Etherscan error:', error);
        }
    }
    var score = Math.min(100, Math.max(0, riskScore));
    if (score > 70) level = 'Высокий';
    else if (score > 40) level = 'Средний';
    return { score: score, level: level, reason: 'Скоринг риска: ' + score + '/100 (' + level + ')' };
}

async function checkWallet(address) {
    var balance = 0;
    var tokens = [];
    if (ETHERSCAN_API_KEY) {
        try {
            var balUrl = 'https://api.etherscan.io/api?module=account&action=balance&address=' + address + '&tag=latest&apikey=' + ETHERSCAN_API_KEY;
            var balResp = await fetchWithRetry(balUrl);
            var balData = await balResp.json();
            if (balData.status === '1') balance = parseFloat(balData.result) / 1e18;
            var tokenUrl = 'https://api.etherscan.io/api?module=account&action=tokentx&address=' + address + '&page=1&offset=100&sort=desc&apikey=' + ETHERSCAN_API_KEY;
            var tokenResp = await fetchWithRetry(tokenUrl);
            var tokenData = await tokenResp.json();
            if (tokenData.status === '1') {
                for (var i = 0; i < tokenData.result.slice(0, 10).length; i++) {
                    var t = tokenData.result.slice(0, 10)[i];
                    if (t.tokenSymbol && !tokens.includes(t.tokenSymbol)) {
                        tokens.push(t.tokenSymbol);
                    }
                }
            }
        } catch (error) {
            console.error('Wallet check error:', error);
        }
    }
    var risk = balance > 10 ? 'low' : (balance > 1 ? 'medium' : 'high');
    return { balance: balance, tokens: tokens, risk: risk };
}

async function checkUrl(url) {
    try {
        var domain = new URL(url).hostname;
        var issues = [];
        var blacklisted = await getData('domain_blacklist_' + domain);
        if (blacklisted) return { safe: false, reason: 'Домен ' + domain + ' в чёрном списке.' };
        var knownDomains = ['binance.com', 'bybit.com', 'okx.com', 'metamask.io', 'trustwallet.com'];
        for (var i = 0; i < knownDomains.length; i++) {
            var known = knownDomains[i];
            var base = known.split('.')[0];
            if (domain.includes(base) && !domain.endsWith(known)) {
                issues.push('Подозрение на подделку ' + known + '.');
            }
        }
        if (issues.length === 0) return { safe: true, reason: 'Ссылка прошла проверку.' };
        return { safe: false, reason: issues.join('\n') };
    } catch (error) {
        return { safe: false, reason: 'Ошибка: ' + error.message };
    }
}

function checkFile(fileName) {
    var dangerous = ['.exe', '.scr', '.bat', '.cmd', '.ps1', '.vbs', '.dmg', '.app', '.sh', '.js', '.jar', '.apk'];
    var suspicious = ['.zip', '.rar', '.7z', '.py', '.xls', '.doc', '.pdf', '.docm', '.xlsm'];
    var ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    if (dangerous.includes(ext)) return 'ОПАСНО! Расширение ' + ext + ' может содержать вирус.';
    if (suspicious.includes(ext)) return 'ВНИМАНИЕ Расширение ' + ext + ' может содержать вредоносный код.';
    return 'Безопасно Расширение ' + ext + ' не представляет угрозы.';
}

function checkImpersonation(username) {
    if (!username) return null;
    var knownAdmins = ['binance_support', 'bybit_official', 'okx_help', 'metamask_support', 'trustwallet_help'];
    var lower = username.toLowerCase();
    for (var i = 0; i < knownAdmins.length; i++) {
        var admin = knownAdmins[i];
        if (lower.includes(admin.toLowerCase()) && lower !== admin) {
            return 'Обнаружена подделка! @' + username + ' пытается выдать себя за @' + admin + '.';
        }
    }
    return null;
}

var TICKER_TO_COINGECKO = {
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
    var cacheKey = 'cg_' + coinId;
    var cached = await getData(cacheKey);
    if (cached) {
        var parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        if (Date.now() - parsed.timestamp < 300000) {
            return parsed.data;
        }
    }
    return null;
}

async function setCachedCoinGecko(coinId, data) {
    var cacheKey = 'cg_' + coinId;
    await setData(cacheKey, JSON.stringify({
        data: data,
        timestamp: Date.now()
    }), 300);
}

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
    var userPlan = await getUserPlan(chatId);
    var mode = await getData('mode_' + chatId) || 'beginner';
    
    var userName = 'Друг';
    try {
        var url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/getChat';
        var response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId })
        });
        var data = await response.json();
        if (data.ok && data.result) {
            userName = data.result.username || data.result.first_name || 'Друг';
            if (userName.startsWith('@')) userName = userName.substring(1);
        }
    } catch (error) {
        console.error('Ошибка получения username:', error);
    }

    var userId = chatId;
    var planName = userPlan.name || 'Триал';
    var expiresDate = formatDateShort(userPlan.expires);
    var modeDisplay = mode === 'beginner' ? 'Новичок' : 'Опытный';
    
    var greeting = getText(lang, 'greeting_morning', userName);
    var header = getText(lang, 'main_header', userName, modeDisplay, userId, planName, expiresDate);
    
    var vipStatus = '';
    var isVip = userPlan.plan === 'VIP' && userPlan.expires > Date.now();
    if (isVip) {
        var timeLeft = userPlan.expires - Date.now();
        var daysLeft = Math.floor(timeLeft / (24 * 60 * 60 * 1000));
        if (daysLeft <= 1) {
            vipStatus = '\nVIP заканчивается завтра!';
        } else {
            vipStatus = '\nVIP активен (' + daysLeft + ' дн.)';
        }
    }
    
    var message = greeting + '\n\n' + header + vipStatus + '\n\nVoid Node — твой крипто-телохранитель\n\nГлавное меню:';
    await sendUpdatedMessage(chatId, message, getMainMenuKeyboard(lang));
}

async function showFunctionsMenu(chatId, lang) {
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'functions_analyze'), callback_data: 'menu_analyze' }],
            [{ text: getText(lang, 'functions_security'), callback_data: 'menu_security' }],
            [{ text: 'Оповещения', callback_data: 'alert_menu' }],
            [{ text: getText(lang, 'functions_news'), callback_data: 'menu_news' }],
            [{ text: getText(lang, 'functions_history'), callback_data: 'menu_history' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, getText(lang, 'functions_title'), keyboard);
}

async function showSettingsMenuNew(chatId, lang) {
    var currentLang = lang === 'ru' ? 'Русский' : 'English';
    var mode = await getData('mode_' + chatId) || 'beginner';
    var modeDisplay = mode === 'beginner' ? 'Новичок' : 'Опытный';
    var message = getText(lang, 'settings_title') + '\n\n';
    message += getText(lang, 'settings_lang') + ' ' + currentLang + '\n';
    message += getText(lang, 'settings_mode') + ' ' + modeDisplay;
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'settings_change_lang'), callback_data: 'settings_change_lang' }],
            [{ text: getText(lang, 'settings_change_mode'), callback_data: 'settings_change_mode' }],
            [{ text: 'Отключить биржу', callback_data: 'action_disconnect' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

async function showLanguageSelect(chatId, lang) {
    var keyboard = {
        inline_keyboard: [
            [{ text: 'Русский', callback_data: 'lang_ru' }],
            [{ text: 'English', callback_data: 'lang_en' }],
            [{ text: getText(lang, 'back_to_settings'), callback_data: 'back_to_settings' }]
        ]
    };
    await sendUpdatedMessage(chatId, getText(lang, 'language_select'), keyboard);
}

async function showModeSelect(chatId, lang) {
    var message = getText(lang, 'mode_select') + '\n\n';
    message += getText(lang, 'mode_beginner_desc') + '\n\n';
    message += getText(lang, 'mode_pro_desc') + '\n\n';
    message += getText(lang, 'mode_select_prompt');
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'mode_beginner_btn'), callback_data: 'mode_beginner' }],
            [{ text: getText(lang, 'mode_pro_btn'), callback_data: 'mode_pro' }],
            [{ text: getText(lang, 'back_to_settings'), callback_data: 'back_to_settings' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

async function showAboutMenu(chatId, lang) {
    var message = 'О БОТЕ\n\n';
    message += 'Void Node — твой персональный крипто-телохранитель.\n\n';
    message += 'Что умеет бот:\n';
    message += 'Анализировать портфель и давать рекомендации\n';
    message += 'Проверять контракты и ссылки на безопасность\n';
    message += 'Отслеживать соц.тренды и новости\n';
    message += 'Календарь трейдера с важными событиями\n';
    message += 'Автоторговля для защиты и роста\n';
    message += 'Холодный душ при падении рынка\n';
    message += 'Оповещения по цене, объёму и новостям\n\n';
    message += 'Версия: 2.0.0\n';
    message += 'Создан: 2024\n\n';
    message += 'Канал проекта:\n';
    message += 'Atifragility Node\n\n';
    message += 'Быстрые команды:\n';
    message += '/analyze — анализ портфеля\n';
    message += '/connect — подключить биржу\n';
    message += '/news — новости, тренды, календарь\n';
    message += '/help — помощь по боту';
    
    var keyboard = {
        inline_keyboard: [
            [{ text: 'Выйти в меню', callback_data: 'exit_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown');
}

async function showAnalyzeMenu(chatId, lang) {
    var savedData = await getData('user_' + chatId);
    if (!savedData) {
        var keyboard = {
            inline_keyboard: [
                [{ text: 'Подключить биржу', callback_data: 'menu_connect' }],
                [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'), keyboard);
        return;
    }
    var keyboard = {
        inline_keyboard: [
            [{ text: 'Полный анализ', callback_data: 'action_analyze' }],
            [{ text: 'CSV отчет', callback_data: 'action_export_csv' }],
            [{ text: 'AI-советник', callback_data: 'action_ask_ai' }],
            [{ text: 'Автоторговля', callback_data: 'autotrade_menu' }],
            [{ text: 'Ребаланс портфеля', callback_data: 'action_rebalance' }],
            [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
        ]
    };
    await sendUpdatedMessage(chatId, 'Анализ портфеля\n\nВыберите действие:', keyboard);
}

async function showSecurityMenu(chatId, lang) {
    var keyboard = {
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

async function showMarketMenu(chatId, lang) {
    var keyboard = {
        inline_keyboard: [
            [{ text: 'Соц.тренды', callback_data: 'menu_social' }],
            [{ text: 'Новости', callback_data: 'menu_news' }],
            [{ text: 'Календарь трейдера', callback_data: 'menu_calendar' }],
            [{ text: 'Выйти в меню', callback_data: 'exit_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, 'РЫНОК\n\nВыберите раздел:', keyboard);
}

async function showHistoryMenu(chatId, lang) {
    var history = await getHistory(chatId);
    if (history.length === 0) {
        var keyboard = {
            inline_keyboard: [
                [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
            ]
        };
        await sendUpdatedMessage(chatId, getText(lang, 'history_empty'), keyboard);
        return;
    }
    var message = getText(lang, 'history_title') + '\n\n';
    for (var i = history.slice(-10).reverse().length - 1; i >= 0; i--) {
        var item = history.slice(-10).reverse()[i];
        message += getText(lang, 'history_item', item.date, item.action, item.detail);
    }
    var keyboard = {
        inline_keyboard: [
            [{ text: 'Обновить', callback_data: 'action_history_refresh' }],
            [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

async function showPlansMenu(chatId, lang) {
    var userPlan = await getUserPlan(chatId);
    var expiresDate = formatDateShort(userPlan.expires);
    
    var message = getText(lang, 'plans_title') + '\n\n';
    message += getText(lang, 'plans_current', userPlan.name, expiresDate) + '\n\n';
    message += '\n';
    message += 'TRIAL — 0 ₽ / 7 дней\n';
    message += '   2 анализа/день, 3 антискам-проверки\n\n';
    message += 'START — 500 ₽ / 30 дней\n';
    message += '   10 анализов/день, 15 антискам-проверок\n';
    message += '   3 оповещения, AI-советник (5/день)\n\n';
    message += 'PRO — 1 000 ₽ / 30 дней\n';
    message += '   30 анализов/день, 50 антискам-проверок\n';
    message += '   15 оповещений, автоторговля (3/день)\n';
    message += '   Холодный душ, Kill Switch\n\n';
    message += 'VIP — 1 500 ₽ / 30 дней\n';
    message += '   ВСЕ БЕЗЛИМИТНО\n';
    message += '   24/7 приоритетная поддержка\n\n';
    message += 'Оплата через CryptoBot (USDT)\n';
    message += getText(lang, 'plans_select');
    
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'plan_trial_name'), callback_data: 'plan_TRIAL' }],
            [{ text: getText(lang, 'plan_start_name'), callback_data: 'plan_START' }],
            [{ text: getText(lang, 'plan_pro_name'), callback_data: 'plan_PRO' }],
            [{ text: getText(lang, 'plan_vip_name'), callback_data: 'plan_VIP' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown');
}

async function showHelpMenu(chatId, lang) {
    var message = getText(lang, 'help_menu_title');
    var keyboard = {
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
            [{ text: getText(lang, 'help_contact_moderator'), callback_data: 'help_contact_moderator' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

async function showAlertMenu(chatId, lang) {
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'alert_price'), callback_data: 'alert_price' }],
            [{ text: getText(lang, 'alert_change'), callback_data: 'alert_change' }],
            [{ text: getText(lang, 'alert_volume'), callback_data: 'alert_volume' }],
            [{ text: getText(lang, 'alert_news'), callback_data: 'alert_news' }],
            [{ text: getText(lang, 'alert_calendar'), callback_data: 'alert_calendar' }],
            [{ text: 'Список оповещений', callback_data: 'alert_list' }],
            [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
        ]
    };
    await sendUpdatedMessage(chatId, getText(lang, 'alert_menu'), keyboard);
}

async function showAutotradeMenu(chatId, lang) {
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'autotrade_level1'), callback_data: 'autotrade_level1' }],
            [{ text: getText(lang, 'autotrade_level2'), callback_data: 'autotrade_level2' }],
            [{ text: getText(lang, 'autotrade_level3'), callback_data: 'autotrade_level3' }],
            [{ text: getText(lang, 'autotrade_level4'), callback_data: 'autotrade_level4' }],
            [{ text: 'Остановить', callback_data: 'autotrade_stop' }],
            [{ text: getText(lang, 'back_to_analyze'), callback_data: 'back_to_analyze' }]
        ]
    };
    await sendUpdatedMessage(chatId, getText(lang, 'autotrade_menu'), keyboard);
}

async function showLanguageSelectOnboarding(chatId) {
    var keyboard = {
        inline_keyboard: [
            [{ text: 'Русский', callback_data: 'onboard_lang_ru' }],
            [{ text: 'English', callback_data: 'onboard_lang_en' }]
        ]
    };
    await sendUpdatedMessage(chatId, 'Выберите язык / Choose language:', keyboard);
}

async function showModeSelectOnboarding(chatId, lang) {
    var message = getText(lang, 'mode_select') + '\n\n';
    message += getText(lang, 'mode_beginner_desc') + '\n\n';
    message += getText(lang, 'mode_pro_desc') + '\n\n';
    message += getText(lang, 'mode_select_prompt');
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'mode_beginner_btn'), callback_data: 'onboard_mode_beginner' }],
            [{ text: getText(lang, 'mode_pro_btn'), callback_data: 'onboard_mode_pro' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

async function showVipBonusOffer(chatId, lang) {
    var message = getText(lang, 'vip_bonus_title') + '\n\n';
    message += getText(lang, 'vip_bonus_subtitle') + '\n\n';
    message += getText(lang, 'vip_bonus_connect') + '\n\n';
    message += getText(lang, 'vip_bonus_panic') + '\n';
    message += getText(lang, 'vip_bonus_autotrade') + '\n';
    message += getText(lang, 'vip_bonus_analytics') + '\n';
    message += getText(lang, 'vip_bonus_alerts') + '\n\n';
    message += getText(lang, 'vip_bonus_offer');
    
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'vip_bonus_connect_btn'), callback_data: 'onboard_connect_vip' }],
            [{ text: getText(lang, 'vip_bonus_skip_btn'), callback_data: 'onboard_skip' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

async function handleOnboardConnectVip(chatId, lang) {
    await setData('state_' + chatId, 'waiting_for_keys_vip');
    await sendUpdatedMessage(chatId, getText(lang, 'connect_prompt'), null, 'Markdown');
}

async function handleOnboardSkip(chatId, lang) {
    await setData('onboarded_' + chatId, 'true');
    await showMainMenu(chatId, lang);
}

async function showOnboardingSetup(chatId, lang) {
    await sendUpdatedMessage(chatId, getText(lang, 'onboarding_setup'));
    setTimeout(async function() {
        await showVipBonusOffer(chatId, lang);
    }, 2000);
}

async function handlePlanSelection(chatId, planId, lang, messageId) {
    if (planId === 'TRIAL') {
        var userPlan = await getUserPlan(chatId);
        if (userPlan.trialUsed && userPlan.plan !== 'TRIAL') {
            await sendUpdatedMessage(chatId, getText(lang, 'plans_trial_used'), null, 'Markdown', messageId);
            return;
        }
        await activateTrial(chatId);
        await sendUpdatedMessage(chatId, getText(lang, 'plans_trial_success'), null, 'Markdown', messageId);
        await showMainMenu(chatId, lang);
        return;
    }
    
    var plan = PLANS[planId];
    if (!plan) {
        await sendUpdatedMessage(chatId, getText(lang, 'plans_not_found'), null, 'Markdown', messageId);
        return;
    }
    
    var duplicateCheck = await checkDuplicatePayment(chatId, planId);
    if (duplicateCheck.duplicate) {
        await sendUpdatedMessage(chatId, duplicateCheck.message, null, 'Markdown', messageId);
        return;
    }
    
    var userPlan = await getUserPlan(chatId);
    if (userPlan.plan === planId && userPlan.expires > Date.now()) {
        await sendUpdatedMessage(chatId, getText(lang, 'plans_already', plan.name), null, 'Markdown', messageId);
        return;
    }
    
    await sendUpdatedMessage(chatId, getText(lang, 'plans_payment_creating'), null, 'Markdown', messageId);
    
    var invoice = await createCryptoInvoice(chatId, planId, plan.price);
    if (!invoice) {
        await sendUpdatedMessage(chatId, getText(lang, 'plans_payment_error'), null, 'Markdown', messageId);
        return;
    }
    
    var displayFeatures = lang === 'en' ? plan.features_en : plan.features;
    var usdtAmount = Math.round(plan.price / 90);
    
    var message = getText(lang, 'plans_payment_title', plan.name) + '\n\n';
    message += plan.price + ' ₽ ≈ ' + usdtAmount + ' USDT\n';
    message += plan.duration + ' ' + getText(lang, 'days') + '\n\n';
    message += getText(lang, 'plans_features') + ':\n';
    message += displayFeatures.map(function(f) { return '• ' + f; }).join('\n');
    message += '\n\n';
    message += getText(lang, 'plans_payment_methods') + ':\n';
    message += '• ' + getText(lang, 'plans_payment_crypto') + '\n\n';
    message += getText(lang, 'plans_payment_note');
    
    var keyboard = {
        inline_keyboard: [
            [{ text: 'Оплатить ' + plan.price + ' ₽ (USDT)', url: invoice.payUrl }],
            [{ text: getText(lang, 'back_to_plans'), callback_data: 'back_to_plans' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
}

function generateCSV(engineResult) {
    var csv = 'Asset,Value(USDT),Percentage\n';
    for (var i = 0; i < (engineResult.assets || []).length; i++) {
        var a = (engineResult.assets || [])[i];
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

function createProgressBarUI(value, max, length) {
    if (max === undefined) max = 100;
    if (length === undefined) length = 10;
    var percent = Math.min(value / max, 1);
    var filled = Math.round(percent * length);
    var empty = length - filled;
    return '🟩'.repeat(filled) + '⬜'.repeat(empty);
}

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
        var token = this.tokens.get(symbol);
        if (!token) return null;
        return ((currentPrice - token.entryPrice) / token.entryPrice) * 100;
    }
    
    shouldExecuteFlow(symbol, currentPrice) {
        var token = this.tokens.get(symbol);
        if (!token) return null;
        var growth = ((currentPrice - token.entryPrice) / token.entryPrice) * 100;
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
    var keysUser = await loadUserKeys(chatId);
    if (!keysUser) return { error: 'Нет API-ключей' };
    
    try {
        var exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
        var balance = await exchange.fetchBalance();
        var total = balance.total;
        
        var tokens = [];
        for (var symbol in total) {
            if (symbol === 'USDT' || total[symbol] < 0.0001) continue;
            try {
                var ticker = await exchange.fetchTicker(symbol + '/USDT');
                if (ticker && ticker.last) {
                    var value = total[symbol] * ticker.last;
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
            return { error: 'Нужно минимум 2 токена для стратегии' };
        }
        
        tokens.sort(function(a, b) { return b.change24h - a.change24h; });
        var growToken = tokens[0];
        
        if (growToken.change24h < 2) {
            return { error: 'Нет токена с достаточным ростом (>2% за 24ч)' };
        }
        
        var junkToken = tokens[tokens.length - 1];
        if (junkToken.change24h > 0) {
            var nonGrowing = tokens.filter(function(t) { return t.change24h < 2; });
            if (nonGrowing.length > 0 && nonGrowing[0].symbol !== growToken.symbol) {
                junkToken = nonGrowing[0];
            } else {
                return { error: 'Все токены растут' };
            }
        }
        
        var tracker = new SnowballTracker();
        tracker.initToken(growToken.symbol, growToken.price);
        tracker.initToken(junkToken.symbol, junkToken.price);
        
        var growth = tracker.getGrowth(growToken.symbol, growToken.price);
        if (growth >= 30) {
            var tokenBalance = balance.free[growToken.symbol] || 0;
            if (tokenBalance > 0.001) {
                var order = await exchange.createMarketSellOrder(growToken.symbol + '/USDT', tokenBalance);
                var message = 'ПРИБЫЛЬ ЗАФИКСИРОВАНА!\n\n' +
                    growToken.symbol + '\nРост: ' + growth.toFixed(1) + '%\n' +
                    'Получено: $' + (order.cost || 0).toFixed(2) + ' USDT';
                await sendMessage(chatId, message);
                await addHistory(chatId, 'Снежный ком — фиксация', growToken.symbol + ' → USDT');
                return { success: true, message: message };
            }
        }
        
        var junkBalance = balance.free[junkToken.symbol] || 0;
        if (junkBalance < 0.001) {
            return { error: 'Недостаточно ' + junkToken.symbol + ' для продажи' };
        }
        
        var sellAmount = junkBalance * 0.5;
        var sellOrder = await exchange.createMarketSellOrder(junkToken.symbol + '/USDT', sellAmount);
        var usdtReceived = sellOrder.cost || 0;
        
        var buyAmount = usdtReceived / growToken.price;
        if (buyAmount > 0.0001) {
            await exchange.createMarketBuyOrder(growToken.symbol + '/USDT', buyAmount);
            var message = 'СНЕЖНЫЙ КОМ\n\n' +
                growToken.symbol + ' → +' + growth.toFixed(1) + '%\n' +
                'Продано ' + sellAmount.toFixed(4) + ' ' + junkToken.symbol + ' ($' + usdtReceived.toFixed(2) + ')\n' +
                'Куплено ' + buyAmount.toFixed(4) + ' ' + growToken.symbol + '\n' +
                'Следующий порог: +' + (growth + 5).toFixed(1) + '%';
            await sendMessage(chatId, message);
            await addHistory(chatId, 'Снежный ком — переток', growToken.symbol + ' ← ' + junkToken.symbol + ' ($' + usdtReceived.toFixed(2) + ')');
            return { success: true, message: message };
        }
        
        return { success: false, error: 'Не удалось выполнить переток' };
    } catch (error) {
        console.error('Snowball strategy error:', error);
        return { error: error.message };
    }
}

async function checkPanic() {
    var keys = await VOID_KV.list('panic_');
    for (var k = 0; k < keys.keys.length; k++) {
        var key = keys.keys[k];
        var chatId = parseInt(key.name.replace('panic_', ''));
        var config = await getData(key.name);
        if (!config) continue;
        var parsedConfig = typeof config === 'string' ? JSON.parse(config) : config;
        if (!parsedConfig.active) continue;

        var keysUser = await loadUserKeys(chatId);
        if (!keysUser) continue;

        try {
            var exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
            var balance = await exchange.fetchBalance();
            var coins = Object.keys(balance.total).filter(function(c) { return c !== 'USDT' && balance.total[c] > 0; });
            
            if (coins.length === 0) continue;
            
            var panicTriggered = false;
            var droppedCoins = [];
            
            for (var i = 0; i < coins.length; i++) {
                var coin = coins[i];
                try {
                    var ticker = await exchange.fetchTicker(coin + '/USDT');
                    if (!ticker) continue;
                    var currentPrice = ticker.last;
                    
                    var priceKey = 'panic_price_' + chatId + '_' + coin;
                    var previousPrice = await getData(priceKey);
                    
                    if (previousPrice) {
                        var prev = parseFloat(previousPrice);
                        var drop = ((prev - currentPrice) / prev) * 100;
                        
                        if (drop >= 5) {
                            panicTriggered = true;
                            droppedCoins.push({ coin: coin, drop: drop, currentPrice: currentPrice, prev: prev });
                        }
                    }
                    
                    await setData(priceKey, currentPrice.toString(), 3600);
                } catch (e) {
                    console.error('Ошибка проверки ' + coin + ':', e.message);
                }
            }
            
            if (panicTriggered) {
                var coinsList = droppedCoins.map(function(c) { return '• ' + c.coin + ': -' + c.drop.toFixed(1) + '%'; }).join('\n');
                
                var message = 'ХОЛОДНЫЙ ДУШ СРАБОТАЛ!\n\n' +
                    'Обнаружено падение >5% по нескольким активам:\n\n' + coinsList + '\n\n' +
                    'Рекомендация: конвертировать ВСЕ активы в USDT для защиты капитала.';
                
                var keyboard = {
                    inline_keyboard: [
                        [{ text: 'Конвертировать всё в USDT', callback_data: 'panic_convert_all' }],
                        [{ text: 'Выйти в меню', callback_data: 'exit_to_menu' }]
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
            console.error('Panic check error for ' + chatId + ':', error);
        }
    }
}

async function handlePanicConvertAll(chatId) {
    var keys = await loadUserKeys(chatId);
    if (!keys) {
        await sendMessage(chatId, 'Нет ключей для конвертации.');
        return;
    }
    
    try {
        var exchange = await connectExchange(keys.exchangeId, keys.apiKey, keys.secretKey);
        var balance = await exchange.fetchBalance();
        var converted = 0;
        var details = [];
        
        var coins = Object.keys(balance.total).filter(function(c) { return c !== 'USDT' && balance.total[c] > 0; });
        
        for (var i = 0; i < coins.length; i++) {
            var coin = coins[i];
            try {
                var amount = balance.total[coin];
                var ticker = await exchange.fetchTicker(coin + '/USDT');
                var value = amount * ticker.last;
                
                await exchange.createMarketSellOrder(coin + '/USDT', amount);
                converted++;
                details.push('• ' + coin + ': ' + amount.toFixed(4) + ' ≈ $' + value.toFixed(2));
            } catch (e) {
                details.push('• ' + coin + ': Ошибка: ' + e.message);
            }
        }
        
        var message = 'ХОЛОДНЫЙ ДУШ — КОНВЕРТАЦИЯ ВЫПОЛНЕНА!\n\n' +
            'Продано ' + converted + ' активов в USDT\n\n' +
            details.join('\n') + '\n\n' +
            'Портфель в безопасности.';
        
        await sendMessage(chatId, message);
        await deleteData('panic_' + chatId);
        
        var priceKeys = await VOID_KV.list('panic_price_' + chatId + '_');
        for (var j = 0; j < priceKeys.keys.length; j++) {
            await deleteData(priceKeys.keys[j].name);
        }
        
    } catch (error) {
        console.error('Panic convert error:', error);
        await sendMessage(chatId, 'Ошибка конвертации: ' + error.message);
    }
}

class VipReminderService {
    constructor() {
        this.checkInterval = 60 * 60 * 1000;
    }

    async checkAllUsers() {
        var keys = await VOID_KV.list('plan_');
        var now = Date.now();

        for (var k = 0; k < keys.keys.length; k++) {
            var key = keys.keys[k];
            var chatId = parseInt(key.name.replace('plan_', ''));
            var data = await getData(key.name);
            if (!data) continue;

            var plan;
            try {
                plan = typeof data === 'string' ? JSON.parse(data) : data;
            } catch (e) {
                continue;
            }
            
            if (plan.planId !== 'VIP' || !plan.vipTrial) continue;
            if (plan.expires < now) continue;

            var timeLeft = plan.expires - now;
            var lang = await getData('lang_' + chatId) || 'ru';
            var isRu = lang === 'ru';
            
            var notifiedKey = 'vip_notified_' + chatId;
            var alreadyNotified = await getData(notifiedKey);

            if (timeLeft <= 24 * 60 * 60 * 1000 && timeLeft > 23 * 60 * 60 * 1000 && !alreadyNotified) {
                var expiresDate = formatDateShort(plan.expires);
                var message = isRu
                    ? 'Привет! Твой VIP-доступ заканчивается завтра (' + expiresDate + ').\n\nТы уже видел, как холодный душ спасает портфель.\nТы знаешь, как автоторговля приносит прибыль.\n\nЯ не хочу, чтобы ты терял эти возможности.\nПродли доступ сейчас — и оставайся под защитой.\n\n/subscribe — выбери свой тариф'
                    : 'Hey! Your VIP access expires tomorrow (' + expiresDate + ').\n\nYou\'ve already seen how panic mode saves your portfolio.\nYou know how autotrading brings profit.\n\nI don\'t want you to lose these opportunities.\nRenew now — and stay protected.\n\n/subscribe — choose your plan';
                
                var keyboard = {
                    inline_keyboard: [
                        [{ text: isRu ? 'Выбрать тариф' : 'Choose plan', callback_data: 'menu_plans' }],
                        [{ text: isRu ? 'Анализ портфеля' : 'Portfolio analysis', callback_data: 'action_analyze' }]
                    ]
                };
                
                await sendMessage(chatId, message, keyboard);
                await setData(notifiedKey, 'true', 86400);
                await addHistory(chatId, 'VIP-напоминание', 'До окончания: 24 часа');
            }
        }
    }
}

var vipReminder = new VipReminderService();

async function loadUserKeys(chatId) {
    var key = 'user_' + chatId;
    var data = await getData(key);
    if (!data) return null;
    try {
        var parsed = typeof data === 'string' ? JSON.parse(data) : data;
        var decryptedApiKey = decrypt(parsed.apiKey);
        var decryptedSecretKey = decrypt(parsed.secretKey);
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

async function executeRecommendation(chatId, recId) {
    var analysisData = await getData('analysis_' + chatId);
    if (!analysisData) return { error: 'Нет данных анализа' };
    var analysis = typeof analysisData === 'string' ? JSON.parse(analysisData) : analysisData;
    var rec = analysis.recommendations.find(function(r) { return r.id === recId; });
    if (!rec) return { error: 'Рекомендация не найдена' };

    var userPlan = await getUserPlan(chatId);
    if (!userPlan.limits.autotrade || userPlan.limits.autotrade === false) {
        return { error: 'Автоторговля недоступна на вашем тарифе' };
    }

    var orderLimitKey = 'orders_' + chatId + '_' + new Date().toISOString().split('T')[0];
    var ordersToday = parseInt(await getData(orderLimitKey) || '0');
    if (ordersToday >= CONFIG.MAX_ORDERS_PER_DAY) {
        return { error: 'Достигнут лимит ордеров на сегодня (' + CONFIG.MAX_ORDERS_PER_DAY + ')' };
    }

    var keys = await loadUserKeys(chatId);
    if (!keys) return { error: 'Нет API-ключей' };

    try {
        var exchange = await connectExchange(keys.exchangeId, keys.apiKey, keys.secretKey);
        var balance = await exchange.fetchBalance();
        var free = balance.free[rec.asset] || 0;

        if (rec.action === 'sell' && free < rec.amount) {
            return { error: 'Недостаточно ' + rec.asset + ' на балансе (доступно: ' + free + ', нужно: ' + rec.amount + ')' };
        }
        if (rec.action === 'buy') {
            var freeUSDT = balance.free['USDT'] || 0;
            var ticker = await exchange.fetchTicker(rec.symbol || rec.asset + '/USDT');
            var price = ticker ? ticker.last : 0;
            var needed = rec.amount * price;
            if (freeUSDT < needed) {
                return { error: 'Недостаточно USDT для покупки (доступно: ' + freeUSDT + ', нужно: ' + needed + ')' };
            }
        }

        var order;
        if (rec.action === 'sell') {
            order = await exchange.createMarketSellOrder(rec.symbol, rec.amount);
        } else if (rec.action === 'buy') {
            order = await exchange.createMarketBuyOrder(rec.symbol, rec.amount);
        } else {
            return { error: 'Неизвестное действие: ' + rec.action };
        }

        await new Promise(function(r) { setTimeout(r, 3000); });
        var orderStatus = await exchange.fetchOrder(order.id);
        if (orderStatus.status !== 'closed') {
            return { error: 'Ордер не исполнился. Текущий статус: ' + orderStatus.status };
        }

        await setData(orderLimitKey, (ordersToday + 1).toString(), 86400);
        return { success: true, order: orderStatus };
    } catch (error) {
        console.error('Order execution error:', error);
        return { error: 'Ошибка исполнения: ' + error.message };
    }
}

async function composeReport(engineResult, mode, lang, dailyChange) {
    if (dailyChange === undefined) dailyChange = 0;
    var totalUSDT = engineResult.totalUSDT;
    var btcPercent = engineResult.btcPercent;
    var altPercent = engineResult.altPercent;
    var usdtPercent = engineResult.usdtPercent;
    var riskLevel = engineResult.riskLevel;
    var issues = engineResult.issues || [];
    var recommendations = engineResult.recommendations || [];
    var signals = engineResult.signals || [];
    var btcMetrics = engineResult.btcMetrics;
    var riskScore = engineResult.riskScore;
    var assets = engineResult.assets || [];
    var thresholds = engineResult.thresholds;

    var baseText = 'АНАЛИЗ ПОРТФЕЛЯ\n';
    baseText += '\n';
    baseText += 'Общая стоимость: $' + (totalUSDT?.toFixed(2) || 0) + ' USDT\n';
    if (dailyChange !== 0) {
        baseText += ' Изменение (24ч): ' + (dailyChange > 0 ? '+' : '') + dailyChange.toFixed(2) + '%\n';
    }
    baseText += '\n\n';

    var modeLabel = mode === 'beginner' ? 'Новичок' : 'Опытный';
    baseText += 'Режим: ' + modeLabel + '\n';
    if (thresholds) {
        baseText += 'Риск-профиль:\n';
        baseText += 'Стоп-лосс: ' + thresholds.stopLoss + '%\n';
        baseText += 'Тейк-профит: ' + thresholds.takeProfit + '%\n';
        baseText += 'Макс. позиция: ' + thresholds.maxPosition + '%\n';
        baseText += 'Макс. доля альтов: ' + thresholds.maxAltExposure + '%\n\n';
    }

    baseText += 'РАСПРЕДЕЛЕНИЕ АКТИВОВ\n';
    baseText += 'BTC:      ' + createProgressBarUI(btcPercent) + ' ' + (btcPercent?.toFixed(1) || 0) + '%\n';
    baseText += 'Альты:    ' + createProgressBarUI(altPercent) + ' ' + (altPercent?.toFixed(1) || 0) + '%\n';
    baseText += 'Стейблы:  ' + createProgressBarUI(usdtPercent) + ' ' + (usdtPercent?.toFixed(1) || 0) + '%\n\n';

    var ideal = getIdealPortfolio(mode);
    baseText += 'Целевые веса (' + ideal.label + '):\n';
    baseText += 'BTC:  ' + ideal.btc + '%  (ваш: ' + (btcPercent?.toFixed(1) || 0) + '%)\n';
    baseText += 'Альты: ' + ideal.alt + '%  (ваш: ' + (altPercent?.toFixed(1) || 0) + '%)\n';
    baseText += 'Стейблы: ' + ideal.stable + '%  (ваш: ' + (usdtPercent?.toFixed(1) || 0) + '%)\n\n';

    var riskLabel = riskLevel === 'high' ? getText(lang, 'risk_high') : (riskLevel === 'medium' ? getText(lang, 'risk_medium') : getText(lang, 'risk_low'));
    baseText += ' Риск: ' + riskLabel + ' (' + (riskScore || 0) + ' баллов)\n\n';

    if (btcMetrics) {
        baseText += 'ФИНАНСОВЫЕ МЕТРИКИ BTC\n';
        if (btcMetrics.sharpe !== undefined) {
            baseText += ' Коэф. Шарпа: ' + btcMetrics.sharpe.toFixed(2) + '\n';
        }
        if (btcMetrics.sortino !== undefined) {
            baseText += ' Коэф. Сортино: ' + btcMetrics.sortino.toFixed(2) + '\n';
        }
        if (btcMetrics.var !== undefined) {
            baseText += ' VaR (95%): ' + btcMetrics.var.toFixed(2) + '%\n';
        }
        baseText += '\n';
    }

    if (signals && signals.length > 0) {
        baseText += 'СИГНАЛЫ\n';
        for (var i = 0; i < signals.length; i++) {
            var s = signals[i];
            baseText += ' ' + s.text + '\n';
        }
        baseText += '\n';
    }

    if (issues && issues.length > 0) {
        baseText += 'ПРОБЛЕМЫ\n';
        for (var j = 0; j < issues.length; j++) {
            var issue = issues[j];
            baseText += ' ' + issue.text + '\n';
        }
        baseText += '\n';
    }

    var keyboard = { inline_keyboard: [] };

    if (recommendations && recommendations.length > 0) {
        baseText += 'РЕКОМЕНДАЦИИ\n';
        for (var r = 0; r < recommendations.slice(0, 5).length; r++) {
            var rec = recommendations.slice(0, 5)[r];
            var confidence = rec.action === 'sell' ? (rec.rsi_signal === 'overbought' ? 70 : 55) : (rec.rsi_signal === 'oversold' ? 70 : 55);

            baseText += '• ' + rec.reason + '\n';
            baseText += '   Уверенность: ' + confidence + '%\n';
            if (rec.action === 'sell' || rec.action === 'buy') {
                var actionText = rec.action === 'sell' ? 'Продать' : 'Купить';
                keyboard.inline_keyboard.push([
                    { text: actionText + ' ' + rec.asset, callback_data: 'exec_' + rec.id }
                ]);
            }
        }
        baseText += '\n';
    }

    keyboard.inline_keyboard.push([
        { text: 'Полный отчет', callback_data: 'action_full_report' },
        { text: 'CSV отчет', callback_data: 'action_export_csv' }
    ]);
    keyboard.inline_keyboard.push([
        { text: 'AI-советник', callback_data: 'action_ask_ai' },
        { text: 'Ребаланс', callback_data: 'action_rebalance' },
        { text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }
    ]);

    baseText += '\nVoid Node — твой телохранитель в крипте\n';
    baseText += '\nЭто не финансовая рекомендация.';

    return { text: baseText, keyboard: keyboard };
}

async function runAutotrade() {
    var keys = await VOID_KV.list('autotrade_');
    for (var k = 0; k < keys.keys.length; k++) {
        var key = keys.keys[k];
        var chatId = parseInt(key.name.replace('autotrade_', ''));
        var data = await getData(key.name);
        if (!data) continue;
        var config = typeof data === 'string' ? JSON.parse(data) : data;
        if (!config.active) continue;

        var mode = await getData('mode_' + chatId) || 'beginner';
        var thresholds = getRiskThresholds(mode);

        var keysUser = await loadUserKeys(chatId);
        if (!keysUser) continue;

        try {
            var exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
            var balance = await exchange.fetchBalance();
            var total = balance.total;
            var coins = Object.keys(total).filter(function(c) { return c !== 'USDT' && total[c] > 0; });

            if (config.level === 4) {
                console.log('Запуск "Снежного кома" для ' + chatId);
                await runSnowballStrategy(chatId);
                continue;
            }

            if (config.level === 1) {
                for (var i = 0; i < coins.length; i++) {
                    var coin = coins[i];
                    try {
                        var ticker = await exchange.fetchTicker(coin + '/USDT');
                        if (!ticker) continue;
                        var price = ticker.last;
                        var stopLoss = thresholds.stopLoss;
                        var stop5 = price * (1 - stopLoss / 100);
                        var stop10 = price * 0.90;
                        await exchange.createOrder(coin + '/USDT', 'stop_loss_limit', 'sell', total[coin], stop5, { stopPrice: stop5 });
                        await exchange.createOrder(coin + '/USDT', 'stop_loss_limit', 'sell', total[coin] * 0.5, stop10, { stopPrice: stop10 });
                    } catch (e) {}
                }
            } else if (config.level === 2) {
                for (var i = 0; i < coins.length; i++) {
                    var coin = coins[i];
                    try {
                        var ticker = await exchange.fetchTicker(coin + '/USDT');
                        if (!ticker) continue;
                        var change = ticker.percentage || 0;
                        var volume = ticker.quoteVolume || 0;
                        if (volume < 50000 && change < 0) {
                            await exchange.createMarketSellOrder(coin + '/USDT', total[coin]);
                        } else if (change > 5) {
                            var amount = (0.01 * balance.total.USDT) / ticker.last;
                            if (amount > 0.001) await exchange.createMarketBuyOrder(coin + '/USDT', amount);
                        }
                    } catch (e) {}
                }
            } else if (config.level === 3) {
                var settingsKey = 'autotrade_settings_' + chatId;
                var settings = await getData(settingsKey);
                settings = settings ? (typeof settings === 'string' ? JSON.parse(settings) : settings) : {};
                for (var i = 0; i < coins.length; i++) {
                    var coin = coins[i];
                    try {
                        var ticker = await exchange.fetchTicker(coin + '/USDT');
                        if (!ticker) continue;
                        var price = ticker.last;
                        var symbol = coin + '/USDT';
                        if (!settings[symbol]) settings[symbol] = { stop: price * 0.95, entry: price };
                        if (price > settings[symbol].entry * 1.05) {
                            var newStop = price * 0.95;
                            await exchange.cancelAllOrders(symbol);
                            await exchange.createOrder(symbol, 'stop_loss_limit', 'sell', total[coin], newStop, { stopPrice: newStop });
                            settings[symbol].stop = newStop;
                        }
                        if (price > settings[symbol].entry * 1.2) {
                            var profitAmount = total[coin] * 0.3;
                            await exchange.createMarketSellOrder(symbol, profitAmount);
                            settings[symbol].entry = price;
                        }
                    } catch (e) {}
                }
                await setData(settingsKey, JSON.stringify(settings));
            }
        } catch (error) {
            console.error('Autotrade error for ' + chatId + ':', error);
        }
    }
}

async function autoRebalance(chatId) {
    var savedData = await getData('user_' + chatId);
    if (!savedData) {
        return { error: 'Нет ключей биржи' };
    }
    var user = typeof savedData === 'string' ? JSON.parse(savedData) : savedData;
    var apiKey = decrypt(user.apiKey);
    var secretKey = decrypt(user.secretKey);
    var mode = await getData('mode_' + chatId) || 'beginner';
    var ideal = getIdealPortfolio(mode);
    var thresholds = getRiskThresholds(mode);

    try {
        var exchange = await connectExchange(apiKey, secretKey, user.exchangeId);
        var balance = await exchange.fetchBalance();
        var total = balance.total;
        var coins = Object.keys(total).filter(function(key) { return total[key] > 0; });
        var totalUSDT = 0;
        var assets = [];
        for (var i = 0; i < coins.length; i++) {
            var coin = coins[i];
            if (coin === 'USDT') {
                totalUSDT += total[coin];
                continue;
            }
            try {
                var ticker = await exchange.fetchTicker(coin + '/USDT');
                var value = total[coin] * ticker.last;
                totalUSDT += value;
                assets.push({ symbol: coin, value: value });
            } catch (e) {}
        }
        for (var a = 0; a < assets.length; a++) {
            assets[a].weight = (assets[a].value / totalUSDT) * 100;
        }
        var btcWeight = assets.find(function(a) { return a.symbol === 'BTC'; })?.weight || 0;
        var altWeight = assets.filter(function(a) { return a.symbol !== 'BTC' && a.symbol !== 'USDT'; }).reduce(function(sum, a) { return sum + a.weight; }, 0);

        var trades = [];
        var message = '';

        if (btcWeight > ideal.btc + 5) {
            var excess = (btcWeight - ideal.btc) / 100 * totalUSDT;
            var btcPrice = assets.find(function(a) { return a.symbol === 'BTC'; })?.value / (total[balance.total.BTC] || 1) || 0;
            var amount = excess / btcPrice;
            if (amount > 0.001) {
                await exchange.createMarketSellOrder('BTC/USDT', amount);
                trades.push('Продано ' + amount.toFixed(4) + ' BTC (' + excess.toFixed(2) + ' USDT)');
            }
        } else if (btcWeight < ideal.btc - 5) {
            var needed = (ideal.btc - btcWeight) / 100 * totalUSDT;
            var btcPrice = assets.find(function(a) { return a.symbol === 'BTC'; })?.value / (total[balance.total.BTC] || 1) || 0;
            var amount = needed / btcPrice;
            if (amount > 0.001 && balance.total.USDT > needed) {
                await exchange.createMarketBuyOrder('BTC/USDT', amount);
                trades.push('Куплено ' + amount.toFixed(4) + ' BTC (' + needed.toFixed(2) + ' USDT)');
            }
        }

        if (altWeight > thresholds.maxAltExposure) {
            var excess = (altWeight - thresholds.maxAltExposure) / 100 * totalUSDT;
            for (var j = 0; j < assets.length; j++) {
                var asset = assets[j];
                if (asset.symbol === 'BTC' || asset.symbol === 'USDT') continue;
                var sellAmount = (asset.value / altWeight) * excess / (asset.value / (total[asset.symbol] || 1));
                if (sellAmount > 0.001) {
                    await exchange.createMarketSellOrder(asset.symbol + '/USDT', sellAmount);
                    trades.push('Продано ' + sellAmount.toFixed(4) + ' ' + asset.symbol + ' (' + (sellAmount * asset.value / (total[asset.symbol] || 1)).toFixed(2) + ' USDT)');
                }
            }
        }

        if (trades.length === 0) {
            return { error: false, message: 'Портфель уже сбалансирован. Никаких действий не требуется.' };
        }

        message = 'Выполнено действий: ' + trades.length + '\n\n' +
                  trades.slice(0, 5).join('\n') +
                  (trades.length > 5 ? '\n... и еще ' + (trades.length - 5) + ' действий' : '');

        await addHistory(chatId, 'Ребаланс портфеля', trades.length + ' действий');
        return { error: false, message: message };

    } catch (error) {
        console.error('Rebalance error:', error);
        return { error: 'Ошибка ребаланса: ' + error.message };
    }
}
class NewsManager {
    constructor() {
        this.updateInterval = 15 * 60 * 1000;
        this.lastUpdate = new Map();
        this.isUpdating = new Map();
    }

    async getPersonalizedNews(chatId, lang, forceUpdate) {
        if (forceUpdate === undefined) forceUpdate = false;
        var cacheKey = 'news_cache_' + chatId;
        var now = Date.now();
        var lastUpdate = this.lastUpdate.get(chatId) || 0;

        if (!forceUpdate && now - lastUpdate < this.updateInterval) {
            var cached = await getData(cacheKey);
            if (cached) {
                try {
                    var parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
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
            return {
                error: true,
                message: 'Новости обновляются, подождите...'
            };
        }

        this.isUpdating.set(chatId, true);
        try {
            var result = await this._fetchAndCacheNews(chatId, lang);
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

    async backgroundUpdate() {
        var keys = await VOID_KV.list('news_cache_');
        var now = Date.now();

        for (var k = 0; k < keys.keys.length; k++) {
            var key = keys.keys[k];
            var chatId = parseInt(key.name.replace('news_cache_', ''));
            var data = await getData(key.name);
            if (!data) continue;

            try {
                var parsed = typeof data === 'string' ? JSON.parse(data) : data;
                if (now - parsed.timestamp > this.updateInterval) {
                    var lang = await getData('lang_' + chatId) || 'ru';
                    await this._fetchAndCacheNews(chatId, lang, true);
                    console.log('Новости обновлены для ' + chatId);
                }
            } catch (e) {}
        }
    }

    async refreshNews(chatId, lang) {
        var result = await this._fetchAndCacheNews(chatId, lang, false);
        this.lastUpdate.set(chatId, Date.now());
        return result;
    }

    async _fetchAndCacheNews(chatId, lang, silent) {
        if (silent === undefined) silent = false;
        var isRu = lang === 'ru';
        var analysisData = await getData('analysis_' + chatId);

        var assets = [];
        if (analysisData) {
            try {
                var analysis = typeof analysisData === 'string' ? JSON.parse(analysisData) : analysisData;
                assets = analysis.assets || [];
            } catch (e) {
                console.error('Analysis parse error:', e);
            }
        }

        if (assets.length === 0) {
            var defaultAssets = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA'];
            assets = defaultAssets.map(function(symbol) { return { symbol: symbol, weight: 20 }; });
        }

        var topAssets = assets.slice(0, 5);
        var allArticles = [];
        var seenUrls = new Set();

        var newsPromises = topAssets.map(async function(asset) {
            try {
                var query = asset.symbol;
                var cacheKey = 'news_asset_' + query + '_' + (isRu ? 'ru' : 'en');
                var cached = await getData(cacheKey);
                if (cached) {
                    var parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
                    if (Date.now() - parsed.timestamp < 300000) {
                        return parsed.articles;
                    }
                }
                var url = 'https://newsapi.org/v2/everything?q=' + query + '+crypto&language=' + (isRu ? 'ru' : 'en') + '&sortBy=publishedAt&pageSize=3&apiKey=' + NEWS_API_KEY;
                var response = await fetchWithRetry(url);
                var data = await response.json();
                var articles = [];
                if (data.status === 'ok' && data.articles) {
                    articles = data.articles;
                    await setData(cacheKey, JSON.stringify({
                        articles: articles,
                        timestamp: Date.now()
                    }), 300);
                }
                return articles;
            } catch (error) {
                console.error('News error for ' + asset.symbol + ':', error);
                return [];
            }
        });

        var allArticlesArrays = await Promise.all(newsPromises);
        for (var i = 0; i < allArticlesArrays.length; i++) {
            var articles = allArticlesArrays[i];
            var asset = topAssets[i];
            for (var j = 0; j < articles.length; j++) {
                var article = articles[j];
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
            var relevanceDiff = (b.relevance || 0) - (a.relevance || 0);
            if (Math.abs(relevanceDiff) > 0.01) return relevanceDiff;
            return new Date(b.publishedAt) - new Date(a.publishedAt);
        });

        var topArticles = allArticles.slice(0, 7);
        var result = {
            articles: topArticles,
            assets: topAssets,
            timestamp: Date.now(),
            count: topArticles.length,
            totalAssets: topAssets.length
        };

        await setData('news_cache_' + chatId, JSON.stringify(result), 900);
        return result;
    }

    getStats(chatId) {
        var lastUpdate = this.lastUpdate.get(chatId);
        var isUpdating = this.isUpdating.get(chatId) || false;
        return {
            lastUpdate: lastUpdate || 0,
            isUpdating: isUpdating,
            age: lastUpdate ? Math.round((Date.now() - lastUpdate) / 60000) : null
        };
    }
}

var newsManager = new NewsManager();

class NewsManager {
    constructor() {
        this.updateInterval = 15 * 60 * 1000;
        this.lastUpdate = new Map();
        this.isUpdating = new Map();
    }

    async getPersonalizedNews(chatId, lang, forceUpdate) {
        if (forceUpdate === undefined) forceUpdate = false;
        var cacheKey = 'news_cache_' + chatId;
        var now = Date.now();
        var lastUpdate = this.lastUpdate.get(chatId) || 0;

        if (!forceUpdate && now - lastUpdate < this.updateInterval) {
            var cached = await getData(cacheKey);
            if (cached) {
                try {
                    var parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
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
            return {
                error: true,
                message: 'Новости обновляются, подождите...'
            };
        }

        this.isUpdating.set(chatId, true);
        try {
            var result = await this._fetchAndCacheNews(chatId, lang);
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

    async backgroundUpdate() {
        var keys = await VOID_KV.list('news_cache_');
        var now = Date.now();

        for (var k = 0; k < keys.keys.length; k++) {
            var key = keys.keys[k];
            var chatId = parseInt(key.name.replace('news_cache_', ''));
            var data = await getData(key.name);
            if (!data) continue;

            try {
                var parsed = typeof data === 'string' ? JSON.parse(data) : data;
                if (now - parsed.timestamp > this.updateInterval) {
                    var lang = await getData('lang_' + chatId) || 'ru';
                    await this._fetchAndCacheNews(chatId, lang, true);
                    console.log('Новости обновлены для ' + chatId);
                }
            } catch (e) {}
        }
    }

    async refreshNews(chatId, lang) {
        var result = await this._fetchAndCacheNews(chatId, lang, false);
        this.lastUpdate.set(chatId, Date.now());
        return result;
    }

    async _fetchAndCacheNews(chatId, lang, silent) {
        if (silent === undefined) silent = false;
        var isRu = lang === 'ru';
        var analysisData = await getData('analysis_' + chatId);

        var assets = [];
        if (analysisData) {
            try {
                var analysis = typeof analysisData === 'string' ? JSON.parse(analysisData) : analysisData;
                assets = analysis.assets || [];
            } catch (e) {
                console.error('Analysis parse error:', e);
            }
        }

        if (assets.length === 0) {
            var defaultAssets = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA'];
            assets = defaultAssets.map(function(symbol) { return { symbol: symbol, weight: 20 }; });
        }

        var topAssets = assets.slice(0, 5);
        var allArticles = [];
        var seenUrls = new Set();

        var newsPromises = topAssets.map(async function(asset) {
            try {
                var query = asset.symbol;
                var cacheKey = 'news_asset_' + query + '_' + (isRu ? 'ru' : 'en');
                var cached = await getData(cacheKey);
                if (cached) {
                    var parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
                    if (Date.now() - parsed.timestamp < 300000) {
                        return parsed.articles;
                    }
                }
                var url = 'https://newsapi.org/v2/everything?q=' + query + '+crypto&language=' + (isRu ? 'ru' : 'en') + '&sortBy=publishedAt&pageSize=3&apiKey=' + NEWS_API_KEY;
                var response = await fetchWithRetry(url);
                var data = await response.json();
                var articles = [];
                if (data.status === 'ok' && data.articles) {
                    articles = data.articles;
                    await setData(cacheKey, JSON.stringify({
                        articles: articles,
                        timestamp: Date.now()
                    }), 300);
                }
                return articles;
            } catch (error) {
                console.error('News error for ' + asset.symbol + ':', error);
                return [];
            }
        });

        var allArticlesArrays = await Promise.all(newsPromises);
        for (var i = 0; i < allArticlesArrays.length; i++) {
            var articles = allArticlesArrays[i];
            var asset = topAssets[i];
            for (var j = 0; j < articles.length; j++) {
                var article = articles[j];
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
            var relevanceDiff = (b.relevance || 0) - (a.relevance || 0);
            if (Math.abs(relevanceDiff) > 0.01) return relevanceDiff;
            return new Date(b.publishedAt) - new Date(a.publishedAt);
        });

        var topArticles = allArticles.slice(0, 7);
        var result = {
            articles: topArticles,
            assets: topAssets,
            timestamp: Date.now(),
            count: topArticles.length,
            totalAssets: topAssets.length
        };

        await setData('news_cache_' + chatId, JSON.stringify(result), 900);
        return result;
    }

    getStats(chatId) {
        var lastUpdate = this.lastUpdate.get(chatId);
        var isUpdating = this.isUpdating.get(chatId) || false;
        return {
            lastUpdate: lastUpdate || 0,
            isUpdating: isUpdating,
            age: lastUpdate ? Math.round((Date.now() - lastUpdate) / 60000) : null
        };
    }
}

async function handleNewsCommand(chatId, coin, lang, messageId) {
    var check = await checkLimit(chatId, 'news');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        return;
    }

    await sendTyping(chatId);

    if (coin && coin.trim().length > 0) {
        await handleNewsSingleCoin(chatId, coin, lang, messageId);
        return;
    }

    var result = await newsManager.getPersonalizedNews(chatId, lang);

    if (result.error) {
        await sendUpdatedMessage(chatId, result.message, null, 'Markdown', messageId);
        return;
    }

    var isRu = lang === 'ru';
    var report = isRu ?
        'НОВОСТИ ДЛЯ ТВОЕГО ПОРТФЕЛЯ\n' :
        'NEWS FOR YOUR PORTFOLIO\n';

    if (result.fromCache) {
        report += 'Обновлено ' + result.age + ' мин. назад\n';
    } else {
        report += 'Только что обновлено\n';
    }

    report += 'По твоим активам: ' + result.assets.map(function(a) { return a.symbol; }).join(', ') + '\n\n';

    if (result.articles.length === 0) {
        report += 'Новостей не найдено\n';
        report += 'Попробуй обновить через 5-10 минут';

        var keyboard = {
            inline_keyboard: [
                [{ text: 'Обновить', callback_data: 'menu_news' }],
                [{ text: 'Назад к рынку', callback_data: 'menu_market' }],
                [{ text: 'Главное меню', callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
        return;
    }

    for (var i = 0; i < result.articles.slice(0, 7).length; i++) {
        var article = result.articles.slice(0, 7)[i];
        var title = article.title?.length > 80 ? article.title.slice(0, 77) + '...' : article.title || 'Новость';
        var source = article.source?.name || 'Unknown';
        var date = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString(isRu ? 'ru-RU' : 'en-US') : '';
        var description = article.description?.length > 120 ? article.description.slice(0, 117) + '...' : article.description || '';
        var assetTag = article.asset ? ' ' + article.asset : '';

        report += title + assetTag + '\n';
        report += '   ' + source;
        if (date) report += ' | ' + date;
        report += '\n';
        if (description) {
            report += '   ' + description + '\n';
        }
        report += '   ' + (isRu ? 'Читать полностью' : 'Read more') + ': ' + article.url + '\n\n';
    }

    report += '\nНайдено: ' + result.articles.length + ' новостей\n';
    report += '/news — ' + (isRu ? 'обновить' : 'refresh');

    var keyboard = {
        inline_keyboard: [
            [{ text: 'Обновить', callback_data: 'menu_news' }],
            [{ text: 'Назад к рынку', callback_data: 'menu_market' }],
            [{ text: 'Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_news'), 'Персонализированные (' + result.articles.length + ')');
}

async function handleNewsSingleCoin(chatId, coin, lang, messageId) {
    var isRu = lang === 'ru';
    try {
        var cacheKey = 'news_single_' + coin + '_' + (isRu ? 'ru' : 'en');
        var cached = await getData(cacheKey);
        if (cached) {
            var parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
            if (Date.now() - parsed.timestamp < 300000) {
                await sendNewsReport(chatId, parsed.articles, coin, lang, messageId);
                return;
            }
        }
        var url = 'https://newsapi.org/v2/everything?q=' + coin + '+crypto&language=' + (isRu ? 'ru' : 'en') + '&sortBy=publishedAt&pageSize=5&apiKey=' + NEWS_API_KEY;
        var response = await fetchWithRetry(url);
        var data = await response.json();
        if (data.status !== 'ok' || !data.articles || data.articles.length === 0) {
            await sendUpdatedMessage(chatId, getText(lang, 'news_empty'), null, 'Markdown', messageId);
            return;
        }
        await setData(cacheKey, JSON.stringify({
            articles: data.articles,
            timestamp: Date.now()
        }), 300);
        await sendNewsReport(chatId, data.articles, coin, lang, messageId);
    } catch (error) {
        console.error('News error:', error);
        await sendUpdatedMessage(chatId, 'Ошибка получения новостей. Попробуйте позже.', null, 'Markdown', messageId);
    }
}

async function sendNewsReport(chatId, articles, coin, lang, messageId) {
    var isRu = lang === 'ru';
    var report = getText(lang, 'news_coin', coin.toUpperCase());
    var count = 0;
    var seenUrls = new Set();
    for (var i = 0; i < articles.length; i++) {
        var article = articles[i];
        if (count >= 5) break;
        if (!article.title || article.title.length < 5) continue;
        if (article.url && seenUrls.has(article.url)) continue;
        if (article.url) seenUrls.add(article.url);
        count++;
        var title = article.title.length > 80 ? article.title.slice(0, 77) + '...' : article.title;
        var source = article.source?.name || 'Unknown';
        var date = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString(isRu ? 'ru-RU' : 'en-US') : '';
        var description = article.description && article.description.length > 120 ? article.description.slice(0, 117) + '...' : article.description || '';
        report += title + '\n';
        report += '   ' + source;
        if (date) report += ' | ' + date;
        report += '\n';
        if (description) {
            report += '   ' + description + '\n';
        }
        report += '   ' + (isRu ? 'Читать полностью' : 'Read more') + ': ' + article.url + '\n\n';
    }
    report += '\nНайдено: ' + count + ' новостей\n';
    report += '/news ' + coin + ' — ' + (isRu ? 'обновить' : 'refresh');
    var keyboard = {
        inline_keyboard: [
            [{ text: 'Назад к рынку', callback_data: 'menu_market' }],
            [{ text: 'Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_news'), coin);
}

async function handleCalendarCommand(chatId, lang, messageId) {
    var plan = await getUserPlan(chatId);
    if (!plan.limits.panic) {
        await sendUpdatedMessage(chatId, getText(lang, 'calendar_pro_only'), null, 'Markdown', messageId);
        return;
    }
    var check = await checkLimit(chatId, 'calendar');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        return;
    }
    await sendTyping(chatId);
    await sendUpdatedMessage(chatId, getText(lang, 'calendar_analyzing'), null, 'Markdown', messageId);
    try {
        var cacheKey = 'economic_calendar';
        var cached = await getData(cacheKey);
        if (cached) {
            var parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
            if (Date.now() - parsed.timestamp < 1800000) {
                await sendCalendarReport(chatId, parsed.events, lang, messageId);
                return;
            }
        }
        var url = 'https://finnhub.io/api/v1/calendar/economic?token=' + FINNHUB_API_KEY;
        var response = await fetchWithRetry(url);
        var data = await response.json();
        var events = [];
        if (data.economicCalendar && data.economicCalendar.length > 0) {
            events = data.economicCalendar.slice(0, 10).map(function(event) {
                return {
                    title: event.event || 'Событие',
                    date: event.date || 'Дата неизвестна',
                    importance: event.importance === 2 ? 'Высокая' :
                        event.importance === 1 ? 'Средняя' : 'Низкая',
                    impact: event.impact || 'Нет данных'
                };
            });
        }
        if (events.length === 0) {
            await sendUpdatedMessage(chatId, getText(lang, 'calendar_empty'), null, 'Markdown', messageId);
            return;
        }
        await setData(cacheKey, JSON.stringify({
            events: events,
            timestamp: Date.now()
        }), 1800);
        await sendCalendarReport(chatId, events, lang, messageId);
    } catch (error) {
        console.error('Calendar error:', error);
        await sendUpdatedMessage(chatId, 'Ошибка получения календаря. Попробуйте позже.', null, 'Markdown', messageId);
    }
}

async function sendCalendarReport(chatId, events, lang, messageId) {
    var calendar = getText(lang, 'calendar_result', events);
    var keyboard = {
        inline_keyboard: [
            [{ text: 'Назад к рынку', callback_data: 'menu_market' }],
            [{ text: 'Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, calendar, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_calendar'), 'Неделя');
}

async function handleSocialTrend(chatId, lang, messageId) {
    var check = await checkLimit(chatId, 'social');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        return;
    }
    var keyboard = {
        inline_keyboard: [
            [{ text: 'BTC', callback_data: 'trend_BTC' }, { text: 'ETH', callback_data: 'trend_ETH' }],
            [{ text: 'SOL', callback_data: 'trend_SOL' }, { text: 'ADA', callback_data: 'trend_ADA' }],
            [{ text: 'XRP', callback_data: 'trend_XRP' }, { text: 'DOT', callback_data: 'trend_DOT' }],
            [{ text: 'Найти токен', callback_data: 'trend_search_menu' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, getText(lang, 'social_menu'), keyboard, 'Markdown', messageId);
}

async function handleTrendClick(chatId, data, lang, messageId) {
    var coin = data.replace('trend_', '');
    var check = await checkLimit(chatId, 'social');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        return;
    }
    await sendTyping(chatId);
    await sendUpdatedMessage(chatId, getText(lang, 'social_analyzing', coin), null, 'Markdown', messageId);
    try {
        var coinId = TICKER_TO_COINGECKO[coin] || coin.toLowerCase();
        var cachedData = await getCachedCoinGecko(coinId);
        var dataObj;
        if (cachedData) {
            dataObj = cachedData;
        } else {
            var url = 'https://api.coingecko.com/api/v3/coins/' + coinId;
            var response = await fetchWithRetry(url, {
                headers: {
                    'x-cg-pro-api-key': COINGECKO_API_KEY,
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) {
                await sendUpdatedMessage(chatId, 'Данные по ' + coin + ' временно недоступны.', null, 'Markdown', messageId);
                return;
            }
            dataObj = await response.json();
            await setCachedCoinGecko(coinId, dataObj);
        }
        var price = dataObj.market_data?.current_price?.usd || 0;
        var change24h = dataObj.market_data?.price_change_percentage_24h || 0;
        var marketCap = dataObj.market_data?.market_cap?.usd || 0;
        var volume24h = dataObj.market_data?.total_volume?.usd || 0;
        var rank = dataObj.market_cap_rank || 'Нет данных';
        var twitterFollowers = dataObj.community_data?.twitter_followers || 0;
        var redditSubscribers = dataObj.community_data?.subreddit_subscribers || 0;
        var trend = 'Нейтральный';
        var rec = '';
        if (change24h > 5) {
            trend = 'БЫЧИЙ';
            rec = coin + ' растет на ' + change24h.toFixed(2) + '% за 24ч. Объем: $' + (volume24h / 1e6).toFixed(1) + 'M';
        } else if (change24h < -5) {
            trend = 'МЕДВЕЖИЙ';
            rec = coin + ' падает на ' + Math.abs(change24h).toFixed(2) + '% за 24ч.';
        } else if (rank && rank < 50) {
            trend = 'ТОП-МОНЕТА';
            rec = coin + ' входит в топ-50 криптовалют.';
        } else {
            rec = coin + ' в спокойном состоянии. Изменение: ' + (change24h > 0 ? '+' : '') + change24h.toFixed(2) + '%';
        }
        var message = 'SOCIAL TREND: ' + coin + '\n\n' +
            'Цена: $' + price.toFixed(2) + '\n' +
            'Изменение 24ч: ' + (change24h > 0 ? '+' : '') + change24h.toFixed(2) + '%\n' +
            'Объем 24ч: $' + (volume24h / 1e6).toFixed(1) + 'M\n' +
            'Рыночная капа: $' + (marketCap / 1e9).toFixed(2) + 'B\n' +
            'Ранг: #' + rank + '\n' +
            'Twitter: ' + (twitterFollowers > 0 ? (twitterFollowers / 1000).toFixed(1) + 'K' : 'Нет данных') + '\n' +
            'Reddit: ' + (redditSubscribers > 0 ? (redditSubscribers / 1000).toFixed(1) + 'K' : 'Нет данных') + '\n' +
            'Тренд: ' + trend + '\n' +
            rec + '\n\n' +
            'Обновлено: только что\nИсточник: CoinGecko';
        var keyboard = {
            inline_keyboard: [
                [{ text: 'Назад к рынку', callback_data: 'menu_market' }],
                [{ text: 'Главное меню', callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
        await addHistory(chatId, getText(lang, 'history_social'), coin);
    } catch (error) {
        console.error('Trend error:', error);
        await sendUpdatedMessage(chatId, 'Ошибка получения данных по ' + coin + '. Попробуйте позже.', null, 'Markdown', messageId);
    }
}

async function handleTrendSearchMenu(chatId, lang, messageId) {
    var keyboard = {
        inline_keyboard: [
            [{ text: 'По названию токена', callback_data: 'trend_search_name' }],
            [{ text: 'По адресу контракта', callback_data: 'trend_search_contract' }],
            [{ text: 'Назад к трендам', callback_data: 'menu_social' }]
        ]
    };
    var message = 'Как искать токен?\n\nПо названию - введи тикер (PEPE, DOGE, SHIB)\nПо адресу - вставь адрес контракта (0x...)\n\nЕсли адрес контракта - бот покажет DEX данные и ликвидность.';
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
}

async function handleTrendSearchInput(chatId, text, lang, messageId) {
    var input = text.trim().toUpperCase();
    if (input.length < 2 || input.length > 15) {
        await sendUpdatedMessage(chatId, getText(lang, 'social_search_invalid'), null, 'Markdown', messageId);
        await setData('state_' + chatId, 'waiting_for_trend_search');
        return;
    }
    var coin = input;
    var check = await checkLimit(chatId, 'search_token');
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
        var dexUrl = 'https://api.dexscreener.com/latest/dex/search?q=' + address;
        var response = await fetchWithRetry(dexUrl);
        var data = await response.json();
        var message = 'РЕЗУЛЬТАТ ПОИСКА ПО КОНТРАКТУ\n\n';
        message += 'Адрес: ' + address.slice(0, 10) + '...' + address.slice(-6) + '\n\n';
        if (data.pairs && data.pairs.length > 0) {
            var pair = data.pairs[0];
            message += 'Токен найден на DEX\n\n';
            message += 'Сеть: ' + (pair.chainId || 'Unknown') + '\n';
            message += 'DEX: ' + (pair.dexId || 'Unknown') + '\n';
            message += 'Цена: $' + parseFloat(pair.priceUsd || 0).toFixed(8) + '\n';
            message += 'Ликвидность: $' + parseFloat(pair.liquidity?.usd || 0).toFixed(2) + '\n';
            message += 'Объем 24ч: $' + parseFloat(pair.volume?.h24 || 0).toFixed(2) + '\n\n';
            var liq = parseFloat(pair.liquidity?.usd || 0);
            var risk = 'Низкий';
            var note = 'Достаточная ликвидность.';
            if (liq < 10000) { risk = 'Высокий'; note = 'Очень низкая ликвидность!'; }
            else if (liq < 50000) { risk = 'Средний'; note = 'Средняя ликвидность. Будьте осторожны.'; }
            message += 'Риск: ' + risk + '\n' + note + '\n\n';
            if (pair.url) message += 'Посмотреть на DEX: ' + pair.url + '\n';
        } else {
            message += 'Токен не найден на DEX\n\n';
            message += 'Возможные причины:\nТокен новый и еще не добавлен\nАдрес контракта неверный\nТокен на другой сети (не Ethereum)\n\n';
            message += 'Проверить вручную: https://etherscan.io/address/' + address;
        }
        var keyboard = {
            inline_keyboard: [
                [{ text: 'Поискать другой токен', callback_data: 'trend_search_menu' }],
                [{ text: 'Назад к трендам', callback_data: 'menu_social' }],
                [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
        await addHistory(chatId, 'Поиск по контракту', address.slice(0, 10) + '...');
    } catch (error) {
        console.error('Contract search error:', error);
        await sendUpdatedMessage(chatId, 'Ошибка при поиске контракта.\n\nПопробуйте позже или проверьте адрес вручную.', null, 'Markdown', messageId);
    }
    await setData('state_' + chatId, 'idle');
}

async function handleAntiScamInput(chatId, text, lang, update, messageId) {
    var check = await checkLimit(chatId, 'antiscam');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        await setData('state_' + chatId, 'idle');
        return;
    }
    var state = await getData('state_' + chatId);
    if (state === 'antiscam_url') {
        if (!text.startsWith('http://') && !text.startsWith('https://')) {
            await sendUpdatedMessage(chatId, getText(lang, 'scan_link_invalid'), null, 'Markdown', messageId);
            return;
        }
        await handleUrlCheck(chatId, text, lang, messageId);
    } else if (state === 'antiscam_contract') {
        if (!text.startsWith('0x') || text.length < 42) {
            await sendUpdatedMessage(chatId, getText(lang, 'scan_contract_invalid'), null, 'Markdown', messageId);
            return;
        }
        await handleContractCheck(chatId, text, lang, messageId);
    } else if (state === 'antiscam_dex') {
        if (!text.startsWith('0x') || text.length < 42) {
            await sendUpdatedMessage(chatId, getText(lang, 'scan_contract_invalid'), null, 'Markdown', messageId);
            return;
        }
        var dexCheck = await checkLimit(chatId, 'dex');
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
            await sendUpdatedMessage(chatId, getText(lang, 'scan_file_invalid'), null, 'Markdown', messageId);
        }
    } else if (state === 'antiscam_impersonation') {
        if (update && update.message.forward_from) {
            await handleImpersonationCheck(chatId, update, lang, messageId);
        } else {
            await sendUpdatedMessage(chatId, getText(lang, 'scan_impersonation_invalid'), null, 'Markdown', messageId);
        }
    } else if (state === 'antiscam_wallet') {
        await handleWalletCheck(chatId, text, lang, messageId);
    } else {
        await sendUpdatedMessage(chatId, 'Неизвестный тип проверки.', null, 'Markdown', messageId);
    }
    await setData('state_' + chatId, 'idle');
}

async function handleUrlCheck(chatId, url, lang, messageId) {
    await sendTyping(chatId);
    var result = await checkUrl(url);
    var message = result.safe ?
        getText(lang, 'scan_safe') + '\n\n' + getText(lang, 'scan_result_safe', 'Ссылка') :
        getText(lang, 'scan_danger') + '\n\n' + getText(lang, 'scan_result_danger', 'Ссылка', result.reason);
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_antiscam'), 'Ссылка: ' + url.slice(0, 30) + '...');
}

async function handleContractCheck(chatId, address, lang, messageId) {
    await sendTyping(chatId);
    var contractInfo = await checkContract(address);
    var message = 'ПРОВЕРКА КОНТРАКТА\n\n' + address + '\n\n' + contractInfo.reason + '\n\nПроверьте вручную: https://etherscan.io/address/' + address;
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_antiscam'), 'Контракт: ' + address.slice(0, 10) + '...');
}

async function handleDEXCheck(chatId, address, lang, messageId) {
    await sendTyping(chatId);
    try {
        var dexUrl = 'https://api.dexscreener.com/latest/dex/search?q=' + address;
        var response = await fetchWithRetry(dexUrl);
        var data = await response.json();
        var message = 'DEX ПРОВЕРКА\n\n' + address.slice(0, 10) + '...' + address.slice(-6) + '\n\n';
        if (data.pairs && data.pairs.length > 0) {
            var pair = data.pairs[0];
            message += 'Токен найден на DEX\n\n';
            message += 'Сеть: ' + (pair.chainId || 'Unknown') + '\n';
            message += 'DEX: ' + (pair.dexId || 'Unknown') + '\n';
            message += 'Цена: $' + parseFloat(pair.priceUsd || 0).toFixed(8) + '\n';
            message += 'Ликвидность: $' + parseFloat(pair.liquidity?.usd || 0).toFixed(2) + '\n';
            message += 'Объем 24ч: $' + parseFloat(pair.volume?.h24 || 0).toFixed(2) + '\n\n';
            var liq = parseFloat(pair.liquidity?.usd || 0);
            var risk = 'Низкий';
            var note = 'Достаточная ликвидность.';
            if (liq < 10000) { risk = 'Высокий'; note = 'Очень низкая ликвидность!'; }
            else if (liq < 50000) { risk = 'Средний'; note = 'Средняя ликвидность. Будьте осторожны.'; }
            message += 'Риск: ' + risk + '\n' + note + '\n\n';
            if (pair.url) message += 'Посмотреть на DEX: ' + pair.url + '\n';
        } else {
            message += 'Токен не найден на DEX\n\nВозможные причины: новый токен, неверный адрес, или токен на другой сети.\n';
        }
        message += 'Etherscan: https://etherscan.io/address/' + address;
        var keyboard = {
            inline_keyboard: [
                [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
                [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
        await addHistory(chatId, getText(lang, 'history_antiscam'), 'DEX: ' + address.slice(0, 10) + '...');
    } catch (error) {
        console.error('DEX check error:', error);
        await sendUpdatedMessage(chatId, 'Ошибка при проверке DEX.', null, 'Markdown', messageId);
    }
}

async function handleFileCheck(chatId, update, lang, messageId) {
    var file = update.message.document;
    var fileName = file.file_name || 'неизвестный_файл';
    var MAX_FILE_SIZE = 20 * 1024 * 1024;
    if (file.file_size > MAX_FILE_SIZE) {
        await sendUpdatedMessage(chatId, 'Файл слишком большой (макс. 20MB)', null, 'Markdown', messageId);
        return;
    }
    await sendTyping(chatId);
    var result = checkFile(fileName);
    var message = 'ПРОВЕРКА ФАЙЛА\n\n' + fileName + '\n' + (file.file_size / 1024).toFixed(1) + ' KB\n\n' + result;
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_antiscam'), 'Файл: ' + fileName);
}

async function handleImpersonationCheck(chatId, update, lang, messageId) {
    var forwarded = update.message.forward_from;
    var username = forwarded.username || '';
    if (!username) {
        await sendUpdatedMessage(chatId, 'Не удалось определить пользователя.', null, 'Markdown', messageId);
        await showMainMenu(chatId, lang);
        return;
    }
    await sendTyping(chatId);
    var result = checkImpersonation(username);
    var message = 'ПРОВЕРКА АККАУНТА\n\n@' + username + '\n\n';
    if (result) {
        message += getText(lang, 'scan_danger') + '\n\n' + result;
    } else {
        message += getText(lang, 'scan_safe') + '\n\nАккаунт безопасен.';
    }
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_antiscam'), 'Аккаунт: @' + username);
}

async function handleWalletCheck(chatId, address, lang, messageId) {
    var check = await checkLimit(chatId, 'antiscam');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        await setData('state_' + chatId, 'idle');
        return;
    }
    await sendTyping(chatId);
    if (!address.startsWith('0x') || address.length < 42) {
        await sendUpdatedMessage(chatId, getText(lang, 'wallet_invalid'), null, 'Markdown', messageId);
        return;
    }
    var walletInfo = await checkWallet(address);
    var message = 'ПРОВЕРКА КОШЕЛЬКА\n\nАдрес: ' + address.slice(0, 10) + '...' + address.slice(-6) + '\nСеть: Ethereum\n\nБаланс: ' + walletInfo.balance.toFixed(4) + ' ETH\nТокены: ' + (walletInfo.tokens.length > 0 ? walletInfo.tokens.join(', ') : 'нет') + '\n\n';
    var riskLabel = walletInfo.risk === 'high' ? 'Высокий' : walletInfo.risk === 'medium' ? 'Средний' : 'Низкий';
    message += 'Риск: ' + riskLabel + '\n\n';
    if (walletInfo.risk === 'high') {
        message += 'Обнаружены подозрительные токены\nМало транзакций\n\n';
    } else if (walletInfo.risk === 'medium') {
        message += 'Кошелёк создан недавно\n\n';
    } else {
        message += 'Рисков не обнаружено\n\n';
    }
    message += 'Рекомендации:\n';
    if (walletInfo.risk === 'high') {
        message += 'Не взаимодействуйте с подозрительными токенами\nПроверьте контракты через DEX\n\n';
    } else if (walletInfo.risk === 'medium') {
        message += 'Диверсифицируйте портфель\nПодключите биржу для полного анализа\n\n';
    } else {
        message += 'Хотите полный анализ с рекомендациями?\nПодключите биржу через /connect\n\n';
    }
    message += 'Просмотр: https://etherscan.io/address/' + address;
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'wallet_connect'), callback_data: 'menu_connect' }],
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_antiscam'), 'Кошелёк: ' + address.slice(0, 10) + '...');
    await setData('state_' + chatId, 'idle');
}

async function autoCheckLinks(chatId, text, lang, messageId) {
    var urls = text.match(/https?:\/\/[^\s]+/g);
    if (!urls) return;
    var check = await checkLimit(chatId, 'antiscam');
    if (!check.allowed) return;
    for (var i = 0; i < urls.length; i++) {
        var url = urls[i];
        try {
            var result = await checkUrl(url);
            if (!result.safe) {
                var message = 'ПОДОЗРИТЕЛЬНАЯ ССЫЛКА!\n\n' + url + '\n\n' + result.reason + '\n\nНикогда не вводите пароли и сид-фразы!';
                var keyboard = {
                    inline_keyboard: [
                        [{ text: 'Проверить другое', callback_data: 'menu_security' }],
                        [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
                    ]
                };
                await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
                await addHistory(chatId, getText(lang, 'history_antiscam'), 'Авто: ' + url.slice(0, 30) + '...');
            }
        } catch (error) {
            console.error('Auto-check error:', error);
        }
    }
}

async function autoCheckContract(chatId, address, lang, messageId) {
    var check = await checkLimit(chatId, 'antiscam');
    if (!check.allowed) return;
    await sendTyping(chatId);
    var contractInfo = await checkContract(address);
    var result = 'АВТОМАТИЧЕСКАЯ ПРОВЕРКА КОНТРАКТА\n\n' + address + '\n\n' + contractInfo.reason + '\n\nПроверьте вручную: https://etherscan.io/address/' + address;
    var keyboard = {
        inline_keyboard: [
            [{ text: 'Проверить другое', callback_data: 'menu_security' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, result, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_antiscam'), 'Контракт: ' + address.slice(0, 10) + '...');
}

async function handleCallback(update) {
    var callback = update.callback_query;
    var chatId = callback.message.chat.id;
    var messageId = callback.message.message_id;
    var data = callback.data;
    var lang = await getData('lang_' + chatId) || 'ru';

    var buttonSpamKey = 'btn_spam_' + chatId;
    var lastButtonClick = await getData(buttonSpamKey);
    if (lastButtonClick && Date.now() - parseInt(lastButtonClick) < 500) {
        await answerCallback(callback.id, 'Не спамьте кнопками!', true);
        return;
    }
    await setData(buttonSpamKey, Date.now().toString(), 5);

    await deleteUserMessage(chatId, messageId);
    await answerCallback(callback.id);

    try {
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
        if (data === 'settings_change_lang') { await showLanguageSelect(chatId, lang); return; }
        if (data === 'settings_change_mode') { await showModeSelect(chatId, lang); return; }
        if (data === 'menu_analyze') { await showAnalyzeMenu(chatId, lang); return; }
        if (data === 'menu_security') { await showSecurityMenu(chatId, lang); return; }
        if (data === 'menu_news') { await handleNewsCommand(chatId, null, lang, null); return; }
        if (data === 'menu_history') { await showHistoryMenu(chatId, lang); return; }
        if (data === 'menu_social') { await handleSocialTrend(chatId, lang, null); return; }
        if (data === 'menu_calendar') { await handleCalendarCommand(chatId, lang, null); return; }
        if (data === 'menu_market') { await showMarketMenu(chatId, lang); return; }
        if (data === 'menu_connect') {
            await sendUpdatedMessage(chatId, getText(lang, 'connect_prompt'));
            await setData('state_' + chatId, 'waiting_for_keys');
            return;
        }

        if (data === 'lang_ru' || data === 'lang_en') {
            var newLang = data === 'lang_ru' ? 'ru' : 'en';
            await setData('lang_' + chatId, newLang);
            await sendUpdatedMessage(chatId, getText(newLang, 'settings_lang_selected', newLang === 'ru' ? 'Русский' : 'English'));
            await showSettingsMenuNew(chatId, newLang);
            return;
        }
        if (data === 'mode_beginner' || data === 'mode_pro') {
            var newMode = data === 'mode_beginner' ? 'beginner' : 'pro';
            await setData('mode_' + chatId, newMode);
            await sendUpdatedMessage(chatId, getText(lang, 'settings_mode_selected', newMode === 'beginner' ? 'Новичок' : 'Опытный'));
            await showSettingsMenuNew(chatId, lang);
            return;
        }

        if (data === 'onboard_lang_ru' || data === 'onboard_lang_en') {
            var newLang = data === 'onboard_lang_ru' ? 'ru' : 'en';
            await setData('lang_' + chatId, newLang);
            await showModeSelectOnboarding(chatId, newLang);
            return;
        }
        if (data === 'onboard_mode_beginner' || data === 'onboard_mode_pro') {
            var mode = data === 'onboard_mode_beginner' ? 'beginner' : 'pro';
            await setData('mode_' + chatId, mode);
            await showVipBonusOffer(chatId, lang);
            return;
        }
        if (data === 'onboard_connect_vip') {
            await handleOnboardConnectVip(chatId, lang);
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

        if (data === 'help_q1') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q1'), null, 'Markdown'); return; }
        if (data === 'help_q2') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q2'), null, 'Markdown'); return; }
        if (data === 'help_q3') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q3'), null, 'Markdown'); return; }
        if (data === 'help_q4') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q4'), null, 'Markdown'); return; }
        if (data === 'help_q5') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q5'), null, 'Markdown'); return; }
        if (data === 'help_q6') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q6'), null, 'Markdown'); return; }
        if (data === 'help_q7') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q7'), null, 'Markdown'); return; }
        if (data === 'help_q8') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q8'), null, 'Markdown'); return; }
        if (data === 'help_q9') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q9'), null, 'Markdown'); return; }
        if (data === 'help_contact_moderator') {
            await sendUpdatedMessage(chatId, getText(lang, 'help_contact_moderator_message'), null, 'Markdown');
            return;
        }

        if (data.startsWith('plan_')) {
            var planId = data.replace('plan_', '');
            await handlePlanSelection(chatId, planId, lang, null);
            return;
        }

        if (data.startsWith('antiscam_')) {
            await setData('state_' + chatId, data);
            var prompts = {
                'antiscam_url': getText(lang, 'scan_link'),
                'antiscam_contract': getText(lang, 'scan_contract'),
                'antiscam_file': getText(lang, 'scan_file'),
                'antiscam_dex': getText(lang, 'dex_prompt'),
                'antiscam_impersonation': getText(lang, 'impersonation_prompt'),
                'antiscam_wallet': getText(lang, 'wallet_prompt')
            };
            await sendUpdatedMessage(chatId, prompts[data] + '\n\nДля отмены отправь /cancel');
            return;
        }

        if (data.startsWith('trend_')) {
            await handleTrendClick(chatId, data, lang, null);
            return;
        }
        if (data === 'trend_search_menu') {
            await handleTrendSearchMenu(chatId, lang, null);
            return;
        }
        if (data === 'trend_search_name') {
            await sendUpdatedMessage(chatId, getText(lang, 'social_search_prompt'), null, 'Markdown');
            await setData('state_' + chatId, 'waiting_for_trend_search');
            return;
        }
        if (data === 'trend_search_contract') {
            await sendUpdatedMessage(chatId, 'Отправь адрес контракта для проверки\n\nПример: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e\n/cancel — отмена', null, 'Markdown');
            await setData('state_' + chatId, 'waiting_for_contract_search');
            return;
        }

        if (data === 'alert_menu') {
            await showAlertMenu(chatId, lang);
            return;
        }
        if (data === 'alert_price') {
            await sendUpdatedMessage(chatId, getText(lang, 'alert_create_price'), null, 'Markdown');
            await setData('state_' + chatId, 'alert_price');
            return;
        }
        if (data === 'alert_change') {
            await sendUpdatedMessage(chatId, getText(lang, 'alert_create_change'), null, 'Markdown');
            await setData('state_' + chatId, 'alert_change');
            return;
        }
        if (data === 'alert_volume' || data === 'alert_news' || data === 'alert_calendar') {
            await sendUpdatedMessage(chatId, 'Функция в разработке', null, 'Markdown');
            return;
        }
        if (data === 'alert_list') {
            var alerts = await getData('alerts_' + chatId);
            if (!alerts || (typeof alerts === 'string' ? JSON.parse(alerts) : alerts).length === 0) {
                await sendUpdatedMessage(chatId, 'У вас нет активных оповещений.', null, 'Markdown');
                return;
            }
            var parsedAlerts = typeof alerts === 'string' ? JSON.parse(alerts) : alerts;
            var text = getText(lang, 'alert_list');
            for (var i = 0; i < parsedAlerts.length; i++) {
                var a = parsedAlerts[i];
                text += '• ' + (a.params.symbol || '') + ' (' + a.type + ') – ' + (a.params.target || '') + '\n';
            }
            await sendUpdatedMessage(chatId, text, null, 'Markdown');
            return;
        }

        if (data === 'autotrade_menu') {
            await showAutotradeMenu(chatId, lang);
            return;
        }
        if (data === 'autotrade_level1' || data === 'autotrade_level2' || data === 'autotrade_level3') {
            var level = data === 'autotrade_level1' ? 1 : data === 'autotrade_level2' ? 2 : 3;
            var plan = await getUserPlan(chatId);
            if (!plan.limits.autotrade) {
                await sendUpdatedMessage(chatId, getText(lang, 'autotrade_pro_only'), null, 'Markdown');
                return;
            }
            await setData('autotrade_' + chatId, JSON.stringify({ level: level, active: true, lastCheck: Date.now() }));
            await sendUpdatedMessage(chatId, getText(lang, 'autotrade_active', { level: level }), null, 'Markdown');
            return;
        }
        if (data === 'autotrade_level4') {
            var plan = await getUserPlan(chatId);
            if (!plan.limits.autotrade) {
                await sendUpdatedMessage(chatId, getText(lang, 'autotrade_pro_only'), null, 'Markdown');
                return;
            }
            await sendUpdatedMessage(chatId, 'Запускаю "Снежный ком"...', null, 'Markdown');
            var result = await runSnowballStrategy(chatId);
            if (result.error) {
                await sendUpdatedMessage(chatId, 'Ошибка: ' + result.error, null, 'Markdown');
            } else {
                await setData('autotrade_' + chatId, JSON.stringify({ 
                    level: 4, active: true, lastCheck: Date.now(), type: 'snowball'
                }));
                await sendUpdatedMessage(chatId, 'Стратегия "Снежный ком" запущена!', null, 'Markdown');
            }
            return;
        }
        if (data === 'autotrade_stop') {
            await deleteData('autotrade_' + chatId);
            await sendUpdatedMessage(chatId, getText(lang, 'autotrade_stopped'), null, 'Markdown');
            return;
        }

        if (data.startsWith('exec_')) {
            var recId = data.replace('exec_', '');
            var keyboard = {
                inline_keyboard: [
                    [{ text: 'Подтвердить', callback_data: 'confirm_' + recId }],
                    [{ text: 'Отмена', callback_data: 'cancel_exec_' + recId }]
                ]
            };
            await sendMessage(chatId, 'Подтвердите исполнение рекомендации.\n\nЭто действие отправит ордер на биржу.', keyboard);
            return;
        }
        if (data.startsWith('confirm_')) {
            var recId = data.replace('confirm_', '');
            var result = await executeRecommendation(chatId, recId);
            if (result.error) {
                await sendUpdatedMessage(chatId, 'Ошибка: ' + result.error, null, 'Markdown');
            } else {
                await sendUpdatedMessage(chatId, 'Ордер исполнен!\n\nСимвол: ' + result.order.symbol + '\nСторона: ' + result.order.side + '\nКоличество: ' + result.order.amount + '\nЦена: ' + (result.order.price || 'рыночная'), null, 'Markdown');
            }
            await showMainMenu(chatId, lang);
            return;
        }
        if (data.startsWith('cancel_exec_')) {
            await sendUpdatedMessage(chatId, 'Исполнение отменено.', null, 'Markdown');
            await showMainMenu(chatId, lang);
            return;
        }

        if (data === 'action_rebalance') {
            var savedData = await getData('user_' + chatId);
            if (!savedData) {
                await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'), null, 'Markdown');
                return;
            }
            var mode = await getData('mode_' + chatId) || 'beginner';
            var keyboard = {
                inline_keyboard: [
                    [{ text: 'Подтвердить ребаланс', callback_data: 'confirm_rebalance' }],
                    [{ text: 'Отмена', callback_data: 'cancel_rebalance' }]
                ]
            };
            var modeLabel = mode === 'beginner' ? 'Новичок' : 'Опытный';
            await sendMessage(chatId, 'Подтвердите ребаланс портфеля\n\nБот продаст активы выше целевого веса и купит те, что ниже.\n\nЦелевые веса (' + modeLabel + '):\nBTC: ' + (mode === 'beginner' ? '50%' : '40%') + '\nАльты: ' + (mode === 'beginner' ? '30%' : '40%') + '\nСтейблы: 20%', keyboard);
            return;
        }
        if (data === 'confirm_rebalance') {
            var result = await autoRebalance(chatId);
            if (result.error) {
                await sendUpdatedMessage(chatId, 'Ошибка: ' + result.error, null, 'Markdown');
            } else {
                await sendUpdatedMessage(chatId, 'Ребаланс выполнен!\n\n' + result.message, null, 'Markdown');
            }
            await showMainMenu(chatId, lang);
            return;
        }
        if (data === 'cancel_rebalance') {
            await sendUpdatedMessage(chatId, 'Ребаланс отменен.', null, 'Markdown');
            await showMainMenu(chatId, lang);
            return;
        }

        if (data === 'action_analyze') {
            var savedData = await getData('user_' + chatId);
            if (!savedData) {
                await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'), null, 'Markdown');
                return;
            }
            await sendUpdatedMessage(chatId, 'Начинаю анализ...', null, 'Markdown');
            var user = typeof savedData === 'string' ? JSON.parse(savedData) : savedData;
            var apiKey = decrypt(user.apiKey);
            var secretKey = decrypt(user.secretKey);
            try {
                var exchange = await connectExchange(apiKey, secretKey, user.exchangeId);
                var balance = await exchange.fetchBalance();
                var total = balance.total;
                var coins = Object.keys(total).filter(function(key) { return total[key] > 0; });
                if (coins.length === 0) {
                    await sendUpdatedMessage(chatId, 'На балансе нет монет.', null, 'Markdown');
                    return;
                }
                var totalUSDT = 0;
                var assets = [];
                for (var i = 0; i < coins.length; i++) {
                    var coin = coins[i];
                    if (coin === 'USDT') {
                        totalUSDT += total[coin];
                        continue;
                    }
                    try {
                        var ticker = await exchange.fetchTicker(coin + '/USDT');
                        var value = total[coin] * ticker.last;
                        totalUSDT += value;
                        assets.push({ symbol: coin, value: value });
                    } catch (e) {}
                }
                for (var a = 0; a < assets.length; a++) {
                    assets[a].weight = (assets[a].value / totalUSDT) * 100;
                }
                assets.sort(function(a, b) { return b.weight - a.weight; });
                var mode = await getData('mode_' + chatId) || 'beginner';
                var thresholds = getRiskThresholds(mode);
                var engineResult = {
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
                var report = await composeReport(engineResult, mode, lang, 0);
                await sendUpdatedMessage(chatId, report.text, report.keyboard, 'Markdown');
                await setData('analysis_' + chatId, JSON.stringify(engineResult), 86400);
                await addHistory(chatId, getText(lang, 'history_analyze'), '$' + totalUSDT.toFixed(2));
            } catch (error) {
                console.error('Analysis error:', error);
                await notifyAdmin(error, { chatId: chatId, function: 'action_analyze' });
                await sendUpdatedMessage(chatId, 'Ошибка анализа: ' + error.message, null, 'Markdown');
            }
            return;
        }

        if (data === 'action_export_csv') {
            var savedData = await getData('user_' + chatId);
            if (!savedData) {
                await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'), null, 'Markdown');
                return;
            }
            var user = typeof savedData === 'string' ? JSON.parse(savedData) : savedData;
            var apiKey = decrypt(user.apiKey);
            var secretKey = decrypt(user.secretKey);
            try {
                var exchange = await connectExchange(apiKey, secretKey, user.exchangeId);
                var balance = await exchange.fetchBalance();
                var total = balance.total;
                var coins = Object.keys(total).filter(function(key) { return total[key] > 0; });
                var totalUSDT = 0;
                var assets = [];
                for (var i = 0; i < coins.length; i++) {
                    var coin = coins[i];
                    if (coin === 'USDT') {
                        totalUSDT += total[coin];
                        continue;
                    }
                    try {
                        var ticker = await exchange.fetchTicker(coin + '/USDT');
                        var value = total[coin] * ticker.last;
                        totalUSDT += value;
                        assets.push({ symbol: coin, value: value });
                    } catch (e) {}
                }
                for (var a = 0; a < assets.length; a++) {
                    assets[a].weight = (assets[a].value / totalUSDT) * 100;
                }
                assets.sort(function(a, b) { return b.weight - a.weight; });
                var engineResult = {
                    totalUSDT: totalUSDT,
                    assets: assets,
                    riskLevel: 'low',
                    riskScore: 0,
                    btcMetrics: {},
                    timestamp: Date.now()
                };
                var csv = generateCSV(engineResult);
                await sendDocument(chatId, csv, 'portfolio_report.csv');
                await sendUpdatedMessage(chatId, 'CSV отчет отправлен!', null, 'Markdown');
            } catch (error) {
                console.error('CSV error:', error);
                await notifyAdmin(error, { chatId: chatId, function: 'action_export_csv' });
                await sendUpdatedMessage(chatId, getText(lang, 'export_error'), null, 'Markdown');
            }
            return;
        }

        if (data === 'action_history_refresh') {
            await showHistoryMenu(chatId, lang);
            return;
        }

        if (data === 'action_disconnect') {
            await deleteData('user_' + chatId);
            await sendUpdatedMessage(chatId, getText(lang, 'connect_disconnected'), null, 'Markdown');
            await showMainMenu(chatId, lang);
            return;
        }

        if (data === 'action_ask_ai') {
            await sendUpdatedMessage(chatId, getText(lang, 'ai_mode'), null, 'Markdown');
            await setData('state_' + chatId, 'ai_chat');
            return;
        }

        if (data === 'panic_convert_all') {
            await handlePanicConvertAll(chatId);
            return;
        }

        if (data === 'confirm_reset_all') {
            var keys = [
                'user_' + chatId, 'plan_' + chatId, 'history_' + chatId,
                'alerts_' + chatId, 'analysis_' + chatId, 'mode_' + chatId,
                'lang_' + chatId, 'autotrade_' + chatId, 'panic_' + chatId,
                'onboarded_' + chatId, 'state_' + chatId, 'spam_' + chatId,
                'last_msg_' + chatId
            ];
            for (var i = 0; i < keys.length; i++) {
                await deleteData(keys[i]);
            }
            planCache.delete(chatId);
            await sendUpdatedMessage(chatId, 'Все данные сброшены!\n\nМожешь начать заново: /start', null, 'Markdown');
            return;
        }
        if (data === 'cancel_reset') {
            await sendUpdatedMessage(chatId, 'Сброс отменен.', null, 'Markdown');
            await showMainMenu(chatId, lang);
            return;
        }

    } catch (error) {
        console.error('Callback error:', error);
        await notifyAdmin(error, { chatId: chatId, function: 'handleCallback', data: data });
        await sendUpdatedMessage(chatId, getText(lang, 'error_general', error.message));
    }
}

async function handleMessage(update) {
    var chatId = update.message.chat.id;
    var text = update.message.text || '';
    var messageId = update.message.message_id;
    var userName = update.message.from.first_name || 'Друг';
    var lang = await getData('lang_' + chatId) || 'ru';
    var state = await getData('state_' + chatId) || 'idle';

    try {
        if (!update.message) {
            console.warn('Невалидный webhook: отсутствует message');
            return;
        }

        if (update.message.forward_from) {
            return;
        }

        var cleanText = sanitizeInput(text);

        var rateCheck = await checkRateLimit(chatId, 'messages', 20, 60000);
        if (!rateCheck.allowed) {
            await sendUpdatedMessage(chatId, rateCheck.message, null, 'Markdown', messageId);
            return;
        }

        var spamKey = 'spam_' + chatId;
        var lastMessage = await getData(spamKey);
        if (lastMessage && Date.now() - parseInt(lastMessage) < 1000) {
            await sendUpdatedMessage(chatId, 'Пожалуйста, не спамьте. Подождите 1 секунду.', null, 'Markdown', messageId);
            return;
        }
        await setData(spamKey, Date.now().toString(), 5);

        if (cleanText && (cleanText.includes('http://') || cleanText.includes('https://'))) {
            await autoCheckLinks(chatId, cleanText, lang, messageId);
        }
        if (cleanText && cleanText.startsWith('0x') && cleanText.length >= 42 && cleanText.length <= 44) {
            await autoCheckContract(chatId, cleanText, lang, messageId);
            return;
        }

        if (state === 'waiting_for_keys' || state === 'waiting_for_keys_vip') {
            if (cleanText === '/cancel') {
                await setData('state_' + chatId, 'idle');
                await sendUpdatedMessage(chatId, getText(lang, 'connect_cancel'), null, 'Markdown', messageId);
                if (state === 'waiting_for_keys_vip') {
                    await setData('onboarded_' + chatId, 'true');
                    await showMainMenu(chatId, lang);
                } else {
                    await showMainMenu(chatId, lang);
                }
                return;
            }
            var parts = cleanText.split(':');
            if (parts.length === 2) {
                var apiKey = parts[0].trim();
                var secretKey = parts[1].trim();
                await sendTyping(chatId);
                await sendUpdatedMessage(chatId, 'Проверяю ключи...', null, 'Markdown', messageId);

                var attemptsCheck = await checkConnectAttempts(chatId);
                if (attemptsCheck.blocked) {
                    await sendUpdatedMessage(chatId, attemptsCheck.reason, null, 'Markdown', messageId);
                    return;
                }

                var validation = await validateExchangeKeys(apiKey, secretKey);
                if (!validation.valid) {
                    await recordConnectAttempt(chatId, false);
                    await sendUpdatedMessage(chatId, validation.error, null, 'Markdown', messageId);
                    return;
                }

                var encryptedApiKey = encrypt(apiKey);
                var encryptedSecretKey = encrypt(secretKey);
                await setData('user_' + chatId, JSON.stringify({
                    apiKey: encryptedApiKey,
                    secretKey: encryptedSecretKey,
                    exchangeId: 'binance'
                }));
                await recordConnectAttempt(chatId, true);

                if (state === 'waiting_for_keys_vip') {
                    await activateVipTrial(chatId);
                    await setData('state_' + chatId, 'idle');
                    await setData('onboarded_' + chatId, 'true');
                    var expiresDate = formatDateShort(Date.now() + 3 * 24 * 60 * 60 * 1000);
                    var message = 'ПОЗДРАВЛЯЮ!\n\n' +
                        'Ты подключил биржу и получил VIP-доступ на 3 дня!\n\n' +
                        'Действует до: ' + expiresDate + '\n\n' +
                        'Теперь тебе доступно всё:\n' +
                        'Холодный душ\n' +
                        'Автоторговля\n' +
                        'Полная аналитика\n' +
                        'Безлимитные оповещения\n\n' +
                        'Попробуй все функции, а после триала выбери подходящий тариф!';
                    var keyboard = {
                        inline_keyboard: [
                            [{ text: 'В меню', callback_data: 'onboard_vip_done' }]
                        ]
                    };
                    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
                    return;
                }

                await setData('state_' + chatId, 'idle');
                await sendUpdatedMessage(chatId, getText(lang, 'connect_success', 'Binance'), null, 'Markdown', messageId);
                await showMainMenu(chatId, lang);
            } else {
                await sendUpdatedMessage(chatId, getText(lang, 'invalid_format'), null, 'Markdown', messageId);
            }
            return;
        }

        var antiscamStates = ['antiscam_url', 'antiscam_contract', 'antiscam_dex', 'antiscam_file', 'antiscam_impersonation', 'antiscam_wallet'];
        if (antiscamStates.indexOf(state) !== -1) {
            if (cleanText === '/cancel') {
                await setData('state_' + chatId, 'idle');
                await sendUpdatedMessage(chatId, getText(lang, 'scan_cancelled'), null, 'Markdown', messageId);
                await showMainMenu(chatId, lang);
                return;
            }
            await handleAntiScamInput(chatId, cleanText, lang, update, messageId);
            return;
        }

        if (state === 'waiting_for_trend_search') {
            if (cleanText === '/cancel') {
                await setData('state_' + chatId, 'idle');
                await sendUpdatedMessage(chatId, 'Поиск отменен.', null, 'Markdown', messageId);
                await showMainMenu(chatId, lang);
                return;
            }
            await handleTrendSearchInput(chatId, cleanText, lang, messageId);
            return;
        }

        if (state === 'waiting_for_contract_search') {
            if (cleanText === '/cancel') {
                await setData('state_' + chatId, 'idle');
                await sendUpdatedMessage(chatId, 'Поиск отменен.', null, 'Markdown', messageId);
                await showMainMenu(chatId, lang);
                return;
            }
            var cleanInput = cleanText.trim();
            if (!cleanInput.startsWith('0x') || cleanInput.length < 42) {
                await sendUpdatedMessage(chatId, 'Неверный адрес контракта.\n\nОтправь адрес, начинающийся с 0x... (длина 42 символа)', null, 'Markdown', messageId);
                await setData('state_' + chatId, 'waiting_for_contract_search');
                return;
            }
            await handleContractSearch(chatId, cleanInput, lang, messageId);
            await setData('state_' + chatId, 'idle');
            return;
        }

        if (state === 'alert_price') {
            var parts = cleanText.split(' ');
            if (parts.length === 2) {
                var symbol = parts[0].toUpperCase();
                var target = parseFloat(parts[1]);
                if (!isNaN(target)) {
                    var alerts = await getData('alerts_' + chatId);
                    var parsedAlerts = alerts ? (typeof alerts === 'string' ? JSON.parse(alerts) : alerts) : [];
                    var plan = await getUserPlan(chatId);
                    var limit = plan.limits.alerts || 0;
                    if (parsedAlerts.length >= limit && limit !== Infinity) {
                        await sendUpdatedMessage(chatId, 'Лимит оповещений исчерпан. Повысьте тариф: /subscribe', null, 'Markdown', messageId);
                        await setData('state_' + chatId, 'idle');
                        return;
                    }
                    var alert = { 
                        id: Date.now().toString(), 
                        type: 'price', 
                        params: { symbol: symbol, target: target, direction: 'above' }, 
                        active: true, 
                        createdAt: Date.now() 
                    };
                    parsedAlerts.push(alert);
                    await setData('alerts_' + chatId, JSON.stringify(parsedAlerts));
                    await sendUpdatedMessage(chatId, 'Оповещение добавлено!', null, 'Markdown', messageId);
                    await setData('state_' + chatId, 'idle');
                    return;
                }
            } else if (parts.length === 3 && parts[2].toLowerCase() === 'below') {
                var symbol = parts[0].toUpperCase();
                var target = parseFloat(parts[1]);
                if (!isNaN(target)) {
                    var alerts = await getData('alerts_' + chatId);
                    var parsedAlerts = alerts ? (typeof alerts === 'string' ? JSON.parse(alerts) : alerts) : [];
                    var alert = { id: Date.now().toString(), type: 'price', params: { symbol: symbol, target: target, direction: 'below' }, active: true, createdAt: Date.now() };
                    parsedAlerts.push(alert);
                    await setData('alerts_' + chatId, JSON.stringify(parsedAlerts));
                    await sendUpdatedMessage(chatId, 'Оповещение добавлено!', null, 'Markdown', messageId);
                    await setData('state_' + chatId, 'idle');
                    return;
                }
            }
            await sendUpdatedMessage(chatId, 'Неверный формат. Используйте BTC 70000 или BTC 65000 below', null, 'Markdown', messageId);
            return;
        }

        if (state === 'alert_change') {
            var parts = cleanText.split(' ');
            if (parts.length === 2) {
                var symbol = parts[0].toUpperCase();
                var target = parseFloat(parts[1]);
                if (!isNaN(target)) {
                    var alerts = await getData('alerts_' + chatId);
                    var parsedAlerts = alerts ? (typeof alerts === 'string' ? JSON.parse(alerts) : alerts) : [];
                    var alert = { id: Date.now().toString(), type: 'change', params: { symbol: symbol, target: target }, active: true, createdAt: Date.now() };
                    parsedAlerts.push(alert);
                    await setData('alerts_' + chatId, JSON.stringify(parsedAlerts));
                    await sendUpdatedMessage(chatId, 'Оповещение добавлено!', null, 'Markdown', messageId);
                    await setData('state_' + chatId, 'idle');
                    return;
                }
            }
            await sendUpdatedMessage(chatId, 'Неверный формат. Используйте BTC 5', null, 'Markdown', messageId);
            return;
        }

        if (state === 'ai_chat') {
            if (cleanText === '/exit' || cleanText === 'выход' || cleanText === 'Exit') {
                await setData('state_' + chatId, 'idle');
                await sendUpdatedMessage(chatId, getText(lang, 'ai_exit'), null, 'Markdown', messageId);
                await showMainMenu(chatId, lang);
                return;
            }
            await sendTyping(chatId);
            var portfolioData = await getData('analysis_' + chatId);
            var portfolio = portfolioData ? (typeof portfolioData === 'string' ? JSON.parse(portfolioData) : portfolioData) : null;
            var answer = await aiRouter.safeAIChat(cleanText, portfolio, lang);
            if (answer) {
                await sendUpdatedMessage(chatId, answer, null, 'Markdown', messageId);
            } else {
                await sendUpdatedMessage(chatId, 'Не удалось получить ответ. Попробуйте позже.', null, 'Markdown', messageId);
            }
            await setData('state_' + chatId, 'ai_chat');
            return;
        }

        if (cleanText === '/start') {
            var onboarded = await getData('onboarded_' + chatId);
            if (!onboarded) {
                await showLanguageSelectOnboarding(chatId);
                return;
            }
            await showMainMenu(chatId, lang);
            return;
        }

        if (cleanText === '/help') { await showHelpMenu(chatId, lang); return; }
        if (cleanText === '/history') { await showHistoryMenu(chatId, lang); return; }
        if (cleanText === '/settings') { await showSettingsMenuNew(chatId, lang); return; }
        if (cleanText === '/subscribe' || cleanText === '/plans') { await showPlansMenu(chatId, lang); return; }
        if (cleanText === '/connect') {
            await sendUpdatedMessage(chatId, getText(lang, 'connect_prompt'), null, 'Markdown', messageId);
            await setData('state_' + chatId, 'waiting_for_keys');
            return;
        }
        if (cleanText === '/disconnect') {
            await deleteData('user_' + chatId);
            await sendUpdatedMessage(chatId, getText(lang, 'connect_disconnected'), null, 'Markdown', messageId);
            await showMainMenu(chatId, lang);
            return;
        }

        if (cleanText === '/portfolio') {
            var savedData = await getData('user_' + chatId);
            if (!savedData) {
                await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'), null, 'Markdown', messageId);
                return;
            }
            var user = typeof savedData === 'string' ? JSON.parse(savedData) : savedData;
            var apiKey = decrypt(user.apiKey);
            var secretKey = decrypt(user.secretKey);
            try {
                var exchange = await connectExchange(apiKey, secretKey, user.exchangeId);
                var balance = await exchange.fetchBalance();
                var total = balance.total;
                var coins = Object.keys(total).filter(function(key) { return total[key] > 0; });
                var message = 'ПОРТФЕЛЬ\n\n';
                var totalUSDT = 0;
                var assets = [];
                for (var i = 0; i < coins.length; i++) {
                    var coin = coins[i];
                    if (coin === 'USDT') {
                        totalUSDT += total[coin];
                        assets.push({ symbol: coin, value: total[coin] });
                    } else {
                        try {
                            var ticker = await exchange.fetchTicker(coin + '/USDT');
                            var value = total[coin] * ticker.last;
                            totalUSDT += value;
                            assets.push({ symbol: coin, value: value, amount: total[coin] });
                        } catch (e) {
                            assets.push({ symbol: coin, value: 0, amount: total[coin] });
                        }
                    }
                }
                assets.sort(function(a, b) { return b.value - a.value; });
                for (var j = 0; j < assets.length; j++) {
                    var a = assets[j];
                    if (a.symbol === 'USDT') {
                        message += a.symbol + ': $' + a.value.toFixed(2) + '\n';
                    } else if (a.value > 0) {
                        var percent = ((a.value / totalUSDT) * 100).toFixed(1);
                        message += a.symbol + ': ' + a.amount.toFixed(4) + ' ≈ $' + a.value.toFixed(2) + ' (' + percent + '%)\n';
                    } else {
                        message += a.symbol + ': ' + a.amount.toFixed(4) + ' (не удалось получить цену)\n';
                    }
                }
                message += '\nИтого: $' + totalUSDT.toFixed(2) + ' USDT';
                var keyboard = {
                    inline_keyboard: [
                        [{ text: 'Полный анализ', callback_data: 'action_analyze' }],
                        [{ text: 'Выйти в меню', callback_data: 'exit_to_menu' }]
                    ]
                };
                await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
            } catch (error) {
                await sendUpdatedMessage(chatId, 'Ошибка: ' + error.message, null, 'Markdown', messageId);
            }
            return;
        }

        if (cleanText === '/reset') {
            var keyboard = {
                inline_keyboard: [
                    [{ text: 'Да, сбросить всё', callback_data: 'confirm_reset_all' }],
                    [{ text: 'Отмена', callback_data: 'cancel_reset' }]
                ]
            };
            await sendMessage(chatId, 
                'ВНИМАНИЕ!\n\nТы собираешься СБРОСИТЬ ВСЕ ДАННЫЕ:\n' +
                'API-ключи будут удалены\nИстория будет очищена\nНастройки будут сброшены\nОповещения удалены\nАвтоторговля остановлена\n\nЭто действие НЕОБРАТИМО!',
                keyboard
            );
            return;
        }

        if (cleanText === '/analyze') {
            var savedData = await getData('user_' + chatId);
            if (!savedData) {
                await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'), null, 'Markdown', messageId);
                return;
            }
            await sendUpdatedMessage(chatId, 'Начинаю анализ...', null, 'Markdown', messageId);
            var user = typeof savedData === 'string' ? JSON.parse(savedData) : savedData;
            var apiKey = decrypt(user.apiKey);
            var secretKey = decrypt(user.secretKey);
            try {
                var exchange = await connectExchange(apiKey, secretKey, user.exchangeId);
                var balance = await exchange.fetchBalance();
                var total = balance.total;
                var coins = Object.keys(total).filter(function(key) { return total[key] > 0; });
                if (coins.length === 0) {
                    await sendUpdatedMessage(chatId, 'На балансе нет монет.', null, 'Markdown', messageId);
                    return;
                }
                var totalUSDT = 0;
                var assets = [];
                for (var i = 0; i < coins.length; i++) {
                    var coin = coins[i];
                    if (coin === 'USDT') {
                        totalUSDT += total[coin];
                        continue;
                    }
                    try {
                        var ticker = await exchange.fetchTicker(coin + '/USDT');
                        var value = total[coin] * ticker.last;
                        totalUSDT += value;
                        assets.push({ symbol: coin, value: value });
                    } catch (e) {}
                }
                for (var a = 0; a < assets.length; a++) {
                    assets[a].weight = (assets[a].value / totalUSDT) * 100;
                }
                assets.sort(function(a, b) { return b.weight - a.weight; });
                var mode = await getData('mode_' + chatId) || 'beginner';
                var thresholds = getRiskThresholds(mode);
                var engineResult = {
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
                var report = await composeReport(engineResult, mode, lang, 0);
                await sendUpdatedMessage(chatId, report.text, report.keyboard, 'Markdown', messageId);
                await setData('analysis_' + chatId, JSON.stringify(engineResult), 86400);
                await addHistory(chatId, getText(lang, 'history_analyze'), '$' + totalUSDT.toFixed(2));
            } catch (error) {
                console.error('Analysis error:', error);
                await notifyAdmin(error, { chatId: chatId, function: 'handleMessage_analyze' });
                await sendUpdatedMessage(chatId, 'Ошибка анализа: ' + error.message, null, 'Markdown', messageId);
            }
            return;
        }

        if (cleanText.startsWith('/news ')) {
            var coin = cleanText.replace('/news ', '').trim();
            await handleNewsCommand(chatId, coin, lang, messageId);
            return;
        }
        if (cleanText === '/news' || cleanText === '/news ') {
            await handleNewsCommand(chatId, null, lang, messageId);
            return;
        }

        if (cleanText.startsWith('/trend ')) {
            var coin = cleanText.replace('/trend ', '').trim().toUpperCase();
            await handleTrendClick(chatId, 'trend_' + coin, lang, messageId);
            return;
        }

        if (cleanText.startsWith('http://') || cleanText.startsWith('https://') || (cleanText.startsWith('0x') && cleanText.length >= 42)) {
            await handleAntiScamInput(chatId, cleanText, lang, update, messageId);
            return;
        }

        await sendUpdatedMessage(chatId, getText(lang, 'default_response', cleanText), null, 'Markdown', messageId);

    } catch (error) {
        console.error('Message error:', error);
        await notifyAdmin(error, { chatId: chatId, function: 'handleMessage', text: text });
        await sendUpdatedMessage(chatId, getText(lang, 'error_general', error.message), null, 'Markdown', messageId);
    }
}

async function handleCryptoWebhook(request) {
    try {
        var update = request.body;

        if (!verifyCryptoBotWebhook(update, request.headers)) {
            console.warn('Недействительная подпись webhook CryptoBot');
            return { status: 401, error: 'Invalid signature' };
        }

        if (update.update_type === 'invoice_paid') {
            var payload = update.payload;
            var parts = payload.split('_');
            var planId = parts[1];
            var chatId = parseInt(parts[2]);
            var lang = await getData('lang_' + chatId) || 'ru';

            var plan = await activatePlan(chatId, planId);
            if (plan) {
                await sendMessage(chatId, getText(lang, 'plans_success', plan.name));
                await showMainMenu(chatId, lang);
                await addHistory(chatId, 'Оплата', plan.name + ' активирован');
            }
        }

        return { status: 200 };
    } catch (error) {
        console.error('Webhook error:', error);
        return { status: 500, error: error.message };
    }
}

function runTaskWithRecovery(task, name, interval) {
    var run = async function() {
        try {
            await task();
        } catch (error) {
            console.error(name + ' error:', error);
            await notifyAdmin(error, { function: name });
        } finally {
            setTimeout(run, interval);
        }
    };
    setTimeout(run, 5000);
}

async function checkAlerts() {
    var keys = await VOID_KV.list('alerts_');
    for (var k = 0; k < keys.keys.length; k++) {
        var key = keys.keys[k];
        var chatId = parseInt(key.name.replace('alerts_', ''));
        var alerts = await getData(key.name);
        if (!alerts) continue;
        var parsedAlerts = typeof alerts === 'string' ? JSON.parse(alerts) : alerts;

        var keysUser = await loadUserKeys(chatId);
        if (!keysUser) {
            console.warn('Нет ключей для ' + chatId + ', пропускаем оповещения');
            continue;
        }

        try {
            var exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
            var updated = false;

            for (var i = 0; i < parsedAlerts.length; i++) {
                var alert = parsedAlerts[i];
                if (!alert.active) continue;
                try {
                    var ticker = await exchange.fetchTicker(alert.params.symbol + '/USDT');
                    if (!ticker) continue;
                    var price = ticker.last;

                    if (alert.type === 'price') {
                        if (alert.params.direction === 'above' && price >= alert.params.target) {
                            await sendMessage(chatId,
                                'ОПОВЕЩЕНИЕ СРАБОТАЛО!\n\n' +
                                alert.params.symbol + '\nЦена: $' + price.toFixed(2) + '\nЦель: > $' + alert.params.target
                            );
                            alert.active = false;
                            updated = true;
                        } else if (alert.params.direction === 'below' && price <= alert.params.target) {
                            await sendMessage(chatId,
                                'ОПОВЕЩЕНИЕ СРАБОТАЛО!\n\n' +
                                alert.params.symbol + '\nЦена: $' + price.toFixed(2) + '\nЦель: < $' + alert.params.target
                            );
                            alert.active = false;
                            updated = true;
                        }
                    } else if (alert.type === 'change') {
                        var priceKey = 'alert_price_' + chatId + '_' + alert.params.symbol;
                        var prevPriceData = await getData(priceKey);
                        if (prevPriceData) {
                            var prevPrice = parseFloat(prevPriceData);
                            var change = ((price - prevPrice) / prevPrice) * 100;
                            if (Math.abs(change) >= alert.params.target) {
                                await sendMessage(chatId,
                                    'ОПОВЕЩЕНИЕ СРАБОТАЛО!\n\n' +
                                    alert.params.symbol + '\nИзменение: ' + (change > 0 ? '+' : '') + change.toFixed(2) + '%\nЦель: ' + alert.params.target + '%'
                                );
                                alert.active = false;
                                updated = true;
                            }
                        }
                        await setData(priceKey, price.toString(), 3600);
                    }
                } catch (e) {
                    console.error('Ошибка проверки оповещения ' + alert.id + ' для ' + chatId + ':', e.message);
                }
            }

            if (updated) {
                await setData(key.name, JSON.stringify(parsedAlerts));
            }
        } catch (error) {
            console.error('Ошибка подключения к бирже для ' + chatId + ':', error);
        }
    }
}

async function runNewsBackgroundUpdate() {
    await newsManager.backgroundUpdate();
}

async function checkExpiringPlans() {
    var keys = await VOID_KV.list('plan_');
    var now = Date.now();
    var threeDays = 3 * 24 * 60 * 60 * 1000;

    for (var k = 0; k < keys.keys.length; k++) {
        var key = keys.keys[k];
        var chatId = parseInt(key.name.replace('plan_', ''));
        var data = await getData(key.name);
        if (!data) continue;
        
        var plan;
        try {
            plan = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (e) {
            continue;
        }

        if (plan.planId === 'TRIAL' || plan.vipTrial) continue;
        if (!plan.expires) continue;

        var timeLeft = plan.expires - now;
        if (timeLeft < threeDays && timeLeft > 0) {
            var lang = await getData('lang_' + chatId) || 'ru';
            var expiresDate = formatDateShort(plan.expires);

            var notifiedKey = 'expire_notified_' + chatId;
            var alreadyNotified = await getData(notifiedKey);
            if (!alreadyNotified) {
                await sendMessage(chatId,
                    'Твоя подписка заканчивается через 3 дня!\n\n' +
                    'Дата окончания: ' + expiresDate + '\n\n' +
                    'Чтобы продлить — отправь /subscribe',
                    null, 'Markdown'
                );
                await setData(notifiedKey, 'true', 86400 * 3);
            }
        }
    }
}

async function cleanPlanCache() {
    var now = Date.now();
    var keys = Array.from(planCache.keys());
    for (var i = 0; i < keys.length; i++) {
        var chatId = keys[i];
        var entry = planCache.get(chatId);
        if (now - entry.timestamp > 600000) {
            planCache.delete(chatId);
        }
    }
}

async function runVipReminderCheck() {
    await vipReminder.checkAllUsers();
}

runTaskWithRecovery(checkAlerts, 'checkAlerts', CONFIG.ALERT_CHECK_INTERVAL);
runTaskWithRecovery(runAutotrade, 'runAutotrade', CONFIG.AUTOTRADE_CHECK_INTERVAL);
runTaskWithRecovery(checkPanic, 'checkPanic', CONFIG.PANIC_CHECK_INTERVAL);
runTaskWithRecovery(runNewsBackgroundUpdate, 'runNewsBackgroundUpdate', 15 * 60 * 1000);
runTaskWithRecovery(runVipReminderCheck, 'runVipReminderCheck', 60 * 60 * 1000);
runTaskWithRecovery(checkExpiringPlans, 'checkExpiringPlans', 24 * 60 * 60 * 1000);

setInterval(cleanPlanCache, 600000);

var app = express();
app.use(express.json());

app.use(function(req, res, next) {
    console.log(req.method + ' ' + req.url);
    next();
});

app.get('/health', function(req, res) {
    res.status(200).json({
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        redis: VOID_KV.isRedisAvailable ? 'connected' : 'fallback'
    });
});

app.get('/webhook', function(req, res) {
    res.status(200).send('Webhook is active');
});

app.post('/webhook', async function(req, res) {
    console.log('Webhook вызван!');
    try {
        var update = req.body;
        console.log('Webhook received: ' + JSON.stringify(update).slice(0, 200) + '...');

        if (update.callback_query) {
            console.log('Обработка callback...');
            await handleCallback(update);
            res.sendStatus(200);
            return;
        }

        if (update.message) {
            console.log('Сообщение от ' + (update.message.from?.first_name || 'Unknown'));
            await handleMessage(update);
            res.sendStatus(200);
            return;
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error);
        await notifyAdmin(error, { function: 'webhook', body: req.body });
        res.sendStatus(500);
    }
});

app.post('/webhook/crypto', async function(req, res) {
    try {
        var result = await handleCryptoWebhook(req);
        res.status(result.status || 200).json(result);
    } catch (error) {
        console.error('Crypto webhook error:', error);
        res.sendStatus(500);
    }
});

app.post('/webhook/test', function(req, res) {
    console.log('Test webhook:', req.body);
    res.status(200).json({ received: true, body: req.body });
});

var PORT = process.env.PORT || 3000;

var server = app.listen(PORT, '0.0.0.0', function() {
    console.log('Бот успешно запущен на порту ' + PORT);
    console.log('Webhook URL: https://ваш-домен.onrender.com/webhook');
    console.log('Health Check: https://ваш-домен.onrender.com/health');
    console.log('Crypto Webhook: https://ваш-домен.onrender.com/webhook/crypto');
    console.log('Бот готов к работе!');
});

process.on('uncaughtException', function(error) {
    console.error('Uncaught Exception:', error);
    notifyAdmin(error, { function: 'uncaughtException' });
});

process.on('unhandledRejection', function(reason, promise) {
    console.error('Unhandled Rejection:', reason);
    notifyAdmin(reason instanceof Error ? reason : new Error(String(reason)), {
        function: 'unhandledRejection',
        promise: promise
    });
});

process.on('SIGTERM', function() {
    console.log('Получен SIGTERM, завершаю работу...');
    server.close(function() {
        console.log('Сервер остановлен');
        process.exit(0);
    });
});

process.on('SIGINT', function() {
    console.log('Получен SIGINT, завершаю работу...');
    server.close(function() {
        console.log('Сервер остановлен');
        process.exit(0);
    });
});

setTimeout(async function() {
    try {
        console.log('Запуск первоначальных проверок...');
        await runNewsBackgroundUpdate();
        await runVipReminderCheck();
        await checkExpiringPlans();
        await cleanPlanCache();
        console.log('Первоначальные проверки завершены');
    } catch (error) {
        console.error('Ошибка первоначальных проверок:', error);
    }
}, 10000);

console.log('БОТ VOID NODE УСПЕШНО ЗАПУЩЕН!');
console.log('Защита активна');
console.log('AI-модуль подключен');
console.log('Холодный душ готов');
console.log('Автоторговля активна');
