// ============================================================
// БОТ VOID NODE — ПОЛНАЯ ВЕРСИЯ 4.0 (ЧАСТЬ 1/6)
// ============================================================

// ============================================================
// 1. ПОДКЛЮЧЕНИЕ ЗАВИСИМОСТЕЙ
// ============================================================
require('dotenv').config();
const express = require('express');
const ccxt = require('ccxt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Redis } = require('@upstash/redis');

// ============================================================
// 2. ПОДКЛЮЧЕНИЕ ЛОГГЕРА
// ============================================================
require('./logger');

// ============================================================
// 3. КОНФИГУРАЦИЯ (ВСЕ КЛЮЧИ ИЗ .ENV)
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
const PORT = process.env.PORT || 3000;

const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не найден в переменных окружения!');
    process.exit(1);
}
if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    console.error('❌ UPSTASH_REDIS_REST_URL или TOKEN не найдены в переменных окружения!');
    process.exit(1);
}

// ============================================================
// 4. КОНСТАНТЫ КОНФИГУРАЦИИ
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
// 5. REDIS-ХРАНИЛИЩЕ (ВСЕ ДАННЫЕ СОХРАНЯЮТСЯ)
// ============================================================
class RedisStorage {
    constructor() {
        this.redis = new Redis({
            url: UPSTASH_REDIS_REST_URL,
            token: UPSTASH_REDIS_REST_TOKEN,
        });
        this.localCache = new Map();
        console.log('✅ Redis подключен');
    }

    async get(key) {
        try {
            // Сначала пробуем Redis
            const data = await this.redis.get(key);
            if (data !== null && data !== undefined) {
                return data;
            }
            // Если в Redis нет — пробуем локальный кэш
            if (this.localCache.has(key)) {
                return this.localCache.get(key);
            }
            return null;
        } catch (error) {
            console.error('❌ Redis get error:', error);
            // При ошибке Redis — используем локальный кэш
            return this.localCache.get(key) || null;
        }
    }

    async put(key, value, ttl = null) {
        try {
            await this.redis.set(key, value);
            if (ttl) {
                await this.redis.expire(key, ttl);
            }
            // Сохраняем в локальный кэш
            this.localCache.set(key, value);
        } catch (error) {
            console.error('❌ Redis set error:', error);
            // При ошибке Redis — сохраняем только в локальный кэш
            this.localCache.set(key, value);
        }
    }

    async delete(key) {
        try {
            await this.redis.del(key);
            this.localCache.delete(key);
        } catch (error) {
            console.error('❌ Redis delete error:', error);
            this.localCache.delete(key);
        }
    }

    async list(prefix = '') {
        try {
            const keys = await this.redis.keys(`${prefix}*`);
            return { keys: keys.map(k => ({ name: k })) };
        } catch (error) {
            console.error('❌ Redis list error:', error);
            // При ошибке Redis — возвращаем пустой список
            return { keys: [] };
        }
    }
}

const VOID_KV = new RedisStorage();

// ============================================================
// 6. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ KV
// ============================================================
async function getData(key) {
    return await VOID_KV.get(key);
}
async function setData(key, value, ttl = null) {
    await VOID_KV.put(key, value, ttl);
}
async function deleteData(key) {
    await VOID_KV.delete(key);
}

// ============================================================
// 7. FETCH С RETRY ЛОГИКОЙ
// ============================================================
async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response;
        } catch (error) {
            lastError = error;
            console.warn(`⚠️ Попытка ${i + 1}/${retries} не удалась: ${error.message}`);
            if (i < retries - 1) {
                const waitTime = delay * Math.pow(2, i);
                await new Promise(r => setTimeout(r, waitTime));
            }
        }
    }
    throw lastError;
}

// ============================================================
// 8. ОТПРАВКА ОШИБОК АДМИНУ (МОНИТОРИНГ)
// ============================================================
const errorCache = new Map();

async function notifyAdmin(error, context = {}) {
    if (!ADMIN_CHAT_ID || ADMIN_CHAT_ID === 'ваш_telegram_id') {
        console.warn('⚠️ ADMIN_CHAT_ID не настроен');
        return;
    }

    const errorKey = error.message?.slice(0, 50) || 'unknown';
    const now = Date.now();
    if (errorCache.has(errorKey) && now - errorCache.get(errorKey) < 3600000) {
        return; // Не отправлять ту же ошибку чаще 1 раза в час
    }
    errorCache.set(errorKey, now);

    try {
        const message = `🚨 *КРИТИЧЕСКАЯ ОШИБКА БОТА*\n\n` +
            `📌 *Ошибка:* ${error.message || 'Unknown error'}\n` +
            `📂 *Функция:* ${context.function || 'unknown'}\n` +
            `👤 *Пользователь:* ${context.chatId || 'unknown'}\n` +
            `📅 *Время:* ${new Date().toISOString()}\n` +
            `📋 *Стек:*\n\`\`\`${(error.stack || '').slice(0, 300)}\`\`\``;

        await sendMessage(ADMIN_CHAT_ID, message);
    } catch (e) {
        console.error('❌ Не удалось отправить уведомление админу:', e);
    }
}

// ============================================================
// 9. ШИФРОВАНИЕ (AES-256-GCM)
// ============================================================
function encrypt(text) {
    try {
        const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        const tag = cipher.getAuthTag().toString('base64');
        return `${iv.toString('base64')}:${encrypted}:${tag}`;
    } catch (error) {
        console.error('❌ Ошибка шифрования:', error);
        return null;
    }
}

function decrypt(encoded) {
    try {
        const parts = encoded.split(':');
        if (parts.length !== 3) return null;
        const [ivBase64, encrypted, tagBase64] = parts;
        const iv = Buffer.from(ivBase64, 'base64');
        const tag = Buffer.from(tagBase64, 'base64');
        const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        console.error('❌ Ошибка дешифрования:', error);
        return null;
    }
}

// ============================================================
// 10. ТАРИФЫ (PLANS) — ПОЛНЫЙ ОБЪЕКТ
// ============================================================
const PLANS = {
    TRIAL: {
        id: 'TRIAL',
        name: '🔰 Триал',
        name_en: '🔰 Trial',
        price: 0,
        duration: 7,
        limits: {
            analyze: 2, antiscam: 3, alerts: 0, social: 3, dex: 2,
            news: 2, calendar: 2, search_token: 3, panic: false,
            diary: true, ranking: false, autotrade: false, ai: 0,
            csv: false, kill_switch: false, priority_support: false
        },
        features: [
            '📊 Анализ портфеля (2/день)',
            '🛡️ Антискам-центр (3/день)',
            '📈 Соц.тренды (3/день)',
            '🔍 DEX проверка (2/день)',
            '📰 Новости + AI (2/день)',
            '📅 Календарь трейдера (2/день)',
            '🔎 Поиск токена (3/день)',
            '📝 Дневник настроения',
            '📊 Полный отчет'
        ],
        features_en: [
            '📊 Portfolio analysis (2/day)',
            '🛡️ Anti-scam center (3/day)',
            '📈 Social trends (3/day)',
            '🔍 DEX check (2/day)',
            '📰 News + AI (2/day)',
            '📅 Trader calendar (2/day)',
            '🔎 Token search (3/day)',
            '📝 Mood diary',
            '📊 Full report'
        ]
    },
    START: {
        id: 'START',
        name: '⭐ Старт',
        name_en: '⭐ Start',
        price: 500,
        duration: 30,
        limits: {
            analyze: 10, antiscam: 15, alerts: 3, social: 10, dex: 10,
            news: 10, calendar: 10, search_token: 15, panic: false,
            diary: true, ranking: true, autotrade: false, ai: 5,
            csv: true, kill_switch: false, priority_support: false
        },
        features: [
            '📊 Анализ портфеля (10/день)',
            '🛡️ Антискам-центр (15/день)',
            '🔔 Оповещения (3 шт)',
            '📈 Соц.тренды (10/день)',
            '🔍 DEX проверка (10/день)',
            '📰 Новости + AI (10/день)',
            '📅 Календарь трейдера (10/день)',
            '🔎 Поиск токена (15/день)',
            '📝 Дневник настроения',
            '🏆 Рейтинг',
            '💬 AI-советник (5/день)',
            '📊 Полный отчет + CSV'
        ],
        features_en: [
            '📊 Portfolio analysis (10/day)',
            '🛡️ Anti-scam center (15/day)',
            '🔔 Alerts (3)',
            '📈 Social trends (10/day)',
            '🔍 DEX check (10/day)',
            '📰 News + AI (10/day)',
            '📅 Trader calendar (10/day)',
            '🔎 Token search (15/day)',
            '📝 Mood diary',
            '🏆 Ranking',
            '💬 AI advisor (5/day)',
            '📊 Full report + CSV'
        ]
    },
    PRO: {
        id: 'PRO',
        name: '🚀 PRO',
        name_en: '🚀 PRO',
        price: 1000,
        duration: 30,
        limits: {
            analyze: 30, antiscam: 50, alerts: 15, social: Infinity, dex: Infinity,
            news: Infinity, calendar: Infinity, search_token: Infinity, panic: true,
            diary: true, ranking: true, autotrade: 3, ai: 20,
            csv: true, kill_switch: true, priority_support: false
        },
        features: [
            '📊 Анализ портфеля (30/день)',
            '🛡️ Антискам-центр (50/день)',
            '🔔 Оповещения (15 шт)',
            '📈 Соц.тренды (Безлимит)',
            '🔍 DEX проверка (Безлимит)',
            '📰 Новости + AI (Безлимит)',
            '📅 Календарь трейдера (Безлимит)',
            '🔎 Поиск токена (Безлимит)',
            '❄️ Холодный душ',
            '📝 Дневник настроения',
            '🏆 Рейтинг',
            '🚀 Автоторговля (3/день)',
            '💬 AI-советник (20/день)',
            '📊 Полный отчет + CSV',
            '🆘 Kill Switch'
        ],
        features_en: [
            '📊 Portfolio analysis (30/day)',
            '🛡️ Anti-scam center (50/day)',
            '🔔 Alerts (15)',
            '📈 Social trends (Unlimited)',
            '🔍 DEX check (Unlimited)',
            '📰 News + AI (Unlimited)',
            '📅 Trader calendar (Unlimited)',
            '🔎 Token search (Unlimited)',
            '❄️ Panic mode',
            '📝 Mood diary',
            '🏆 Ranking',
            '🚀 Autotrading (3/day)',
            '💬 AI advisor (20/day)',
            '📊 Full report + CSV',
            '🆘 Kill Switch'
        ]
    },
    VIP: {
        id: 'VIP',
        name: '👑 VIP',
        name_en: '👑 VIP',
        price: 1500,
        duration: 30,
        limits: {
            analyze: Infinity, antiscam: Infinity, alerts: Infinity, social: Infinity, dex: Infinity,
            news: Infinity, calendar: Infinity, search_token: Infinity, panic: true,
            diary: true, ranking: true, autotrade: Infinity, ai: Infinity,
            csv: true, kill_switch: true, priority_support: true
        },
        features: [
            '📊 Анализ портфеля (Безлимит)',
            '🛡️ Антискам-центр (Безлимит)',
            '🔔 Оповещения (Безлимит)',
            '📈 Соц.тренды (Безлимит)',
            '🔍 DEX проверка (Безлимит)',
            '📰 Новости + AI (Безлимит)',
            '📅 Календарь трейдера (Безлимит)',
            '🔎 Поиск токена (Безлимит)',
            '❄️ Холодный душ (Безлимит)',
            '📝 Дневник настроения',
            '🏆 Рейтинг',
            '🚀 Автоторговля (Безлимит)',
            '💬 AI-советник (Безлимит)',
            '📊 Полный отчет + CSV',
            '🆘 Kill Switch',
            '⚡ Приоритетная поддержка 24/7'
        ],
        features_en: [
            '📊 Portfolio analysis (Unlimited)',
            '🛡️ Anti-scam center (Unlimited)',
            '🔔 Alerts (Unlimited)',
            '📈 Social trends (Unlimited)',
            '🔍 DEX check (Unlimited)',
            '📰 News + AI (Unlimited)',
            '📅 Trader calendar (Unlimited)',
            '🔎 Token search (Unlimited)',
            '❄️ Panic mode (Unlimited)',
            '📝 Mood diary',
            '🏆 Ranking',
            '🚀 Autotrading (Unlimited)',
            '💬 AI advisor (Unlimited)',
            '📊 Full report + CSV',
            '🆘 Kill Switch',
            '⚡ 24/7 priority support'
        ]
    }
};

// ============================================================
// БОТ VOID NODE — ПОЛНАЯ ВЕРСИЯ 4.0 (ЧАСТЬ 2/6)
// ============================================================

// ============================================================
// 11. ФУНКЦИИ ТАРИФОВ И ЛИМИТОВ
// ============================================================

async function getUserPlan(chatId) {
    const key = `plan_${chatId}`;
    const data = await getData(key);
    
    if (!data) {
        await activateTrial(chatId);
        return { plan: 'TRIAL', ...PLANS.TRIAL, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
    }
    
    try {
        const parsed = JSON.parse(data);
        const plan = PLANS[parsed.planId];
        if (!plan) {
            await activateTrial(chatId);
            return { plan: 'TRIAL', ...PLANS.TRIAL, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
        }
        
        if (parsed.planId === 'TRIAL' && parsed.expires < Date.now()) {
            return {
                plan: 'NONE',
                name: '❌ Без подписки',
                name_en: '❌ No subscription',
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
        }
        
        if (parsed.planId !== 'TRIAL' && parsed.expires < Date.now()) {
            return {
                plan: 'NONE',
                name: '❌ Без подписки',
                name_en: '❌ No subscription',
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
        }
        
        return {
            plan: parsed.planId,
            ...plan,
            expires: parsed.expires || Date.now() + plan.duration * 24 * 60 * 60 * 1000
        };
    } catch (error) {
        console.error('❌ Ошибка getUserPlan:', error);
        await activateTrial(chatId);
        return { plan: 'TRIAL', ...PLANS.TRIAL, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
    }
}

async function activateTrial(chatId) {
    const key = `plan_${chatId}`;
    await setData(key, JSON.stringify({
        planId: 'TRIAL',
        activatedAt: Date.now(),
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
        trialUsed: true
    }));
}

async function activatePlan(chatId, planId) {
    const plan = PLANS[planId];
    if (!plan) return null;
    const key = `plan_${chatId}`;
    await setData(key, JSON.stringify({
        planId: planId,
        activatedAt: Date.now(),
        expires: Date.now() + plan.duration * 24 * 60 * 60 * 1000
    }));
    return plan;
}

async function checkLimit(chatId, feature) {
    const userPlan = await getUserPlan(chatId);
    const limit = userPlan.limits[feature];
    if (limit === undefined || limit === false) {
        return { allowed: false, reason: `❌ Функция недоступна на тарифе "${userPlan.name}"\n💳 /subscribe` };
    }
    if (limit === Infinity) return { allowed: true };
    const key = `usage_${chatId}_${feature}_${new Date().toISOString().split('T')[0]}`;
    const usage = await getData(key);
    const count = usage ? parseInt(usage) : 0;
    if (count >= limit) {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        const hoursLeft = Math.round((tomorrow - now) / (1000 * 60 * 60));
        return { allowed: false, reason: `📊 *Лимит: ${limit}/день.* Осталось: ${hoursLeft} ч.\n💳 /subscribe`, limit, remaining: 0 };
    }
    await setData(key, (count + 1).toString());
    return { allowed: true, remaining: limit - count - 1, limit };
}

// ============================================================
// 12. ПОРОГИ РИСКА В ЗАВИСИМОСТИ ОТ РЕЖИМА
// ============================================================

function getRiskThresholds(mode) {
    if (mode === 'beginner') {
        return {
            stopLoss: 5,
            takeProfit: 10,
            maxPosition: 10,
            maxAltExposure: 30,
            label: '🔰 Новичок (спокойный)',
            labelEn: '🔰 Beginner (calm)'
        };
    } else {
        return {
            stopLoss: 8,
            takeProfit: 20,
            maxPosition: 15,
            maxAltExposure: 40,
            label: '🚀 Опытный (активный)',
            labelEn: '🚀 Experienced (active)'
        };
    }
}

// ============================================================
// 13. МУЛЬТИЯЗЫЧНОСТЬ (LANGUAGES) — ПОЛНЫЙ ОБЪЕКТ
// ============================================================
const LANGUAGES = {
    ru: {
        // ===== ОБЩИЕ =====
        language_select: '🌍 *Выберите язык / Choose language:*',
        mode_select: '📊 *Выбери свой уровень:*',
        mode_beginner_desc: '🔰 *Новичок*\n• Целевые веса: BTC 50%, Альты 30%, Стейблы 20%\n• Простые рекомендации по портфелю\n• Базовые метрики (риск, распределение)',
        mode_pro_desc: '🚀 *Опытный*\n• Целевые веса: BTC 40%, Альты 40%, Стейблы 20%\n• Расширенные рекомендации\n• Полные метрики (Шарп, RSI, MA20, просадка)',
        mode_select_prompt: '👇 *Выбери режим:*',
        mode_beginner_btn: '🔰 Новичок',
        mode_pro_btn: '🚀 Опытный',
        onboarding_setup: '⚙️ *Настройка бота...*\n\n✅ Язык установлен\n✅ Режим выбран\n✅ Профиль создан\n\n⏳ Завершаем настройку...',
        onboarding_done: '✅ *Готово!* 🎉',
        main_header: (name, mode, id, plan, expires) => `👤 *${name}* | ${mode} | 🆔 ID: ${id}\n💳 Тариф: ${plan} (до ${expires})`,
        main_functions: '📊 Функции',
        main_settings: '⚙️ Настройки',
        main_plans: '💳 Тарифы',
        main_help: '❓ Помощь',
        main_about: 'ℹ️ О боте',
        back_to_menu: '🔙 Назад в меню',
        functions_title: '📊 *Функции*',
        functions_analyze: '📊 Анализ портфеля',
        functions_security: '🛡️ Антискам-центр',
        functions_news: '📰 Новости',
        functions_history: '📋 История',
        back_to_functions: '🔙 Назад к функциям',
        settings_title: '⚙️ *Настройки*',
        settings_lang: '🌍 Язык:',
        settings_mode: '🧠 Режим:',
        settings_change_lang: '🌍 Сменить язык',
        settings_change_mode: '🧠 Сменить режим',
        back_to_settings: '🔙 Назад к настройкам',
        help_menu_title: '❓ *Помощь по боту*\n\nВыберите интересующий вас вопрос:',
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
        back_to_help: '🔙 Назад к помощи',
        help_answer_q1: '🔐 *Как подключить биржу?*\n\n1. Зайдите на биржу (Binance, Bybit, OKX и др.)\n2. Перейдите в раздел управления API\n3. Создайте ключ с правами *только на чтение*\n4. Скопируйте API-ключ и Secret-ключ\n5. Отправьте их в бот командой /connect в формате:\n`API_KEY:SECRET_KEY`\n\n🔒 *Ключи шифруются и не имеют права на вывод средств.*',
        help_answer_q2: '📊 *Как работает анализ портфеля?*\n\nКоманда /analyze запускает полный анализ:\n• Показывает распределение активов (BTC, альты, стейблы)\n• Рассчитывает RSI, скользящие средние (MA20, MA200)\n• Оценивает риск (низкий/средний/высокий)\n• Считает коэффициент Шарпа и VaR\n• Даёт конкретные рекомендации по ребалансировке\n\n📌 После анализа вы можете исполнить рекомендации одним нажатием кнопки.',
        help_answer_q3: '💳 *Какие тарифы доступны?*\n\n🔰 *Триал* — 0 ₽, 7 дней\n• 2 анализа/день, 3 антискам-проверки\n\n⭐ *Старт* — 500 ₽/мес\n• 10 анализов/день, 3 оповещения\n\n🚀 *PRO* — 1 000 ₽/мес\n• 30 анализов/день, 15 оповещений, автоторговля (3/день)\n\n👑 *VIP* — 1 500 ₽/мес\n• ВСЕ БЕЗЛИМИТНО\n• Приоритетная поддержка 24/7\n\nПодробнее: /subscribe',
        help_answer_q4: '🛡️ *Как проверить контракт?*\n\nОтправьте адрес контракта (0x...) в чат – бот проверит:\n• Верификацию на Etherscan\n• Подозрительные паттерны (honeypot)\n• Скоринг риска (0–100 баллов)\n\n📌 Пример: `0x742d35Cc6634C0532925a3b844Bc454e4438f44e`',
        help_answer_q5: '🔔 *Как создать оповещение?*\n\nИспользуйте /alerts или меню *Оповещения*.\n\n5 типов оповещений:\n• 📊 По цене – при достижении заданной цены\n• 📈 По изменению % – при изменении цены более чем на X%\n• 📊 По объёму – при превышении объёма торгов\n• 📰 Новостное – при появлении новостей по вашим активам\n• 📅 Календарное – перед важными экономическими событиями\n\n📌 Лимит зависит от вашего тарифа.',
        help_answer_q6: '🚀 *Как включить автоторговлю?*\n\n/autotrade открывает меню с 3 уровнями:\n\n🛡️ *Уровень 1 (Защита)* – стоп-лоссы 5% и 10%\n🔄 *Уровень 2 (Перераспределение)* – продажа мусора, покупка роста\n🧠 *Уровень 3 (Умный рост)* – трейлинг стоп-лосс, фиксация 30% прибыли\n\n📌 Доступна только на PRO и VIP. Проверка каждые 15 минут.',
        help_answer_q7: '❄️ *Что такое холодный душ?*\n\nЭкстренная защита при падении рынка:\n• Бот проверяет BTC каждые 15 минут\n• При падении >5% за 15 минут – отправляет предупреждение\n• Предлагает конвертировать все активы в USDT\n\n🛡️ Доступен на PRO и VIP. Активируйте командой /panic.',
        help_answer_q8: '📝 *Как работает дневник настроения?*\n\n/diary открывает дневник эмоций.\n\nВыберите настроение:\n😌 Спокоен | 🤔 Задумчив | 😰 Тревожен | 😱 Паника | 😤 Зол | 😊 Эйфория\n\n📌 Бот сохраняет записи. Если вы тревожны 3 дня подряд — бот предупредит вас.',
        help_answer_q9: '🔌 *Как отключить биржу?*\n\n/disconnect или *Настройки* → *Отключить биржу*.\n\nПосле подтверждения API-ключи будут удалены.\n\n📌 Если вы случайно подтвердили, есть 10 секунд на отмену: /undo',
        help_answer_q10: '🤖 *Как использовать AI-советник?*\n\nДоступен двумя способами:\n1. После анализа портфеля нажмите *💬 AI-советник*\n2. В меню *Помощь* → *Задать свой вопрос*\n\n🤖 AI знает ваш портфель и даёт персонализированные советы.\n\n📌 Примеры: "Стоит ли докупить BTC?", "Как снизить риски?"\n\n🔄 Для выхода из AI-режима отправьте /exit.',
        help_contact_moderator_message: '👤 *Связь с модератором*\n\nНапишите @clofeLEAN — он вам поможет!\n\n📌 Также вы можете задать вопрос в нашем чате поддержки:\n📱 [Чат поддержки](https://t.me/void_node_chat)\n\n⏳ Мы отвечаем в течение 15 минут (в рабочее время).',
        market_menu: '📈 *Что вас интересует?*',
        market_social: '📊 Соц.тренды',
        market_news: '📰 Новости',
        market_calendar: '📅 Календарь',
        back_to_market: '🔙 Назад к рынку',
        social_menu: '📊 *Выберите монету:*',
        social_search: '🔎 Найти токен',
        social_analyzing: (coin) => `⏳ Получаю данные по ${coin}...`,
        social_search_prompt: '🔎 *Введите название токена*\n\n📌 Примеры: PEPE, ARB, SOL, DOGE, SHIB\n🔄 /cancel — отмена',
        social_search_invalid: '❌ *Некорректное название токена.*\n\n📌 Введите тикер (например: PEPE, ARB, SOL, DOGE, SHIB).',
        news_analyzing: '📰 Получаю новости...',
        news_empty: '📭 Новостей не найдено.',
        news_coin: (coin) => `📰 *НОВОСТИ: ${coin}*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`,
        news_personalized_header: '📰 *НОВОСТИ ДЛЯ ТВОЕГО ПОРТФЕЛЯ*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n',
        news_no_assets: '❌ Сначала выполни /analyze, чтобы я знал твой портфель.',
        news_no_news: '📭 Новостей по твоим активам не найдено.',
        calendar_analyzing: '📅 Формирую календарь...',
        calendar_empty: '📭 На эту неделю важных событий не найдено.',
        calendar_pro_only: '❌ *Календарь трейдера доступен на тарифах PRO и VIP.*\n\n💳 /subscribe',
        calendar_result: (events) => {
            if (!events || events.length === 0) return '📭 На эту неделю важных событий не найдено.';
            let result = '📅 *КАЛЕНДАРЬ ТРЕЙДЕРА*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
            for (const event of events.slice(0, 10)) {
                result += `📌 *${event.title || 'Событие'}*\n`;
                result += `📅 ${event.date || 'Дата неизвестна'}\n`;
                if (event.importance) result += `⭐ Важность: ${event.importance}\n`;
                if (event.impact) result += `📊 Влияние: ${event.impact}\n`;
                result += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
            }
            return result;
        },
        settings_old: '⚙️ *Настройки*',
        settings_lang_old: '🌍 Язык',
        settings_mode_old: '🧠 Режим',
        settings_lang_selected: (lang) => `✅ Язык: ${lang}`,
        settings_mode_selected: (mode) => `✅ Режим: ${mode}`,
        settings_mode_beginner_old: '🔰 Новичок',
        settings_mode_pro_old: '🚀 Опытный',
        history_title: '📋 *ИСТОРИЯ*',
        history_empty: '📭 История пуста.',
        history_item: (date, action, detail) => `📌 ${date}\n• ${action}\n  ${detail}\n`,
        history_analyze: '📊 Анализ портфеля',
        history_antiscam: '🛡️ Проверка безопасности',
        history_social: '📈 Соц.тренды',
        history_news: '📰 Новости',
        history_calendar: '📅 Календарь',
        mood_title: '📝 *Как настроение?*',
        mood_saved: '✅ *Сохранено!*',
        mood_warning: (days) => `⚠️ *Внимание!*\n\nТы тревожен ${days} день подряд.\nВ таком состоянии опасно торговать.\n\n🛡️ Рекомендую:\n• Сделать перерыв\n• Включить режим HODL\n• Не принимать решений до завтра`,
        mood_calm: '😌 Спокоен',
        mood_thoughtful: '🤔 Задумчив',
        mood_anxious: '😰 Тревожен',
        mood_panic: '😱 Паника',
        mood_angry: '😤 Зол',
        mood_euphoric: '😊 Эйфория',
        plans_title: '💳 *Тарифы*',
        plans_current: (plan, expires) => `📊 ${plan}\n📅 До: ${expires}`,
        plans_trial: '🔰 Триал — 0 ₽\n   • 7 дней\n   • Базовые функции',
        plans_start: '⭐ Старт — 500 ₽/мес\n   • 10 анализов/день\n   • Антискам (15/день)',
        plans_pro: '🚀 PRO — 1 000 ₽/мес 🔥\n   • 30 анализов/день\n   • Безлимитные тренды\n   • Холодный душ',
        plans_vip: '👑 VIP — 1 500 ₽/мес\n   • ВСЕ БЕЗЛИМИТНО\n   • Поддержка 24/7',
        plans_select: '👇 *Выбери тариф:*',
        plans_payment_creating: '⏳ Создаю счёт...',
        plans_payment_error: '❌ Ошибка создания счёта.',
        plans_success: (plan) => `✅ *${plan} активирован!*`,
        plans_already: (plan) => `ℹ️ У вас уже активен ${plan}`,
        plans_not_found: '❌ Тариф не найден.',
        plans_trial_used: '❌ Триал уже использован.\n💳 /subscribe',
        plans_trial_success: '🎉 *Триал активирован на 7 дней!*',
        plans_payment_title: (plan) => `ОПЛАТА ${plan}`,
        days: 'дней',
        plans_features: 'Функции',
        plans_payment_methods: 'Способы оплаты',
        plans_payment_crypto: 'Криптовалюта (USDT, BTC, TON)',
        plans_payment_card: 'Банковская карта',
        plans_payment_note: 'После оплаты тариф активируется автоматически.',
        plan_trial_name: '🔰 Триал',
        plan_start_name: '⭐ Старт',
        plan_pro_name: '🚀 PRO',
        plan_vip_name: '👑 VIP',
        error_exchange: '⚠️ *Биржа не отвечает.* Попробуй через минуту.',
        error_api_key: '❌ *Неверный ключ.* Проверь инструкцию: /connect',
        error_general: (err) => `❌ *Ошибка:* ${err}`,
        cooldown: (sec) => `⏳ Подожди ${sec} сек.`,
        no_keys: '🔐 *Подключи биржу:* /connect',
        no_analysis_data: '❌ *Нет данных.* Выполни /analyze',
        ai_mode: '🤖 *Задай вопрос по портфелю*\nДля выхода: /exit',
        ai_thinking: '🤔 *Думаю...*',
        ai_exit: '✅ *Выход из AI.*',
        export_error: '❌ *Ошибка CSV.*',
        issues_found: '🔍 *Проблемы:*',
        suggested_actions: '💡 *Рекомендации:*',
        disconnect_success: '🔌 *Биржа отключена.*',
        default_response: (text) => `Ты написал: "${text}"\n\n🤔 Нажми /help`,
        no_coins: '📭 *На балансе нет монет.*',
        risk_high: '🔴 Высокий риск',
        risk_medium: '🟡 Средний риск',
        risk_low: '🟢 Низкий риск',
        wallet_invalid: '❌ *Неверный адрес кошелька.*\n\nОтправь адрес, начинающийся с 0x...',
        wallet_balance: (balance, price) => `💰 *Баланс:* ${balance} ETH (≈ $${price})`,
        wallet_tokens: (tokens) => `🪙 *Токены:* ${tokens} разных токенов`,
        wallet_risk_label: (risk) => `Риск: ${risk}`,
        wallet_risk_high: '🔴 Высокий',
        wallet_risk_medium: '🟡 Средний',
        wallet_risk_low: '🟢 Низкий',
        wallet_no_risks: 'Рисков не обнаружено',
        wallet_recommendations: '💡 *Рекомендации:*',
        wallet_connect: '🔐 Подключить биржу',
        kill_switch_activated: '🛑 *KILL SWITCH АКТИВИРОВАН*\n\n• Ордера отменены\n• Ключи удалены\n• Бот заблокирован\n\nДля разблокировки: /reset',
        kill_switch_cancel: '❌ *Отменён.*',
        kill_switch_no_keys: 'ℹ️ *Нет биржи.*',
        kill_switch_blocked: '🛑 *Бот заблокирован.*\nДля разблокировки: /reset',
        kill_switch_reset: '✅ *Бот разблокирован.*\n\nПодключи биржу: /connect',
        kill_switch_confirm_yes: '🛑 ДА, ОСТАНОВИТЬ',
        kill_switch_confirm_no: '❌ Отмена',
        kill_switch_pro_only: '❌ *Kill Switch доступен на PRO и VIP.*\n💳 /subscribe',
        kill_switch_confirmation: '⚠️ *ПОДТВЕРДИ KILL SWITCH*\n\nЭто действие НЕОБРАТИМО!\n\n• Все ордера будут отменены\n• Ключи будут удалены\n• Бот будет заблокирован',
        share_title: '📤 *Поделиться Void Node*',
        share_text: '🛡️ *Void Node — твой крипто-телохранитель*\n\n• Анализ портфеля за 1 минуту\n• Антискам-центр\n• Соц.тренды\n• Календарь трейдера\n• AI-советник\n\n🚀 Присоединяйся: @void_node_bot',
        share_link: (ref) => `🔗 Твоя реферальная ссылка:\nhttps://t.me/${BOT_USERNAME}?start=ref_${ref}`,
        help_title: '🤖 *УМНАЯ ПОМОЩЬ*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n💬 *Просто напиши свой вопрос, и я отвечу!*\n🔄 Для выхода: /exit',
        help_ask: '💬 Задать свой вопрос',
        help_how_check: '🔍 Как проверить токен?',
        help_sharpe: '📊 Коэффициент Шарпа',
        help_connect: '🔐 Подключить биржу',
        help_antiscam: '🛡️ Антискам-центр',
        help_panic: '❄️ Холодный душ',
        help_plans: '💳 Тарифы',
        help_out_of_scope: '🤖 *Я помогаю только с вопросами о боте Void Node!*',
        help_ask_prompt: '💬 *Напиши свой вопрос*\n\n📝 Я отвечу на него максимально подробно.\n🔄 Для выхода из режима помощи отправь /exit',
        alert_menu: '🔔 *Оповещения*\n\nВыберите тип оповещения:',
        alert_price: '📊 По цене',
        alert_change: '📈 По изменению %',
        alert_volume: '📊 По объёму',
        alert_news: '📰 Новостное',
        alert_calendar: '📅 Календарное',
        alert_create_price: '📊 *Создать ценовое оповещение*\n\nВведите символ и цену в формате:\n`BTC 70000` (выше) или `BTC 65000 below`',
        alert_create_change: '📈 *Создать оповещение по изменению %*\n\nВведите символ и % в формате:\n`BTC 5` (изменение >5% за час)',
        alert_created: '✅ Оповещение создано!',
        alert_list: '📋 *Ваши оповещения:*\n',
        alert_deleted: '✅ Оповещение удалено.',
        autotrade_menu: '🚀 *Автоторговля*\n\nВыберите уровень сложности:',
        autotrade_level1: '🛡️ Уровень 1 (Защита)',
        autotrade_level2: '🔄 Уровень 2 (Перераспределение)',
        autotrade_level3: '🧠 Уровень 3 (Умный рост)',
        autotrade_active: '✅ Автоторговля активирована (уровень {level})',
        autotrade_stopped: '⏹️ Автоторговля остановлена.',
        autotrade_pro_only: '❌ Автоторговля доступна только PRO и VIP.',
        panic_start: '❄️ *Холодный душ активирован.*\n\nБуду отслеживать BTC каждые 15 минут. При падении >5% за 15 минут – предложу конвертацию в стейблы.',
        panic_stop: '❄️ Холодный душ остановлен.',
        panic_trigger: '🚨 *Холодный душ сработал!*\n\nBTC упал на {percent}% за последние 15 минут.\n\n⚠️ Рекомендуется конвертировать часть портфеля в стейблы.',
        panic_convert: '🔄 Конвертировать в стейблы',
        panic_converted: '✅ Конвертация выполнена. Портфель в безопасности.',
        back_to_security: '🔙 Назад к безопасности',
        back_to_plans: '🔙 Назад к тарифам',
        back_to_history: '🔙 Назад к истории',
        back_to_analyze: '🔙 Назад к анализу',
        about_title: 'ℹ️ *О БОТЕ*\n━━━━━━━━━━━━━━━━━━━━━━━',
        about_version: '📌 *Версия:* 2.0.0',
        about_created: '📅 *Создан:* 2024',
        about_dev: '👨‍💻 *Разработчик:* @void_node_dev',
        about_instruction: '📖 *ИНСТРУКЦИЯ:*\n\n1️⃣ **Подключи биржу** /connect\n2️⃣ **Анализируй портфель** /analyze\n3️⃣ **Проверяй безопасность** — отправь ссылку или контракт\n4️⃣ **Следи за рынком** /news\n5️⃣ **Получи AI-совет** /help',
        about_links: '🔗 *ПОЛЕЗНЫЕ ССЫЛКИ:*\n\n📱 [Telegram](https://t.me/void_node_bot)',
        about_commands: '⚡ *Быстрые команды:*\n/analyze — анализ портфеля\n/connect — подключить биржу\n/news — новости, тренды, календарь\n/help — умная помощь',
        menu: '🔮 *Void Node — твой крипто-телохранитель*\n\n🏠 *Главное меню:*',
        main_analyze: '📊 Анализ портфеля',
        main_security: '🛡️ Безопасность',
        main_market: '📈 Рынок',
        main_settings_old: '⚙️ Настройки',
        main_plans_old: '💳 Тарифы',
        main_history_old: '📋 История',
        main_help_old: '❓ Помощь',
        greeting_morning: (name) => `☀️ *Доброе утро, ${name}!*`,
        greeting_afternoon: (name) => `☀️ *Добрый день, ${name}!*`,
        greeting_evening: (name) => `🌙 *Добрый вечер, ${name}!*`,
        onboard: `👋 *Добро пожаловать в Void Node!*\n\nЯ — *твой крипто-телохранитель* 🛡️\n\n🔐 Начни с подключения биржи: /connect\n🛡️ Или отправь мне ссылку или адрес контракта — я проверю!`,
        onboard_skip: '⏭️ Пропустить',
        onboard_start: '🚀 Начать!',
        connect_prompt: '🔐 *Подключи биржу*\n\n📋 Отправь API-ключи в формате:\n`API_KEY:SECRET_KEY`\n\n🔄 Для отмены: /cancel',
        connect_success: (exchange) => `✅ *Биржа ${exchange} подключена!*\n\n📊 Теперь отправь /analyze`,
        connect_fail: '❌ *Не удалось подключить биржу.*\n\nПроверь ключи и попробуй ещё раз.',
        connect_cancel: '❌ *Подключение отменено.*',
        connect_confirm: '⚠️ *Точно отключить биржу?*\n\nВсе ключи будут удалены.',
        connect_confirm_yes: '✅ Да, отключить',
        connect_confirm_no: '❌ Нет, оставить',
        connect_undo: '⏳ Ключи будут удалены через 10 секунд. Отмена: /undo',
        connect_undo_success: '✅ *Отмена выполнена!* Ключи сохранены.',
        connect_disconnected: '🔌 *Биржа отключена.* Все ключи удалены.',
        invalid_format: '❌ *Неверный формат!* Отправь ключи как `API_KEY:SECRET_KEY`.',
        analyzing_step: (step, total, text) => `⏳ [${step}/${total}] ${text}...`,
        analyzing_done: '✅ *Анализ завершён!*',
        analyzing_no_keys: '🔐 *Сначала подключи биржу.* /connect',
        analyzing_limit: (limit, remaining) => `📊 *Лимит: ${limit}/день.* Осталось: ${remaining}\n💳 /subscribe`,
        security_menu: '🛡️ *Что проверить?*',
        security_link: '🔗 Ссылку',
        security_contract: '📄 Контракт',
        security_file: '📁 Файл',
        security_dex: '🔍 DEX',
        security_impersonation: '🔄 Аккаунт',
        security_wallet: '👛 Кошелек',
        scan_link: '🔗 *Отправь ссылку для проверки*\n🔄 /cancel — отмена',
        scan_contract: '📄 *Отправь адрес контракта (0x...)*\n🔄 /cancel — отмена',
        scan_file: '📁 *Отправь файл для проверки*\n🔄 /cancel — отмена',
        dex_prompt: '🔍 *Отправь адрес контракта для DEX проверки*\n🔄 /cancel — отмена',
        impersonation_prompt: '🔄 *Перешли сообщение от подозрительного пользователя*\n🔄 /cancel — отмена',
        wallet_prompt: '👛 *Отправь адрес кошелька для проверки*\n📌 Пример: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e\n🔄 /cancel — отмена',
        scan_link_invalid: '❌ Отправьте ссылку, начинающуюся с http:// или https://',
        scan_contract_invalid: '❌ Отправьте адрес контракта (0x...)',
        scan_file_invalid: '❌ Отправьте файл для проверки.',
        scan_impersonation_invalid: '❌ Перешлите сообщение от подозрительного пользователя.',
        scan_timeout: '⏱️ *Проверка заняла слишком много времени.*',
        scan_cancelled: '❌ *Проверка отменена.*',
        scan_safe: '🟢 *БЕЗОПАСНО*',
        scan_danger: '🔴 *ОПАСНО*',
        scan_result_safe: (type) => `🟢 *БЕЗОПАСНО*\n\n${type} не содержит угроз.`,
        scan_result_danger: (type, reason) => `🔴 *ОПАСНО*\n\n${type} содержит угрозы:\n${reason}`,
    },
    en: {
        // Полный английский перевод (все ключи из ru)
        language_select: '🌍 *Choose language:*',
        mode_select: '📊 *Choose your level:*',
        mode_beginner_desc: '🔰 *Beginner*\n• Target weights: BTC 50%, Alts 30%, Stable 20%\n• Simple portfolio recommendations\n• Basic metrics (risk, allocation)',
        mode_pro_desc: '🚀 *Experienced*\n• Target weights: BTC 40%, Alts 40%, Stable 20%\n• Advanced recommendations\n• Full metrics (Sharpe, RSI, MA20, drawdown)',
        mode_select_prompt: '👇 *Select mode:*',
        mode_beginner_btn: '🔰 Beginner',
        mode_pro_btn: '🚀 Experienced',
        onboarding_setup: '⚙️ *Setting up bot...*\n\n✅ Language set\n✅ Mode selected\n✅ Profile created\n\n⏳ Finishing setup...',
        onboarding_done: '✅ *Done!* 🎉',
        main_header: (name, mode, id, plan, expires) => `👤 *${name}* | ${mode} | 🆔 ID: ${id}\n💳 Plan: ${plan} (until ${expires})`,
        main_functions: '📊 Functions',
        main_settings: '⚙️ Settings',
        main_plans: '💳 Plans',
        main_help: '❓ Help',
        main_about: 'ℹ️ About',
        back_to_menu: '🔙 Back to menu',
        functions_title: '📊 *Functions*',
        functions_analyze: '📊 Analyze portfolio',
        functions_security: '🛡️ Anti-scam center',
        functions_news: '📰 News',
        functions_history: '📋 History',
        back_to_functions: '🔙 Back to functions',
        settings_title: '⚙️ *Settings*',
        settings_lang: '🌍 Language:',
        settings_mode: '🧠 Mode:',
        settings_change_lang: '🌍 Change language',
        settings_change_mode: '🧠 Change mode',
        back_to_settings: '🔙 Back to settings',
        help_menu_title: '❓ *Help*\n\nSelect a question:',
        help_q1: '🔐 How to connect exchange?',
        help_q2: '📊 How does portfolio analysis work?',
        help_q3: '💳 What plans are available?',
        help_q4: '🛡️ How to check a contract?',
        help_q5: '🔔 How to create an alert?',
        help_q6: '🚀 How to enable autotrading?',
        help_q7: '❄️ What is Panic mode?',
        help_q8: '📝 How does mood diary work?',
        help_q9: '🔌 How to disconnect exchange?',
        help_q10: '🤖 How to use AI advisor?',
        help_contact_moderator: '👤 Contact moderator',
        back_to_help: '🔙 Back to help',
        help_answer_q1: '🔐 *How to connect exchange?*\n\n1. Go to your exchange (Binance, Bybit, OKX, etc.)\n2. Go to API management section\n3. Create a key with *read-only* permissions\n4. Copy API key and Secret key\n5. Send them to bot with /connect in format:\n`API_KEY:SECRET_KEY`\n\n🔒 *Keys are encrypted and have no withdrawal rights.*',
        help_answer_q2: '📊 *How does portfolio analysis work?*\n\n/analyze runs a full portfolio analysis:\n\n• Shows asset allocation (BTC, alts, stablecoins)\n• Calculates RSI, moving averages (MA20, MA200)\n• Evaluates risk (low/medium/high)\n• Calculates Sharpe ratio and VaR\n• Gives specific rebalancing recommendations\n\n📌 After analysis you can execute recommendations with one click.',
        help_answer_q3: '💳 *What plans are available?*\n\n🔰 *Trial* — 0 ₽, 7 days\n• 2 analyses/day, 3 anti-scam checks\n\n⭐ *Start* — 500 ₽/mo\n• 10 analyses/day, 3 alerts\n\n🚀 *PRO* — 1 000 ₽/mo\n• 30 analyses/day, 15 alerts, autotrading (3/day)\n\n👑 *VIP* — 1 500 ₽/mo\n• ALL UNLIMITED\n• 24/7 priority support\n\nDetails: /subscribe',
        help_answer_q4: '🛡️ *How to check a contract?*\n\nYou can check a smart contract in several ways:\n\n1. Send contract address (0x...) in chat – bot will check automatically\n2. Use *Security* menu → *Contract*\n3. Use *Security* menu → *DEX* – shows liquidity and risks\n\n🔍 Bot checks:\n• Verification on Etherscan\n• Suspicious patterns (honeypot)\n• Risk scoring (0–100)\n\n📌 Example: `0x742d35Cc6634C0532925a3b844Bc454e4438f44e`',
        help_answer_q5: '🔔 *How to create an alert?*\n\nUse /alerts or *Alerts* menu.\n\n5 alert types available:\n• 📊 Price – triggers at target price\n• 📈 Change % – triggers when price changes by X%\n• 📊 Volume – triggers when trading volume exceeds\n• 📰 News – triggers when news appear for your assets\n• 📅 Calendar – before important economic events\n\n📌 Limit depends on your plan.\nYou can view and delete alerts via menu.',
        help_answer_q6: '🚀 *How to enable autotrading?*\n\n/autotrade opens menu with 3 levels:\n\n🛡️ *Level 1 (Protection)* – sets stop-losses at 5% and 10% drops\n\n🔄 *Level 2 (Reallocation)* – sells junk tokens and buys growing ones\n\n🧠 *Level 3 (Smart Growth)* – uses trailing stop-loss and locks 30% profit at >20% growth\n\n📌 Autotrading checks portfolio every 15 minutes. Available only on PRO and VIP.',
        help_answer_q7: '❄️ *What is Panic mode?*\n\nPanic mode is emergency protection during market crashes.\n\n• Bot checks BTC price every 15 minutes\n• If drop >5% in 15 minutes – sends warning\n• Offers one-click conversion of all assets to USDT\n\n🛡️ Helps preserve capital during crashes.\n\nAvailable on PRO and VIP. Activate with /panic.',
        help_answer_q8: '📝 *How does mood diary work?*\n\n/diary opens emotion diary.\n\nChoose your current mood:\n😌 Calm | 🤔 Thoughtful | 😰 Anxious | 😱 Panic | 😤 Angry | 😊 Euphoric\n\n📌 Bot saves entries and analyzes them.\nIf you\'re anxious for 3 days in a row – bot warns you not to trade.\n\n💡 Helps control psychological state and avoid impulsive decisions.',
        help_answer_q9: '🔌 *How to disconnect exchange?*\n\n/disconnect or *Settings* → *Disconnect exchange*.\n\nAfter confirmation:\n• API keys will be deleted\n• Bot will stop analyzing portfolio\n• All portfolio data will be erased\n\n⚠️ You can always reconnect with /connect.\n\n📌 If you accidentally confirmed, you have 10 seconds to undo: /undo',
        help_answer_q10: '🤖 *How to use AI advisor?*\n\nAI advisor is available in two ways:\n\n1. After portfolio analysis press *💬 AI advisor*\n2. In main menu choose *Help* → *Ask your question*\n\n🤖 AI knows your portfolio and gives personalized advice.\n\n📌 Example questions:\n• "Should I buy more BTC?"\n• "How to reduce risks?"\n• "What to do with altcoins?"\n\n💡 All answers include consequences, risks, and alternatives.\n\n🔄 To exit AI mode send /exit.',
        help_contact_moderator_message: '👤 *Contact moderator*\n\nWrite to @clofeLEAN — he will help you!\n\n📌 Also you can ask in our support chat:\n📱 [Support chat](https://t.me/void_node_chat)\n\n⏳ We reply within 15 minutes (working hours).\n\n🔄 VIP users have 24/7 priority support.',
        market_menu: '📈 *What interests you?*',
        market_social: '📊 Social trends',
        market_news: '📰 News',
        market_calendar: '📅 Calendar',
        back_to_market: '🔙 Back to market',
        social_menu: '📊 *Select coin:*',
        social_search: '🔎 Find token',
        social_analyzing: (coin) => `⏳ Getting data for ${coin}...`,
        social_search_prompt: '🔎 *Enter token name*\n\n📌 Examples: PEPE, ARB, SOL, DOGE, SHIB\n🔄 /cancel — cancel',
        social_search_invalid: '❌ *Invalid token name.*\n\n📌 Enter a ticker (e.g., PEPE, ARB, SOL, DOGE, SHIB).',
        news_analyzing: '📰 Fetching news...',
        news_empty: '📭 No news found.',
        news_coin: (coin) => `📰 *NEWS: ${coin}*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`,
        news_personalized_header: '📰 *NEWS FOR YOUR PORTFOLIO*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n',
        news_no_assets: '❌ Please run /analyze first so I know your portfolio.',
        news_no_news: '📭 No news found for your assets.',
        calendar_analyzing: '📅 Generating calendar...',
        calendar_empty: '📭 No important events this week.',
        calendar_pro_only: '❌ *Trader Calendar available on PRO and VIP plans.*\n\n💳 /subscribe',
        calendar_result: (events) => {
            if (!events || events.length === 0) return '📭 No important events this week.';
            let result = '📅 *TRADER CALENDAR*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
            for (const event of events.slice(0, 10)) {
                result += `📌 *${event.title || 'Event'}*\n`;
                result += `📅 ${event.date || 'Date unknown'}\n`;
                if (event.importance) result += `⭐ Importance: ${event.importance}\n`;
                if (event.impact) result += `📊 Impact: ${event.impact}\n`;
                result += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
            }
            return result;
        },
        settings_old: '⚙️ *Settings*',
        settings_lang_old: '🌍 Language',
        settings_mode_old: '🧠 Mode',
        settings_lang_selected: (lang) => `✅ Language: ${lang}`,
        settings_mode_selected: (mode) => `✅ Mode: ${mode}`,
        settings_mode_beginner_old: '🔰 Beginner',
        settings_mode_pro_old: '🚀 Pro',
        history_title: '📋 *HISTORY*',
        history_empty: '📭 History is empty.',
        history_item: (date, action, detail) => `📌 ${date}\n• ${action}\n  ${detail}\n`,
        history_analyze: '📊 Portfolio analysis',
        history_antiscam: '🛡️ Security check',
        history_social: '📈 Social trends',
        history_news: '📰 News',
        history_calendar: '📅 Calendar',
        mood_title: '📝 *How are you feeling?*',
        mood_saved: '✅ *Saved!*',
        mood_warning: (days) => `⚠️ *Warning!*\n\nYou\'ve been anxious for ${days} days in a row.\nIt\'s dangerous to trade in this state.\n\n🛡️ I recommend:\n• Take a break\n• Enable HODL mode\n• Don\'t make decisions until tomorrow`,
        mood_calm: '😌 Calm',
        mood_thoughtful: '🤔 Thoughtful',
        mood_anxious: '😰 Anxious',
        mood_panic: '😱 Panic',
        mood_angry: '😤 Angry',
        mood_euphoric: '😊 Euphoric',
        plans_title: '💳 *Plans*',
        plans_current: (plan, expires) => `📊 ${plan}\n📅 Until: ${expires}`,
        plans_trial: '🔰 Trial — 0 ₽\n   • 7 days\n   • Basic features',
        plans_start: '⭐ Start — 500 ₽/mo\n   • 10 analyses/day\n   • Anti-scam (15/day)',
        plans_pro: '🚀 PRO — 1 000 ₽/mo 🔥\n   • 30 analyses/day\n   • Unlimited trends\n   • Panic mode',
        plans_vip: '👑 VIP — 1 500 ₽/mo\n   • UNLIMITED\n   • 24/7 support',
        plans_select: '👇 *Select plan:*',
        plans_payment_creating: '⏳ Creating invoice...',
        plans_payment_error: '❌ Payment error.',
        plans_success: (plan) => `✅ *${plan} activated!*`,
        plans_already: (plan) => `ℹ️ You already have ${plan}`,
        plans_not_found: '❌ Plan not found.',
        plans_trial_used: '❌ Trial already used.\n💳 /subscribe',
        plans_trial_success: '🎉 *Trial activated for 7 days!*',
        plans_payment_title: (plan) => `PAYMENT ${plan}`,
        days: 'days',
        plans_features: 'Features',
        plans_payment_methods: 'Payment methods',
        plans_payment_crypto: 'Cryptocurrency (USDT, BTC, TON)',
        plans_payment_card: 'Bank card',
        plans_payment_note: 'After payment, the plan will be activated automatically.',
        plan_trial_name: '🔰 Trial',
        plan_start_name: '⭐ Start',
        plan_pro_name: '🚀 PRO',
        plan_vip_name: '👑 VIP',
        error_exchange: '⚠️ *Exchange not responding.* Try again in a minute.',
        error_api_key: '❌ *Invalid key.* Check instructions: /connect',
        error_general: (err) => `❌ *Error:* ${err}`,
        cooldown: (sec) => `⏳ Wait ${sec} sec.`,
        no_keys: '🔐 *Connect exchange:* /connect',
        no_analysis_data: '❌ *No data.* Run /analyze',
        ai_mode: '🤖 *Ask about your portfolio*\nTo exit: /exit',
        ai_thinking: '🤔 *Thinking...*',
        ai_exit: '✅ *Exited AI.*',
        export_error: '❌ *CSV error.*',
        issues_found: '🔍 *Issues:*',
        suggested_actions: '💡 *Recommendations:*',
        disconnect_success: '🔌 *Exchange disconnected.*',
        default_response: (text) => `You wrote: "${text}"\n\n🤔 Press /help`,
        no_coins: '📭 *No coins in balance.*',
        risk_high: '🔴 High risk',
        risk_medium: '🟡 Medium risk',
        risk_low: '🟢 Low risk',
        wallet_invalid: '❌ *Invalid wallet address.*\n\nSend a valid address starting with 0x...',
        wallet_balance: (balance, price) => `💰 *Balance:* ${balance} ETH (≈ $${price})`,
        wallet_tokens: (tokens) => `🪙 *Tokens:* ${tokens} different tokens`,
        wallet_risk_label: (risk) => `Risk: ${risk}`,
        wallet_risk_high: '🔴 High',
        wallet_risk_medium: '🟡 Medium',
        wallet_risk_low: '🟢 Low',
        wallet_no_risks: 'No risks detected',
        wallet_recommendations: '💡 *Recommendations:*',
        wallet_connect: '🔐 Connect Exchange',
        kill_switch_activated: '🛑 *KILL SWITCH ACTIVATED*\n\n• Orders cancelled\n• Keys deleted\n• Bot locked\n\nTo unlock: /reset',
        kill_switch_cancel: '❌ *Cancelled.*',
        kill_switch_no_keys: 'ℹ️ *No exchange.*',
        kill_switch_blocked: '🛑 *Bot locked.*\nTo unlock: /reset',
        kill_switch_reset: '✅ *Bot unlocked.*\n\nConnect exchange: /connect',
        kill_switch_confirm_yes: '🛑 YES, STOP',
        kill_switch_confirm_no: '❌ Cancel',
        kill_switch_pro_only: '❌ *Kill Switch available on PRO and VIP.*\n💳 /subscribe',
        kill_switch_confirmation: '⚠️ *CONFIRM KILL SWITCH*\n\nThis action is IRREVERSIBLE!\n\n• All orders will be cancelled\n• Keys will be deleted\n• Bot will be locked',
        share_title: '📤 *Share Void Node*',
        share_text: '🛡️ *Void Node — your crypto guardian*\n\n• Portfolio analysis in 1 minute\n• Anti-scam center\n• Social trends\n• Trader calendar\n• AI advisor\n\n🚀 Join: @void_node_bot',
        share_link: (ref) => `🔗 Your referral link:\nhttps://t.me/${BOT_USERNAME}?start=ref_${ref}`,
        help_title: '🤖 *SMART HELP*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n💬 *Just write your question, and I\'ll answer!*\n🔄 To exit: /exit\n\n📌 *Example questions:*\n• "how to check a token?"\n• "what is Sharpe ratio?"\n• "how to connect exchange?"\n• "what does high risk mean?"\n• "how does panic mode work?"\n\n💬 Or choose a common question:',
        help_ask: '💬 Ask your own question',
        help_how_check: '🔍 How to check token?',
        help_sharpe: '📊 Sharpe ratio',
        help_connect: '🔐 Connect exchange',
        help_antiscam: '🛡️ Anti-scam center',
        help_panic: '❄️ Panic mode',
        help_plans: '💳 Plans',
        help_out_of_scope: '🤖 *I only help with questions about the Void Node bot!*\n\n📌 *Ask about one of these features:*\n• 📊 Portfolio analysis\n• 🛡️ Anti-scam center\n• 📈 Social trends\n• 📅 Trader calendar\n• 💳 Plans\n• 🔐 Connect exchange\n• ❄️ Panic mode\n\n💡 For example: "how to connect exchange?" or "what does PRO plan give?"',
        help_ask_prompt: '💬 *Write your question*\n\n📝 I will answer in detail.\n🔄 To exit help mode: /exit\n\n📌 *Examples:*\n• "how to set stop-loss?"\n• "what to do when market drops?"\n• "how does autotrading work?"',
        alert_menu: '🔔 *Alerts*\n\nSelect alert type:',
        alert_price: '📊 Price',
        alert_change: '📈 Change %',
        alert_volume: '📊 Volume',
        alert_news: '📰 News',
        alert_calendar: '📅 Calendar',
        alert_create_price: '📊 *Create price alert*\n\nEnter symbol and price in format:\n`BTC 70000` (above) or `BTC 65000 below`',
        alert_create_change: '📈 *Create change % alert*\n\nEnter symbol and % in format:\n`BTC 5` (change >5% per hour)',
        alert_created: '✅ Alert created!',
        alert_list: '📋 *Your alerts:*\n',
        alert_deleted: '✅ Alert deleted.',
        autotrade_menu: '🚀 *Autotrading*\n\nChoose difficulty level:',
        autotrade_level1: '🛡️ Level 1 (Protection)',
        autotrade_level2: '🔄 Level 2 (Reallocation)',
        autotrade_level3: '🧠 Level 3 (Smart Growth)',
        autotrade_active: '✅ Autotrading activated (level {level})',
        autotrade_stopped: '⏹️ Autotrading stopped.',
        autotrade_pro_only: '❌ Autotrading is available only for PRO and VIP.',
        panic_start: '❄️ *Panic mode activated.*\n\nI will monitor BTC every 15 minutes. If drop >5% in 15 minutes – I will suggest converting to stables.',
        panic_stop: '❄️ Panic mode stopped.',
        panic_trigger: '🚨 *Panic mode triggered!*\n\nBTC dropped by {percent}% in the last 15 minutes.\n\n⚠️ It\'s recommended to convert part of portfolio to stables.',
        panic_convert: '🔄 Convert to stables',
        panic_converted: '✅ Conversion completed. Portfolio is safe.',
        back_to_security: '🔙 Back to Security',
        back_to_plans: '🔙 Back to Plans',
        back_to_history: '🔙 Back to History',
        back_to_analyze: '🔙 Back to Analysis',
        about_title: 'ℹ️ *ABOUT BOT*\n━━━━━━━━━━━━━━━━━━━━━━━',
        about_version: '📌 *Version:* 2.0.0',
        about_created: '📅 *Created:* 2024',
        about_dev: '👨‍💻 *Developer:* @void_node_dev',
        about_instruction: '📖 *INSTRUCTION:*\n\n1️⃣ **Connect exchange** /connect\n2️⃣ **Analyze portfolio** /analyze\n3️⃣ **Check security** — send link or contract\n4️⃣ **Follow market** /news\n5️⃣ **Get AI advice** /help',
        about_links: '🔗 *USEFUL LINKS:*\n\n📱 [Telegram](https://t.me/void_node_bot)',
        about_commands: '⚡ *Quick commands:*\n/analyze — portfolio analysis\n/connect — connect exchange\n/news — news, trends, calendar\n/help — smart help',
        menu: '🔮 *Void Node — your crypto guardian*\n\n🏠 *Main menu:*',
        main_analyze: '📊 Analyze portfolio',
        main_security: '🛡️ Security',
        main_market: '📈 Market',
        main_settings_old: '⚙️ Settings',
        main_plans_old: '💳 Plans',
        main_history_old: '📋 History',
        main_help_old: '❓ Help',
        greeting_morning: (name) => `☀️ *Good morning, ${name}!*`,
        greeting_afternoon: (name) => `☀️ *Good afternoon, ${name}!*`,
        greeting_evening: (name) => `🌙 *Good evening, ${name}!*`,
        onboard: `👋 *Welcome to Void Node!*\n\nI am *your crypto guardian* 🛡️\n\n🔐 Start by connecting exchange: /connect\n🛡️ Or just send me a link or contract address — I\'ll check it!`,
        onboard_skip: '⏭️ Skip',
        onboard_start: '🚀 Start!',
        connect_prompt: '🔐 *Connect exchange*\n\n📋 Send API keys as:\n`API_KEY:SECRET_KEY`\n\n🔄 To cancel: /cancel',
        connect_success: (exchange) => `✅ *${exchange} connected!*\n\n📊 Now send /analyze`,
        connect_fail: '❌ *Failed to connect.*\n\nCheck your keys and try again.',
        connect_cancel: '❌ *Cancelled.*',
        connect_confirm: '⚠️ *Really disconnect exchange?*\n\nAll keys will be deleted.',
        connect_confirm_yes: '✅ Yes, disconnect',
        connect_confirm_no: '❌ No, keep',
        connect_undo: '⏳ Keys will be deleted in 10 seconds. Undo: /undo',
        connect_undo_success: '✅ *Undo successful!* Keys saved.',
        connect_disconnected: '🔌 *Exchange disconnected.* All keys deleted.',
        invalid_format: '❌ *Invalid format!* Send as `API_KEY:SECRET_KEY`.',
        analyzing_step: (step, total, text) => `⏳ [${step}/${total}] ${text}...`,
        analyzing_done: '✅ *Analysis complete!*',
        analyzing_no_keys: '🔐 *Connect exchange first.* /connect',
        analyzing_limit: (limit, remaining) => `📊 *Limit: ${limit}/day.* Remaining: ${remaining}\n💳 /subscribe`,
        security_menu: '🛡️ *What to check?*',
        security_link: '🔗 Link',
        security_contract: '📄 Contract',
        security_file: '📁 File',
        security_dex: '🔍 DEX',
        security_impersonation: '🔄 Account',
        security_wallet: '👛 Wallet',
        scan_link: '🔗 *Send link to check*\n🔄 /cancel — cancel',
        scan_contract: '📄 *Send contract address (0x...)*\n🔄 /cancel — cancel',
        scan_file: '📁 *Send file to check*\n🔄 /cancel — cancel',
        dex_prompt: '🔍 *Send contract address for DEX check*\n🔄 /cancel — cancel',
        impersonation_prompt: '🔄 *Forward message from suspicious user*\n🔄 /cancel — cancel',
        wallet_prompt: '👛 *Send wallet address to check*\n📌 Example: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e\n🔄 /cancel — cancel',
        scan_link_invalid: '❌ Send a link starting with http:// or https://',
        scan_contract_invalid: '❌ Send a contract address (0x...)',
        scan_file_invalid: '❌ Send a file to check.',
        scan_impersonation_invalid: '❌ Forward a message from a suspicious user.',
        scan_timeout: '⏱️ *Check took too long.*',
        scan_cancelled: '❌ *Check cancelled.*',
        scan_safe: '🟢 *SAFE*',
        scan_danger: '🔴 *DANGER*',
        scan_result_safe: (type) => `🟢 *SAFE*\n\n${type} contains no threats.`,
        scan_result_danger: (type, reason) => `🔴 *DANGER*\n\n${type} contains threats:\n${reason}`,
    }
};

// ============================================================
// 14. ФУНКЦИЯ ПОЛУЧЕНИЯ ТЕКСТА ПО КЛЮЧУ
// ============================================================

function getText(lang, key, ...args) {
    const strings = LANGUAGES[lang] || LANGUAGES.ru;
    const text = strings[key];
    if (text === undefined) {
        const fallbackText = LANGUAGES.ru[key];
        if (typeof fallbackText === 'function') return fallbackText(...args);
        return fallbackText || `❌ Ошибка: отсутствует перевод для "${key}"`;
    }
    if (typeof text === 'function') return text(...args);
    return text;
}

// ============================================================
// БОТ VOID NODE — ПОЛНАЯ ВЕРСИЯ 4.0 (ЧАСТЬ 3/6)
// ============================================================

// ============================================================
// 15. УПРАВЛЕНИЕ СООБЩЕНИЯМИ (СИСТЕМА ОДНОГО СООБЩЕНИЯ)
// ============================================================

async function getUserLastMessageId(chatId) {
    const key = `last_msg_${chatId}`;
    const data = await getData(key);
    return data ? parseInt(data) : null;
}

async function setUserLastMessageId(chatId, messageId) {
    const key = `last_msg_${chatId}`;
    await setData(key, messageId.toString());
}

async function deleteUserLastMessage(chatId) {
    const messageId = await getUserLastMessageId(chatId);
    if (messageId) {
        try {
            await botDeleteMessage(chatId, messageId);
            await deleteData(`last_msg_${chatId}`);
        } catch (error) {
            console.error('❌ Failed to delete message:', error);
        }
    }
}

async function botDeleteMessage(chatId, messageId) {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`;
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
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`;
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

async function deleteUserMessageWithDelay(chatId, messageId, delay = 1500) {
    if (!messageId) return;
    setTimeout(async () => {
        await deleteUserMessage(chatId, messageId);
    }, delay);
}

async function checkMessageExists(chatId, messageId) {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getMessage`;
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

async function sendUpdatedMessage(chatId, text, keyboard = null, parseMode = 'Markdown', userMessageId = null) {
    if (userMessageId) {
        const msgExists = await checkMessageExists(chatId, userMessageId);
        if (msgExists) {
            await deleteUserMessageWithDelay(chatId, userMessageId, 1500);
        }
    }
    await deleteUserLastMessage(chatId);
    const result = await sendMessage(chatId, text, keyboard, parseMode);
    if (result && result.ok) {
        const data = await result.json();
        if (data.result && data.result.message_id) {
            await setUserLastMessageId(chatId, data.result.message_id);
        }
    }
    return result;
}

async function sendMessage(chatId, text, keyboard = null, parseMode = 'Markdown') {
    if (!text) return null;
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const body = {
            chat_id: chatId,
            text: text,
            parse_mode: parseMode,
            disable_web_page_preview: true
        };
        if (keyboard) body.reply_markup = keyboard;
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

// ============================================================
// 16. TELEGRAM ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

async function sendTyping(chatId) {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`;
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

async function answerCallback(callbackId, text = null, showAlert = false) {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`;
        const body = { callback_query_id: callbackId, show_alert: showAlert };
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

async function sendDocument(chatId, content, filename) {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`;
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
// 17. МЕТРИКИ И ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

function createProgressBarUI(value, max = 100, length = 10) {
    const percent = Math.min(value / max, 1);
    const filled = Math.round(percent * length);
    const empty = length - filled;
    return '🟩'.repeat(filled) + '⬜'.repeat(empty);
}

function getIdealPortfolio(mode) {
    if (mode === 'beginner') {
        return { btc: 50, alt: 30, stable: 20, label: '🔰 Для новичков' };
    } else {
        return { btc: 40, alt: 40, stable: 20, label: '🚀 Для опытных' };
    }
}

function generateCSV(engineResult) {
    let csv = 'Asset,Value(USDT),Percentage\n';
    for (const a of engineResult.assets || []) {
        csv += `${a.symbol},${a.value.toFixed(2)},${a.weight.toFixed(2)}\n`;
    }
    csv += `\nRisk Level,${engineResult.riskLevel || 'unknown'}\n`;
    csv += `Risk Score,${engineResult.riskScore || 0}\n`;
    csv += `Total USDT,${engineResult.totalUSDT?.toFixed(2) || 0}\n`;
    if (engineResult.btcMetrics && engineResult.btcMetrics.sharpe !== undefined) {
        csv += `Sharpe Ratio,${engineResult.btcMetrics.sharpe.toFixed(2)}\n`;
        csv += `Sortino Ratio,${engineResult.btcMetrics.sortino?.toFixed(2) || 0}\n`;
        csv += `VaR (95%),${engineResult.btcMetrics.var?.toFixed(2) || 0}\n`;
    }
    return csv;
}

// ============================================================
// 18. БИРЖЕВЫЕ ФУНКЦИИ
// ============================================================

async function connectExchange(apiKey, secretKey, exchangeId = 'binance') {
    try {
        const exchange = new ccxt[exchangeId]({
            apiKey: apiKey,
            secret: secretKey,
            enableRateLimit: true,
            timeout: 30000
        });
        await exchange.fetchBalance();
        return exchange;
    } catch (error) {
        console.error(`❌ Ошибка подключения к бирже ${exchangeId}:`, error);
        throw error;
    }
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
// 19. ИСТОРИЯ ДЕЙСТВИЙ
// ============================================================

async function addHistory(chatId, action, detail) {
    const key = `history_${chatId}`;
    const data = await getData(key);
    const history = data ? JSON.parse(data) : [];
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
    const key = `history_${chatId}`;
    const data = await getData(key);
    return data ? JSON.parse(data) : [];
}

// ============================================================
// 20. ПЛАТЕЖИ CRYPTOBOT
// ============================================================

async function createCryptoInvoice(chatId, planId, amountRub) {
    const url = 'https://pay.crypt.bot/api/createInvoice';
    const usdtAmount = Math.round(amountRub / 90);
    const plan = PLANS[planId];
    if (amountRub === 0) return { payUrl: null, invoiceId: null };
    const body = {
        asset: 'USDT',
        amount: usdtAmount,
        description: `Void Node - ${plan.name} (${amountRub} RUB ≈ ${usdtAmount} USDT)`,
        payload: `plan_${planId}_${chatId}`,
        paid_btn_name: 'openBot',
        paid_btn_url: `https://t.me/${BOT_USERNAME}?start=activate_${planId}`,
        hidden_message: `✅ Тариф ${plan.name} активирован! Спасибо! 🙏`
    };
    try {
        const response = await fetchWithRetry(url, {
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
// 21. ОБРАБОТЧИК ВЫБОРА ТАРИФА
// ============================================================

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
// 22. АНТИСКАМ ФУНКЦИИ
// ============================================================

async function checkContract(address) {
    let riskScore = 0;
    let level = '🟢 Низкий';
    const isHoneypot = address.toLowerCase().includes('dead') || (address.length === 42 && address.endsWith('f'));
    if (isHoneypot) riskScore += 40;
    if (address.includes('0x0000')) riskScore += 20;
    if (ETHERSCAN_API_KEY) {
        try {
            const url = `https://api.etherscan.io/api?module=contract&action=getabi&address=${address}&apikey=${ETHERSCAN_API_KEY}`;
            const resp = await fetchWithRetry(url);
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
    if (score > 70) level = '🔴 Высокий';
    else if (score > 40) level = '🟡 Средний';
    return { score, level, reason: `Скоринг риска: ${score}/100 (${level})` };
}

async function checkWallet(address) {
    let balance = 0;
    const tokens = [];
    if (ETHERSCAN_API_KEY) {
        try {
            const balUrl = `https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${ETHERSCAN_API_KEY}`;
            const balResp = await fetchWithRetry(balUrl);
            const balData = await balResp.json();
            if (balData.status === '1') balance = parseFloat(balData.result) / 1e18;
            const tokenUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&page=1&offset=100&sort=desc&apikey=${ETHERSCAN_API_KEY}`;
            const tokenResp = await fetchWithRetry(tokenUrl);
            const tokenData = await tokenResp.json();
            if (tokenData.status === '1') {
                for (const t of tokenData.result.slice(0, 10)) {
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
    return { balance, tokens, risk };
}

async function checkUrl(url) {
    try {
        const domain = new URL(url).hostname;
        const issues = [];
        const blacklisted = await getData(`domain_blacklist_${domain}`);
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

// ============================================================
// 23. ОБРАБОТЧИКИ АНТИСКАМА
// ============================================================

async function handleAntiScamInput(chatId, text, lang, update, messageId) {
    const check = await checkLimit(chatId, 'antiscam');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        await setData(`state_${chatId}`, 'idle');
        return;
    }
    const state = await getData(`state_${chatId}`);
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
                await setData(`state_${chatId}`, 'idle');
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
        default:
            await sendUpdatedMessage(chatId, '❌ Неизвестный тип проверки.', null, 'Markdown', messageId);
    }
    await setData(`state_${chatId}`, 'idle');
}

async function handleUrlCheck(chatId, url, lang, messageId) {
    await sendTyping(chatId);
    const result = await checkUrl(url);
    let message = result.safe ?
        getText(lang, 'scan_safe') + '\n\n' + getText(lang, 'scan_result_safe', 'Ссылка') :
        getText(lang, 'scan_danger') + '\n\n' + getText(lang, 'scan_result_danger', 'Ссылка', result.reason);
    const keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
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
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
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
        const response = await fetchWithRetry(dexUrl);
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
                [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
                [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
        await addHistory(chatId, getText(lang, 'history_antiscam'), `DEX: ${address.slice(0, 10)}...`);
    } catch (error) {
        console.error('DEX check error:', error);
        await sendUpdatedMessage(chatId, '❌ Ошибка при проверке DEX.', null, 'Markdown', messageId);
    }
}

async function handleFileCheck(chatId, update, lang, messageId) {
    const file = update.message.document;
    const fileName = file.file_name || 'неизвестный_файл';
    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
    if (file.file_size > MAX_FILE_SIZE) {
        await sendUpdatedMessage(chatId, '❌ Файл слишком большой (макс. 20MB)', null, 'Markdown', messageId);
        return;
    }
    await sendTyping(chatId);
    const result = checkFile(fileName);
    let message = `📁 *ПРОВЕРКА ФАЙЛА*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 ${fileName}\n📏 ${(file.file_size / 1024).toFixed(1)} KB\n\n${result}`;
    const keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
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
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
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
        await setData(`state_${chatId}`, 'idle');
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
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_antiscam'), `Кошелёк: ${address.slice(0, 10)}...`);
    await setData(`state_${chatId}`, 'idle');
}

// ============================================================
// 24. АВТОМАТИЧЕСКАЯ ПРОВЕРКА
// ============================================================

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
// БОТ VOID NODE — ПОЛНАЯ ВЕРСИЯ 4.0 (ЧАСТЬ 4/6)
// ============================================================

// ============================================================
// 25. МЕНЮ И ИНТЕРФЕЙС
// ============================================================

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
    const mode = await getData(`mode_${chatId}`) || 'beginner';
    const userName = 'Друг';
    const userId = chatId;
    const planName = userPlan.name || '🔰 Триал';
    const expiresDate = new Date(userPlan.expires).toLocaleDateString();
    const modeDisplay = mode === 'beginner' ? '🔰 Новичок' : '🚀 Опытный';
    const greeting = getText(lang, 'greeting_morning', userName);
    const header = getText(lang, 'main_header', userName, modeDisplay, userId, planName, expiresDate);
    const message = `${greeting}\n\n${header}\n\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🔮 *Void Node — твой крипто-телохранитель*\n\n🏠 *Главное меню:*`;
    await sendUpdatedMessage(chatId, message, getMainMenuKeyboard(lang));
}

async function showFunctionsMenu(chatId, lang) {
    const keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'functions_analyze'), callback_data: 'menu_analyze' }],
            [{ text: getText(lang, 'functions_security'), callback_data: 'menu_security' }],
            [{ text: '🔔 Оповещения', callback_data: 'alert_menu' }],
            [{ text: getText(lang, 'functions_news'), callback_data: 'menu_news' }],
            [{ text: getText(lang, 'functions_history'), callback_data: 'menu_history' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, getText(lang, 'functions_title'), keyboard);
}

async function showSettingsMenuNew(chatId, lang) {
    const currentLang = lang === 'ru' ? '🇷🇺 Русский' : '🇬🇧 English';
    const mode = await getData(`mode_${chatId}`) || 'beginner';
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

async function showAnalyzeMenu(chatId, lang) {
    const savedData = await getData(`user_${chatId}`);
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
            [{ text: '🚀 Автоторговля', callback_data: 'autotrade_menu' }],
            [{ text: '🔄 Ребаланс портфеля', callback_data: 'action_rebalance' }],
            [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
        ]
    };
    await sendUpdatedMessage(chatId, '📊 *Анализ портфеля*\n\nВыберите действие:', keyboard);
}

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

async function showMarketMenu(chatId, lang) {
    const keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'market_social'), callback_data: 'menu_social' }],
            [{ text: getText(lang, 'market_news'), callback_data: 'menu_news' }],
            [{ text: getText(lang, 'market_calendar'), callback_data: 'menu_calendar' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, getText(lang, 'market_menu'), keyboard);
}

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

// ============================================================
// 26. ПОМОЩЬ (НОВАЯ ВЕРСИЯ)
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
// 27. ОПОВЕЩЕНИЯ
// ============================================================

async function showAlertMenu(chatId, lang) {
    const keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'alert_price'), callback_data: 'alert_price' }],
            [{ text: getText(lang, 'alert_change'), callback_data: 'alert_change' }],
            [{ text: getText(lang, 'alert_volume'), callback_data: 'alert_volume' }],
            [{ text: getText(lang, 'alert_news'), callback_data: 'alert_news' }],
            [{ text: getText(lang, 'alert_calendar'), callback_data: 'alert_calendar' }],
            [{ text: '📋 Список оповещений', callback_data: 'alert_list' }],
            [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
        ]
    };
    await sendUpdatedMessage(chatId, getText(lang, 'alert_menu'), keyboard);
}

// ============================================================
// 28. АВТОТОРГОВЛЯ
// ============================================================

async function showAutotradeMenu(chatId, lang) {
    const keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'autotrade_level1'), callback_data: 'autotrade_level1' }],
            [{ text: getText(lang, 'autotrade_level2'), callback_data: 'autotrade_level2' }],
            [{ text: getText(lang, 'autotrade_level3'), callback_data: 'autotrade_level3' }],
            [{ text: '⏹️ Остановить', callback_data: 'autotrade_stop' }],
            [{ text: getText(lang, 'back_to_analyze'), callback_data: 'back_to_analyze' }]
        ]
    };
    await sendUpdatedMessage(chatId, getText(lang, 'autotrade_menu'), keyboard);
}

// ============================================================
// 29. ОНБОРДИНГ
// ============================================================

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
// БОТ VOID NODE — ПОЛНАЯ ВЕРСИЯ 4.0 (ЧАСТЬ 5/6)
// ============================================================

// ============================================================
// 30. НОВОСТИ (ПЕРСОНАЛИЗИРОВАННЫЕ С КЭШЕМ)
// ============================================================

async function getPersonalizedNews(chatId, lang) {
    const analysisData = await getData(`analysis_${chatId}`);
    if (!analysisData) {
        return { error: true, message: getText(lang, 'news_no_assets') };
    }
    const analysis = JSON.parse(analysisData);
    const assets = analysis.assets || [];
    if (assets.length === 0) {
        return { error: true, message: getText(lang, 'news_no_assets') };
    }
    const topAssets = assets.slice(0, 5);
    const isRu = lang === 'ru';
    let allArticles = [];
    const seenUrls = new Set();
    for (const asset of topAssets) {
        try {
            const query = asset.symbol;
            const cacheKey = `news_${query}_${isRu ? 'ru' : 'en'}`;
            const cached = await getData(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Date.now() - parsed.timestamp < 300000) { // 5 минут
                    allArticles = allArticles.concat(parsed.articles);
                    continue;
                }
            }
            const url = `https://newsapi.org/v2/everything?q=${query}+crypto&language=${isRu ? 'ru' : 'en'}&sortBy=publishedAt&pageSize=3&apiKey=${NEWS_API_KEY}`;
            const response = await fetchWithRetry(url);
            const data = await response.json();
            if (data.status === 'ok' && data.articles) {
                const articles = data.articles.filter(a => a.url && !seenUrls.has(a.url));
                for (const article of articles) {
                    if (article.url && !seenUrls.has(article.url)) {
                        seenUrls.add(article.url);
                        allArticles.push({
                            ...article,
                            asset: asset.symbol,
                            weight: asset.weight
                        });
                    }
                }
                await setData(cacheKey, JSON.stringify({
                    articles: articles,
                    timestamp: Date.now()
                }), 300);
            }
        } catch (error) {
            console.error(`News error for ${asset.symbol}:`, error);
        }
    }
    allArticles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const topArticles = allArticles.slice(0, 5);
    if (topArticles.length === 0) {
        return { error: true, message: getText(lang, 'news_no_news') };
    }
    let report = getText(lang, 'news_personalized_header');
    report += `📌 По твоим активам: ${topAssets.map(a => a.symbol).join(', ')}\n\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const article of topArticles) {
        const title = article.title && article.title.length > 80 ? article.title.slice(0, 77) + '...' : article.title || 'Новость';
        const source = article.source?.name || 'Unknown';
        const date = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString(isRu ? 'ru-RU' : 'en-US') : '';
        const description = article.description && article.description.length > 120 ? article.description.slice(0, 117) + '...' : article.description || '';
        const assetTag = article.asset ? ` 🎯 ${article.asset}` : '';
        const emoji = article.asset ? '📌' : '📊';
        report += `${emoji} *${title}*${assetTag}\n`;
        report += `   📎 ${source}`;
        if (date) report += ` | 📅 ${date}`;
        report += `\n`;
        if (description) {
            report += `   📝 ${description}\n`;
        }
        report += `   🔗 [${isRu ? 'Читать полностью' : 'Read more'}](${article.url})\n\n`;
    }
    report += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `🔄 /news — ${isRu ? 'обновить' : 'refresh'}`;
    return { error: false, report, count: topArticles.length };
}

async function handleNewsCommand(chatId, coin, lang, messageId) {
    const check = await checkLimit(chatId, 'news');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        return;
    }
    await sendTyping(chatId);
    await sendUpdatedMessage(chatId, getText(lang, 'news_analyzing'), null, 'Markdown', messageId);
    if (coin && coin.trim().length > 0) {
        await handleNewsSingleCoin(chatId, coin, lang, messageId);
        return;
    }
    const result = await getPersonalizedNews(chatId, lang);
    if (result.error) {
        await sendUpdatedMessage(chatId, result.message, null, 'Markdown', messageId);
        return;
    }
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔄 Обновить', callback_data: 'menu_news' }],
            [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
            [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, result.report, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_news'), `Персонализированные (${result.count})`);
}

async function handleNewsSingleCoin(chatId, coin, lang, messageId) {
    const isRu = lang === 'ru';
    try {
        const cacheKey = `news_single_${coin}_${isRu ? 'ru' : 'en'}`;
        const cached = await getData(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.timestamp < 300000) {
                await sendNewsReport(chatId, parsed.articles, coin, lang, messageId);
                return;
            }
        }
        const url = `https://newsapi.org/v2/everything?q=${coin}+crypto&language=${isRu ? 'ru' : 'en'}&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`;
        const response = await fetchWithRetry(url);
        const data = await response.json();
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
        await sendUpdatedMessage(chatId, '❌ Ошибка получения новостей. Попробуйте позже.', null, 'Markdown', messageId);
    }
}

async function sendNewsReport(chatId, articles, coin, lang, messageId) {
    const isRu = lang === 'ru';
    let report = getText(lang, 'news_coin', coin.toUpperCase());
    let count = 0;
    const seenUrls = new Set();
    for (const article of articles) {
        if (count >= 5) break;
        if (!article.title || article.title.length < 5) continue;
        if (article.url && seenUrls.has(article.url)) continue;
        if (article.url) seenUrls.add(article.url);
        count++;
        const title = article.title.length > 80 ? article.title.slice(0, 77) + '...' : article.title;
        const source = article.source?.name || 'Unknown';
        const date = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString(isRu ? 'ru-RU' : 'en-US') : '';
        const description = article.description && article.description.length > 120 ? article.description.slice(0, 117) + '...' : article.description || '';
        report += `📊 *${title}*\n`;
        report += `   📎 ${source}`;
        if (date) report += ` | 📅 ${date}`;
        report += `\n`;
        if (description) {
            report += `   📝 ${description}\n`;
        }
        report += `   🔗 [${isRu ? 'Читать полностью' : 'Read more'}](${article.url})\n\n`;
    }
    report += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `📊 ${isRu ? `Найдено: ${count} новостей` : `Found: ${count} news`}\n`;
    report += `🔄 /news ${coin} — ${isRu ? 'обновить' : 'refresh'}`;
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
            [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_news'), coin);
}

// ============================================================
// 31. СОЦ.ТРЕНДЫ (С КЭШЕМ COINGECKO)
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
    const cacheKey = `cg_${coinId}`;
    const cached = await getData(cacheKey);
    if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 300000) { // 5 минут
            return parsed.data;
        }
    }
    return null;
}

async function setCachedCoinGecko(coinId, data) {
    const cacheKey = `cg_${coinId}`;
    await setData(cacheKey, JSON.stringify({
        data: data,
        timestamp: Date.now()
    }), 300);
}

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

async function handleTrendClick(chatId, data, lang, messageId) {
    const coin = data.replace('trend_', '');
    const check = await checkLimit(chatId, 'social');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        return;
    }
    await sendTyping(chatId);
    await sendUpdatedMessage(chatId, getText(lang, 'social_analyzing', coin), null, 'Markdown', messageId);
    try {
        const coinId = TICKER_TO_COINGECKO[coin] || coin.toLowerCase();
        let cachedData = await getCachedCoinGecko(coinId);
        let dataObj;
        if (cachedData) {
            dataObj = cachedData;
        } else {
            const url = `https://api.coingecko.com/api/v3/coins/${coinId}`;
            const response = await fetchWithRetry(url, {
                headers: {
                    'x-cg-pro-api-key': COINGECKO_API_KEY,
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) {
                await sendUpdatedMessage(chatId, `❌ Данные по ${coin} временно недоступны.`, null, 'Markdown', messageId);
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
        let trend = 'Нейтральный', emoji = '⚪', rec = '';
        if (change24h > 5) {
            trend = 'БЫЧИЙ'; emoji = '🟢';
            rec = `📈 ${coin} растет на ${change24h.toFixed(2)}% за 24ч. Объем: $${(volume24h / 1e6).toFixed(1)}M`;
        } else if (change24h < -5) {
            trend = 'МЕДВЕЖИЙ'; emoji = '🔴';
            rec = `📉 ${coin} падает на ${Math.abs(change24h).toFixed(2)}% за 24ч.`;
        } else if (rank && rank < 50) {
            trend = 'ТОП-МОНЕТА'; emoji = '💎';
            rec = `💎 ${coin} входит в топ-50 криптовалют.`;
        } else {
            rec = `⚪ ${coin} в спокойном состоянии. Изменение: ${change24h > 0 ? '+' : ''}${change24h.toFixed(2)}%`;
        }
        const message = `📊 *SOCIAL TREND: ${coin}*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `💵 *Цена:* $${price.toFixed(2)}\n` +
            `📈 *Изменение 24ч:* ${change24h > 0 ? '+' : ''}${change24h.toFixed(2)}%\n` +
            `📊 *Объем 24ч:* $${(volume24h / 1e6).toFixed(1)}M\n` +
            `💰 *Рыночная капа:* $${(marketCap / 1e9).toFixed(2)}B\n` +
            `🏆 *Ранг:* #${rank}\n` +
            `🐦 *Twitter:* ${twitterFollowers > 0 ? `${(twitterFollowers / 1000).toFixed(1)}K` : 'Нет данных'}\n` +
            `📡 *Reddit:* ${redditSubscribers > 0 ? `${(redditSubscribers / 1000).toFixed(1)}K` : 'Нет данных'}\n` +
            `${emoji} *Тренд:* ${trend}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `💡 ${rec}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🕐 *Обновлено:* только что\n` +
            `📡 *Источник:* CoinGecko`;
        const keyboard = {
            inline_keyboard: [
                [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
                [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
        await addHistory(chatId, getText(lang, 'history_social'), coin);
    } catch (error) {
        console.error('Trend error:', error);
        await sendUpdatedMessage(chatId, `❌ Ошибка получения данных по ${coin}. Попробуйте позже.`, null, 'Markdown', messageId);
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
    const message = `🔍 *Как искать токен?*\n\n📌 *По названию* — введи тикер (PEPE, DOGE, SHIB)\n📄 *По адресу* — вставь адрес контракта (0x...)\n\n💡 Если адрес контракта — бот покажет DEX данные и ликвидность.`;
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
}

async function handleTrendSearchInput(chatId, text, lang, messageId) {
    const input = text.trim().toUpperCase();
    if (input.length < 2 || input.length > 15) {
        await sendUpdatedMessage(chatId, getText(lang, 'social_search_invalid'), null, 'Markdown', messageId);
        await setData(`state_${chatId}`, 'waiting_for_trend_search');
        return;
    }
    const coin = input;
    const check = await checkLimit(chatId, 'search_token');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        await setData(`state_${chatId}`, 'idle');
        return;
    }
    await setData(`state_${chatId}`, 'idle');
    await handleTrendClick(chatId, `trend_${coin}`, lang, messageId);
}

async function handleContractSearch(chatId, address, lang, messageId) {
    await sendTyping(chatId);
    try {
        const dexUrl = `https://api.dexscreener.com/latest/dex/search?q=${address}`;
        const response = await fetchWithRetry(dexUrl);
        const data = await response.json();
        let message = `📄 *РЕЗУЛЬТАТ ПОИСКА ПО КОНТРАКТУ*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        message += `📌 *Адрес:* \`${address.slice(0, 10)}...${address.slice(-6)}\`\n\n`;
        if (data.pairs && data.pairs.length > 0) {
            const pair = data.pairs[0];
            message += `✅ *Токен найден на DEX*\n\n`;
            message += `🌐 *Сеть:* ${pair.chainId || 'Unknown'}\n`;
            message += `🏦 *DEX:* ${pair.dexId || 'Unknown'}\n`;
            message += `💰 *Цена:* $${parseFloat(pair.priceUsd || 0).toFixed(8)}\n`;
            message += `💧 *Ликвидность:* $${parseFloat(pair.liquidity?.usd || 0).toFixed(2)}\n`;
            message += `📊 *Объем 24ч:* $${parseFloat(pair.volume?.h24 || 0).toFixed(2)}\n\n`;
            const liq = parseFloat(pair.liquidity?.usd || 0);
            let risk = '🟢 Низкий';
            let note = 'Достаточная ликвидность.';
            if (liq < 10000) { risk = '🔴 Высокий'; note = '⚠️ Очень низкая ликвидность!'; }
            else if (liq < 50000) { risk = '🟡 Средний'; note = '⚠️ Средняя ликвидность. Будьте осторожны.'; }
            message += `🛡️ *Риск:* ${risk}\n💡 ${note}\n\n`;
            if (pair.url) message += `🔗 [Посмотреть на DEX](${pair.url})\n`;
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
    await setData(`state_${chatId}`, 'idle');
}

// ============================================================
// 32. КАЛЕНДАРЬ ТРЕЙДЕРА (ЧЕРЕЗ FINNHUB)
// ============================================================

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
    try {
        const cacheKey = 'economic_calendar';
        const cached = await getData(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.timestamp < 1800000) { // 30 минут
                await sendCalendarReport(chatId, parsed.events, lang, messageId);
                return;
            }
        }
        const url = `https://finnhub.io/api/v1/calendar/economic?token=${FINNHUB_API_KEY}`;
        const response = await fetchWithRetry(url);
        const data = await response.json();
        let events = [];
        if (data.economicCalendar && data.economicCalendar.length > 0) {
            events = data.economicCalendar.slice(0, 10).map(event => ({
                title: event.event || 'Событие',
                date: event.date || 'Дата неизвестна',
                importance: event.importance === 2 ? '🔴 Высокая' : 
                           event.importance === 1 ? '🟡 Средняя' : '🟢 Низкая',
                impact: event.impact || 'Нет данных'
            }));
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
        await sendUpdatedMessage(chatId, '❌ Ошибка получения календаря. Попробуйте позже.', null, 'Markdown', messageId);
    }
}

async function sendCalendarReport(chatId, events, lang, messageId) {
    const calendar = getText(lang, 'calendar_result', events);
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
            [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, calendar, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_calendar'), 'Неделя');
}

// ============================================================
// БОТ VOID NODE — ПОЛНАЯ ВЕРСИЯ 4.0 (ЧАСТЬ 6/6 — ФИНАЛ)
// ============================================================

// ============================================================
// 33. ОБРАБОТЧИК CALLBACK (ВСЕ КНОПКИ)
// ============================================================

async function handleCallback(update) {
    const callback = update.callback_query;
    const chatId = callback.message.chat.id;
    const messageId = callback.message.message_id;
    const data = callback.data;
    const lang = await getData(`lang_${chatId}`) || 'ru';

    await deleteUserMessage(chatId, messageId);
    await answerCallback(callback.id);

    try {
        // ===== ОНБОРДИНГ =====
        if (data === 'onboard_lang_ru' || data === 'onboard_lang_en') {
            const newLang = data === 'onboard_lang_ru' ? 'ru' : 'en';
            await setData(`lang_${chatId}`, newLang);
            await showModeSelectOnboarding(chatId, newLang);
            return;
        }
        if (data === 'onboard_mode_beginner' || data === 'onboard_mode_pro') {
            const mode = data === 'onboard_mode_beginner' ? 'beginner' : 'pro';
            await setData(`mode_${chatId}`, mode);
            await setData(`onboarded_${chatId}`, 'true');
            await showOnboardingSetup(chatId, lang);
            return;
        }

        // ===== НАВИГАЦИЯ =====
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
        if (data === 'menu_connect') {
            await sendUpdatedMessage(chatId, getText(lang, 'connect_prompt'));
            await setData(`state_${chatId}`, 'waiting_for_keys');
            return;
        }

        // ===== ЯЗЫК И РЕЖИМ =====
        if (data === 'lang_ru' || data === 'lang_en') {
            const newLang = data === 'lang_ru' ? 'ru' : 'en';
            await setData(`lang_${chatId}`, newLang);
            await sendUpdatedMessage(chatId, getText(newLang, 'settings_lang_selected', newLang === 'ru' ? 'Русский' : 'English'));
            await showSettingsMenuNew(chatId, newLang);
            return;
        }
        if (data === 'mode_beginner' || data === 'mode_pro') {
            const newMode = data === 'mode_beginner' ? 'beginner' : 'pro';
            await setData(`mode_${chatId}`, newMode);
            await sendUpdatedMessage(chatId, getText(lang, 'settings_mode_selected', newMode === 'beginner' ? '🔰 Новичок' : '🚀 Опытный'));
            await showSettingsMenuNew(chatId, lang);
            return;
        }

        // ===== ПОМОЩЬ (10 ВОПРОСОВ) =====
        if (data === 'help_q1') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q1'), null, 'Markdown'); return; }
        if (data === 'help_q2') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q2'), null, 'Markdown'); return; }
        if (data === 'help_q3') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q3'), null, 'Markdown'); return; }
        if (data === 'help_q4') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q4'), null, 'Markdown'); return; }
        if (data === 'help_q5') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q5'), null, 'Markdown'); return; }
        if (data === 'help_q6') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q6'), null, 'Markdown'); return; }
        if (data === 'help_q7') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q7'), null, 'Markdown'); return; }
        if (data === 'help_q8') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q8'), null, 'Markdown'); return; }
        if (data === 'help_q9') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q9'), null, 'Markdown'); return; }
        if (data === 'help_q10') { await sendUpdatedMessage(chatId, getText(lang, 'help_answer_q10'), null, 'Markdown'); return; }
        if (data === 'help_contact_moderator') {
            await sendUpdatedMessage(chatId, getText(lang, 'help_contact_moderator_message'), null, 'Markdown');
            return;
        }

        // ===== ТАРИФЫ =====
        if (data.startsWith('plan_')) {
            const planId = data.replace('plan_', '');
            await handlePlanSelection(chatId, planId, lang, null);
            return;
        }

        // ===== АНТИСКАМ =====
        if (data.startsWith('antiscam_')) {
            await setData(`state_${chatId}`, data);
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

        // ===== ТРЕНДЫ =====
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
            await setData(`state_${chatId}`, 'waiting_for_trend_search');
            return;
        }
        if (data === 'trend_search_contract') {
            await sendUpdatedMessage(chatId, '📄 *Отправь адрес контракта для проверки*\n\n📌 Пример: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e\n🔄 /cancel — отмена', null, 'Markdown');
            await setData(`state_${chatId}`, 'waiting_for_contract_search');
            return;
        }

        // ===== ОПОВЕЩЕНИЯ =====
        if (data === 'alert_menu') {
            await showAlertMenu(chatId, lang);
            return;
        }
        if (data === 'alert_price') {
            await sendUpdatedMessage(chatId, getText(lang, 'alert_create_price'), null, 'Markdown');
            await setData(`state_${chatId}`, 'alert_price');
            return;
        }
        if (data === 'alert_change') {
            await sendUpdatedMessage(chatId, getText(lang, 'alert_create_change'), null, 'Markdown');
            await setData(`state_${chatId}`, 'alert_change');
            return;
        }
        if (data === 'alert_volume' || data === 'alert_news' || data === 'alert_calendar') {
            await sendUpdatedMessage(chatId, '⏳ *Функция в разработке*', null, 'Markdown');
            return;
        }
        if (data === 'alert_list') {
            const alerts = await getData(`alerts_${chatId}`);
            if (!alerts || JSON.parse(alerts).length === 0) {
                await sendUpdatedMessage(chatId, '📭 У вас нет активных оповещений.', null, 'Markdown');
                return;
            }
            let text = getText(lang, 'alert_list');
            for (const a of JSON.parse(alerts)) {
                text += `• ${a.params.symbol || ''} (${a.type}) – ${a.params.target || ''}\n`;
            }
            await sendUpdatedMessage(chatId, text, null, 'Markdown');
            return;
        }
        if (data.startsWith('alert_delete_')) {
            const alertId = data.replace('alert_delete_', '');
            const alerts = await getData(`alerts_${chatId}`);
            if (alerts) {
                const parsed = JSON.parse(alerts).filter(a => a.id !== alertId);
                await setData(`alerts_${chatId}`, JSON.stringify(parsed));
                await sendUpdatedMessage(chatId, getText(lang, 'alert_deleted'), null, 'Markdown');
            }
            return;
        }

        // ===== АВТОТОРГОВЛЯ =====
        if (data === 'autotrade_menu') {
            await showAutotradeMenu(chatId, lang);
            return;
        }
        if (data === 'autotrade_level1' || data === 'autotrade_level2' || data === 'autotrade_level3') {
            const level = data === 'autotrade_level1' ? 1 : data === 'autotrade_level2' ? 2 : 3;
            const plan = await getUserPlan(chatId);
            if (!plan.limits.autotrade) {
                await sendUpdatedMessage(chatId, getText(lang, 'autotrade_pro_only'), null, 'Markdown');
                return;
            }
            await setData(`autotrade_${chatId}`, JSON.stringify({ level, active: true, lastCheck: Date.now() }));
            await sendUpdatedMessage(chatId, getText(lang, 'autotrade_active', { level }), null, 'Markdown');
            return;
        }
        if (data === 'autotrade_stop') {
            await deleteData(`autotrade_${chatId}`);
            await sendUpdatedMessage(chatId, getText(lang, 'autotrade_stopped'), null, 'Markdown');
            return;
        }

        // ===== ИСПОЛНЕНИЕ РЕКОМЕНДАЦИЙ =====
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
            const result = await executeRecommendation(chatId, recId);
            if (result.error) {
                await sendUpdatedMessage(chatId, `❌ ${result.error}`, null, 'Markdown');
            } else {
                await sendUpdatedMessage(chatId, `✅ *Ордер исполнен!*\n\nСимвол: ${result.order.symbol}\nСторона: ${result.order.side}\nКоличество: ${result.order.amount}\nЦена: ${result.order.price || 'рыночная'}`, null, 'Markdown');
            }
            await showMainMenu(chatId, lang);
            return;
        }
        if (data.startsWith('cancel_exec_')) {
            await sendUpdatedMessage(chatId, '❌ Исполнение отменено.', null, 'Markdown');
            await showMainMenu(chatId, lang);
            return;
        }

        // ===== АНАЛИЗ =====
        if (data === 'action_analyze') {
            const savedData = await getData(`user_${chatId}`);
            if (!savedData) {
                await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'), null, 'Markdown');
                return;
            }
            await sendUpdatedMessage(chatId, '⏳ *Начинаю анализ...*', null, 'Markdown');
            const user = JSON.parse(savedData);
            const apiKey = decrypt(user.apiKey);
            const secretKey = decrypt(user.secretKey);
            try {
                const exchange = await connectExchange(apiKey, secretKey, user.exchangeId);
                const balance = await exchange.fetchBalance();
                const total = balance.total;
                const coins = Object.keys(total).filter(key => total[key] > 0);
                if (coins.length === 0) {
                    await sendUpdatedMessage(chatId, '📭 *На балансе нет монет.*', null, 'Markdown');
                    return;
                }
                let totalUSDT = 0;
                const assets = [];
                for (const coin of coins) {
                    if (coin === 'USDT') {
                        totalUSDT += total[coin];
                        continue;
                    }
                    try {
                        const ticker = await exchange.fetchTicker(`${coin}/USDT`);
                        const value = total[coin] * ticker.last;
                        totalUSDT += value;
                        assets.push({ symbol: coin, value });
                    } catch (e) {}
                }
                for (const a of assets) {
                    a.weight = (a.value / totalUSDT) * 100;
                }
                assets.sort((a, b) => b.weight - a.weight);
                const mode = await getData(`mode_${chatId}`) || 'beginner';
                const thresholds = getRiskThresholds(mode);
                const engineResult = {
                    totalUSDT: totalUSDT,
                    btcPercent: assets.find(a => a.symbol === 'BTC')?.weight || 0,
                    altPercent: assets.filter(a => a.symbol !== 'BTC' && a.symbol !== 'USDT').reduce((sum, a) => sum + a.weight, 0),
                    usdtPercent: assets.find(a => a.symbol === 'USDT')?.weight || 0,
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
                await sendUpdatedMessage(chatId, report.text, report.keyboard, 'Markdown');
                await setData(`analysis_${chatId}`, JSON.stringify(engineResult), 86400);
                await addHistory(chatId, getText(lang, 'history_analyze'), `$${totalUSDT.toFixed(2)}`);
            } catch (error) {
                console.error('Analysis error:', error);
                await notifyAdmin(error, { chatId, function: 'action_analyze' });
                await sendUpdatedMessage(chatId, `❌ Ошибка анализа: ${error.message}`, null, 'Markdown');
            }
            return;
        }

        if (data === 'action_export_csv') {
            const savedData = await getData(`user_${chatId}`);
            if (!savedData) {
                await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'), null, 'Markdown');
                return;
            }
            const user = JSON.parse(savedData);
            const apiKey = decrypt(user.apiKey);
            const secretKey = decrypt(user.secretKey);
            try {
                const exchange = await connectExchange(apiKey, secretKey, user.exchangeId);
                const balance = await exchange.fetchBalance();
                const total = balance.total;
                const coins = Object.keys(total).filter(key => total[key] > 0);
                let totalUSDT = 0;
                const assets = [];
                for (const coin of coins) {
                    if (coin === 'USDT') {
                        totalUSDT += total[coin];
                        continue;
                    }
                    try {
                        const ticker = await exchange.fetchTicker(`${coin}/USDT`);
                        const value = total[coin] * ticker.last;
                        totalUSDT += value;
                        assets.push({ symbol: coin, value });
                    } catch (e) {}
                }
                for (const a of assets) {
                    a.weight = (a.value / totalUSDT) * 100;
                }
                assets.sort((a, b) => b.weight - a.weight);
                const engineResult = {
                    totalUSDT: totalUSDT,
                    assets: assets,
                    riskLevel: 'low',
                    riskScore: 0,
                    btcMetrics: {},
                    timestamp: Date.now()
                };
                const csv = generateCSV(engineResult);
                await sendDocument(chatId, csv, 'portfolio_report.csv');
                await sendUpdatedMessage(chatId, '✅ *CSV отчет отправлен!*', null, 'Markdown');
            } catch (error) {
                console.error('CSV error:', error);
                await notifyAdmin(error, { chatId, function: 'action_export_csv' });
                await sendUpdatedMessage(chatId, getText(lang, 'export_error'), null, 'Markdown');
            }
            return;
        }

        if (data === 'action_history_refresh') {
            await showHistoryMenu(chatId, lang);
            return;
        }

        if (data === 'action_disconnect') {
            await deleteData(`user_${chatId}`);
            await sendUpdatedMessage(chatId, getText(lang, 'connect_disconnected'), null, 'Markdown');
            await showMainMenu(chatId, lang);
            return;
        }

        if (data === 'action_ask_ai') {
            await sendUpdatedMessage(chatId, getText(lang, 'ai_mode'), null, 'Markdown');
            await setData(`state_${chatId}`, 'ai_chat');
            return;
        }

        // ===== РЕБАЛАНС =====
        if (data === 'action_rebalance') {
            const savedData = await getData(`user_${chatId}`);
            if (!savedData) {
                await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'), null, 'Markdown');
                return;
            }
            const mode = await getData(`mode_${chatId}`) || 'beginner';
            const keyboard = {
                inline_keyboard: [
                    [{ text: '✅ Подтвердить ребаланс', callback_data: `confirm_rebalance` }],
                    [{ text: '❌ Отмена', callback_data: `cancel_rebalance` }]
                ]
            };
            await sendMessage(chatId, `⚠️ *Подтвердите ребаланс портфеля*\n\nБот продаст активы выше целевого веса и купит те, что ниже.\n\n🎯 *Целевые веса (${mode === 'beginner' ? 'Новичок' : 'Опытный'}):*\nBTC: ${mode === 'beginner' ? '50%' : '40%'}\nАльты: ${mode === 'beginner' ? '30%' : '40%'}\nСтейблы: 20%`, keyboard);
            return;
        }
        if (data === 'confirm_rebalance') {
            const result = await autoRebalance(chatId);
            if (result.error) {
                await sendUpdatedMessage(chatId, `❌ ${result.error}`, null, 'Markdown');
            } else {
                await sendUpdatedMessage(chatId, `✅ *Ребаланс выполнен!*\n\n${result.message}`, null, 'Markdown');
            }
            await showMainMenu(chatId, lang);
            return;
        }
        if (data === 'cancel_rebalance') {
            await sendUpdatedMessage(chatId, '❌ Ребаланс отменен.', null, 'Markdown');
            await showMainMenu(chatId, lang);
            return;
        }

        // ===== ХОЛОДНЫЙ ДУШ =====
        if (data === 'panic_convert') {
            await handlePanicConvert(chatId);
            return;
        }

    } catch (error) {
        console.error('❌ Callback error:', error);
        await notifyAdmin(error, { chatId, function: 'handleCallback', data });
        await sendUpdatedMessage(chatId, getText(lang, 'error_general', error.message));
    }
}

// ============================================================
// 34. АВТО-РЕБАЛАНС
// ============================================================

async function autoRebalance(chatId) {
    const savedData = await getData(`user_${chatId}`);
    if (!savedData) {
        return { error: 'Нет ключей биржи' };
    }
    const user = JSON.parse(savedData);
    const apiKey = decrypt(user.apiKey);
    const secretKey = decrypt(user.secretKey);
    const mode = await getData(`mode_${chatId}`) || 'beginner';
    const ideal = getIdealPortfolio(mode);
    const thresholds = getRiskThresholds(mode);

    try {
        const exchange = await connectExchange(apiKey, secretKey, user.exchangeId);
        const balance = await exchange.fetchBalance();
        const total = balance.total;
        const coins = Object.keys(total).filter(key => total[key] > 0);
        let totalUSDT = 0;
        const assets = [];
        for (const coin of coins) {
            if (coin === 'USDT') {
                totalUSDT += total[coin];
                continue;
            }
            try {
                const ticker = await exchange.fetchTicker(`${coin}/USDT`);
                const value = total[coin] * ticker.last;
                totalUSDT += value;
                assets.push({ symbol: coin, value });
            } catch (e) {}
        }
        for (const a of assets) {
            a.weight = (a.value / totalUSDT) * 100;
        }
        const btcWeight = assets.find(a => a.symbol === 'BTC')?.weight || 0;
        const altWeight = assets.filter(a => a.symbol !== 'BTC' && a.symbol !== 'USDT').reduce((sum, a) => sum + a.weight, 0);
        const stableWeight = assets.find(a => a.symbol === 'USDT')?.weight || 0;

        const trades = [];
        let message = '';

        // Ребаланс BTC
        if (btcWeight > ideal.btc + 5) {
            const excess = (btcWeight - ideal.btc) / 100 * totalUSDT;
            const btcPrice = assets.find(a => a.symbol === 'BTC')?.value / (total[balance.total.BTC] || 1) || 0;
            const amount = excess / btcPrice;
            if (amount > 0.001) {
                await exchange.createMarketSellOrder('BTC/USDT', amount);
                trades.push(`Продано ${amount.toFixed(4)} BTC (${excess.toFixed(2)} USDT)`);
            }
        } else if (btcWeight < ideal.btc - 5) {
            const needed = (ideal.btc - btcWeight) / 100 * totalUSDT;
            const btcPrice = assets.find(a => a.symbol === 'BTC')?.value / (total[balance.total.BTC] || 1) || 0;
            const amount = needed / btcPrice;
            if (amount > 0.001 && balance.total.USDT > needed) {
                await exchange.createMarketBuyOrder('BTC/USDT', amount);
                trades.push(`Куплено ${amount.toFixed(4)} BTC (${needed.toFixed(2)} USDT)`);
            }
        }

        // Ребаланс альтов (продажа лишних)
        if (altWeight > thresholds.maxAltExposure) {
            const excess = (altWeight - thresholds.maxAltExposure) / 100 * totalUSDT;
            for (const a of assets) {
                if (a.symbol === 'BTC' || a.symbol === 'USDT') continue;
                const sellAmount = (a.value / altWeight) * excess / (a.value / (total[a.symbol] || 1));
                if (sellAmount > 0.001) {
                    await exchange.createMarketSellOrder(`${a.symbol}/USDT`, sellAmount);
                    trades.push(`Продано ${sellAmount.toFixed(4)} ${a.symbol} (${(sellAmount * a.value / (total[a.symbol] || 1)).toFixed(2)} USDT)`);
                }
            }
        }

        if (trades.length === 0) {
            return { error: false, message: 'Портфель уже сбалансирован. Никаких действий не требуется.' };
        }

        message = `Выполнено действий: ${trades.length}\n\n` +
                  trades.slice(0, 5).join('\n') +
                  (trades.length > 5 ? `\n... и еще ${trades.length - 5} действий` : '');

        await addHistory(chatId, '🔄 Ребаланс портфеля', `${trades.length} действий`);
        return { error: false, message };

    } catch (error) {
        console.error('Rebalance error:', error);
        return { error: `Ошибка ребаланса: ${error.message}` };
    }
}

// ============================================================
// 35. ОБРАБОТЧИК СООБЩЕНИЙ
// ============================================================

async function handleMessage(update) {
    const chatId = update.message.chat.id;
    const text = update.message.text || '';
    const messageId = update.message.message_id;
    const userName = update.message.from.first_name || 'Друг';
    let lang = await getData(`lang_${chatId}`) || 'ru';
    let state = await getData(`state_${chatId}`) || 'idle';

    try {
        // ===== ВАЛИДАЦИЯ WEBHOOK =====
        if (!update.message) {
            console.warn('⚠️ Невалидный webhook: отсутствует message');
            return;
        }

        // ===== АВТОПРОВЕРКА ССЫЛОК =====
        if (text && (text.includes('http://') || text.includes('https://'))) {
            await autoCheckLinks(chatId, text, lang, messageId);
        }

        // ===== АВТОПРОВЕРКА КОНТРАКТОВ =====
        if (text && text.startsWith('0x') && text.length >= 42 && text.length <= 44) {
            await autoCheckContract(chatId, text, lang, messageId);
            return;
        }

        // ===== ВВОД API КЛЮЧЕЙ =====
        if (state === 'waiting_for_keys') {
            if (text === '/cancel') {
                await setData(`state_${chatId}`, 'idle');
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
                    const exchange = await connectExchange(apiKey, secretKey);
                    const encryptedApiKey = encrypt(apiKey);
                    const encryptedSecretKey = encrypt(secretKey);
                    await setData(`user_${chatId}`, JSON.stringify({
                        apiKey: encryptedApiKey,
                        secretKey: encryptedSecretKey,
                        exchangeId: 'binance'
                    }));
                    await setData(`state_${chatId}`, 'idle');
                    await sendUpdatedMessage(chatId, getText(lang, 'connect_success', 'Binance'), null, 'Markdown', messageId);
                    await showMainMenu(chatId, lang);
                } catch (error) {
                    console.error('Connect error:', error);
                    await notifyAdmin(error, { chatId, function: 'handleMessage_keys' });
                    await sendUpdatedMessage(chatId, getText(lang, 'connect_fail'), null, 'Markdown', messageId);
                }
            } else {
                await sendUpdatedMessage(chatId, getText(lang, 'invalid_format'), null, 'Markdown', messageId);
            }
            return;
        }

        // ===== АНТИСКАМ СОСТОЯНИЯ =====
        const antiscamStates = ['antiscam_url', 'antiscam_contract', 'antiscam_dex', 'antiscam_file', 'antiscam_impersonation', 'antiscam_wallet'];
        if (antiscamStates.includes(state)) {
            if (text === '/cancel') {
                await setData(`state_${chatId}`, 'idle');
                await sendUpdatedMessage(chatId, getText(lang, 'scan_cancelled'), null, 'Markdown', messageId);
                await showMainMenu(chatId, lang);
                return;
            }
            await handleAntiScamInput(chatId, text, lang, update, messageId);
            return;
        }

        // ===== ПОИСК ТОКЕНА =====
        if (state === 'waiting_for_trend_search') {
            if (text === '/cancel') {
                await setData(`state_${chatId}`, 'idle');
                await sendUpdatedMessage(chatId, '❌ Поиск отменен.', null, 'Markdown', messageId);
                await showMainMenu(chatId, lang);
                return;
            }
            await handleTrendSearchInput(chatId, text, lang, messageId);
            return;
        }

        // ===== ПОИСК ПО КОНТРАКТУ =====
        if (state === 'waiting_for_contract_search') {
            if (text === '/cancel') {
                await setData(`state_${chatId}`, 'idle');
                await sendUpdatedMessage(chatId, '❌ Поиск отменен.', null, 'Markdown', messageId);
                await showMainMenu(chatId, lang);
                return;
            }
            const cleanInput = text.trim();
            if (!cleanInput.startsWith('0x') || cleanInput.length < 42) {
                await sendUpdatedMessage(chatId, '❌ *Неверный адрес контракта.*\n\nОтправь адрес, начинающийся с 0x... (длина 42 символа)', null, 'Markdown', messageId);
                await setData(`state_${chatId}`, 'waiting_for_contract_search');
                return;
            }
            await handleContractSearch(chatId, cleanInput, lang, messageId);
            await setData(`state_${chatId}`, 'idle');
            return;
        }

        // ===== СОЗДАНИЕ ОПОВЕЩЕНИЙ (ВВОД) =====
        if (state === 'alert_price') {
            const parts = text.split(' ');
            if (parts.length === 2) {
                const symbol = parts[0].toUpperCase();
                const target = parseFloat(parts[1]);
                if (!isNaN(target)) {
                    const alerts = await getData(`alerts_${chatId}`);
                    const parsedAlerts = alerts ? JSON.parse(alerts) : [];
                    const duplicate = parsedAlerts.some(a =>
                        a.type === 'price' &&
                        a.params.symbol === symbol &&
                        a.params.target === target &&
                        a.active !== false
                    );
                    if (duplicate) {
                        await sendUpdatedMessage(chatId, '⚠️ Такое оповещение уже существует.', null, 'Markdown', messageId);
                        await setData(`state_${chatId}`, 'idle');
                        return;
                    }
                    const plan = await getUserPlan(chatId);
                    const limit = plan.limits.alerts || 0;
                    if (parsedAlerts.length >= limit && limit !== Infinity) {
                        await sendUpdatedMessage(chatId, `❌ Лимит оповещений: ${limit}`, null, 'Markdown', messageId);
                        await setData(`state_${chatId}`, 'idle');
                        return;
                    }
                    const alert = { id: Date.now().toString(), type: 'price', params: { symbol, target, direction: 'above' }, active: true, createdAt: Date.now() };
                    parsedAlerts.push(alert);
                    await setData(`alerts_${chatId}`, JSON.stringify(parsedAlerts));
                    await sendUpdatedMessage(chatId, getText(lang, 'alert_created'), null, 'Markdown', messageId);
                    await setData(`state_${chatId}`, 'idle');
                    return;
                }
            } else if (parts.length === 3 && parts[2].toLowerCase() === 'below') {
                const symbol = parts[0].toUpperCase();
                const target = parseFloat(parts[1]);
                if (!isNaN(target)) {
                    const alerts = await getData(`alerts_${chatId}`);
                    const parsedAlerts = alerts ? JSON.parse(alerts) : [];
                    const alert = { id: Date.now().toString(), type: 'price', params: { symbol, target, direction: 'below' }, active: true, createdAt: Date.now() };
                    parsedAlerts.push(alert);
                    await setData(`alerts_${chatId}`, JSON.stringify(parsedAlerts));
                    await sendUpdatedMessage(chatId, getText(lang, 'alert_created'), null, 'Markdown', messageId);
                    await setData(`state_${chatId}`, 'idle');
                    return;
                }
            }
            await sendUpdatedMessage(chatId, '❌ Неверный формат. Используйте `BTC 70000` или `BTC 65000 below`', null, 'Markdown', messageId);
            return;
        }

        if (state === 'alert_change') {
            const parts = text.split(' ');
            if (parts.length === 2) {
                const symbol = parts[0].toUpperCase();
                const target = parseFloat(parts[1]);
                if (!isNaN(target)) {
                    const alerts = await getData(`alerts_${chatId}`);
                    const parsedAlerts = alerts ? JSON.parse(alerts) : [];
                    const alert = { id: Date.now().toString(), type: 'change', params: { symbol, target }, active: true, createdAt: Date.now() };
                    parsedAlerts.push(alert);
                    await setData(`alerts_${chatId}`, JSON.stringify(parsedAlerts));
                    await sendUpdatedMessage(chatId, getText(lang, 'alert_created'), null, 'Markdown', messageId);
                    await setData(`state_${chatId}`, 'idle');
                    return;
                }
            }
            await sendUpdatedMessage(chatId, '❌ Неверный формат. Используйте `BTC 5`', null, 'Markdown', messageId);
            return;
        }

        // ===== AI-ЧАТ =====
        if (state === 'ai_chat') {
            if (text === '/exit' || text === 'выход' || text === 'Exit') {
                await setData(`state_${chatId}`, 'idle');
                await sendUpdatedMessage(chatId, getText(lang, 'ai_exit'), null, 'Markdown', messageId);
                await showMainMenu(chatId, lang);
                return;
            }
            await sendTyping(chatId);
            const response = `🤖 *AI-советник*\n\nЯ пока не могу ответить на этот вопрос, так как нахожусь в режиме обучения. Попробуйте использовать /analyze для анализа портфеля.`;
            const keyboard = {
                inline_keyboard: [
                    [{ text: '📊 Анализ портфеля', callback_data: 'action_analyze' }],
                    [{ text: '🔙 Назад', callback_data: 'back_to_functions' }]
                ]
            };
            await sendUpdatedMessage(chatId, response, keyboard, 'Markdown', messageId);
            return;
        }

        // ===== СТАРТ =====
        if (text === '/start') {
            const onboarded = await getData(`onboarded_${chatId}`);
            if (!onboarded) {
                await showLanguageSelectOnboarding(chatId);
                return;
            }
            await showMainMenu(chatId, lang);
            return;
        }

        // ===== КОМАНДЫ =====
        if (text === '/help') { await showHelpMenu(chatId, lang); return; }
        if (text === '/history') { await showHistoryMenu(chatId, lang); return; }
        if (text === '/settings') { await showSettingsMenuNew(chatId, lang); return; }
        if (text === '/subscribe' || text === '/plans') { await showPlansMenu(chatId, lang); return; }
        if (text === '/connect') {
            await sendUpdatedMessage(chatId, getText(lang, 'connect_prompt'), null, 'Markdown', messageId);
            await setData(`state_${chatId}`, 'waiting_for_keys');
            return;
        }
        if (text === '/disconnect') {
            await deleteData(`user_${chatId}`);
            await sendUpdatedMessage(chatId, getText(lang, 'connect_disconnected'), null, 'Markdown', messageId);
            await showMainMenu(chatId, lang);
            return;
        }
        if (text === '/analyze') {
            const savedData = await getData(`user_${chatId}`);
            if (!savedData) {
                await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'), null, 'Markdown', messageId);
                return;
            }
            await sendUpdatedMessage(chatId, '⏳ *Начинаю анализ...*', null, 'Markdown', messageId);
            const user = JSON.parse(savedData);
            const apiKey = decrypt(user.apiKey);
            const secretKey = decrypt(user.secretKey);
            try {
                const exchange = await connectExchange(apiKey, secretKey, user.exchangeId);
                const balance = await exchange.fetchBalance();
                const total = balance.total;
                const coins = Object.keys(total).filter(key => total[key] > 0);
                if (coins.length === 0) {
                    await sendUpdatedMessage(chatId, '📭 *На балансе нет монет.*', null, 'Markdown', messageId);
                    return;
                }
                let totalUSDT = 0;
                const assets = [];
                for (const coin of coins) {
                    if (coin === 'USDT') {
                        totalUSDT += total[coin];
                        continue;
                    }
                    try {
                        const ticker = await exchange.fetchTicker(`${coin}/USDT`);
                        const value = total[coin] * ticker.last;
                        totalUSDT += value;
                        assets.push({ symbol: coin, value });
                    } catch (e) {}
                }
                for (const a of assets) {
                    a.weight = (a.value / totalUSDT) * 100;
                }
                assets.sort((a, b) => b.weight - a.weight);
                const mode = await getData(`mode_${chatId}`) || 'beginner';
                const thresholds = getRiskThresholds(mode);
                const engineResult = {
                    totalUSDT: totalUSDT,
                    btcPercent: assets.find(a => a.symbol === 'BTC')?.weight || 0,
                    altPercent: assets.filter(a => a.symbol !== 'BTC' && a.symbol !== 'USDT').reduce((sum, a) => sum + a.weight, 0),
                    usdtPercent: assets.find(a => a.symbol === 'USDT')?.weight || 0,
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
                await setData(`analysis_${chatId}`, JSON.stringify(engineResult), 86400);
                await addHistory(chatId, getText(lang, 'history_analyze'), `$${totalUSDT.toFixed(2)}`);
            } catch (error) {
                console.error('Analysis error:', error);
                await notifyAdmin(error, { chatId, function: 'handleMessage_analyze' });
                await sendUpdatedMessage(chatId, `❌ Ошибка анализа: ${error.message}`, null, 'Markdown', messageId);
            }
            return;
        }

        // ===== НОВОСТИ =====
        if (text.startsWith('/news ')) {
            const coin = text.replace('/news ', '').trim();
            await handleNewsCommand(chatId, coin, lang, messageId);
            return;
        }
        if (text === '/news' || text === '/news ') {
            await handleNewsCommand(chatId, null, lang, messageId);
            return;
        }

        // ===== ТРЕНДЫ =====
        if (text.startsWith('/trend ')) {
            const coin = text.replace('/trend ', '').trim().toUpperCase();
            await handleTrendClick(chatId, `trend_${coin}`, lang, messageId);
            return;
        }

        // ===== АНТИСКАМ (ССЫЛКА ИЛИ КОНТРАКТ) =====
        if (text.startsWith('http://') || text.startsWith('https://') || (text.startsWith('0x') && text.length >= 42)) {
            await handleAntiScamInput(chatId, text, lang, update, messageId);
            return;
        }

        // ===== ОТВЕТ ПО УМОЛЧАНИЮ =====
        await sendUpdatedMessage(chatId, getText(lang, 'default_response', text), null, 'Markdown', messageId);

    } catch (error) {
        console.error('❌ Message error:', error);
        await notifyAdmin(error, { chatId, function: 'handleMessage', text });
        await sendUpdatedMessage(chatId, getText(lang, 'error_general', error.message), null, 'Markdown', messageId);
    }
}

// ============================================================
// 36. ИСПОЛНЕНИЕ РЕКОМЕНДАЦИЙ (С ПРОВЕРКАМИ)
// ============================================================

async function executeRecommendation(chatId, recId) {
    const analysisData = await getData(`analysis_${chatId}`);
    if (!analysisData) return { error: 'Нет данных анализа' };
    const analysis = JSON.parse(analysisData);
    const rec = analysis.recommendations.find(r => r.id === recId);
    if (!rec) return { error: 'Рекомендация не найдена' };

    const userPlan = await getUserPlan(chatId);
    if (!userPlan.limits.autotrade || userPlan.limits.autotrade === false) {
        return { error: 'Автоторговля недоступна на вашем тарифе' };
    }

    // Проверка лимита ордеров
    const orderLimitKey = `orders_${chatId}_${new Date().toISOString().split('T')[0]}`;
    let ordersToday = parseInt(await getData(orderLimitKey) || '0');
    if (ordersToday >= CONFIG.MAX_ORDERS_PER_DAY) {
        return { error: `Достигнут лимит ордеров на сегодня (${CONFIG.MAX_ORDERS_PER_DAY})` };
    }

    const keys = await loadUserKeys(chatId);
    if (!keys) return { error: 'Нет API-ключей' };

    try {
        const exchange = await connectExchange(keys.exchangeId, keys.apiKey, keys.secretKey);
        const balance = await exchange.fetchBalance();
        const free = balance.free[rec.asset] || 0;

        if (rec.action === 'sell' && free < rec.amount) {
            return { error: `Недостаточно ${rec.asset} на балансе (доступно: ${free}, нужно: ${rec.amount})` };
        }
        if (rec.action === 'buy') {
            const freeUSDT = balance.free['USDT'] || 0;
            const ticker = await exchange.fetchTicker(rec.symbol || `${rec.asset}/USDT`);
            const price = ticker ? ticker.last : 0;
            const needed = rec.amount * price;
            if (freeUSDT < needed) {
                return { error: `Недостаточно USDT для покупки (доступно: ${freeUSDT}, нужно: ${needed})` };
            }
        }

        // Проверка ликвидности и спреда
        if (rec.symbol) {
            const ticker = await exchange.fetchTicker(rec.symbol);
            const volume24h = ticker.quoteVolume || 0;
            const spread = ((ticker.ask - ticker.bid) / ticker.ask) * 100;
            if (volume24h < 50000) {
                return { error: `Низкая ликвидность (объём: $${volume24h.toFixed(0)})` };
            }
            if (spread > 0.5) {
                return { error: `Слишком большой спред (${spread.toFixed(2)}%)` };
            }
            const orderSize = rec.amount * ticker.last;
            if (orderSize > volume24h * 0.01) {
                return { error: `Размер ордера слишком велик для текущей ликвидности` };
            }
        }

        let order;
        if (rec.action === 'sell') {
            order = await exchange.createMarketSellOrder(rec.symbol, rec.amount);
        } else if (rec.action === 'buy') {
            order = await exchange.createMarketBuyOrder(rec.symbol, rec.amount);
        } else {
            return { error: `Неизвестное действие: ${rec.action}` };
        }

        // Проверка исполнения
        await new Promise(r => setTimeout(r, 3000));
        const orderStatus = await exchange.fetchOrder(order.id);
        if (orderStatus.status !== 'closed') {
            return { error: `Ордер не исполнился. Текущий статус: ${orderStatus.status}` };
        }

        await logTrade(chatId, orderStatus, rec);
        ordersToday++;
        await setData(orderLimitKey, ordersToday.toString(), 86400);

        return { success: true, order: orderStatus };
    } catch (error) {
        console.error('Order execution error:', error);
        return { error: `Ошибка исполнения: ${error.message}` };
    }
}

async function logTrade(chatId, order, recommendation) {
    const key = `trades_${chatId}`;
    let trades = await getData(key);
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
    await setData(key, JSON.stringify(trades));
}

// ============================================================
// 37. КОМПОЗИЦИЯ ОТЧЕТА (С РЕКОМЕНДАЦИЯМИ И ПРОГНОЗАМИ)
// ============================================================

async function composeReport(engineResult, mode, lang, dailyChange = 0) {
    const {
        totalUSDT, btcPercent, altPercent, usdtPercent,
        riskLevel, issues, recommendations,
        signals, btcMetrics, riskScore, assets, thresholds
    } = engineResult;

    let baseText = `📊 *АНАЛИЗ ПОРТФЕЛЯ*\n`;
    baseText += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    baseText += `💰 *Общая стоимость:* $${totalUSDT?.toFixed(2) || 0} USDT\n`;
    if (dailyChange !== 0) {
        const changeEmoji = dailyChange > 0 ? '📈' : '📉';
        baseText += `${changeEmoji} *Изменение (24ч):* ${dailyChange > 0 ? '+' : ''}${dailyChange.toFixed(2)}%\n`;
    }
    baseText += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Режим и риск-профиль
    const modeLabel = mode === 'beginner' ? '🔰 Новичок' : '🚀 Опытный';
    baseText += `🧠 *Режим:* ${modeLabel}\n`;
    if (thresholds) {
        baseText += `📊 *Риск-профиль:*\n`;
        baseText += `• Стоп-лосс: ${thresholds.stopLoss}%\n`;
        baseText += `• Тейк-профит: ${thresholds.takeProfit}%\n`;
        baseText += `• Макс. позиция: ${thresholds.maxPosition}%\n`;
        baseText += `• Макс. доля альтов: ${thresholds.maxAltExposure}%\n\n`;
    }

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
    baseText += `${riskEmoji} *Риск:* ${riskLabel} (${riskScore || 0} баллов)\n\n`;

    // Сравнение с рынком (если есть данные)
    if (assets && assets.length > 0) {
        const btcAsset = assets.find(a => a.symbol === 'BTC');
        if (btcAsset && btcAsset.change24h !== undefined) {
            const portfolioChange = dailyChange || 0;
            const btcChange = btcAsset.change24h || 0;
            const diff = portfolioChange - btcChange;
            const emoji = diff > 0 ? '🟢' : (diff < 0 ? '🔴' : '⚪');
            baseText += `📊 *СРАВНЕНИЕ С РЫНКОМ*\n`;
            baseText += `${emoji} Твой портфель: ${portfolioChange > 0 ? '+' : ''}${portfolioChange.toFixed(2)}%\n`;
            baseText += `₿ BTC: ${btcChange > 0 ? '+' : ''}${btcChange.toFixed(2)}%\n`;
            baseText += `📌 Ты ${diff > 0 ? 'лучше' : (diff < 0 ? 'хуже' : 'на уровне')} рынка на ${Math.abs(diff).toFixed(2)}%\n\n`;
        }
    }

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
        baseText += `\n`;
    }

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

    if (signals && signals.length > 0) {
        baseText += `📊 *СИГНАЛЫ*\n`;
        for (const s of signals) {
            const emoji = s.type === 'bullish' ? '🟢' : s.type === 'bearish' ? '🔴' : s.type === 'overbought' ? '🟥' : s.type === 'oversold' ? '🟩' : 'ℹ️';
            baseText += `${emoji} ${s.text}\n`;
        }
        baseText += `\n`;
    }

    if (issues && issues.length > 0) {
        baseText += `⚠️ *ПРОБЛЕМЫ*\n`;
        for (const issue of issues) {
            const emoji = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
            baseText += `${emoji} ${issue.text}\n`;
        }
        baseText += `\n`;
    }

    const keyboard = { inline_keyboard: [] };

    if (recommendations && recommendations.length > 0) {
        baseText += `💡 *РЕКОМЕНДАЦИИ*\n`;
        for (const rec of recommendations.slice(0, 5)) {
            // Прогноз последствий для каждой рекомендации
            const asset = assets?.find(a => a.symbol === rec.asset);
            const amountUSD = rec.amount * (asset?.value / (asset?.value / (asset?.value / rec.amount) || 1) || 0);
            const newWeight = asset ? ((asset.value - amountUSD) / totalUSDT * 100) : 0;
            const confidence = rec.action === 'sell' ? (rec.rsi_signal === 'overbought' ? 70 : 55) : (rec.rsi_signal === 'oversold' ? 70 : 55);
            const confidenceEmoji = confidence > 70 ? '🟢' : (confidence > 40 ? '🟡' : '🔴');

            baseText += `• ${rec.reason}\n`;
            baseText += `   📊 *Эффект:* зафиксируешь ~$${amountUSD.toFixed(2)}, новая доля ${newWeight.toFixed(1)}%\n`;
            baseText += `   🎯 *Уверенность:* ${confidenceEmoji} ${confidence}%\n`;
            if (rec.action === 'sell' || rec.action === 'buy') {
                const actionText = rec.action === 'sell' ? 'Продать' : 'Купить';
                keyboard.inline_keyboard.push([
                    { text: `📈 ${actionText} ${rec.asset}`, callback_data: `exec_${rec.id}` }
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
        { text: '🔄 Ребаланс', callback_data: 'action_rebalance' },
        { text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }
    ]);

    baseText += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    baseText += `🛡️ *Void Node — твой телохранитель в крипте*\n`;
    baseText += `\n⚠️ *Это не финансовая рекомендация.*`;

    return { text: baseText, keyboard };
}

// ============================================================
// 38. ВЕБХУК CRYPTOBOT
// ============================================================

async function handleCryptoWebhook(request) {
    try {
        const update = await request.json();
        if (update.update_type === 'invoice_paid') {
            const payload = update.payload;
            const customPayload = payload.payload;
            const parts = customPayload.split('_');
            const planId = parts[1];
            const chatId = parseInt(parts[2]);
            const lang = await getData(`lang_${chatId}`) || 'ru';
            const plan = await activatePlan(chatId, planId);
            if (plan) {
                await sendUpdatedMessage(chatId, getText(lang, 'plans_success', plan.name));
                await showMainMenu(chatId, lang);
            }
        }
        return { status: 200 };
    } catch (error) {
        console.error('❌ Webhook error:', error);
        return { status: 500, error: error.message };
    }
}

// ============================================================
// 39. АВТОТОРГОВЛЯ (ФОНОВАЯ)
// ============================================================

async function runAutotrade() {
    const keys = await VOID_KV.list('autotrade_');
    for (const key of keys.keys) {
        const chatId = parseInt(key.name.replace('autotrade_', ''));
        const data = await getData(key.name);
        if (!data) continue;
        const config = JSON.parse(data);
        if (!config.active) continue;

        const mode = await getData(`mode_${chatId}`) || 'beginner';
        const thresholds = getRiskThresholds(mode);

        const keysUser = await loadUserKeys(chatId);
        if (!keysUser) continue;

        try {
            const exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
            const balance = await exchange.fetchBalance();
            const total = balance.total;
            const coins = Object.keys(total).filter(c => c !== 'USDT' && total[c] > 0);

            if (config.level === 1) {
                // Уровень 1: Защита
                for (const coin of coins) {
                    try {
                        const ticker = await exchange.fetchTicker(`${coin}/USDT`);
                        if (!ticker) continue;
                        const price = ticker.last;
                        const stopLoss = thresholds.stopLoss;
                        const stop5 = price * (1 - stopLoss / 100);
                        const stop10 = price * 0.90;
                        await exchange.createOrder(`${coin}/USDT`, 'stop_loss_limit', 'sell', total[coin], stop5, { stopPrice: stop5 });
                        await exchange.createOrder(`${coin}/USDT`, 'stop_loss_limit', 'sell', total[coin] * 0.5, stop10, { stopPrice: stop10 });
                    } catch (e) {}
                }
            } else if (config.level === 2) {
                // Уровень 2: Перераспределение
                for (const coin of coins) {
                    try {
                        const ticker = await exchange.fetchTicker(`${coin}/USDT`);
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
                // Уровень 3: Умный рост
                const settingsKey = `autotrade_settings_${chatId}`;
                let settings = await getData(settingsKey);
                settings = settings ? JSON.parse(settings) : {};
                for (const coin of coins) {
                    try {
                        const ticker = await exchange.fetchTicker(`${coin}/USDT`);
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
                await setData(settingsKey, JSON.stringify(settings));
            }
        } catch (error) {
            console.error(`Autotrade error for ${chatId}:`, error);
        }
    }
}

// ============================================================
// 40. ХОЛОДНЫЙ ДУШ (ПРОВЕРКА BTC + КОНВЕРТАЦИЯ)
// ============================================================

async function checkPanic() {
    const keys = await VOID_KV.list('panic_');
    for (const key of keys.keys) {
        const chatId = parseInt(key.name.replace('panic_', ''));
        const config = await getData(key.name);
        if (!config) continue;
        const { active, lastPrice } = JSON.parse(config);
        if (!active) continue;

        const keysUser = await loadUserKeys(chatId);
        if (!keysUser) continue;

        try {
            const exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
            const ticker = await exchange.fetchTicker('BTC/USDT');
            if (!ticker) continue;
            const currentPrice = ticker.last;

            if (lastPrice && (lastPrice - currentPrice) / lastPrice >= 0.05) {
                const keyboard = {
                    inline_keyboard: [[{ text: getText('ru', 'panic_convert'), callback_data: 'panic_convert' }]]
                };
                await sendMessage(chatId, getText('ru', 'panic_trigger', { percent: 5 }), keyboard);
                await setData(key.name, JSON.stringify({ active: true, lastPrice: currentPrice }));
            } else {
                await setData(key.name, JSON.stringify({ active: true, lastPrice: currentPrice }));
            }
        } catch (error) {
            console.error(`Panic check error for ${chatId}:`, error);
        }
    }
}

async function handlePanicConvert(chatId) {
    const keys = await loadUserKeys(chatId);
    if (!keys) {
        await sendMessage(chatId, '❌ Нет ключей для конвертации.');
        return;
    }
    try {
        const exchange = await connectExchange(keys.exchangeId, keys.apiKey, keys.secretKey);
        const balance = await exchange.fetchBalance();
        const coins = Object.keys(balance.total).filter(c => c !== 'USDT' && balance.total[c] > 0);
        let converted = 0;
        for (const coin of coins) {
            try {
                const amount = balance.total[coin];
                await exchange.createMarketSellOrder(`${coin}/USDT`, amount);
                converted++;
            } catch (e) {
                console.error(`Ошибка конвертации ${coin}:`, e.message);
            }
        }
        await sendMessage(chatId,
            `✅ *Конвертация выполнена!*\n\n🔄 Продано ${converted} активов в USDT.\n🛡️ Портфель в безопасности.`
        );
        await deleteData(`panic_${chatId}`);
    } catch (error) {
        console.error('Panic convert error:', error);
        await sendMessage(chatId, `❌ Ошибка конвертации: ${error.message}`);
    }
}

// ============================================================
// 41. ОПОВЕЩЕНИЯ (ФОНОВАЯ ПРОВЕРКА)
// ============================================================

async function checkAlerts() {
    const keys = await VOID_KV.list('alerts_');
    for (const key of keys.keys) {
        const chatId = parseInt(key.name.replace('alerts_', ''));
        const alerts = await getData(key.name);
        if (!alerts) continue;
        const parsedAlerts = JSON.parse(alerts);

        const keysUser = await loadUserKeys(chatId);
        if (!keysUser) continue;

        try {
            const exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
            for (const alert of parsedAlerts) {
                if (!alert.active) continue;
                try {
                    const ticker = await exchange.fetchTicker(`${alert.params.symbol}/USDT`);
                    if (!ticker) continue;
                    const price = ticker.last;
                    if (alert.type === 'price') {
                        if (alert.params.direction === 'above' && price >= alert.params.target) {
                            await sendMessage(chatId, getText('ru', 'alert_triggered', { symbol: alert.params.symbol, condition: `Цена > ${alert.params.target}`, value: price }));
                            alert.active = false;
                        } else if (alert.params.direction === 'below' && price <= alert.params.target) {
                            await sendMessage(chatId, getText('ru', 'alert_triggered', { symbol: alert.params.symbol, condition: `Цена < ${alert.params.target}`, value: price }));
                            alert.active = false;
                        }
                    } else if (alert.type === 'volume') {
                        const volume = ticker.quoteVolume || 0;
                        if (volume > alert.params.target) {
                            await sendMessage(chatId, getText('ru', 'alert_triggered', { symbol: alert.params.symbol, condition: `Объём > ${alert.params.target}`, value: volume }));
                            alert.active = false;
                        }
                    }
                } catch (e) {}
            }
            await setData(key.name, JSON.stringify(parsedAlerts));
        } catch (error) {
            console.error(`Alert check error for ${chatId}:`, error);
        }
    }
}

// ============================================================
// 42. ЗАГРУЗКА КЛЮЧЕЙ (ВСПОМОГАТЕЛЬНАЯ)
// ============================================================

async function loadUserKeys(chatId) {
    const key = `user_${chatId}`;
    const data = await getData(key);
    if (!data) return null;
    try {
        const parsed = JSON.parse(data);
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
// 43. ЗАПУСК ФОНОВЫХ ЗАДАЧ
// ============================================================

// Запуск с восстановлением при ошибках
function runTaskWithRecovery(task, name, interval) {
    const run = async () => {
        try {
            await task();
        } catch (error) {
            console.error(`❌ ${name} error:`, error);
        } finally {
            setTimeout(run, interval);
        }
    };
    run();
}

runTaskWithRecovery(checkAlerts, 'checkAlerts', CONFIG.ALERT_CHECK_INTERVAL);
runTaskWithRecovery(runAutotrade, 'runAutotrade', CONFIG.AUTOTRADE_CHECK_INTERVAL);
runTaskWithRecovery(checkPanic, 'checkPanic', CONFIG.PANIC_CHECK_INTERVAL);

// Ежедневное уведомление об окончании подписки
async function checkExpiringPlans() {
    const keys = await VOID_KV.list('plan_');
    const now = Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    for (const key of keys.keys) {
        const chatId = parseInt(key.name.replace('plan_', ''));
        const data = await getData(key.name);
        if (!data) continue;
        const plan = JSON.parse(data);
        if (plan.expires && plan.expires - now < threeDays && plan.expires - now > 0) {
            const lang = await getData(`lang_${chatId}`) || 'ru';
            await sendMessage(chatId,
                `⚠️ *Твоя подписка заканчивается через 3 дня!*\n\n` +
                `📅 ${new Date(plan.expires).toLocaleDateString()}\n\n` +
                `Чтобы продлить — отправь /subscribe`,
                null, 'Markdown'
            );
        }
    }
}
setInterval(checkExpiringPlans, 24 * 60 * 60 * 1000);

// ============================================================
// EXPRESS СЕРВЕР
// ============================================================

const app = express();
app.use(express.json());

app.use((req, res, next) => {
    console.log(`📩 ${req.method} ${req.url}`);
    next();
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime()
    });
});

app.get('/webhook', (req, res) => {
    res.status(200).send('Webhook is active');
});

app.post('/webhook', async (req, res) => {
    console.log('✅ Webhook вызван!');
    try {
        const update = req.body;
        console.log(`📩 Webhook received: ${JSON.stringify(update).slice(0, 200)}...`);
        if (update.callback_query) {
            console.log('🔄 Обработка callback...');
            await handleCallback(update);
            res.sendStatus(200);
            return;
        }
        if (update.message) {
            console.log(`💬 Сообщение от ${update.message.from?.first_name || 'Unknown'}`);
            await handleMessage(update);
            res.sendStatus(200);
            return;
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.sendStatus(500);
    }
});

app.post('/webhook/crypto', async (req, res) => {
    try {
        const result = await handleCryptoWebhook(req);
        res.status(result.status || 200).json(result);
    } catch (error) {
        console.error('❌ Crypto webhook error:', error);
        res.sendStatus(500);
    }
});

// ============================================================
// ЗАПУСК СЕРВЕРА
// ============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Бот запущен на порту ${PORT}`);
    console.log(`📡 Webhook URL: https://ваш-домен.onrender.com/webhook`);
    console.log(`🩺 Health Check: https://ваш-домен.onrender.com/health`);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

console.log('✅ Бот полностью загружен!');

// ============================================================
// КОНЕЦ ФАЙЛА
// ============================================================
