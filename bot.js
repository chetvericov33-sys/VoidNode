// ============================================================
// БОТ VOID NODE — ПОЛНАЯ РАБОЧАЯ ВЕРСИЯ 0.1 (С AI СОВЕТНИКОМ)
// ============================================================

require('dotenv').config();
const express = require('express');
const ccxt = require('ccxt');
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

const BOT_TOKEN = process.env.BOT_TOKEN;
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
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!BOT_TOKEN) { console.error('BOT_TOKEN not found'); process.exit(1); }
if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    console.error('UPSTASH_REDIS_REST_URL or TOKEN not found');
    process.exit(1);
}

var CONFIG = {
    MAX_RECOMMENDATIONS: 5,
    ALERT_CHECK_INTERVAL: 300000,
    AUTOTRADE_CHECK_INTERVAL: 900000,
    PANIC_CHECK_INTERVAL: 900000,
    MAX_ORDERS_PER_DAY: 10,
    WHITELIST_SYMBOLS: ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT', 'ADA/USDT', 'DOT/USDT']
};

// ============================================================
// 1. REDIS STORAGE
// ============================================================
class RedisStorage {
    constructor() {
        this.redis = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });
        this.localCache = new Map();
        this.isRedisAvailable = true;
        console.log('Redis connected');
    }

    async get(key) {
        try {
            if (this.isRedisAvailable) {
                var data = await this.redis.get(key);
                if (data !== null && data !== undefined) return data;
            }
            return this.localCache.get(key) || null;
        } catch (error) {
            console.error('Redis get error:', error);
            this.isRedisAvailable = false;
            setTimeout(function() { this.isRedisAvailable = true; }.bind(this), 60000);
            return this.localCache.get(key) || null;
        }
    }

    async put(key, value, ttl) {
        if (ttl === undefined) ttl = null;
        try {
            if (this.isRedisAvailable) {
                await this.redis.set(key, value);
                if (ttl) await this.redis.expire(key, ttl);
            }
            this.localCache.set(key, value);
        } catch (error) {
            console.error('Redis set error:', error);
            this.isRedisAvailable = false;
            this.localCache.set(key, value);
            setTimeout(function() { this.isRedisAvailable = true; }.bind(this), 60000);
        }
    }

    async delete(key) {
        try {
            if (this.isRedisAvailable) await this.redis.del(key);
            this.localCache.delete(key);
        } catch (error) {
            console.error('Redis delete error:', error);
            this.localCache.delete(key);
        }
    }

    async list(prefix) {
        if (prefix === undefined) prefix = '';
        try {
            if (this.isRedisAvailable) {
                var keys = await this.redis.keys(prefix + '*');
                return keys.map(function(k) { return { name: k }; });
            }
            return [];
        } catch (error) {
            console.error('Redis list error:', error);
            return [];
        }
    }
}

var VOID_KV = new RedisStorage();

async function getData(key) { return await VOID_KV.get(key); }
async function setData(key, value, ttl) { if (ttl === undefined) ttl = null; await VOID_KV.put(key, value, ttl); }
async function deleteData(key) { await VOID_KV.delete(key); }

// ============================================================
// 2. SINGLE MESSAGE SYSTEM
// ============================================================
async function getUserLastMessageId(chatId) {
    var key = 'last_msg_' + chatId;
    var data = await getData(key);
    return data ? parseInt(data) : null;
}

async function setUserLastMessageId(chatId, messageId) {
    var key = 'last_msg_' + chatId;
    await setData(key, messageId.toString());
}

async function deleteUserLastMessage(chatId) {
    try {
        var messageId = await getUserLastMessageId(chatId);
        if (messageId) {
            await botDeleteMessage(chatId, messageId);
            await deleteData('last_msg_' + chatId);
        }
    } catch (error) {
        console.error('deleteUserLastMessage error:', error);
    }
}

async function botDeleteMessage(chatId, messageId) {
    try {
        var url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/deleteMessage';
        var body = { chat_id: chatId, message_id: messageId };
        var response = await fetch(url, {
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
        var url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/deleteMessage';
        var body = { chat_id: chatId, message_id: messageId };
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
        var url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/getMessage';
        var body = { chat_id: chatId, message_id: messageId };
        var response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

async function sendMessage(chatId, text, keyboard, parseMode) {
    if (!text) return null;
    if (keyboard === undefined) keyboard = null;
    if (parseMode === undefined) parseMode = 'Markdown';
    try {
        var url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage';
        var body = {
            chat_id: chatId,
            text: text,
            parse_mode: parseMode,
            disable_web_page_preview: true
        };
        if (keyboard) body.reply_markup = keyboard;
        var response = await fetch(url, {
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

async function sendUpdatedMessage(chatId, text, keyboard, parseMode, userMessageId, skipBackButton) {
    if (keyboard === undefined) keyboard = null;
    if (parseMode === undefined) parseMode = 'Markdown';
    if (userMessageId === undefined) userMessageId = null;
    if (skipBackButton === undefined) skipBackButton = false;
    
    if (userMessageId) {
        var msgExists = await checkMessageExists(chatId, userMessageId);
        if (msgExists) {
            await deleteUserMessageWithDelay(chatId, userMessageId, 1500);
        }
    }
    await deleteUserLastMessage(chatId);
    
    if (!skipBackButton && keyboard && keyboard.inline_keyboard) {
        var hasBackButton = false;
        for (var i = 0; i < keyboard.inline_keyboard.length; i++) {
            var row = keyboard.inline_keyboard[i];
            for (var j = 0; j < row.length; j++) {
                var btn = row[j];
                if (btn.callback_data === 'back_to_menu' || btn.callback_data === 'exit_to_menu' || 
                    btn.callback_data === 'back_to_functions' || btn.callback_data === 'back_to_settings' || 
                    btn.callback_data === 'back_to_market' || btn.callback_data === 'back_to_security' || 
                    btn.callback_data === 'back_to_plans' || btn.callback_data === 'back_to_history' ||
                    btn.callback_data === 'back_to_help' || btn.callback_data === 'back_to_analyze') {
                    hasBackButton = true;
                    break;
                }
            }
            if (hasBackButton) break;
        }
        if (!hasBackButton) {
            var lang = await getData('lang_' + chatId) || 'ru';
            keyboard.inline_keyboard.push([{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]);
        }
    }
    
    var result = await sendMessage(chatId, text, keyboard, parseMode);
    if (result && result.ok) {
        var data = await result.json();
        if (data.result && data.result.message_id) {
            await setUserLastMessageId(chatId, data.result.message_id);
        }
    }
    return result;
}

async function sendTyping(chatId) {
    try {
        await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendChatAction?chat_id=' + chatId + '&action=typing');
    } catch (e) {}
}

async function answerCallback(callbackId, text, showAlert) {
    if (text === undefined) text = null;
    if (showAlert === undefined) showAlert = false;
    try {
        var url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/answerCallbackQuery';
        var body = { callback_query_id: callbackId, show_alert: showAlert };
        if (text) body.text = text;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (e) {}
}

async function sendDocument(chatId, content, filename) {
    try {
        var url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/sendDocument';
        var formData = new FormData();
        formData.append('chat_id', chatId);
        var blob = new Blob([content], { type: 'text/csv' });
        formData.append('document', blob, filename);
        await fetch(url, { method: 'POST', body: formData });
    } catch (error) {
        console.error('Send document error:', error);
    }
}

// ============================================================
// 3. ENCRYPTION
// ============================================================
function encrypt(text) {
    try {
        var key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
        var iv = crypto.randomBytes(12);
        var cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        var encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        var tag = cipher.getAuthTag().toString('base64');
        return iv.toString('base64') + ':' + encrypted + ':' + tag;
    } catch (error) { console.error('Encryption error:', error); return null; }
}

function decrypt(encoded) {
    try {
        var parts = encoded.split(':');
        if (parts.length !== 3) return null;
        var iv = Buffer.from(parts[0], 'base64');
        var tag = Buffer.from(parts[2], 'base64');
        var key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
        var decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        var decrypted = decipher.update(parts[1], 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) { console.error('Decryption error:', error); return null; }
}

// ============================================================
// 4. HELPER FUNCTIONS
// ============================================================
function sanitizeInput(text) {
    if (!text) return '';
    var sanitized = text.replace(/[<>{}[\]`]/g, '').trim();
    if (sanitized.length > 4096) sanitized = sanitized.slice(0, 4096);
    return sanitized;
}

function isValidContractAddress(address) {
    if (!address || typeof address !== 'string') return false;
    var clean = address.trim();
    if (!clean.startsWith('0x')) return false;
    if (clean.length !== 42) return false;
    return /^[0-9a-fA-F]{40}$/.test(clean.slice(2));
}

function isValidUrl(string) {
    try {
        var url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) { return false; }
}

function formatDateShort(date) {
    var d = new Date(date);
    var day = String(d.getDate()).padStart(2, '0');
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var year = String(d.getFullYear()).slice(-2);
    return day + '.' + month + '.' + year;
}

function createProgressBarUI(value, max, length) {
    if (max === undefined) max = 100;
    if (length === undefined) length = 10;
    var percent = Math.min(value / max, 1);
    var filled = Math.round(percent * length);
    var empty = length - filled;
    return '🟩'.repeat(filled) + '⬜'.repeat(empty);
}

// ============================================================
// 4.1. ФУНКЦИИ ДЛЯ ФОРМАТИРОВАНИЯ СООБЩЕНИЙ
// ============================================================

function formatSection(title, emoji) {
    if (emoji === undefined) emoji = '📌';
    return '\n' + emoji + ' *' + title + '*\n━━━━━━━━━━━━━━━━━━━━━━━\n';
}

function formatSubSection(title, emoji) {
    if (emoji === undefined) emoji = '•';
    return '\n' + emoji + ' **' + title + '**';
}

function formatValue(label, value, emoji) {
    if (emoji === undefined) emoji = '';
    return emoji + ' ' + label + ': ' + value;
}

function formatRecommendation(text, status) {
    if (status === undefined) status = 'info';
    var emojis = {
        success: '✅',
        warning: '⚠️',
        danger: '🔴',
        info: '💡',
        buy: '📈',
        sell: '📉',
        neutral: '⚪'
    };
    return (emojis[status] || '•') + ' ' + text;
}

function formatAssetLine(symbol, amount, value, weight, change) {
    var line = '• *' + symbol + '*: ' + amount.toFixed(4) + ' → $' + value.toFixed(2) + ' (' + weight.toFixed(1) + '%)';
    if (change !== null && change !== 0 && !isNaN(change)) {
        var sign = change > 0 ? '+' : '';
        var emoji = change > 0 ? '📈' : '📉';
        line += '  ' + emoji + ' ' + sign + change.toFixed(2) + '%';
    }
    return line;
}

function getStatusEmoji(value, good, bad) {
    if (value <= good) return '✅';
    if (value <= bad) return '⚠️';
    return '🔴';
}

function getRiskLabel(score) {
    if (score > 70) return { emoji: '🔴', label: 'Высокий' };
    if (score > 40) return { emoji: '🟡', label: 'Средний' };
    return { emoji: '🟢', label: 'Низкий' };
}

function formatHelpAnswer(text, lang) {
    var exitText = lang === 'ru' ? '\n\n━━━━━━━━━━━━━━━━━━━━━━━\n💡 Для выхода в меню отправьте /exit' : '\n\n━━━━━━━━━━━━━━━━━━━━━━━\n💡 To exit to menu send /exit';
    return text + exitText;
}

function getCancelKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: getText(lang, 'cancel'), callback_data: 'cancel_action' }]
        ]
    };
}

function getErrorKeyboard(lang, retryCallback, helpCallback) {
    if (retryCallback === undefined) retryCallback = null;
    if (helpCallback === undefined) helpCallback = 'menu_help';
    var buttons = [];
    if (retryCallback) {
        buttons.push([{ text: '🔄 ' + (lang === 'ru' ? 'Попробовать снова' : 'Try again'), callback_data: retryCallback }]);
    }
    buttons.push([{ text: '📖 ' + (lang === 'ru' ? 'Инструкция' : 'Help'), callback_data: helpCallback }]);
    buttons.push([{ text: '🏠 ' + (lang === 'ru' ? 'В меню' : 'Main menu'), callback_data: 'back_to_menu' }]);
    return { inline_keyboard: buttons };
}

// ============================================================
// 5. PLANS
// ============================================================
var PLANS = {
    TRIAL: {
        id: 'TRIAL',
        name: '🔰 Trial',
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
        name: '⭐ Start',
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

var planCache = new Map();

async function getUserPlan(chatId) {
    if (planCache.has(chatId)) {
        var cached = planCache.get(chatId);
        if (Date.now() - cached.timestamp < 60000) return cached.data;
    }
    var key = 'plan_' + chatId;
    var data = await getData(key);
    var result;
    if (!data) {
        await activateTrial(chatId);
        result = { plan: 'TRIAL', ...PLANS.TRIAL, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
    } else {
        try {
            var parsed = typeof data === 'string' ? JSON.parse(data) : data;
            var plan = PLANS[parsed.planId];
            if (!plan) {
                await activateTrial(chatId);
                result = { plan: 'TRIAL', ...PLANS.TRIAL, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
            } else if (parsed.planId === 'TRIAL' && parsed.trialUsed && parsed.expires < Date.now()) {
                result = {
                    plan: 'NONE',
                    name: '❌ No subscription',
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
                    features: ['❌ Subscription expired. Renew: /subscribe'],
                    features_en: ['❌ Subscription expired. Renew: /subscribe']
                };
            } else if (parsed.planId !== 'TRIAL' && parsed.expires < Date.now()) {
                result = {
                    plan: 'NONE',
                    name: '❌ No subscription',
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
                    features: ['❌ Subscription expired. Renew: /subscribe'],
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
    var key = 'plan_' + chatId;
    var existing = await getData(key);
    if (existing) {
        try {
            var parsed = typeof existing === 'string' ? JSON.parse(existing) : existing;
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
    var plan = PLANS[planId];
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
    var expires = Date.now() + 3 * 24 * 60 * 60 * 1000;
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
    var userPlan = await getUserPlan(chatId);
    var limit = userPlan.limits[feature];
    if (limit === undefined || limit === false) {
        return { allowed: false, reason: '❌ Feature not available on "' + userPlan.name + '" plan\n💳 /subscribe' };
    }
    if (limit === Infinity) return { allowed: true };
    var key = 'usage_' + chatId + '_' + feature + '_' + new Date().toISOString().split('T')[0];
    var usage = await getData(key);
    var count = usage ? parseInt(usage) : 0;
    if (count >= limit) {
        return { allowed: false, reason: '📊 Limit exceeded. Upgrade: /subscribe' };
    }
    await setData(key, (count + 1).toString());
    return { allowed: true };
}

// ============================================================
// 6. FULL LOCALIZATION (RUSSIAN + ENGLISH)
// ============================================================

var LANGUAGES = {
    ru: {
        language_select: '🌍 *Выберите язык / Choose language:*',
        mode_select: '📊 *Выбери свой уровень:*',
        mode_beginner_desc: '🔰 *Новичок*\n• Целевые веса: BTC 50%, Альты 30%, Стейблы 20%\n• Простые рекомендации по портфелю\n• Базовые метрики (риск, распределение)',
        mode_pro_desc: '🚀 *Опытный*\n• Целевые веса: BTC 40%, Альты 40%, Стейблы 20%\n• Расширенные рекомендации\n• Полные метрики (Шарп, RSI, MA20, просадка)',
        mode_select_prompt: '👇 *Выбери режим:*',
        mode_beginner_btn: '🔰 Новичок',
        mode_pro_btn: '🚀 Опытный',
        
        menu_title: '🔮 *Void Node — твой крипто-телохранитель*\n\n🏠 *Главное меню:*\n\n💡 Используйте кнопки ниже или быстрые команды:\n/analyze, /news, /help',
        main_functions: '📊 Функции',
        main_settings: '⚙️ Настройки',
        main_plans: '💳 Тарифы',
        main_help: '❓ Помощь',
        main_about: 'ℹ️ О боте',
        
        functions_title: '📊 *Функции*\n\nВыберите раздел:',
        functions_analyze: '📊 Анализ портфеля',
        functions_security: '🛡️ Антискам-центр',
        functions_news: '📰 Новости',
        functions_history: '📋 История',
        
        settings_title: '⚙️ *Настройки*',
        settings_lang: '🌍 Язык:',
        settings_mode: '🧠 Режим:',
        settings_change_lang: '🌍 Сменить язык',
        settings_change_mode: '🧠 Сменить режим',
        
        help_menu_title: '❓ *Помощь по боту*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nВыберите вопрос:',
        help_q1: '🔐 Как подключить биржу?',
        help_q2: '📊 Как работает анализ портфеля?',
        help_q3: '🔐 Зачем подключать биржу?',
        help_q4: '🛡️ Как проверить контракт?',
        help_q5: '🔔 Как создать оповещение?',
        help_q6: '🚀 Как включить автоторговлю?',
        help_q7: '❄️ Что такое холодный душ?',
        help_q8: '📝 Как работает дневник настроения?',
        help_q9: '🔌 Как отключить биржу?',
        help_contact_moderator: '👤 Написать модератору',
        
        help_answer_q1: '🔐 *Как подключить биржу?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n1️⃣ Зайдите на биржу (Binance, Bybit, OKX и др.)\n2️⃣ Перейдите в раздел управления API\n3️⃣ Создайте ключ с правами *только на чтение*\n4️⃣ Скопируйте API-ключ и Secret-ключ\n5️⃣ Отправьте их в бот командой /connect в формате:\n"API_KEY:SECRET_KEY"\n\n🔒 *Ключи шифруются и не имеют права на вывод средств.*',
        help_answer_q2: '📊 *Как работает анализ портфеля?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nКоманда /analyze запускает полный анализ:\n\n✅ Показывает распределение активов (BTC, альты, стейблы)\n✅ Рассчитывает RSI, скользящие средние (MA20, MA200)\n✅ Оценивает риск (низкий/средний/высокий)\n✅ Считает коэффициент Шарпа и VaR\n✅ Даёт конкретные рекомендации по ребалансировке\n\n📌 После анализа вы можете исполнить рекомендации одним нажатием кнопки.',
        help_answer_q3: '🔐 *Зачем подключать биржу?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nПодключение биржи даёт доступ к ключевым функциям:\n\n1️⃣ Анализ портфеля — бот видит активы и даёт рекомендации\n2️⃣ Автоторговля — автоматическая защита и ребаланс\n3️⃣ Холодный душ — экстренная защита при падении рынка\n4️⃣ Оповещения — уведомления по вашим активам\n5️⃣ Ребаланс — автоматическое поддержание целевых весов\n\n🔒 Ключи шифруются и имеют права только на чтение.',
        help_answer_q4: '🛡️ *Как проверить контракт?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nОтправьте адрес контракта (0x...) в чат — бот проверит:\n\n✅ Верификацию на Etherscan\n✅ Подозрительные паттерны (honeypot)\n✅ Скоринг риска (0–100 баллов)\n\n📌 Пример: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"',
        help_answer_q5: '🔔 *Как создать оповещение?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nИспользуйте /alerts или меню *Оповещения*.\n\n5 типов оповещений:\n\n📊 По цене — при достижении заданной цены\n📈 По изменению % — при изменении цены более чем на X%\n📊 По объёму — при превышении объёма торгов\n📰 Новостное — при появлении новостей по вашим активам\n📅 Календарное — перед важными экономическими событиями\n\n📌 Лимит зависит от вашего тарифа.',
        help_answer_q6: '🚀 *Как включить автоторговлю?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n/autotrade открывает меню с 4 уровнями:\n\n🛡️ *Уровень 1 (Защита)* — стоп-лоссы 5% и 10%\n🔄 *Уровень 2 (Перераспределение)* — продажа мусора, покупка роста\n🧠 *Уровень 3 (Умный рост)* — трейлинг стоп-лосс, фиксация 30% прибыли\n❄️ *Уровень 4 (Снежный ком)* — переток из мусорных в растущие\n\n📌 Доступна только на PRO и VIP.',
        help_answer_q7: '❄️ *Что такое холодный душ?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nЭкстренная защита при падении рынка:\n\n✅ Бот проверяет ВСЕ токены каждые 15 минут\n✅ При падении >5% за 15 минут — отправляет предупреждение\n✅ Предлагает конвертировать все активы в USDT\n\n🛡️ Доступен на PRO и VIP.',
        help_answer_q8: '📝 *Как работает дневник настроения?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n/diary открывает дневник эмоций.\n\nВыберите настроение:\n😌 Спокоен | 🤔 Задумчив | 😰 Тревожен | 😱 Паника | 😤 Зол | 😊 Эйфория\n\n📌 Бот сохраняет записи. Если вы тревожны 3 дня подряд — бот предупредит вас.',
        help_answer_q9: '🔌 *Как отключить биржу?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n/disconnect или *Настройки* → *Отключить биржу*.\n\nПосле подтверждения API-ключи будут удалены.\n\n📌 Если вы случайно подтвердили, есть 10 секунд на отмену: /undo',
        help_contact_moderator_message: '👤 *Связь с модератором*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nНапишите @clofeLEAN — он вам поможет!',
        
        market_menu: '📈 Рынок',
        market_social: '📊 Соц.тренды',
        market_news: '📰 Новости',
        market_calendar: '📅 Календарь',
        back_to_market: '🔙 Назад к рынку',
        
        social_menu: '📊 *Выберите монету:*',
        social_search: '🔎 Найти токен',
        social_analyzing: function(coin) { return '⏳ Получаю данные по ' + coin + '...'; },
        social_search_prompt: '🔎 *Введите название токена*\n\n📌 Примеры: PEPE, ARB, SOL, DOGE, SHIB\n🔄 /cancel — отмена',
        social_search_invalid: '❌ *Некорректное название токена.*\n\n📌 Введите тикер (например: PEPE, ARB, SOL, DOGE, SHIB).',
        
        news_analyzing: '📰 Получаю новости...',
        news_empty: '📭 Новостей не найдено.',
        news_coin: function(coin) { return '📰 *НОВОСТИ: ' + coin + '*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n'; },
        news_personalized_header: '📰 *НОВОСТИ ДЛЯ ТВОЕГО ПОРТФЕЛЯ*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n',
        news_no_assets: '❌ Сначала выполни /analyze, чтобы я знал твой портфель.',
        news_no_news: '📭 Новостей по твоим активам не найдено.',
        
        calendar_analyzing: '📅 Формирую календарь...',
        calendar_empty: '📭 На эту неделю важных событий не найдено.',
        calendar_pro_only: '❌ *Календарь трейдера доступен на тарифах PRO и VIP.*\n\n💳 /subscribe',
        calendar_result: function(events) {
            if (!events || events.length === 0) return '📭 На эту неделю важных событий не найдено.';
            var result = '📅 *КАЛЕНДАРЬ ТРЕЙДЕРА*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
            for (var i = 0; i < Math.min(events.length, 10); i++) {
                var event = events[i];
                result += '📌 *' + (event.title || 'Событие') + '*\n';
                result += '📅 ' + (event.date || 'Дата неизвестна') + '\n';
                if (event.importance) result += '⭐ Важность: ' + event.importance + '\n';
                if (event.impact) result += '📊 Влияние: ' + event.impact + '\n';
                result += '━━━━━━━━━━━━━━━━━━━━━━━\n';
            }
            return result;
        },
        
        history_title: '📋 *ИСТОРИЯ*\n━━━━━━━━━━━━━━━━━━━━━━━',
        history_empty: '📭 История пуста.',
        history_item: function(date, action, detail) { return '📌 ' + date + '\n• ' + action + '\n  ' + detail + '\n'; },
        history_analyze: '📊 Анализ портфеля',
        history_antiscam: '🛡️ Проверка безопасности',
        history_social: '📈 Соц.тренды',
        history_news: '📰 Новости',
        history_calendar: '📅 Календарь',
        
        mood_title: '📝 *Как настроение?*',
        mood_saved: '✅ *Сохранено!*',
        mood_warning: function(days) { return '⚠️ *Внимание!*\n\nТы тревожен ' + days + ' день подряд.\nВ таком состоянии опасно торговать.\n\n🛡️ Рекомендую:\n• Сделать перерыв\n• Включить режим HODL\n• Не принимать решений до завтра'; },
        mood_calm: '😌 Спокоен',
        mood_thoughtful: '🤔 Задумчив',
        mood_anxious: '😰 Тревожен',
        mood_panic: '😱 Паника',
        mood_angry: '😤 Зол',
        mood_euphoric: '😊 Эйфория',
        
        plans_title: '💳 *Тарифы*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nВыберите подходящий тариф:',
        plans_current: function(plan, expires) { return '📊 ' + plan + '\n📅 До: ' + expires; },
        plans_trial: '🔰 *Триал*\n💰 0 ₽ • 7 дней\n\n📋 *Что входит:*\n• 📊 2 анализа портфеля в день\n• 🛡️ 3 антискам-проверки\n• 📈 Социальные тренды\n\n💡 *Идеально для:* знакомства с ботом и первичной оценки.\n\n⚠️ После триала доступ к функциям ограничивается.',
        plans_start: '⭐ *Старт*\n💰 500 ₽ • 30 дней\n\n📋 *Что входит:*\n• 📊 10 анализов портфеля в день\n• 🛡️ 15 антискам-проверок\n• 🔔 3 оповещения\n• 💬 AI-советник (5/день)\n\n💡 *Идеально для:* активных трейдеров, которым нужен ежедневный анализ.',
        plans_pro: '🚀 *PRO*\n💰 1 000 ₽ • 30 дней\n\n📋 *Что входит:*\n• 📊 30 анализов портфеля в день\n• 🛡️ 50 антискам-проверок\n• 🔔 15 оповещений\n• ❄️ *Защита от обвалов* — автоматическая конвертация в USDT при падении рынка\n• 🚀 *Автоматическая фиксация прибыли* и ребаланс портфеля (3/день)\n• 🆘 Kill Switch — экстренная остановка\n\n💡 *Идеально для:* серьёзных трейдеров, которым нужна автоторговля и защита.',
        plans_vip: '👑 *VIP*\n💰 1 500 ₽ • 30 дней\n\n📋 *Что входит:*\n• ✅ ВСЕ БЕЗЛИМИТНО\n• ❄️ *Защита от обвалов* — безлимит\n• 🚀 *Автоматическая фиксация прибыли* — безлимит\n• 🆘 Kill Switch — экстренная остановка\n• ⚡ Приоритетная поддержка 24/7\n\n💡 *Идеально для:* профессионалов, которым нужен полный контроль.',
        plans_select: '👇 *Выбери тариф:*',
        plans_payment_creating: '⏳ Создаю счёт...',
        plans_payment_error: '❌ Ошибка создания счёта.',
        plans_success: function(plan) { return '✅ *' + plan + ' активирован!*'; },
        plans_already: function(plan) { return 'ℹ️ У вас уже активен ' + plan; },
        plans_not_found: '❌ Тариф не найден.',
        plans_trial_used: '❌ Триал уже использован.\n💳 /subscribe',
        plans_trial_success: '🎉 *Триал активирован на 7 дней!*',
        plans_payment_title: function(plan) { return '💳 ОПЛАТА ' + plan; },
        days: 'дней',
        plans_features: 'Функции',
        plans_payment_methods: 'Способы оплаты',
        plans_payment_crypto: '💎 Криптовалюта (USDT, BTC, TON)',
        plans_payment_card: '💳 Банковская карта',
        plans_payment_note: '⚠️ После оплаты тариф активируется автоматически.',
        plan_trial_name: '🔰 Триал',
        plan_start_name: '⭐ Старт',
        plan_pro_name: '🚀 PRO',
        plan_vip_name: '👑 VIP',
        
        error_exchange: '⚠️ *Биржа не отвечает.* Попробуй через минуту.',
        error_api_key: '❌ *Неверный ключ.* Проверь инструкцию: /connect',
        error_general: function(err) { return '❌ *Ошибка:* ' + err; },
        
        analyzing_no_keys: '🔐 *Сначала подключи биржу.* /connect',
        analyzing_limit: function(limit, remaining) { return '📊 *Лимит: ' + limit + '/день.* Осталось: ' + remaining + '\n💳 /subscribe'; },
        no_coins: '📭 *На балансе нет монет.*',
        analyzing_step: function(step, total, text) { return '⏳ [' + step + '/' + total + '] ' + text + '...'; },
        analyzing_done: '✅ *Анализ завершён!*',
        
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
        scan_cancelled: '❌ *Проверка отменена.*',
        scan_safe: '🟢 *БЕЗОПАСНО*',
        scan_danger: '🔴 *ОПАСНО*',
        scan_result_safe: function(type) { return '🟢 *БЕЗОПАСНО*\n\n' + type + ' не содержит угроз.'; },
        scan_result_danger: function(type, reason) { return '🔴 *ОПАСНО*\n\n' + type + ' содержит угрозы:\n' + reason; },
        
        connect_prompt: '🔐 *Подключи биржу*\n\n📋 Отправь API-ключи в формате:\n"API_KEY:SECRET_KEY"\n\n🔄 Для отмены: /cancel',
        connect_success: function(exchange) { return '✅ *Биржа ' + exchange + ' подключена!*\n\n📊 Теперь отправь /analyze'; },
        connect_fail: '❌ *Не удалось подключить биржу.*\n\nПроверь ключи и попробуй ещё раз.',
        connect_cancel: '❌ *Подключение отменено.*',
        connect_confirm: '⚠️ *Точно отключить биржу?*\n\nВсе ключи будут удалены.',
        connect_confirm_yes: '✅ Да, отключить',
        connect_confirm_no: '❌ Нет, оставить',
        connect_undo: '⏳ Ключи будут удалены через 10 секунд. Отмена: /undo',
        connect_undo_success: '✅ *Отмена выполнена!* Ключи сохранены.',
        connect_disconnected: '🔌 *Биржа отключена.* Все ключи удалены.',
        invalid_format: '❌ *Неверный формат!* Отправь ключи как "API_KEY:SECRET_KEY".',
        
        back_to_menu: '🔙 Выйти в меню',
        back_to_functions: '🔙 Назад к функциям',
        back_to_settings: '🔙 Назад к настройкам',
        back_to_help: '🔙 Назад к помощи',
        back_to_plans: '🔙 Назад к тарифам',
        back_to_security: '🔙 Назад к безопасности',
        back_to_history: '🔙 Назад к истории',
        back_to_analyze: '🔙 Назад к анализу',
        cancel: '❌ Отмена',
        
        alert_menu: '🔔 *Оповещения*\n\nВыберите тип оповещения:',
        alert_price: '📊 По цене',
        alert_change: '📈 По изменению %',
        alert_volume: '📊 По объёму',
        alert_news: '📰 Новостное',
        alert_calendar: '📅 Календарное',
        alert_create_price: '📊 *Создать ценовое оповещение*\n\nВведите символ и цену в формате:\n"BTC 70000" (выше) или "BTC 65000 below"\n🔄 /cancel — отмена',
        alert_create_change: '📈 *Создать оповещение по изменению %*\n\nВведите символ и % в формате:\n"BTC 5" (изменение >5% за час)\n🔄 /cancel — отмена',
        alert_created: '✅ Оповещение создано!',
        alert_list: '📋 *Ваши оповещения:*\n',
        alert_deleted: '✅ Оповещение удалено.',
        
        autotrade_menu: '🚀 *Автоторговля*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nВыберите уровень сложности:',
        autotrade_level1: '🛡️ Уровень 1 (Защита)',
        autotrade_level2: '🔄 Уровень 2 (Перераспределение)',
        autotrade_level3: '🧠 Уровень 3 (Умный рост)',
        autotrade_level4: '❄️ Уровень 4 (Снежный ком)',
        autotrade_level1_desc: '🛡️ *Уровень 1 (Защита)* — установит стоп-лоссы 5% и 10% для защиты от падения',
        autotrade_level2_desc: '🔄 *Уровень 2 (Перераспределение)* — продаст мусорные токены и купит растущие',
        autotrade_level3_desc: '🧠 *Уровень 3 (Умный рост)* — будет двигать стоп-лосс вверх при росте и фиксировать 30% прибыли',
        autotrade_level4_desc: '❄️ *Уровень 4 (Снежный ком)* — переток из мусорных токенов в растущие, фиксация прибыли при +30%',
        autotrade_active: function(level) { return '✅ Автоторговля активирована (уровень ' + level + ')'; },
        autotrade_stopped: '⏹️ Автоторговля остановлена.',
        autotrade_pro_only: '❌ Автоторговля доступна только PRO и VIP.',
        
        panic_start: '❄️ *Холодный душ активирован.*\n\nБуду отслеживать ВСЕ токены каждые 15 минут. При падении >5% — предложу конвертацию в стейблы.',
        panic_stop: '❄️ Холодный душ остановлен.',
        panic_trigger: '🚨 *ХОЛОДНЫЙ ДУШ СРАБОТАЛ!*\n\nОбнаружено падение >5% по нескольким активам.\n\n⚠️ Рекомендуется конвертировать ВСЕ активы в USDT.',
        panic_convert: '🔄 Конвертировать всё в USDT',
        panic_converted: '✅ Конвертация выполнена. Портфель в безопасности.',
        
        about_title: 'ℹ️ *О БОТЕ*\n━━━━━━━━━━━━━━━━━━━━━━━',
        about_version: '📌 *Версия:* 0.1',
        about_created: '📅 *Создан:* 01.09.2026',
        about_dev: '👨‍💻 *Разработчик:* @clofeLEAN',
        about_instruction: '📖 *ИНСТРУКЦИЯ:*\n\n1️⃣ **Подключи биржу** — /connect\n2️⃣ **Анализируй портфель** — /analyze\n3️⃣ **Проверяй безопасность** — отправь ссылку или контракт\n4️⃣ **Следи за рынком** — /news\n5️⃣ **Получи помощь** — /help',
        about_links: '🔗 *ПОЛЕЗНЫЕ ССЫЛКИ:*\n\n📱 [Канал проекта](https://t.me/atifragility_node)',
        about_commands: '⚡ *Быстрые команды:*\n/analyze — анализ портфеля\n/connect — подключить биржу\n/news — новости, тренды, календарь\n/help — помощь',
        
        no_keys: '🔐 *Подключи биржу:* /connect',
        no_analysis_data: '❌ *Нет данных.* Выполни /analyze',
        default_response: function(text) { return '🤔 Ты написал: "' + text + '"\n\nНажми /help для помощи.'; },
        risk_high: '🔴 Высокий риск',
        risk_medium: '🟡 Средний риск',
        risk_low: '🟢 Низкий риск',
        wallet_invalid: '❌ *Неверный адрес кошелька.*\n\nОтправь адрес, начинающийся с 0x...',
        wallet_balance: function(balance, price) { return '💰 *Баланс:* ' + balance + ' ETH (≈ $' + price + ')'; },
        wallet_tokens: function(tokens) { return '🪙 *Токены:* ' + tokens + ' разных токенов'; },
        wallet_risk_label: function(risk) { return 'Риск: ' + risk; },
        wallet_risk_high: '🔴 Высокий',
        wallet_risk_medium: '🟡 Средний',
        wallet_risk_low: '🟢 Низкий',
        wallet_no_risks: '✅ Рисков не обнаружено',
        wallet_recommendations: '💡 *Рекомендации:*',
        wallet_connect: '🔐 Подключить биржу',
        share_title: '📤 *Поделиться Void Node*',
        share_text: '🛡️ *Void Node — твой крипто-телохранитель*\n\n• Анализ портфеля за 1 минуту\n• Антискам-центр\n• Соц.тренды\n• Календарь трейдера\n• AI-советник\n\n🚀 Присоединяйся: @void_node_bot',
        share_link: function(ref) { return '🔗 Твоя реферальная ссылка:\nhttps://t.me/' + BOT_USERNAME + '?start=ref_' + ref; },
        greeting_morning: function(name) { return '☀️ *Доброе утро, ' + name + '!*'; },
        greeting_afternoon: function(name) { return '☀️ *Добрый день, ' + name + '!*'; },
        greeting_evening: function(name) { return '🌙 *Добрый вечер, ' + name + '!*'; },
        main_header: function(name, mode, id, plan, expires) { return '👤 *' + name + '* | ' + mode + ' | 🆔 ID: ' + id + '\n💳 Тариф: ' + plan + ' (до ' + expires + ')'; }
    },
    en: {
        language_select: '🌍 *Choose language:*',
        mode_select: '📊 *Choose your level:*',
        mode_beginner_desc: '🔰 *Beginner*\n• Target weights: BTC 50%, Alts 30%, Stable 20%\n• Simple portfolio recommendations\n• Basic metrics (risk, allocation)',
        mode_pro_desc: '🚀 *Experienced*\n• Target weights: BTC 40%, Alts 40%, Stable 20%\n• Advanced recommendations\n• Full metrics (Sharpe, RSI, MA20, drawdown)',
        mode_select_prompt: '👇 *Select mode:*',
        mode_beginner_btn: '🔰 Beginner',
        mode_pro_btn: '🚀 Experienced',
        
        menu_title: '🔮 *Void Node — your crypto guardian*\n\n🏠 *Main menu:*\n\n💡 Use buttons below or quick commands:\n/analyze, /news, /help',
        main_functions: '📊 Functions',
        main_settings: '⚙️ Settings',
        main_plans: '💳 Plans',
        main_help: '❓ Help',
        main_about: 'ℹ️ About',
        
        functions_title: '📊 *Functions*\n\nSelect section:',
        functions_analyze: '📊 Analyze portfolio',
        functions_security: '🛡️ Anti-scam center',
        functions_news: '📰 News',
        functions_history: '📋 History',
        
        settings_title: '⚙️ *Settings*',
        settings_lang: '🌍 Language:',
        settings_mode: '🧠 Mode:',
        settings_change_lang: '🌍 Change language',
        settings_change_mode: '🧠 Change mode',
        
        help_menu_title: '❓ *Help*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nSelect a question:',
        help_q1: '🔐 How to connect exchange?',
        help_q2: '📊 How does portfolio analysis work?',
        help_q3: '🔐 Why connect exchange?',
        help_q4: '🛡️ How to check a contract?',
        help_q5: '🔔 How to create an alert?',
        help_q6: '🚀 How to enable autotrading?',
        help_q7: '❄️ What is Panic mode?',
        help_q8: '📝 How does mood diary work?',
        help_q9: '🔌 How to disconnect exchange?',
        help_contact_moderator: '👤 Contact moderator',
        
        help_answer_q1: '🔐 *How to connect exchange?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n1️⃣ Go to your exchange (Binance, Bybit, OKX, etc.)\n2️⃣ Go to API management section\n3️⃣ Create a key with *read-only* permissions\n4️⃣ Copy API key and Secret key\n5️⃣ Send them to bot with /connect in format:\n"API_KEY:SECRET_KEY"\n\n🔒 *Keys are encrypted and have no withdrawal rights.*',
        help_answer_q2: '📊 *How does portfolio analysis work?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n/analyze runs a full portfolio analysis:\n\n✅ Shows asset allocation (BTC, alts, stablecoins)\n✅ Calculates RSI, moving averages (MA20, MA200)\n✅ Evaluates risk (low/medium/high)\n✅ Calculates Sharpe ratio and VaR\n✅ Gives specific rebalancing recommendations\n\n📌 After analysis you can execute recommendations with one click.',
        help_answer_q3: '🔐 *Why connect exchange?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nConnecting your exchange gives you access to key features:\n\n1️⃣ Portfolio analysis — bot sees your assets and gives recommendations\n2️⃣ Autotrading — automatic protection and rebalancing\n3️⃣ Panic mode — emergency protection during market crashes\n4️⃣ Alerts — notifications for your assets\n5️⃣ Rebalance — automatic maintenance of target weights\n\n🔒 Keys are encrypted and have read-only permissions.',
        help_answer_q4: '🛡️ *How to check a contract?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nYou can check a smart contract in several ways:\n\n✅ Send contract address (0x...) in chat — bot will check automatically\n✅ Use *Security* menu → *Contract*\n✅ Use *Security* menu → *DEX* — shows liquidity and risks\n\n🔍 Bot checks:\n• Verification on Etherscan\n• Suspicious patterns (honeypot)\n• Risk scoring (0–100)\n\n📌 Example: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"',
        help_answer_q5: '🔔 *How to create an alert?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nUse /alerts or *Alerts* menu.\n\n5 alert types available:\n\n📊 Price — triggers at target price\n📈 Change % — triggers when price changes by X%\n📊 Volume — triggers when trading volume exceeds\n📰 News — triggers when news appear for your assets\n📅 Calendar — before important economic events\n\n📌 Limit depends on your plan.',
        help_answer_q6: '🚀 *How to enable autotrading?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n/autotrade opens menu with 4 levels:\n\n🛡️ *Level 1 (Protection)* — sets stop-losses at 5% and 10% drops\n🔄 *Level 2 (Reallocation)* — sells junk tokens and buys growing ones\n🧠 *Level 3 (Smart Growth)* — uses trailing stop-loss and locks 30% profit at >20% growth\n❄️ *Level 4 (Snowball)* — flows capital from junk tokens to growing ones\n\n📌 Available only on PRO and VIP.',
        help_answer_q7: '❄️ *What is Panic mode?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nPanic mode is emergency protection during market crashes.\n\n✅ Bot checks ALL tokens every 15 minutes\n✅ If drop >5% in 15 minutes — sends warning\n✅ Offers one-click conversion of ALL assets to USDT\n\n🛡️ Available on PRO and VIP.',
        help_answer_q8: '📝 *How does mood diary work?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n/diary opens emotion diary.\n\nChoose your current mood:\n😌 Calm | 🤔 Thoughtful | 😰 Anxious | 😱 Panic | 😤 Angry | 😊 Euphoric\n\n📌 Bot saves entries. If you\'re anxious for 3 days in a row — bot warns you.',
        help_answer_q9: '🔌 *How to disconnect exchange?*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n/disconnect or *Settings* → *Disconnect exchange*.\n\nAfter confirmation API keys will be deleted.\n\n📌 If you accidentally confirmed, you have 10 seconds to undo: /undo',
        help_contact_moderator_message: '👤 *Contact moderator*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nWrite to @clofeLEAN — he will help you!',
        
        market_menu: '📈 Market',
        market_social: '📊 Social trends',
        market_news: '📰 News',
        market_calendar: '📅 Calendar',
        back_to_market: '🔙 Back to market',
        
        social_menu: '📊 *Select coin:*',
        social_search: '🔎 Find token',
        social_analyzing: function(coin) { return '⏳ Getting data for ' + coin + '...'; },
        social_search_prompt: '🔎 *Enter token name*\n\n📌 Examples: PEPE, ARB, SOL, DOGE, SHIB\n🔄 /cancel — cancel',
        social_search_invalid: '❌ *Invalid token name.*\n\n📌 Enter a ticker (e.g., PEPE, ARB, SOL, DOGE, SHIB).',
        
        news_analyzing: '📰 Fetching news...',
        news_empty: '📭 No news found.',
        news_coin: function(coin) { return '📰 *NEWS: ' + coin + '*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n'; },
        news_personalized_header: '📰 *NEWS FOR YOUR PORTFOLIO*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n',
        news_no_assets: '❌ Please run /analyze first so I know your portfolio.',
        news_no_news: '📭 No news found for your assets.',
        
        calendar_analyzing: '📅 Generating calendar...',
        calendar_empty: '📭 No important events this week.',
        calendar_pro_only: '❌ *Trader Calendar available on PRO and VIP plans.*\n\n💳 /subscribe',
        calendar_result: function(events) {
            if (!events || events.length === 0) return '📭 No important events this week.';
            var result = '📅 *TRADER CALENDAR*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
            for (var i = 0; i < Math.min(events.length, 10); i++) {
                var event = events[i];
                result += '📌 *' + (event.title || 'Event') + '*\n';
                result += '📅 ' + (event.date || 'Date unknown') + '\n';
                if (event.importance) result += '⭐ Importance: ' + event.importance + '\n';
                if (event.impact) result += '📊 Impact: ' + event.impact + '\n';
                result += '━━━━━━━━━━━━━━━━━━━━━━━\n';
            }
            return result;
        },
        
        history_title: '📋 *HISTORY*\n━━━━━━━━━━━━━━━━━━━━━━━',
        history_empty: '📭 History is empty.',
        history_item: function(date, action, detail) { return '📌 ' + date + '\n• ' + action + '\n  ' + detail + '\n'; },
        history_analyze: '📊 Portfolio analysis',
        history_antiscam: '🛡️ Security check',
        history_social: '📈 Social trends',
        history_news: '📰 News',
        history_calendar: '📅 Calendar',
        
        mood_title: '📝 *How are you feeling?*',
        mood_saved: '✅ *Saved!*',
        mood_warning: function(days) { return '⚠️ *Warning!*\n\nYou\'ve been anxious for ' + days + ' days in a row.\nIt\'s dangerous to trade in this state.\n\n🛡️ I recommend:\n• Take a break\n• Enable HODL mode\n• Don\'t make decisions until tomorrow'; },
        mood_calm: '😌 Calm',
        mood_thoughtful: '🤔 Thoughtful',
        mood_anxious: '😰 Anxious',
        mood_panic: '😱 Panic',
        mood_angry: '😤 Angry',
        mood_euphoric: '😊 Euphoric',
        
        plans_title: '💳 *Plans*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nChoose a plan:',
        plans_current: function(plan, expires) { return '📊 ' + plan + '\n📅 Until: ' + expires; },
        plans_trial: '🔰 *Trial*\n💰 0 ₽ • 7 days\n\n📋 *What\'s included:*\n• 📊 2 portfolio analyses per day\n• 🛡️ 3 anti-scam checks\n• 📈 Social trends\n\n💡 *Perfect for:* getting to know the bot and initial assessment.\n\n⚠️ After trial, access to functions is limited.',
        plans_start: '⭐ *Start*\n💰 500 ₽ • 30 days\n\n📋 *What\'s included:*\n• 📊 10 portfolio analyses per day\n• 🛡️ 15 anti-scam checks\n• 🔔 3 alerts\n• 💬 AI advisor (5/day)\n\n💡 *Perfect for:* active traders who need daily analysis.',
        plans_pro: '🚀 *PRO*\n💰 1 000 ₽ • 30 days\n\n📋 *What\'s included:*\n• 📊 30 portfolio analyses per day\n• 🛡️ 50 anti-scam checks\n• 🔔 15 alerts\n• ❄️ *Crash protection* — automatic conversion to USDT during market drops\n• 🚀 *Automated profit taking* and portfolio rebalancing (3/day)\n• 🆘 Kill Switch — emergency stop\n\n💡 *Perfect for:* serious traders who need autotrading and protection.',
        plans_vip: '👑 *VIP*\n💰 1 500 ₽ • 30 days\n\n📋 *What\'s included:*\n• ✅ ALL UNLIMITED\n• ❄️ *Crash protection* — unlimited\n• 🚀 *Automated profit taking* — unlimited\n• 🆘 Kill Switch — emergency stop\n• ⚡ 24/7 priority support\n\n💡 *Perfect for:* professionals who need full control.',
        plans_select: '👇 *Select plan:*',
        plans_payment_creating: '⏳ Creating invoice...',
        plans_payment_error: '❌ Payment error.',
        plans_success: function(plan) { return '✅ *' + plan + ' activated!*'; },
        plans_already: function(plan) { return 'ℹ️ You already have ' + plan; },
        plans_not_found: '❌ Plan not found.',
        plans_trial_used: '❌ Trial already used.\n💳 /subscribe',
        plans_trial_success: '🎉 *Trial activated for 7 days!*',
        plans_payment_title: function(plan) { return '💳 PAYMENT ' + plan; },
        days: 'days',
        plans_features: 'Features',
        plans_payment_methods: 'Payment methods',
        plans_payment_crypto: '💎 Cryptocurrency (USDT, BTC, TON)',
        plans_payment_card: '💳 Bank card',
        plans_payment_note: '⚠️ After payment, the plan will be activated automatically.',
        plan_trial_name: '🔰 Trial',
        plan_start_name: '⭐ Start',
        plan_pro_name: '🚀 PRO',
        plan_vip_name: '👑 VIP',
        
        error_exchange: '⚠️ *Exchange not responding.* Try again in a minute.',
        error_api_key: '❌ *Invalid key.* Check instructions: /connect',
        error_general: function(err) { return '❌ *Error:* ' + err; },
        
        analyzing_no_keys: '🔐 *Connect exchange first.* /connect',
        analyzing_limit: function(limit, remaining) { return '📊 *Limit: ' + limit + '/day.* Remaining: ' + remaining + '\n💳 /subscribe'; },
        no_coins: '📭 *No coins in balance.*',
        analyzing_step: function(step, total, text) { return '⏳ [' + step + '/' + total + '] ' + text + '...'; },
        analyzing_done: '✅ *Analysis complete!*',
        
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
        scan_cancelled: '❌ *Check cancelled.*',
        scan_safe: '🟢 *SAFE*',
        scan_danger: '🔴 *DANGER*',
        scan_result_safe: function(type) { return '🟢 *SAFE*\n\n' + type + ' contains no threats.'; },
        scan_result_danger: function(type, reason) { return '🔴 *DANGER*\n\n' + type + ' contains threats:\n' + reason; },
        
        connect_prompt: '🔐 *Connect exchange*\n\n📋 Send API keys as:\n"API_KEY:SECRET_KEY"\n\n🔄 To cancel: /cancel',
        connect_success: function(exchange) { return '✅ *' + exchange + ' connected!*\n\n📊 Now send /analyze'; },
        connect_fail: '❌ *Failed to connect.*\n\nCheck your keys and try again.',
        connect_cancel: '❌ *Cancelled.*',
        connect_confirm: '⚠️ *Really disconnect exchange?*\n\nAll keys will be deleted.',
        connect_confirm_yes: '✅ Yes, disconnect',
        connect_confirm_no: '❌ No, keep',
        connect_undo: '⏳ Keys will be deleted in 10 seconds. Undo: /undo',
        connect_undo_success: '✅ *Undo successful!* Keys saved.',
        connect_disconnected: '🔌 *Exchange disconnected.* All keys deleted.',
        invalid_format: '❌ *Invalid format!* Send as "API_KEY:SECRET_KEY".',
        
        back_to_menu: '🔙 Back to menu',
        back_to_functions: '🔙 Back to functions',
        back_to_settings: '🔙 Back to settings',
        back_to_help: '🔙 Back to help',
        back_to_plans: '🔙 Back to plans',
        back_to_security: '🔙 Back to security',
        back_to_history: '🔙 Back to history',
        back_to_analyze: '🔙 Back to analysis',
        cancel: '❌ Cancel',
        
        alert_menu: '🔔 *Alerts*\n\nSelect alert type:',
        alert_price: '📊 Price',
        alert_change: '📈 Change %',
        alert_volume: '📊 Volume',
        alert_news: '📰 News',
        alert_calendar: '📅 Calendar',
        alert_create_price: '📊 *Create price alert*\n\nEnter symbol and price in format:\n"BTC 70000" (above) or "BTC 65000 below"\n🔄 /cancel — cancel',
        alert_create_change: '📈 *Create change % alert*\n\nEnter symbol and % in format:\n"BTC 5" (change >5% per hour)\n🔄 /cancel — cancel',
        alert_created: '✅ Alert created!',
        alert_list: '📋 *Your alerts:*\n',
        alert_deleted: '✅ Alert deleted.',
        
        autotrade_menu: '🚀 *Autotrading*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nChoose difficulty level:',
        autotrade_level1: '🛡️ Level 1 (Protection)',
        autotrade_level2: '🔄 Level 2 (Reallocation)',
        autotrade_level3: '🧠 Level 3 (Smart Growth)',
        autotrade_level4: '❄️ Level 4 (Snowball)',
        autotrade_level1_desc: '🛡️ *Level 1 (Protection)* — sets stop-losses at 5% and 10% to protect from drops',
        autotrade_level2_desc: '🔄 *Level 2 (Reallocation)* — sells junk tokens and buys growing ones',
        autotrade_level3_desc: '🧠 *Level 3 (Smart Growth)* — moves stop-loss up as price grows, locks 30% profit',
        autotrade_level4_desc: '❄️ *Level 4 (Snowball)* — flows capital from junk tokens to growing ones, locks profit at +30%',
        autotrade_active: function(level) { return '✅ Autotrading activated (level ' + level + ')'; },
        autotrade_stopped: '⏹️ Autotrading stopped.',
        autotrade_pro_only: '❌ Autotrading is available only for PRO and VIP.',
        
        panic_start: '❄️ *Panic mode activated.*\n\nI will monitor ALL tokens every 15 minutes. If drop >5% — I will suggest converting to stables.',
        panic_stop: '❄️ Panic mode stopped.',
        panic_trigger: '🚨 *PANIC MODE TRIGGERED!*\n\nDetected drop >5% across multiple assets.\n\n⚠️ It\'s recommended to convert ALL assets to USDT.',
        panic_convert: '🔄 Convert all to USDT',
        panic_converted: '✅ Conversion completed. Portfolio is safe.',
        
        about_title: 'ℹ️ *ABOUT BOT*\n━━━━━━━━━━━━━━━━━━━━━━━',
        about_version: '📌 *Version:* 0.1',
        about_created: '📅 *Created:* 01.09.2026',
        about_dev: '👨‍💻 *Developer:* @clofeLEAN',
        about_instruction: '📖 *INSTRUCTION:*\n\n1️⃣ **Connect exchange** — /connect\n2️⃣ **Analyze portfolio** — /analyze\n3️⃣ **Check security** — send link or contract\n4️⃣ **Follow market** — /news\n5️⃣ **Get help** — /help',
        about_links: '🔗 *USEFUL LINKS:*\n\n📱 [Project channel](https://t.me/atifragility_node)',
        about_commands: '⚡ *Quick commands:*\n/analyze — portfolio analysis\n/connect — connect exchange\n/news — news, trends, calendar\n/help — help',
        
        no_keys: '🔐 *Connect exchange:* /connect',
        no_analysis_data: '❌ *No data.* Run /analyze',
        default_response: function(text) { return '🤔 You wrote: "' + text + '"\n\nPress /help for help.'; },
        risk_high: '🔴 High risk',
        risk_medium: '🟡 Medium risk',
        risk_low: '🟢 Low risk',
        wallet_invalid: '❌ *Invalid wallet address.*\n\nSend a valid address starting with 0x...',
        wallet_balance: function(balance, price) { return '💰 *Balance:* ' + balance + ' ETH (≈ $' + price + ')'; },
        wallet_tokens: function(tokens) { return '🪙 *Tokens:* ' + tokens + ' different tokens'; },
        wallet_risk_label: function(risk) { return 'Risk: ' + risk; },
        wallet_risk_high: '🔴 High',
        wallet_risk_medium: '🟡 Medium',
        wallet_risk_low: '🟢 Low',
        wallet_no_risks: '✅ No risks detected',
        wallet_recommendations: '💡 *Recommendations:*',
        wallet_connect: '🔐 Connect Exchange',
        share_title: '📤 *Share Void Node*',
        share_text: '🛡️ *Void Node — your crypto guardian*\n\n• Portfolio analysis in 1 minute\n• Anti-scam center\n• Social trends\n• Trader calendar\n• AI advisor\n\n🚀 Join: @void_node_bot',
        share_link: function(ref) { return '🔗 Your referral link:\nhttps://t.me/' + BOT_USERNAME + '?start=ref_' + ref; },
        greeting_morning: function(name) { return '☀️ *Good morning, ' + name + '!*'; },
        greeting_afternoon: function(name) { return '☀️ *Good afternoon, ' + name + '!*'; },
        greeting_evening: function(name) { return '🌙 *Good evening, ' + name + '!*'; },
        main_header: function(name, mode, id, plan, expires) { return '👤 *' + name + '* | ' + mode + ' | 🆔 ID: ' + id + '\n💳 Plan: ' + plan + ' (until ' + expires + ')'; }
    }
};

function getText(lang, key, args) {
    var strings = LANGUAGES[lang] || LANGUAGES.ru;
    var text = strings[key];
    if (text === undefined) {
        var fallbackText = LANGUAGES.ru[key];
        if (typeof fallbackText === 'function') {
            if (args === undefined) return fallbackText();
            if (Array.isArray(args)) return fallbackText.apply(null, args);
            return fallbackText(args);
        }
        return fallbackText || '❌ Error: missing translation for "' + key + '"';
    }
    if (typeof text === 'function') {
        if (args === undefined) return text();
        if (Array.isArray(args)) return text.apply(null, args);
        return text(args);
    }
    return text;
}

// ============================================================
// 7. EXCHANGE FUNCTIONS
// ============================================================
async function connectExchange(exchangeId, apiKey, secretKey) {
    var exchange = new ccxt[exchangeId]({
        apiKey: apiKey,
        secret: secretKey,
        enableRateLimit: true,
        timeout: 30000
    });
    await exchange.fetchBalance();
    return exchange;
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
        if (patterns.hasOwnProperty(exchange)) {
            if (patterns[exchange].test(apiKey)) return exchange;
        }
    }
    return null;
}

// ============================================================
// 8. HISTORY
// ============================================================
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

// ============================================================
// 9. CRYPTOBOT PAYMENTS
// ============================================================
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
        hidden_message: '✅ ' + plan.name + ' activated! Thank you! 🙏'
    };
    try {
        var response = await fetch(url, {
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

// ============================================================
// 10. LOAD USER KEYS
// ============================================================
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

// ============================================================
// 11. HANDLE PLAN SELECTION
// ============================================================
async function handlePlanSelection(chatId, planId, lang, messageId) {
    if (planId === 'TRIAL') {
        var userPlan = await getUserPlan(chatId);
        if (userPlan.trialUsed && userPlan.plan !== 'TRIAL') {
            await sendUpdatedMessage(chatId, getText(lang, 'plans_trial_used'), null, 'Markdown', messageId);
            return;
        }
        await activateTrial(chatId);
        await sendUpdatedMessage(chatId, getText(lang, 'plans_trial_success'), null, 'Markdown', messageId);
        await showMainMenu(chatId);
        return;
    }
    var plan = PLANS[planId];
    if (!plan) {
        await sendUpdatedMessage(chatId, getText(lang, 'plans_not_found'), null, 'Markdown', messageId);
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
    var message = getText(lang, 'plans_payment_title', plan.name) + '\n\n' +
        '💰 ' + plan.price + ' ₽\n📅 ' + plan.duration + ' ' + getText(lang, 'days') + '\n\n' +
        '📋 ' + getText(lang, 'plans_features') + ':\n' + displayFeatures.map(function(f) { return '• ' + f; }).join('\n') +
        '\n\n💳 ' + getText(lang, 'plans_payment_methods') + ':\n' +
        '• ' + getText(lang, 'plans_payment_crypto') + '\n\n' +
        '⚠️ ' + getText(lang, 'plans_payment_note');
    var keyboard = {
        inline_keyboard: [
            [{ text: '💳 ' + (lang === 'en' ? 'Pay' : 'Оплатить') + ' ' + plan.price + ' ₽', url: invoice.payUrl }],
            [{ text: getText(lang, 'back_to_plans'), callback_data: 'back_to_plans' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
}

// ============================================================
// 12. ANTISCAM FUNCTIONS
// ============================================================
async function checkContract(address) {
    var riskScore = 0;
    var level = 'Low';
    var isHoneypot = address.toLowerCase().includes('dead') || (address.length === 42 && address.endsWith('f'));
    if (isHoneypot) riskScore += 40;
    if (address.includes('0x0000')) riskScore += 20;
    if (ETHERSCAN_API_KEY) {
        try {
            var url = 'https://api.etherscan.io/api?module=contract&action=getabi&address=' + address + '&apikey=' + ETHERSCAN_API_KEY;
            var resp = await fetch(url);
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
    if (score > 70) level = 'High';
    else if (score > 40) level = 'Medium';
    return { score: score, level: level, reason: 'Risk score: ' + score + '/100 (' + level + ')' };
}

async function checkWallet(address) {
    var balance = 0;
    var tokens = [];
    if (ETHERSCAN_API_KEY) {
        try {
            var balUrl = 'https://api.etherscan.io/api?module=account&action=balance&address=' + address + '&tag=latest&apikey=' + ETHERSCAN_API_KEY;
            var balResp = await fetch(balUrl);
            var balData = await balResp.json();
            if (balData.status === '1') balance = parseFloat(balData.result) / 1e18;
            var tokenUrl = 'https://api.etherscan.io/api?module=account&action=tokentx&address=' + address + '&page=1&offset=100&sort=desc&apikey=' + ETHERSCAN_API_KEY;
            var tokenResp = await fetch(tokenUrl);
            var tokenData = await tokenResp.json();
            if (tokenData.status === '1') {
                var maxTokens = Math.min(tokenData.result.length, 10);
                for (var i = 0; i < maxTokens; i++) {
                    var t = tokenData.result[i];
                    if (t.tokenSymbol && tokens.indexOf(t.tokenSymbol) === -1) {
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
        if (blacklisted) return { safe: false, reason: '🚫 Domain ' + domain + ' is blacklisted.' };
        var knownDomains = ['binance.com', 'bybit.com', 'okx.com', 'metamask.io', 'trustwallet.com'];
        for (var i = 0; i < knownDomains.length; i++) {
            var known = knownDomains[i];
            var base = known.split('.')[0];
            if (domain.includes(base) && !domain.endsWith(known)) {
                issues.push('🚫 Suspicious fake of ' + known + '.');
            }
        }
        if (issues.length === 0) return { safe: true, reason: '✅ Link is safe.' };
        return { safe: false, reason: issues.join('\n') };
    } catch (error) {
        return { safe: false, reason: '❌ Error: ' + error.message };
    }
}

function checkFile(fileName) {
    var dangerous = ['.exe', '.scr', '.bat', '.cmd', '.ps1', '.vbs', '.dmg', '.app', '.sh', '.js', '.jar', '.apk'];
    var suspicious = ['.zip', '.rar', '.7z', '.py', '.xls', '.doc', '.pdf', '.docm', '.xlsm'];
    var ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    if (dangerous.indexOf(ext) !== -1) return '🚫 DANGEROUS! Extension ' + ext + ' may contain virus.';
    if (suspicious.indexOf(ext) !== -1) return '⚠️ WARNING Extension ' + ext + ' may contain malicious code.';
    return '✅ Safe Extension ' + ext + ' is safe.';
}

function checkImpersonation(username) {
    if (!username) return null;
    var knownAdmins = ['binance_support', 'bybit_official', 'okx_help', 'metamask_support', 'trustwallet_help'];
    var lower = username.toLowerCase();
    for (var i = 0; i < knownAdmins.length; i++) {
        var admin = knownAdmins[i];
        if (lower.includes(admin.toLowerCase()) && lower !== admin) {
            return '🚫 Fake account detected! @' + username + ' pretending to be @' + admin + '.';
        }
    }
    return null;
}

// ============================================================
// 13. ALL KEYBOARDS
// ============================================================

function getMainMenuKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: getText(lang, 'main_functions'), callback_data: 'menu_functions' }, { text: getText(lang, 'main_settings'), callback_data: 'menu_settings_new' }],
            [{ text: getText(lang, 'main_plans'), callback_data: 'menu_plans' }, { text: getText(lang, 'main_help'), callback_data: 'menu_help' }],
            [{ text: getText(lang, 'main_about'), callback_data: 'menu_about' }]
        ]
    };
}

function getFunctionsMenuKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: getText(lang, 'functions_analyze'), callback_data: 'menu_analyze' }],
            [{ text: getText(lang, 'functions_security'), callback_data: 'menu_security' }],
            [{ text: '🤖 ' + (lang === 'ru' ? 'AI Советник' : 'AI Advisor'), callback_data: 'menu_ai' }],
            [{ text: getText(lang, 'market_menu'), callback_data: 'menu_market' }],
            [{ text: getText(lang, 'functions_history'), callback_data: 'menu_history' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
}

function getSecurityMenuKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: getText(lang, 'security_link'), callback_data: 'antiscam_url' }, { text: getText(lang, 'security_contract'), callback_data: 'antiscam_contract' }],
            [{ text: getText(lang, 'security_file'), callback_data: 'antiscam_file' }, { text: getText(lang, 'security_dex'), callback_data: 'antiscam_dex' }],
            [{ text: getText(lang, 'security_impersonation'), callback_data: 'antiscam_impersonation' }, { text: getText(lang, 'security_wallet'), callback_data: 'antiscam_wallet' }],
            [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
        ]
    };
}

function getMarketMenuKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: getText(lang, 'market_social'), callback_data: 'menu_social' }],
            [{ text: getText(lang, 'market_news'), callback_data: 'menu_news' }],
            [{ text: getText(lang, 'market_calendar'), callback_data: 'menu_calendar' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
}

function getSocialTrendsKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: '₿ BTC', callback_data: 'trend_BTC' }, { text: '⟠ ETH', callback_data: 'trend_ETH' }],
            [{ text: '🔷 SOL', callback_data: 'trend_SOL' }, { text: '🔶 ADA', callback_data: 'trend_ADA' }],
            [{ text: '🔹 XRP', callback_data: 'trend_XRP' }, { text: '💠 DOT', callback_data: 'trend_DOT' }],
            [{ text: getText(lang, 'social_search'), callback_data: 'trend_search_menu' }],
            [{ text: getText(lang, 'back_to_market'), callback_data: 'menu_market' }]
        ]
    };
}

function getTrendSearchMenuKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: '🔎 By token name', callback_data: 'trend_search_name' }],
            [{ text: '📄 By contract address', callback_data: 'trend_search_contract' }],
            [{ text: getText(lang, 'back_to_market'), callback_data: 'menu_social' }]
        ]
    };
}

function getSettingsMenuKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: getText(lang, 'settings_change_lang'), callback_data: 'settings_change_lang' }],
            [{ text: getText(lang, 'settings_change_mode'), callback_data: 'settings_change_mode' }],
            [{ text: '🔌 ' + (lang === 'ru' ? 'Отключить биржу' : 'Disconnect exchange'), callback_data: 'action_disconnect' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
}

function getLanguageSelectKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: '🇷🇺 Русский', callback_data: 'lang_ru' }],
            [{ text: '🇬🇧 English', callback_data: 'lang_en' }],
            [{ text: getText(lang, 'back_to_settings'), callback_data: 'back_to_settings' }]
        ]
    };
}

function getModeSelectKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: getText(lang, 'mode_beginner_btn'), callback_data: 'mode_beginner' }],
            [{ text: getText(lang, 'mode_pro_btn'), callback_data: 'mode_pro' }],
            [{ text: getText(lang, 'back_to_settings'), callback_data: 'back_to_settings' }]
        ]
    };
}

function getPlansMenuKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: getText(lang, 'plan_trial_name'), callback_data: 'plan_TRIAL' }],
            [{ text: getText(lang, 'plan_start_name'), callback_data: 'plan_START' }],
            [{ text: getText(lang, 'plan_pro_name'), callback_data: 'plan_PRO' }],
            [{ text: getText(lang, 'plan_vip_name'), callback_data: 'plan_VIP' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
}

function getHelpMenuKeyboard(lang) {
    return {
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
}

function getAnalyzeMenuKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: '📊 ' + (lang === 'ru' ? 'Полный анализ' : 'Full analysis'), callback_data: 'action_analyze' }],
            [{ text: '📥 ' + (lang === 'ru' ? 'CSV отчет' : 'CSV report'), callback_data: 'action_export_csv' }],
            [{ text: '🔄 ' + (lang === 'ru' ? 'Ребаланс портфеля' : 'Rebalance portfolio'), callback_data: 'action_rebalance' }],
            [{ text: '🚀 ' + (lang === 'ru' ? 'Автоторговля' : 'Autotrading'), callback_data: 'autotrade_menu' }],
            [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
        ]
    };
}

function getAutotradeMenuKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: getText(lang, 'autotrade_level1'), callback_data: 'autotrade_level1' }],
            [{ text: getText(lang, 'autotrade_level2'), callback_data: 'autotrade_level2' }],
            [{ text: getText(lang, 'autotrade_level3'), callback_data: 'autotrade_level3' }],
            [{ text: getText(lang, 'autotrade_level4'), callback_data: 'autotrade_level4' }],
            [{ text: '⏹️ ' + (lang === 'ru' ? 'Остановить' : 'Stop'), callback_data: 'autotrade_stop' }],
            [{ text: getText(lang, 'back_to_analyze'), callback_data: 'back_to_analyze' }]
        ]
    };
}

function getAlertMenuKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: getText(lang, 'alert_price'), callback_data: 'alert_price' }],
            [{ text: getText(lang, 'alert_change'), callback_data: 'alert_change' }],
            [{ text: getText(lang, 'alert_volume'), callback_data: 'alert_volume' }],
            [{ text: getText(lang, 'alert_news'), callback_data: 'alert_news' }],
            [{ text: getText(lang, 'alert_calendar'), callback_data: 'alert_calendar' }],
            [{ text: '📋 ' + (lang === 'ru' ? 'Список оповещений' : 'List alerts'), callback_data: 'alert_list' }],
            [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
        ]
    };
}

function getDiaryMenuKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: getText(lang, 'mood_calm'), callback_data: 'diary_mood_calm' }, { text: getText(lang, 'mood_thoughtful'), callback_data: 'diary_mood_thoughtful' }],
            [{ text: getText(lang, 'mood_anxious'), callback_data: 'diary_mood_anxious' }, { text: getText(lang, 'mood_panic'), callback_data: 'diary_mood_panic' }],
            [{ text: getText(lang, 'mood_angry'), callback_data: 'diary_mood_angry' }, { text: getText(lang, 'mood_euphoric'), callback_data: 'diary_mood_euphoric' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
}

function getOnboardLanguageKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🇷🇺 Русский', callback_data: 'onboard_lang_ru' }],
            [{ text: '🇬🇧 English', callback_data: 'onboard_lang_en' }]
        ]
    };
}

function getOnboardModeKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: getText(lang, 'mode_beginner_btn'), callback_data: 'onboard_mode_beginner' }],
            [{ text: getText(lang, 'mode_pro_btn'), callback_data: 'onboard_mode_pro' }]
        ]
    };
}

function getVipBonusKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: '🔐 ' + (lang === 'ru' ? 'Подключить биржу' : 'Connect exchange'), callback_data: 'onboard_connect_vip' }],
            [{ text: '⏭️ ' + (lang === 'ru' ? 'Пропустить' : 'Skip'), callback_data: 'onboard_skip' }]
        ]
    };
}

function getBackKeyboard(lang) {
    return {
        inline_keyboard: [
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
}

// ============================================================
// 14. ALL MENUS
// ============================================================
async function showMainMenu(chatId) {
    try {
        var lang = await getData('lang_' + chatId) || 'ru';
        console.log('📊 showMainMenu for ' + chatId + ' with lang: ' + lang);
        var userPlan = await getUserPlan(chatId);
        var mode = await getData('mode_' + chatId) || 'beginner';
        var userName = 'Friend';
        try {
            var url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/getChat';
            var response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId })
            });
            var data = await response.json();
            if (data.ok && data.result) {
                userName = data.result.username || data.result.first_name || 'Friend';
                if (userName.startsWith('@')) userName = userName.substring(1);
            }
        } catch (error) {
            console.error('Error getting username:', error);
        }
        var userId = chatId;
        var planName = userPlan.name || 'Trial';
        var expiresDate = formatDateShort(userPlan.expires);
        var modeDisplay = mode === 'beginner' 
            ? (lang === 'ru' ? 'Новичок' : 'Beginner') 
            : (lang === 'ru' ? 'Опытный' : 'Experienced');
        var hour = new Date().getHours();
        var greeting;
        if (hour < 12) greeting = getText(lang, 'greeting_morning', userName);
        else if (hour < 18) greeting = getText(lang, 'greeting_afternoon', userName);
        else greeting = getText(lang, 'greeting_evening', userName);
        
        var vipStatus = '';
        if (userPlan.plan === 'VIP' && userPlan.expires > Date.now()) {
            var timeLeft = userPlan.expires - Date.now();
            var daysLeft = Math.floor(timeLeft / (24 * 60 * 60 * 1000));
            if (daysLeft <= 1) {
                vipStatus = '\n🔥 VIP expires tomorrow!';
            } else {
                vipStatus = '\n👑 VIP active (' + daysLeft + ' days)';
            }
        }
        var header = getText(lang, 'main_header', [userName, modeDisplay, userId, planName, expiresDate]);
        var message = greeting + '\n\n' + header + vipStatus + '\n\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' + getText(lang, 'menu_title');
        await sendUpdatedMessage(chatId, message, getMainMenuKeyboard(lang), 'Markdown', null, true);
        console.log('Menu sent for ' + chatId);
    } catch (error) {
        console.error('showMainMenu error:', error);
        await sendMessage(chatId, '⚠️ Error loading menu. Please try again later.');
    }
}

async function showFunctionsMenu(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    await sendUpdatedMessage(chatId, getText(lang, 'functions_title'), getFunctionsMenuKeyboard(lang));
}

async function showSecurityMenu(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    await sendUpdatedMessage(chatId, getText(lang, 'security_menu'), getSecurityMenuKeyboard(lang));
}

async function showMarketMenu(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    await sendUpdatedMessage(chatId, '📈 ' + (lang === 'ru' ? 'Рынок' : 'Market'), getMarketMenuKeyboard(lang));
}

async function showSocialTrends(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    await sendUpdatedMessage(chatId, getText(lang, 'social_menu'), getSocialTrendsKeyboard(lang));
}

async function showTrendSearchMenu(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    var message = '🔍 How to search token?\n\n📌 By name — enter ticker (PEPE, DOGE, SHIB)\n📄 By address — paste contract address (0x...)\n\n💡 If contract address — bot will show DEX data and liquidity.';
    await sendUpdatedMessage(chatId, message, getTrendSearchMenuKeyboard(lang));
}

async function showSettingsMenu(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    await sendUpdatedMessage(chatId, getText(lang, 'settings_title'), getSettingsMenuKeyboard(lang));
}

async function showLanguageSelect(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    await sendUpdatedMessage(chatId, getText(lang, 'language_select'), getLanguageSelectKeyboard(lang));
}

async function showModeSelect(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    var message = getText(lang, 'mode_select') + '\n\n';
    message += getText(lang, 'mode_beginner_desc') + '\n\n';
    message += getText(lang, 'mode_pro_desc') + '\n\n';
    message += getText(lang, 'mode_select_prompt');
    await sendUpdatedMessage(chatId, message, getModeSelectKeyboard(lang));
}

async function showPlansMenu(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    var userPlan = await getUserPlan(chatId);
    var expiresDate = formatDateShort(userPlan.expires);
    var planName = userPlan && userPlan.name ? userPlan.name : 'Trial';
    var planExpires = expiresDate || 'N/A';
    var message = getText(lang, 'plans_title') + '\n';
    message += getText(lang, 'plans_current', [planName, planExpires]) + '\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    message += getText(lang, 'plans_trial') + '\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    message += getText(lang, 'plans_start') + '\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    message += getText(lang, 'plans_pro') + '\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    message += getText(lang, 'plans_vip') + '\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    message += getText(lang, 'plans_select');
    await sendUpdatedMessage(chatId, message, getPlansMenuKeyboard(lang));
}

async function showHelpMenu(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    await sendUpdatedMessage(chatId, getText(lang, 'help_menu_title'), getHelpMenuKeyboard(lang));
}

async function showAnalyzeMenu(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    var savedData = await getData('user_' + chatId);
    if (!savedData) {
        var keyboard = {
            inline_keyboard: [
                [{ text: '🔐 ' + (lang === 'ru' ? 'Подключить биржу' : 'Connect exchange'), callback_data: 'menu_connect' }],
                [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'), keyboard);
        return;
    }
    await sendUpdatedMessage(chatId, '📊 Portfolio analysis\n\nSelect action:', getAnalyzeMenuKeyboard(lang));
}

async function showAutotradeMenu(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    var message = getText(lang, 'autotrade_menu') + '\n\n' +
        getText(lang, 'autotrade_level1_desc') + '\n\n' +
        getText(lang, 'autotrade_level2_desc') + '\n\n' +
        getText(lang, 'autotrade_level3_desc') + '\n\n' +
        getText(lang, 'autotrade_level4_desc');
    await sendUpdatedMessage(chatId, message, getAutotradeMenuKeyboard(lang));
}

async function showAlertMenu(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    await sendUpdatedMessage(chatId, getText(lang, 'alert_menu'), getAlertMenuKeyboard(lang));
}

async function showHistoryMenu(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    var history = await getHistory(chatId);
    var text = getText(lang, 'history_title') + '\n\n';
    if (!history || history.length === 0) {
        text += getText(lang, 'history_empty');
    } else {
        try {
            var items = typeof history === 'string' ? JSON.parse(history) : history;
            var recent = items.slice(-10).reverse();
            for (var i = 0; i < recent.length; i++) {
                var item = recent[i];
                text += getText(lang, 'history_item', [item.date, item.action, item.detail]);
            }
        } catch (e) {
            text += getText(lang, 'history_empty');
        }
    }
    var keyboard = {
        inline_keyboard: [
            [{ text: '🔄 ' + (lang === 'ru' ? 'Обновить' : 'Refresh'), callback_data: 'action_history_refresh' }],
            [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
        ]
    };
    await sendUpdatedMessage(chatId, text, keyboard);
}

async function showAboutMenu(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    var message = getText(lang, 'about_title') + '\n';
    message += getText(lang, 'about_version') + '\n';
    message += getText(lang, 'about_created') + '\n';
    message += getText(lang, 'about_dev') + '\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    message += getText(lang, 'about_instruction') + '\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    message += getText(lang, 'about_links') + '\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';
    message += getText(lang, 'about_commands');
    await sendUpdatedMessage(chatId, message, getBackKeyboard(lang));
}

// ============================================================
// 15. ONBOARDING
// ============================================================
async function showLanguageSelectOnboarding(chatId) {
    await sendUpdatedMessage(chatId, '🌍 Choose language:', getOnboardLanguageKeyboard());
}

async function showModeSelectOnboarding(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    var message = getText(lang, 'mode_select') + '\n\n';
    message += getText(lang, 'mode_beginner_desc') + '\n\n';
    message += getText(lang, 'mode_pro_desc') + '\n\n';
    message += getText(lang, 'mode_select_prompt');
    await sendUpdatedMessage(chatId, message, getOnboardModeKeyboard(lang));
}

async function showVipBonusOffer(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    var message = '🎁 BONUS!\n\nConnect exchange and get 3 days of VIP access for FREE!\n\nWhat you get:\n• ❄️ Panic mode — emergency protection\n• 🚀 Autotrading — automatic profit\n• 📊 Full portfolio analytics\n• 🔔 Unlimited alerts\n\n🔥 Offer valid only now!';
    await sendUpdatedMessage(chatId, message, getVipBonusKeyboard(lang));
}

async function handleOnboardConnectVip(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    await setData('state_' + chatId, 'waiting_for_keys_vip');
    await sendMessage(chatId, getText(lang, 'connect_prompt') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
}

async function handleOnboardSkip(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    await setData('onboarded_' + chatId, 'true');
    await showMainMenu(chatId);
}

async function showVipActivated(chatId) {
    var lang = await getData('lang_' + chatId) || 'ru';
    var expiresDate = formatDateShort(Date.now() + 3 * 24 * 60 * 60 * 1000);
    var message = '🎉 CONGRATULATIONS!\n\nYou connected your exchange and got 3 days of VIP access!\n\nValid until: ' + expiresDate + '\n\nNow you have access to everything:\n• ❄️ Panic mode\n• 🚀 Autotrading\n• 📊 Full analytics\n• 🔔 Unlimited alerts\n\nTry all features, then choose a plan that suits you!';
    var keyboard = {
        inline_keyboard: [
            [{ text: '🏠 To menu', callback_data: 'onboard_vip_done' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard);
}

// ============================================================
// 16. TRENDS (NO TWITTER/REDDIT)
// ============================================================
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
        if (Date.now() - parsed.timestamp < 300000) return parsed.data;
    }
    return null;
}

async function setCachedCoinGecko(coinId, data) {
    var cacheKey = 'cg_' + coinId;
    await setData(cacheKey, JSON.stringify({ data: data, timestamp: Date.now() }), 300);
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
        var dataObj = await getCachedCoinGecko(coinId);
        if (!dataObj) {
            var url = 'https://api.coingecko.com/api/v3/coins/' + coinId + '?x_cg_demo_api_key=' + COINGECKO_API_KEY;
            var response = await fetch(url, {
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) {
                await sendUpdatedMessage(chatId, '❌ Data for ' + coin + ' temporarily unavailable.', null, 'Markdown', messageId);
                return;
            }
            dataObj = await response.json();
            await setCachedCoinGecko(coinId, dataObj);
        }
        var price = dataObj.market_data?.current_price?.usd || 0;
        var change24h = dataObj.market_data?.price_change_percentage_24h || 0;
        var marketCap = dataObj.market_data?.market_cap?.usd || 0;
        var volume24h = dataObj.market_data?.total_volume?.usd || 0;
        var rank = dataObj.market_cap_rank || 'N/A';
        
        var trend = 'Neutral';
        var rec = '';
        if (change24h > 5) {
            trend = 'BULLISH';
            rec = '📈 ' + coin + ' is up ' + change24h.toFixed(2) + '% in 24h. Volume: $' + (volume24h / 1e6).toFixed(1) + 'M';
        } else if (change24h < -5) {
            trend = 'BEARISH';
            rec = '📉 ' + coin + ' is down ' + Math.abs(change24h).toFixed(2) + '% in 24h.';
        } else if (rank && rank < 50) {
            trend = 'TOP COIN';
            rec = '💎 ' + coin + ' is in top-50 cryptocurrencies.';
        } else {
            rec = '⚪ ' + coin + ' is calm. Change: ' + (change24h > 0 ? '+' : '') + change24h.toFixed(2) + '%';
        }
        var message = '📊 SOCIAL TREND: ' + coin + '\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            '💵 Price: $' + price.toFixed(2) + '\n' +
            '📈 24h change: ' + (change24h > 0 ? '+' : '') + change24h.toFixed(2) + '%\n' +
            '📊 24h volume: $' + (volume24h / 1e6).toFixed(1) + 'M\n' +
            '💰 Market cap: $' + (marketCap / 1e9).toFixed(2) + 'B\n' +
            '🏆 Rank: #' + rank + '\n' +
            '📌 Trend: ' + trend + '\n\n' +
            '💡 ' + rec + '\n\n' +
            '🕐 Updated: just now\n📡 Source: CoinGecko';
        var keyboard = {
            inline_keyboard: [
                [{ text: getText(lang, 'back_to_market'), callback_data: 'menu_market' }],
                [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
        await addHistory(chatId, getText(lang, 'history_social'), coin);
    } catch (error) {
        console.error('Trend error:', error);
        await sendUpdatedMessage(chatId, '❌ Error getting data for ' + coin + '. Please try again later.', null, 'Markdown', messageId);
    }
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
        var response = await fetch(dexUrl);
        var data = await response.json();
        var message = '📄 CONTRACT SEARCH RESULT\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
        message += '📌 Address: ' + address.slice(0, 10) + '...' + address.slice(-6) + '\n\n';
        if (data.pairs && data.pairs.length > 0) {
            var pair = data.pairs[0];
            message += '✅ Token found on DEX\n\n';
            message += '🌐 Network: ' + (pair.chainId || 'Unknown') + '\n';
            message += '🏦 DEX: ' + (pair.dexId || 'Unknown') + '\n';
            message += '💰 Price: $' + parseFloat(pair.priceUsd || 0).toFixed(8) + '\n';
            message += '💧 Liquidity: $' + parseFloat(pair.liquidity?.usd || 0).toFixed(2) + '\n';
            message += '📊 24h volume: $' + parseFloat(pair.volume?.h24 || 0).toFixed(2) + '\n\n';
            var liq = parseFloat(pair.liquidity?.usd || 0);
            var risk = '🟢 Low';
            var note = 'Sufficient liquidity.';
            if (liq < 10000) { risk = '🔴 High'; note = '⚠️ Very low liquidity!'; }
            else if (liq < 50000) { risk = '🟡 Medium'; note = '⚠️ Medium liquidity. Be careful.'; }
            message += '🛡️ Risk: ' + risk + '\n💡 ' + note + '\n\n';
            if (pair.url) message += '🔗 [View on DEX](' + pair.url + ')\n';
        } else {
            message += '❌ Token not found on DEX\n\n';
            message += '💡 Possible reasons:\n• New token not added yet\n• Invalid contract address\n• Token on different network (not Ethereum)\n\n';
            message += '🔗 [Check manually](https://etherscan.io/address/' + address + ')';
        }
        var keyboard = {
            inline_keyboard: [
                [{ text: '🔍 Search another token', callback_data: 'trend_search_menu' }],
                [{ text: getText(lang, 'back_to_market'), callback_data: 'menu_social' }],
                [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
        await addHistory(chatId, '🔍 Contract search', address.slice(0, 10) + '...');
    } catch (error) {
        console.error('Contract search error:', error);
        await sendUpdatedMessage(chatId, '❌ Error searching contract.\n\nPlease try again later or check address manually.', null, 'Markdown', messageId);
    }
    await setData('state_' + chatId, 'idle');
}

// ============================================================
// 17. ANTISCAM HANDLERS
// ============================================================
async function handleAntiScamInput(chatId, text, lang, update, messageId) {
    var check = await checkLimit(chatId, 'antiscam');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        await setData('state_' + chatId, 'idle');
        return;
    }
    var state = await getData('state_' + chatId);
    
    if (text === '/cancel' || text === '❌ Отмена' || text === '❌ Cancel') {
        await setData('state_' + chatId, 'idle');
        await sendUpdatedMessage(chatId, getText(lang, 'scan_cancelled'), null, 'Markdown', messageId);
        await showMainMenu(chatId);
        return;
    }
    
    if (state === 'antiscam_url') {
        if (!isValidUrl(text)) {
            await sendUpdatedMessage(chatId, getText(lang, 'scan_link_invalid') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang), 'Markdown', messageId);
            return;
        }
        await handleUrlCheck(chatId, text, lang, messageId);
    } else if (state === 'antiscam_contract') {
        if (!isValidContractAddress(text)) {
            await sendUpdatedMessage(chatId, getText(lang, 'scan_contract_invalid') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang), 'Markdown', messageId);
            return;
        }
        await handleContractCheck(chatId, text, lang, messageId);
    } else if (state === 'antiscam_dex') {
        if (!isValidContractAddress(text)) {
            await sendUpdatedMessage(chatId, getText(lang, 'scan_contract_invalid') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang), 'Markdown', messageId);
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
            await sendUpdatedMessage(chatId, getText(lang, 'scan_file_invalid') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang), 'Markdown', messageId);
        }
    } else if (state === 'antiscam_impersonation') {
        if (update && update.message.forward_from) {
            await handleImpersonationCheck(chatId, update, lang, messageId);
        } else {
            await sendUpdatedMessage(chatId, getText(lang, 'scan_impersonation_invalid') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang), 'Markdown', messageId);
        }
    } else if (state === 'antiscam_wallet') {
        await handleWalletCheck(chatId, text, lang, messageId);
    } else {
        await sendUpdatedMessage(chatId, '❌ Unknown check type.', null, 'Markdown', messageId);
    }
    await setData('state_' + chatId, 'idle');
}

async function handleUrlCheck(chatId, url, lang, messageId) {
    await sendTyping(chatId);
    var result = await checkUrl(url);
    var message = result.safe ?
        getText(lang, 'scan_safe') + '\n\n' + getText(lang, 'scan_result_safe', 'Link') :
        getText(lang, 'scan_danger') + '\n\n' + getText(lang, 'scan_result_danger', ['Link', result.reason]);
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_antiscam'), 'Link: ' + url.slice(0, 30) + '...');
}

async function handleContractCheck(chatId, address, lang, messageId) {
    await sendTyping(chatId);
    var contractInfo = await checkContract(address);
    var message = '📄 CONTRACT CHECK\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 ' + address + '\n\n' + contractInfo.reason + '\n\n💡 Check manually: https://etherscan.io/address/' + address;
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_antiscam'), 'Contract: ' + address.slice(0, 10) + '...');
}

async function handleDEXCheck(chatId, address, lang, messageId) {
    await sendTyping(chatId);
    try {
        var dexUrl = 'https://api.dexscreener.com/latest/dex/search?q=' + address;
        var response = await fetch(dexUrl);
        var data = await response.json();
        var message = '🔍 DEX CHECK\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 ' + address.slice(0, 10) + '...' + address.slice(-6) + '\n\n';
        if (data.pairs && data.pairs.length > 0) {
            var pair = data.pairs[0];
            message += '✅ Token found on DEX\n\n';
            message += '🌐 Network: ' + (pair.chainId || 'Unknown') + '\n';
            message += '🏦 DEX: ' + (pair.dexId || 'Unknown') + '\n';
            message += '💰 Price: $' + parseFloat(pair.priceUsd || 0).toFixed(8) + '\n';
            message += '💧 Liquidity: $' + parseFloat(pair.liquidity?.usd || 0).toFixed(2) + '\n';
            message += '📊 24h volume: $' + parseFloat(pair.volume?.h24 || 0).toFixed(2) + '\n\n';
            var liq = parseFloat(pair.liquidity?.usd || 0);
            var risk = '🟢 Low';
            var note = 'Sufficient liquidity.';
            if (liq < 10000) { risk = '🔴 High'; note = '⚠️ Very low liquidity!'; }
            else if (liq < 50000) { risk = '🟡 Medium'; note = '⚠️ Medium liquidity. Be careful.'; }
            message += '🛡️ Risk: ' + risk + '\n💡 ' + note + '\n\n';
            if (pair.url) message += '🔗 [View on DEX](' + pair.url + ')\n';
        } else {
            message += '❌ Token not found on DEX\n\nPossible reasons: new token, invalid address, or token on different network.\n';
        }
        message += '🔗 [Etherscan](https://etherscan.io/address/' + address + ')';
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
        await sendUpdatedMessage(chatId, '❌ Error checking DEX.', null, 'Markdown', messageId);
    }
}

async function handleFileCheck(chatId, update, lang, messageId) {
    var file = update.message.document;
    var fileName = file.file_name || 'unknown_file';
    var MAX_FILE_SIZE = 20 * 1024 * 1024;
    if (file.file_size > MAX_FILE_SIZE) {
        await sendUpdatedMessage(chatId, '❌ File too large (max 20MB)', null, 'Markdown', messageId);
        return;
    }
    await sendTyping(chatId);
    var result = checkFile(fileName);
    var message = '📁 FILE CHECK\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 ' + fileName + '\n📏 ' + (file.file_size / 1024).toFixed(1) + ' KB\n\n' + result;
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_antiscam'), 'File: ' + fileName);
}

async function handleImpersonationCheck(chatId, update, lang, messageId) {
    var forwarded = update.message.forward_from;
    var username = forwarded.username || '';
    if (!username) {
        await sendUpdatedMessage(chatId, '❌ Could not identify user.', null, 'Markdown', messageId);
        await showMainMenu(chatId);
        return;
    }
    await sendTyping(chatId);
    var result = checkImpersonation(username);
    var message = '🔄 ACCOUNT CHECK\n━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 @' + username + '\n\n';
    if (result) {
        message += getText(lang, 'scan_danger') + '\n\n' + result;
    } else {
        message += getText(lang, 'scan_safe') + '\n\n✅ Account is safe.';
    }
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_antiscam'), 'Account: @' + username);
}

async function handleWalletCheck(chatId, address, lang, messageId) {
    var check = await checkLimit(chatId, 'antiscam');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        await setData('state_' + chatId, 'idle');
        return;
    }
    await sendTyping(chatId);
    if (!isValidContractAddress(address)) {
        await sendUpdatedMessage(chatId, getText(lang, 'wallet_invalid') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang), 'Markdown', messageId);
        return;
    }
    var walletInfo = await checkWallet(address);
    var message = '👛 WALLET CHECK\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 Address: ' + address.slice(0, 10) + '...' + address.slice(-6) + '\n🌐 Network: Ethereum\n\n💰 Balance: ' + walletInfo.balance.toFixed(4) + ' ETH\n🪙 Tokens: ' + (walletInfo.tokens.length > 0 ? walletInfo.tokens.join(', ') : 'none') + '\n\n';
    var riskEmoji = walletInfo.risk === 'high' ? '🔴' : walletInfo.risk === 'medium' ? '🟡' : '🟢';
    var riskLabel = walletInfo.risk === 'high' ? 'High' : walletInfo.risk === 'medium' ? 'Medium' : 'Low';
    message += riskEmoji + ' Risk: ' + riskLabel + '\n\n';
    if (walletInfo.risk === 'high') {
        message += '• ⚠️ Suspicious tokens detected\n• ⚠️ Few transactions\n\n';
    } else if (walletInfo.risk === 'medium') {
        message += '• ⚠️ Wallet created recently\n\n';
    } else {
        message += '✅ No risks detected\n\n';
    }
    message += '💡 Recommendations:\n';
    if (walletInfo.risk === 'high') {
        message += '• 🚨 Do not interact with suspicious tokens\n• 🔍 Check contracts via DEX\n\n';
    } else if (walletInfo.risk === 'medium') {
        message += '• 💡 Diversify portfolio\n• 📊 Connect exchange for full analysis\n\n';
    } else {
        message += '• 📊 Want full analysis with recommendations?\n• 🔐 Connect exchange via /connect\n\n';
    }
    message += '━━━━━━━━━━━━━━━━━━━━━━━\n🔗 View: https://etherscan.io/address/' + address;
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'wallet_connect'), callback_data: 'menu_connect' }],
            [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_antiscam'), 'Wallet: ' + address.slice(0, 10) + '...');
    await setData('state_' + chatId, 'idle');
}

// ============================================================
// 18. AUTO CHECK
// ============================================================
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
                var message = '🚨 SUSPICIOUS LINK!\n\n🔗 ' + url + '\n\n⚠️ ' + result.reason + '\n\n🛡️ Never enter passwords or seed phrases!';
                var keyboard = {
                    inline_keyboard: [
                        [{ text: '🛡️ Check other', callback_data: 'menu_security' }],
                        [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
                    ]
                };
                await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
                await addHistory(chatId, getText(lang, 'history_antiscam'), 'Auto: ' + url.slice(0, 30) + '...');
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
    var result = '📄 AUTO CONTRACT CHECK\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 ' + address + '\n\n' + contractInfo.reason + '\n\n💡 Check manually: https://etherscan.io/address/' + address;
    var keyboard = {
        inline_keyboard: [
            [{ text: '🛡️ Check other', callback_data: 'menu_security' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, result, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_antiscam'), 'Contract: ' + address.slice(0, 10) + '...');
}

// ============================================================
// 19. NEWS
// ============================================================
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
            return { error: true, message: '⏳ News updating, please wait...' };
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

    async _fetchAndCacheNews(chatId, lang) {
        var isRu = lang === 'ru';
        var analysisData = await getData('analysis_' + chatId);
        var assets = [];
        if (analysisData) {
            try {
                var analysis = typeof analysisData === 'string' ? JSON.parse(analysisData) : analysisData;
                assets = analysis.assets || [];
            } catch (e) { console.error('Analysis parse error:', e); }
        }
        if (assets.length === 0) {
            assets = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA'].map(function(symbol) { return { symbol: symbol, weight: 20 }; });
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
                    if (Date.now() - parsed.timestamp < 300000) return parsed.articles;
                }
                var url = 'https://newsapi.org/v2/everything?q=' + query + '+crypto&language=' + (isRu ? 'ru' : 'en') + '&sortBy=publishedAt&pageSize=3&apiKey=' + NEWS_API_KEY;
                var response = await fetch(url);
                var data = await response.json();
                var articles = [];
                if (data.status === 'ok' && data.articles) {
                    articles = data.articles;
                    await setData(cacheKey, JSON.stringify({ articles: articles, timestamp: Date.now() }), 300);
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
}

var newsManager = new NewsManager();

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
    var report = getText(lang, 'news_personalized_header');
    if (result.fromCache) {
        report += '🕐 Updated ' + result.age + ' min ago\n';
    } else {
        report += '🕐 Just updated\n';
    }
    
    var assetsList = '';
    if (result.assets && Array.isArray(result.assets) && result.assets.length > 0) {
        assetsList = result.assets.map(function(a) { return a.symbol; }).join(', ');
    } else {
        assetsList = 'BTC, ETH, SOL, BNB, ADA';
    }
    report += '📌 Your assets: ' + assetsList + '\n\n';
    
    if (result.articles.length === 0) {
        report += getText(lang, 'news_no_news') + '\n\nTry refreshing in 5-10 minutes';
        var keyboard = {
            inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'menu_news' }],
                [{ text: getText(lang, 'back_to_market'), callback_data: 'menu_market' }],
                [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
        return;
    }
    for (var i = 0; i < Math.min(result.articles.length, 7); i++) {
        var article = result.articles[i];
        var title = article.title?.length > 80 ? article.title.slice(0, 77) + '...' : article.title || 'News';
        var source = article.source?.name || 'Unknown';
        var date = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US') : '';
        var description = article.description?.length > 120 ? article.description.slice(0, 117) + '...' : article.description || '';
        var assetTag = article.asset ? ' 🎯 ' + article.asset : '';
        var readMoreText = lang === 'ru' ? 'Читать полностью' : 'Read more';
        report += '📌 ' + title + assetTag + '\n';
        report += '   📎 ' + source;
        if (date) report += ' | 📅 ' + date;
        report += '\n';
        if (description) {
            report += '   📝 ' + description + '\n';
        }
        report += '   🔗 [' + readMoreText + '](' + article.url + ')\n\n';
    }
    report += '━━━━━━━━━━━━━━━━━━━━━━━\n';
    var foundText = lang === 'ru' ? 'Найдено' : 'Found';
    var refreshText = lang === 'ru' ? 'обновить' : 'refresh';
    report += '📊 ' + foundText + ': ' + result.articles.length + ' news\n';
    report += '🔄 /news — ' + refreshText;
    var keyboard = {
        inline_keyboard: [
            [{ text: '🔄 Refresh', callback_data: 'menu_news' }],
            [{ text: getText(lang, 'back_to_market'), callback_data: 'menu_market' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_news'), 'Personalized (' + result.articles.length + ')');
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
        var response = await fetch(url);
        var data = await response.json();
        if (data.status !== 'ok' || !data.articles || data.articles.length === 0) {
            await sendUpdatedMessage(chatId, getText(lang, 'news_empty'), null, 'Markdown', messageId);
            return;
        }
        await setData(cacheKey, JSON.stringify({ articles: data.articles, timestamp: Date.now() }), 300);
        await sendNewsReport(chatId, data.articles, coin, lang, messageId);
    } catch (error) {
        console.error('News error:', error);
        await sendUpdatedMessage(chatId, '❌ Error getting news. Please try again later.', null, 'Markdown', messageId);
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
        var readMoreText = isRu ? 'Читать полностью' : 'Read more';
        report += '📌 ' + title + '\n';
        report += '   📎 ' + source;
        if (date) report += ' | 📅 ' + date;
        report += '\n';
        if (description) {
            report += '   📝 ' + description + '\n';
        }
        report += '   🔗 [' + readMoreText + '](' + article.url + ')\n\n';
    }
    report += '━━━━━━━━━━━━━━━━━━━━━━━\n';
    var foundText = isRu ? 'Найдено' : 'Found';
    var refreshText = isRu ? 'обновить' : 'refresh';
    report += '📊 ' + foundText + ': ' + count + ' news\n';
    report += '🔄 /news ' + coin + ' — ' + refreshText;
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'back_to_market'), callback_data: 'menu_market' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_news'), coin);
}

// ============================================================
// 20. CALENDAR
// ============================================================
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
        var response = await fetch(url);
        var data = await response.json();
        var events = [];
        if (data.economicCalendar && data.economicCalendar.length > 0) {
            events = data.economicCalendar.slice(0, 10).map(function(event) {
                return {
                    title: event.event || 'Event',
                    date: event.date || 'Date unknown',
                    importance: event.importance === 2 ? '🔴 High' :
                        event.importance === 1 ? '🟡 Medium' : '🟢 Low',
                    impact: event.impact || 'N/A'
                };
            });
        }
        if (events.length === 0) {
            await sendUpdatedMessage(chatId, getText(lang, 'calendar_empty'), null, 'Markdown', messageId);
            return;
        }
        await setData(cacheKey, JSON.stringify({ events: events, timestamp: Date.now() }), 1800);
        await sendCalendarReport(chatId, events, lang, messageId);
    } catch (error) {
        console.error('Calendar error:', error);
        await sendUpdatedMessage(chatId, '❌ Error getting calendar. Please try again later.', null, 'Markdown', messageId);
    }
}

async function sendCalendarReport(chatId, events, lang, messageId) {
    var calendar = getText(lang, 'calendar_result', events);
    var keyboard = {
        inline_keyboard: [
            [{ text: getText(lang, 'back_to_market'), callback_data: 'menu_market' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, calendar, keyboard, 'Markdown', messageId);
    await addHistory(chatId, getText(lang, 'history_calendar'), 'Week');
}

// ============================================================
// 21. ALERTS
// ============================================================
async function createAlert(chatId, type, params) {
    var key = 'alerts_' + chatId;
    var alerts = await getData(key);
    alerts = alerts ? (typeof alerts === 'string' ? JSON.parse(alerts) : alerts) : [];
    var plan = await getUserPlan(chatId);
    var limit = plan.limits.alerts || 0;
    if (alerts.length >= limit && limit !== Infinity) {
        return { error: '📊 Alert limit exceeded. Upgrade: /subscribe' };
    }
    var alert = { id: Date.now().toString(), type: type, params: params, active: true, createdAt: Date.now() };
    alerts.push(alert);
    await setData(key, JSON.stringify(alerts));
    return { success: true };
}

async function getAlerts(chatId) {
    var key = 'alerts_' + chatId;
    var data = await getData(key);
    return data ? (typeof data === 'string' ? JSON.parse(data) : data) : [];
}

async function deleteAlert(chatId, alertId) {
    var key = 'alerts_' + chatId;
    var alerts = await getData(key);
    if (!alerts) return;
    alerts = typeof alerts === 'string' ? JSON.parse(alerts) : alerts;
    var filtered = alerts.filter(function(a) { return a.id !== alertId; });
    await setData(key, JSON.stringify(filtered));
}

async function checkAlerts() {
    var keys = await VOID_KV.list('alerts_');
    for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var chatId = parseInt(key.name.replace('alerts_', ''));
        var alerts = await getAlerts(chatId);
        var keysUser = await loadUserKeys(chatId);
        if (!keysUser) continue;
        try {
            var exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
            var updated = false;
            for (var i = 0; i < alerts.length; i++) {
                var alert = alerts[i];
                if (!alert.active) continue;
                try {
                    var ticker = await exchange.fetchTicker(alert.params.symbol + '/USDT');
                    if (!ticker) continue;
                    var price = ticker.last;
                    if (alert.type === 'price') {
                        if (alert.params.direction === 'above' && price >= alert.params.target) {
                            await sendMessage(chatId, '🔔 ALERT TRIGGERED!\n\n' + alert.params.symbol + '\nPrice: $' + price.toFixed(2) + '\nTarget: > $' + alert.params.target);
                            alert.active = false;
                            updated = true;
                        } else if (alert.params.direction === 'below' && price <= alert.params.target) {
                            await sendMessage(chatId, '🔔 ALERT TRIGGERED!\n\n' + alert.params.symbol + '\nPrice: $' + price.toFixed(2) + '\nTarget: < $' + alert.params.target);
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
                                await sendMessage(chatId, '🔔 ALERT TRIGGERED!\n\n' + alert.params.symbol + '\nChange: ' + (change > 0 ? '+' : '') + change.toFixed(2) + '%\nTarget: ' + alert.params.target + '%');
                                alert.active = false;
                                updated = true;
                            }
                        }
                        await setData(priceKey, price.toString(), 3600);
                    }
                } catch (e) {
                    console.error('Alert check error for ' + alert.id + ' for ' + chatId + ':', e.message);
                }
            }
            if (updated) {
                await setData(key.name, JSON.stringify(alerts));
            }
        } catch (error) {
            console.error('Exchange connection error for ' + chatId + ':', error);
        }
    }
}

// ============================================================
// 22. AUTOTRADING
// ============================================================
async function runAutotrade() {
    var keys = await VOID_KV.list('autotrade_');
    for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var chatId = parseInt(key.name.replace('autotrade_', ''));
        var data = await getData(key.name);
        if (!data) continue;
        var config = typeof data === 'string' ? JSON.parse(data) : data;
        if (!config.active) continue;
        var keysUser = await loadUserKeys(chatId);
        if (!keysUser) continue;
        
        var userPlan = await getUserPlan(chatId);
        if (!userPlan.limits.autotrade || userPlan.limits.autotrade === false) {
            await deleteData(key.name);
            var msg = userPlan.plan === 'ru' ? 'Автоторговля отключена. Ваш тариф не поддерживает эту функцию.' : 'Autotrading disabled. Your plan does not support this feature.';
            await sendMessage(chatId, '❌ ' + msg);
            continue;
        }
        
        try {
            var exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
            var balance = await exchange.fetchBalance();
            var total = balance.total;
            var coins = Object.keys(total).filter(function(c) { return c !== 'USDT' && total[c] > 0; });
            if (config.level === 4) {
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
                        var stop5 = price * 0.95;
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

// ============================================================
// 23. SNOWBALL STRATEGY (LEVEL 4)
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
    if (!keysUser) return { error: '❌ No API keys' };
    
    var userPlan = await getUserPlan(chatId);
    if (!userPlan.limits.autotrade || userPlan.limits.autotrade === false) {
        return { error: '❌ Autotrading not available on your plan' };
    }
    
    try {
        var exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
        var balance = await exchange.fetchBalance();
        var total = balance.total;
        var tokens = [];
        for (var symbol in total) {
            if (total.hasOwnProperty(symbol)) {
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
        }
        if (tokens.length < 2) {
            return { error: '❌ Need at least 2 tokens for strategy' };
        }
        tokens.sort(function(a, b) { return b.change24h - a.change24h; });
        var growToken = tokens[0];
        if (growToken.change24h < 2) {
            return { error: '❌ No token with sufficient growth (>2% in 24h)' };
        }
        var junkToken = tokens[tokens.length - 1];
        if (junkToken.change24h > 0) {
            var nonGrowing = tokens.filter(function(t) { return t.change24h < 2; });
            if (nonGrowing.length > 0 && nonGrowing[0].symbol !== growToken.symbol) {
                junkToken = nonGrowing[0];
            } else {
                return { error: '❌ All tokens are growing' };
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
                var message = '💰 PROFIT TAKEN!\n\n' +
                    growToken.symbol + '\nGrowth: ' + growth.toFixed(1) + '%\n' +
                    'Received: $' + (order.cost || 0).toFixed(2) + ' USDT';
                await sendMessage(chatId, message);
                await addHistory(chatId, '❄️ Snowball — take profit', growToken.symbol + ' → USDT');
                return { success: true, message: message };
            }
        }
        var junkBalance = balance.free[junkToken.symbol] || 0;
        if (junkBalance < 0.001) {
            return { error: '❌ Insufficient ' + junkToken.symbol + ' to sell' };
        }
        var sellAmount = junkBalance * 0.5;
        var sellOrder = await exchange.createMarketSellOrder(junkToken.symbol + '/USDT', sellAmount);
        var usdtReceived = sellOrder.cost || 0;
        var buyAmount = usdtReceived / growToken.price;
        if (buyAmount > 0.0001) {
            await exchange.createMarketBuyOrder(growToken.symbol + '/USDT', buyAmount);
            var message = '🔄 SNOWBALL\n\n' +
                growToken.symbol + ' → +' + growth.toFixed(1) + '%\n' +
                'Sold ' + sellAmount.toFixed(4) + ' ' + junkToken.symbol + ' ($' + usdtReceived.toFixed(2) + ')\n' +
                'Bought ' + buyAmount.toFixed(4) + ' ' + growToken.symbol + '\n' +
                'Next threshold: +' + (growth + 5).toFixed(1) + '%';
            await sendMessage(chatId, message);
            await addHistory(chatId, '❄️ Snowball — flow', growToken.symbol + ' ← ' + junkToken.symbol + ' ($' + usdtReceived.toFixed(2) + ')');
            return { success: true, message: message };
        }
        return { success: false, error: '❌ Failed to execute flow' };
    } catch (error) {
        console.error('Snowball strategy error:', error);
        return { error: '❌ Error: ' + error.message };
    }
}

// ============================================================
// 24. PANIC MODE
// ============================================================
async function checkPanic() {
    var keys = await VOID_KV.list('panic_');
    for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
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
                    console.error('Error checking ' + coin + ':', e.message);
                }
            }
            if (panicTriggered) {
                var coinsList = droppedCoins.map(function(c) { return '• ' + c.coin + ': -' + c.drop.toFixed(1) + '%'; }).join('\n');
                var message = '🚨 PANIC MODE TRIGGERED!\n\n' +
                    'Detected drop >5% across multiple assets:\n\n' + coinsList + '\n\n' +
                    '⚠️ It\'s recommended to convert ALL assets to USDT to protect capital.';
                var keyboard = {
                    inline_keyboard: [
                        [{ text: '🔄 Convert all to USDT', callback_data: 'panic_convert_all' }],
                        [{ text: '🔙 Back to menu', callback_data: 'back_to_menu' }]
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
        await sendMessage(chatId, '❌ No keys for conversion.');
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
                details.push('• ' + coin + ': Error: ' + e.message);
            }
        }
        var message = '✅ PANIC — CONVERSION COMPLETED!\n\n' +
            '🔄 Sold ' + converted + ' assets to USDT\n\n' +
            details.join('\n') + '\n\n' +
            '🛡️ Portfolio is safe.';
        await sendMessage(chatId, message);
        await deleteData('panic_' + chatId);
        var priceKeys = await VOID_KV.list('panic_price_' + chatId + '_');
        for (var j = 0; j < priceKeys.length; j++) {
            await deleteData(priceKeys[j].name);
        }
    } catch (error) {
        console.error('Panic convert error:', error);
        await sendMessage(chatId, '❌ Conversion error: ' + error.message);
    }
}

// ============================================================
// 25. PORTFOLIO ANALYSIS
// ============================================================
function generateCSV(engineResult) {
    var csv = 'Asset,Value(USDT),Percentage\n';
    var assets = engineResult.assets || [];
    for (var i = 0; i < assets.length; i++) {
        var a = assets[i];
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

async function executeRecommendation(chatId, recId) {
    var analysisData = await getData('analysis_' + chatId);
    if (!analysisData) return { error: '❌ No analysis data' };
    var analysis = typeof analysisData === 'string' ? JSON.parse(analysisData) : analysisData;
    var rec = analysis.recommendations.find(function(r) { return r.id === recId; });
    if (!rec) return { error: '❌ Recommendation not found' };
    var userPlan = await getUserPlan(chatId);
    if (!userPlan.limits.autotrade || userPlan.limits.autotrade === false) {
        return { error: '❌ Autotrading not available on your plan' };
    }
    var orderLimitKey = 'orders_' + chatId + '_' + new Date().toISOString().split('T')[0];
    var ordersToday = parseInt(await getData(orderLimitKey) || '0');
    if (ordersToday >= CONFIG.MAX_ORDERS_PER_DAY) {
        return { error: '❌ Order limit reached for today (' + CONFIG.MAX_ORDERS_PER_DAY + ')' };
    }
    var keys = await loadUserKeys(chatId);
    if (!keys) return { error: '❌ No API keys' };
    try {
        var exchange = await connectExchange(keys.exchangeId, keys.apiKey, keys.secretKey);
        var balance = await exchange.fetchBalance();
        var free = balance.free[rec.asset] || 0;
        if (rec.action === 'sell' && free < rec.amount) {
            return { error: '❌ Insufficient ' + rec.asset + ' balance (available: ' + free + ', needed: ' + rec.amount + ')' };
        }
        if (rec.action === 'buy') {
            var freeUSDT = balance.free['USDT'] || 0;
            var ticker = await exchange.fetchTicker(rec.symbol || rec.asset + '/USDT');
            var price = ticker ? ticker.last : 0;
            var needed = rec.amount * price;
            if (freeUSDT < needed) {
                return { error: '❌ Insufficient USDT for purchase (available: ' + freeUSDT + ', needed: ' + needed + ')' };
            }
        }
        var order;
        if (rec.action === 'sell') {
            order = await exchange.createMarketSellOrder(rec.symbol, rec.amount);
        } else if (rec.action === 'buy') {
            order = await exchange.createMarketBuyOrder(rec.symbol, rec.amount);
        } else {
            return { error: '❌ Unknown action: ' + rec.action };
        }
        await new Promise(function(r) { setTimeout(r, 3000); });
        var orderStatus = await exchange.fetchOrder(order.id);
        if (orderStatus.status !== 'closed') {
            return { error: '❌ Order not executed. Current status: ' + orderStatus.status };
        }
        await setData(orderLimitKey, (ordersToday + 1).toString(), 86400);
        return { success: true, order: orderStatus };
    } catch (error) {
        console.error('Order execution error:', error);
        return { error: '❌ Execution error: ' + error.message };
    }
}

// ============================================================
// 26. CALLBACK HANDLER
// ============================================================
async function handleCallback(update) {
    var callback = update.callback_query;
    var chatId = callback.message.chat.id;
    var data = callback.data;
    var lang = await getData('lang_' + chatId) || 'ru';

    await answerCallback(callback.id);
    console.log('🔄 Callback: ' + data + ' from ' + chatId);

    try {
        if (data === 'cancel_action') {
            await setData('state_' + chatId, 'idle');
            await sendUpdatedMessage(chatId, getText(lang, 'scan_cancelled'), null, 'Markdown');
            await showMainMenu(chatId);
            return;
        }

        if (data === 'back_to_menu') { await showMainMenu(chatId); return; }
        if (data === 'back_to_functions') { await showFunctionsMenu(chatId); return; }
        if (data === 'back_to_settings') { await showSettingsMenu(chatId); return; }
        if (data === 'back_to_analyze') { await showAnalyzeMenu(chatId); return; }
        if (data === 'back_to_help') { await showHelpMenu(chatId); return; }
        if (data === 'back_to_market') { await showMarketMenu(chatId); return; }
        if (data === 'back_to_security') { await showSecurityMenu(chatId); return; }
        if (data === 'back_to_plans') { await showPlansMenu(chatId); return; }
        if (data === 'back_to_history') { await showHistoryMenu(chatId); return; }

        if (data === 'menu_functions') { await showFunctionsMenu(chatId); return; }
        if (data === 'menu_settings_new') { await showSettingsMenu(chatId); return; }
        if (data === 'menu_plans') { await showPlansMenu(chatId); return; }
        if (data === 'menu_help') { await showHelpMenu(chatId); return; }
        if (data === 'menu_about') { await showAboutMenu(chatId); return; }
        if (data === 'menu_analyze') { await showAnalyzeMenu(chatId); return; }
        if (data === 'menu_security') { await showSecurityMenu(chatId); return; }
        if (data === 'menu_market') { await showMarketMenu(chatId); return; }
        if (data === 'menu_social') { await showSocialTrends(chatId); return; }
        if (data === 'menu_history') { await showHistoryMenu(chatId); return; }
        if (data === 'menu_news') { await handleNewsCommand(chatId, null, lang, null); return; }
        if (data === 'menu_calendar') { await handleCalendarCommand(chatId, lang, null); return; }
        if (data === 'menu_connect') {
            await sendMessage(chatId, getText(lang, 'connect_prompt') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            await setData('state_' + chatId, 'waiting_for_keys');
            return;
        }

        // --- AI Советник ---
        if (data === 'menu_ai') {
            await handleAICommand(chatId, '', lang, null);
            return;
        }

        if (data === 'settings_change_lang') { await showLanguageSelect(chatId); return; }
        if (data === 'settings_change_mode') { await showModeSelect(chatId); return; }
        if (data === 'lang_ru') {
            await setData('lang_' + chatId, 'ru');
            await sendMessage(chatId, '✅ Language: Русский');
            await showSettingsMenu(chatId);
            return;
        }
        if (data === 'lang_en') {
            await setData('lang_' + chatId, 'en');
            await sendMessage(chatId, '✅ Language: English');
            await showSettingsMenu(chatId);
            return;
        }
        if (data === 'mode_beginner') {
            await setData('mode_' + chatId, 'beginner');
            await sendMessage(chatId, '✅ Mode: Beginner');
            await showSettingsMenu(chatId);
            return;
        }
        if (data === 'mode_pro') {
            await setData('mode_' + chatId, 'pro');
            await sendMessage(chatId, '✅ Mode: Experienced');
            await showSettingsMenu(chatId);
            return;
        }

        if (data === 'antiscam_url') {
            await setData('state_' + chatId, 'antiscam_url');
            await sendMessage(chatId, getText(lang, 'scan_link') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            return;
        }
        if (data === 'antiscam_contract') {
            await setData('state_' + chatId, 'antiscam_contract');
            await sendMessage(chatId, getText(lang, 'scan_contract') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            return;
        }
        if (data === 'antiscam_file') {
            await setData('state_' + chatId, 'antiscam_file');
            await sendMessage(chatId, getText(lang, 'scan_file') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            return;
        }
        if (data === 'antiscam_dex') {
            await setData('state_' + chatId, 'antiscam_dex');
            await sendMessage(chatId, getText(lang, 'dex_prompt') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            return;
        }
        if (data === 'antiscam_impersonation') {
            await setData('state_' + chatId, 'antiscam_impersonation');
            await sendMessage(chatId, getText(lang, 'impersonation_prompt') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            return;
        }
        if (data === 'antiscam_wallet') {
            await setData('state_' + chatId, 'antiscam_wallet');
            await sendMessage(chatId, getText(lang, 'wallet_prompt') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            return;
        }

        if (data === 'trend_search_menu') {
            await showTrendSearchMenu(chatId);
            return;
        }
        if (data === 'trend_search_name') {
            await setData('state_' + chatId, 'waiting_for_trend_search');
            await sendMessage(chatId, getText(lang, 'social_search_prompt') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            return;
        }
        if (data === 'trend_search_contract') {
            await setData('state_' + chatId, 'waiting_for_contract_search');
            await sendMessage(chatId, '📄 Send contract address to check\n\n📌 Example: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e\n🔄 /cancel — cancel\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            return;
        }
        if (data.startsWith('trend_')) {
            await handleTrendClick(chatId, data, lang, null);
            return;
        }

        if (data.startsWith('plan_')) {
            var plan = data.replace('plan_', '');
            await handlePlanSelection(chatId, plan, lang, null);
            return;
        }

        if (data === 'autotrade_menu') { await showAutotradeMenu(chatId); return; }
        if (data === 'autotrade_level1') {
            await setData('autotrade_' + chatId, JSON.stringify({ level: 1, active: true, lastCheck: Date.now() }));
            await sendMessage(chatId, '🛡️ Level 1 (Protection) activated');
            return;
        }
        if (data === 'autotrade_level2') {
            await setData('autotrade_' + chatId, JSON.stringify({ level: 2, active: true, lastCheck: Date.now() }));
            await sendMessage(chatId, '🔄 Level 2 (Reallocation) activated');
            return;
        }
        if (data === 'autotrade_level3') {
            await setData('autotrade_' + chatId, JSON.stringify({ level: 3, active: true, lastCheck: Date.now() }));
            await sendMessage(chatId, '🧠 Level 3 (Smart Growth) activated');
            return;
        }
        if (data === 'autotrade_level4') {
            await setData('autotrade_' + chatId, JSON.stringify({ level: 4, active: true, lastCheck: Date.now(), type: 'snowball' }));
            await sendMessage(chatId, '❄️ Level 4 (Snowball) activated');
            return;
        }
        if (data === 'autotrade_stop') {
            await deleteData('autotrade_' + chatId);
            await sendMessage(chatId, getText(lang, 'autotrade_stopped'));
            return;
        }

        if (data === 'alert_menu') { await showAlertMenu(chatId); return; }
        if (data === 'alert_price') {
            await setData('state_' + chatId, 'alert_price');
            await sendMessage(chatId, getText(lang, 'alert_create_price') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            return;
        }
        if (data === 'alert_change') {
            await setData('state_' + chatId, 'alert_change');
            await sendMessage(chatId, getText(lang, 'alert_create_change') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            return;
        }
        if (data === 'alert_volume') {
            await setData('state_' + chatId, 'alert_volume');
            await sendMessage(chatId, '📊 Create volume alert\n\nEnter symbol and volume in format:\n"BTC 1000000"\n🔄 /cancel — cancel\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            return;
        }
        if (data === 'alert_news') {
            var result = await createAlert(chatId, 'news', {});
            if (result.error) { await sendMessage(chatId, result.error); return; }
            await sendMessage(chatId, '✅ Alert created!');
            return;
        }
        if (data === 'alert_calendar') {
            var result = await createAlert(chatId, 'calendar', {});
            if (result.error) { await sendMessage(chatId, result.error); return; }
            await sendMessage(chatId, '✅ Alert created!');
            return;
        }
        if (data === 'alert_list') {
            var alerts = await getAlerts(chatId);
            if (alerts.length === 0) {
                await sendMessage(chatId, '📭 You have no active alerts.');
                return;
            }
            var text = getText(lang, 'alert_list');
            for (var i = 0; i < alerts.length; i++) {
                var a = alerts[i];
                var typeText = a.type === 'price' ? '💰 price' : a.type === 'change' ? '📈 change' : a.type === 'volume' ? '📊 volume' : a.type;
                text += '• ' + (a.params.symbol || '') + ' (' + typeText + ') – ' + (a.params.target || '') + '\n';
            }
            var keyboard = {
                inline_keyboard: alerts.map(function(a) {
                    return [{ text: '❌ Delete ' + (a.params.symbol || a.id), callback_data: 'alert_delete_' + a.id }];
                })
            };
            keyboard.inline_keyboard.push([{ text: '🔙 Back', callback_data: 'alert_menu' }]);
            await sendMessage(chatId, text, keyboard);
            return;
        }
        if (data.startsWith('alert_delete_')) {
            var alertId = data.replace('alert_delete_', '');
            await deleteAlert(chatId, alertId);
            await sendMessage(chatId, getText(lang, 'alert_deleted'));
            await showAlertMenu(chatId);
            return;
        }

        if (data.startsWith('diary_mood_')) {
            var mood = data.replace('diary_mood_', '');
            await setData('diary_' + chatId, mood);
            await sendMessage(chatId, getText(lang, 'mood_saved'));
            await showMainMenu(chatId);
            return;
        }

        if (data === 'action_disconnect') {
            await deleteData('user_' + chatId);
            await sendMessage(chatId, getText(lang, 'connect_disconnected'));
            await showMainMenu(chatId);
            return;
        }
        if (data === 'action_history_refresh') {
            await showHistoryMenu(chatId);
            return;
        }

        if (data === 'help_q1') { 
            await sendMessage(chatId, formatHelpAnswer(getText(lang, 'help_answer_q1'), lang)); 
            return; 
        }
        if (data === 'help_q2') { 
            await sendMessage(chatId, formatHelpAnswer(getText(lang, 'help_answer_q2'), lang)); 
            return; 
        }
        if (data === 'help_q3') { 
            await sendMessage(chatId, formatHelpAnswer(getText(lang, 'help_answer_q3'), lang)); 
            return; 
        }
        if (data === 'help_q4') { 
            await sendMessage(chatId, formatHelpAnswer(getText(lang, 'help_answer_q4'), lang)); 
            return; 
        }
        if (data === 'help_q5') { 
            await sendMessage(chatId, formatHelpAnswer(getText(lang, 'help_answer_q5'), lang)); 
            return; 
        }
        if (data === 'help_q6') { 
            await sendMessage(chatId, formatHelpAnswer(getText(lang, 'help_answer_q6'), lang)); 
            return; 
        }
        if (data === 'help_q7') { 
            await sendMessage(chatId, formatHelpAnswer(getText(lang, 'help_answer_q7'), lang)); 
            return; 
        }
        if (data === 'help_q8') { 
            await sendMessage(chatId, formatHelpAnswer(getText(lang, 'help_answer_q8'), lang)); 
            return; 
        }
        if (data === 'help_q9') { 
            await sendMessage(chatId, formatHelpAnswer(getText(lang, 'help_answer_q9'), lang)); 
            return; 
        }
        if (data === 'help_contact_moderator') {
            await sendMessage(chatId, formatHelpAnswer(getText(lang, 'help_contact_moderator_message'), lang));
            return;
        }

        if (data === 'onboard_lang_ru') {
            await setData('lang_' + chatId, 'ru');
            await sendUpdatedMessage(chatId, getText('ru', 'mode_select'), getOnboardModeKeyboard('ru'));
            return;
        }
        if (data === 'onboard_lang_en') {
            await setData('lang_' + chatId, 'en');
            await sendUpdatedMessage(chatId, getText('en', 'mode_select'), getOnboardModeKeyboard('en'));
            return;
        }
        if (data === 'onboard_mode_beginner') {
            await setData('mode_' + chatId, 'beginner');
            await showVipBonusOffer(chatId);
            return;
        }
        if (data === 'onboard_mode_pro') {
            await setData('mode_' + chatId, 'pro');
            await showVipBonusOffer(chatId);
            return;
        }
        if (data === 'onboard_connect_vip') {
            await handleOnboardConnectVip(chatId);
            return;
        }
        if (data === 'onboard_skip') {
            await handleOnboardSkip(chatId);
            return;
        }
        if (data === 'onboard_vip_done') {
            await showMainMenu(chatId);
            return;
        }

        if (data === 'panic_convert_all') {
            await handlePanicConvertAll(chatId);
            return;
        }

        // ============================================================
        // PORTFOLIO ANALYSIS
        // ============================================================
        if (data === 'action_analyze') {
            var savedData = await getData('user_' + chatId);
            if (!savedData) {
                var errorKeyboard = {
                    inline_keyboard: [
                        [{ text: '🔐 ' + (lang === 'ru' ? 'Подключить биржу' : 'Connect exchange'), callback_data: 'menu_connect' }],
                        [{ text: '📖 ' + (lang === 'ru' ? 'Инструкция' : 'Help'), callback_data: 'menu_help' }],
                        [{ text: '🏠 ' + (lang === 'ru' ? 'В меню' : 'Main menu'), callback_data: 'back_to_menu' }]
                    ]
                };
                await sendMessage(chatId, getText(lang, 'analyzing_no_keys'), errorKeyboard);
                return;
            }
            
            await sendMessage(chatId, getText(lang, 'analyzing_step', [1, 4, lang === 'ru' ? 'Подключение к бирже...' : 'Connecting to exchange...']));
            
            try {
                var user = typeof savedData === 'string' ? JSON.parse(savedData) : savedData;
                var apiKey = decrypt(user.apiKey);
                var secretKey = decrypt(user.secretKey);
                
                await sendMessage(chatId, getText(lang, 'analyzing_step', [2, 4, lang === 'ru' ? 'Получение баланса...' : 'Fetching balance...']));
                var exchange = await connectExchange(user.exchangeId, apiKey, secretKey);
                var balance = await exchange.fetchBalance();
                var total = balance.total;
                var coins = Object.keys(total).filter(function(key) { return total[key] > 0; });
                
                if (coins.length === 0) {
                    await sendMessage(chatId, getText(lang, 'no_coins'));
                    return;
                }
                
                await sendMessage(chatId, getText(lang, 'analyzing_step', [3, 4, lang === 'ru' ? 'Запрос цен...' : 'Fetching prices...']));
                
                var totalUSDT = 0;
                var assets = [];
                var btcAmount = 0;
                var usdtAmount = 0;
                
                for (var i = 0; i < coins.length; i++) {
                    var coin = coins[i];
                    if (coin === 'USDT') {
                        usdtAmount += total[coin];
                        totalUSDT += total[coin];
                        continue;
                    }
                    
                    try {
                        var ticker = await exchange.fetchTicker(coin + '/USDT');
                        var value = total[coin] * ticker.last;
                        totalUSDT += value;
                        
                        if (coin === 'BTC') {
                            btcAmount += value;
                        } else {
                            assets.push({
                                symbol: coin,
                                value: value,
                                amount: total[coin],
                                price: ticker.last,
                                change24h: ticker.percentage || 0
                            });
                        }
                    } catch (e) {
                        assets.push({
                            symbol: coin,
                            value: 0,
                            amount: total[coin],
                            price: 0,
                            change24h: 0,
                            error: true
                        });
                    }
                }
                
                var btcPercent = totalUSDT > 0 ? (btcAmount / totalUSDT) * 100 : 0;
                var usdtPercent = totalUSDT > 0 ? (usdtAmount / totalUSDT) * 100 : 0;
                var altTotal = assets.reduce(function(sum, a) { return sum + a.value; }, 0);
                var altPercent = totalUSDT > 0 ? (altTotal / totalUSDT) * 100 : 0;
                
                assets.sort(function(a, b) { return b.value - a.value; });
                var mode = await getData('mode_' + chatId) || 'beginner';
                
                await sendMessage(chatId, getText(lang, 'analyzing_step', [4, 4, lang === 'ru' ? 'Расчет рисков...' : 'Calculating risks...']));
                
                await setData('analysis_' + chatId, JSON.stringify({
                    totalUSDT: totalUSDT,
                    btcPercent: btcPercent,
                    altPercent: altPercent,
                    usdtPercent: usdtPercent,
                    assets: assets.map(function(a) { return { symbol: a.symbol, value: a.value, weight: totalUSDT > 0 ? (a.value / totalUSDT) * 100 : 0 }; }),
                    riskLevel: 'low',
                    riskScore: 0,
                    timestamp: Date.now()
                }), 86400);
                
                var report = getText(lang, 'analyzing_done') + '\n\n';
                report += '📊 PORTFOLIO ANALYSIS\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
                report += '💰 Total value: $' + totalUSDT.toFixed(2) + ' USDT\n';
                report += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';
                
                report += '📊 ASSET ALLOCATION\n';
                report += 'BTC:      ' + createProgressBarUI(btcPercent) + ' ' + btcPercent.toFixed(1) + '%\n';
                report += 'Alts:     ' + createProgressBarUI(altPercent) + ' ' + altPercent.toFixed(1) + '%\n';
                report += 'Stables:  ' + createProgressBarUI(usdtPercent) + ' ' + usdtPercent.toFixed(1) + '%\n\n';
                
                var modeLabel = mode === 'beginner' ? 'Beginner' : 'Experienced';
                var targetBTC = mode === 'beginner' ? 50 : 40;
                var targetAlt = mode === 'beginner' ? 30 : 40;
                var targetStable = 20;
                
                report += '🎯 Target weights (' + modeLabel + '):\n';
                report += 'BTC:  ' + targetBTC + '%  (yours: ' + btcPercent.toFixed(1) + '%)\n';
                report += 'Alts: ' + targetAlt + '%  (yours: ' + altPercent.toFixed(1) + '%)\n';
                report += 'Stables: ' + targetStable + '%  (yours: ' + usdtPercent.toFixed(1) + '%)\n\n';
                
                report += '📈 ASSETS\n';
                var maxAssets = Math.min(assets.length, 10);
                for (var i = 0; i < maxAssets; i++) {
                    var asset = assets[i];
                    if (asset.value > 0) {
                        var weight = (asset.value / totalUSDT) * 100;
                        report += '• ' + asset.symbol + ': ' + asset.amount.toFixed(4) + ' ≈ $' + asset.value.toFixed(2) + ' (' + weight.toFixed(1) + '%)\n';
                        if (asset.change24h !== 0) {
                            report += '  24h change: ' + (asset.change24h > 0 ? '+' : '') + asset.change24h.toFixed(2) + '%\n';
                        }
                    } else if (asset.error) {
                        report += '• ' + asset.symbol + ': ' + asset.amount.toFixed(4) + ' (price unavailable)\n';
                    }
                }
                report += '\n';
                
                var recommendations = [];
                
                if (btcPercent < targetBTC - 5) {
                    recommendations.push('📈 Buy more BTC to reach target ' + targetBTC + '%');
                } else if (btcPercent > targetBTC + 5) {
                    recommendations.push('📉 Sell some BTC to reduce to ' + targetBTC + '%');
                }
                
                if (altPercent > targetAlt + 5) {
                    recommendations.push('⚠️ Too many altcoins. Reduce to ' + targetAlt + '%');
                }
                
                if (usdtPercent < targetStable - 5) {
                    recommendations.push('🛡️ Increase stables to ' + targetStable + '% for protection');
                }
                
                for (var i = 0; i < assets.length; i++) {
                    var asset = assets[i];
                    if (asset.value > 0 && (asset.value / totalUSDT) * 100 > 15) {
                        recommendations.push('⚠️ ' + asset.symbol + ' is ' + ((asset.value / totalUSDT) * 100).toFixed(1) + '% of portfolio. Reduce to 10-15%');
                    }
                }
                
                if (recommendations.length === 0) {
                    report += '✅ Portfolio is balanced! No recommendations.\n';
                } else {
                    report += '💡 RECOMMENDATIONS\n';
                    for (var i = 0; i < recommendations.length; i++) {
                        report += '• ' + recommendations[i] + '\n';
                    }
                }
                
                report += '\n━━━━━━━━━━━━━━━━━━━━━━━\n';
                report += '🛡️ Void Node — your crypto guardian\n';
                report += '\n⚠️ This is not financial advice.';
                
                var keyboard = {
                    inline_keyboard: [
                        [{ text: '📥 CSV report', callback_data: 'action_export_csv' }],
                        [{ text: '🔄 Refresh', callback_data: 'action_analyze' }],
                        [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
                    ]
                };
                
                await sendMessage(chatId, report, keyboard);
                await addHistory(chatId, getText(lang, 'history_analyze'), '$' + totalUSDT.toFixed(2));
                
            } catch (error) {
                console.error('Analysis error:', error);
                var errorKeyboard = {
                    inline_keyboard: [
                        [{ text: '🔄 ' + (lang === 'ru' ? 'Попробовать снова' : 'Try again'), callback_data: 'action_analyze' }],
                        [{ text: '📖 ' + (lang === 'ru' ? 'Инструкция' : 'Help'), callback_data: 'menu_help' }],
                        [{ text: '🏠 ' + (lang === 'ru' ? 'В меню' : 'Main menu'), callback_data: 'back_to_menu' }]
                    ]
                };
                await sendMessage(chatId, '❌ ' + (lang === 'ru' ? 'Ошибка анализа' : 'Analysis error') + ': ' + error.message, errorKeyboard);
            }
            
            return;
        }

        if (data === 'action_export_csv') {
            var analysisData = await getData('analysis_' + chatId);
            if (!analysisData) {
                var errorKeyboard = {
                    inline_keyboard: [
                        [{ text: '📊 ' + (lang === 'ru' ? 'Запустить анализ' : 'Run analysis'), callback_data: 'action_analyze' }],
                        [{ text: '🏠 ' + (lang === 'ru' ? 'В меню' : 'Main menu'), callback_data: 'back_to_menu' }]
                    ]
                };
                await sendMessage(chatId, '❌ ' + (lang === 'ru' ? 'Нет данных. Запустите /analyze' : 'No data. Run /analyze first'), errorKeyboard);
                return;
            }
            var analysis = typeof analysisData === 'string' ? JSON.parse(analysisData) : analysisData;
            var csv = generateCSV(analysis);
            await sendDocument(chatId, csv, 'portfolio_report.csv');
            await sendMessage(chatId, '📥 CSV report sent!');
            return;
        }

        if (data === 'action_rebalance') {
            await sendMessage(chatId, '🔄 ' + (lang === 'ru' ? 'Ребаланс запущен... (функция в разработке)' : 'Rebalance started... (function in development)'));
            return;
        }

        console.log('⚠️ Unknown callback: ' + data);

    } catch (error) {
        console.error('Callback error:', error);
        var errorKeyboard = {
            inline_keyboard: [
                [{ text: '🔄 ' + (lang === 'ru' ? 'Попробовать снова' : 'Try again'), callback_data: 'back_to_menu' }],
                [{ text: '📖 ' + (lang === 'ru' ? 'Инструкция' : 'Help'), callback_data: 'menu_help' }]
            ]
        };
        await sendMessage(chatId, '❌ ' + (lang === 'ru' ? 'Ошибка' : 'Error') + ': ' + error.message, errorKeyboard);
    }
}

// ============================================================
// 27. MESSAGE HANDLER
// ============================================================
async function handleMessage(update) {
    var chatId = update.message.chat.id;
    var text = update.message.text || '';
    var messageId = update.message.message_id;
    var lang = await getData('lang_' + chatId) || 'ru';
    var state = await getData('state_' + chatId) || 'idle';

    console.log('💬 Message from ' + chatId + ': ' + text);

    try {
        var cleanText = sanitizeInput(text);

        if (cleanText && (cleanText.includes('http://') || cleanText.includes('https://'))) {
            await autoCheckLinks(chatId, cleanText, lang, messageId);
        }
        if (cleanText && cleanText.startsWith('0x') && cleanText.length >= 42 && cleanText.length <= 44) {
            await autoCheckContract(chatId, cleanText, lang, messageId);
            return;
        }

        if (state === 'waiting_for_keys' || state === 'waiting_for_keys_vip') {
            if (cleanText === '/cancel' || cleanText === '❌ Отмена' || cleanText === '❌ Cancel') {
                await setData('state_' + chatId, 'idle');
                await sendMessage(chatId, getText(lang, 'connect_cancel'));
                if (state === 'waiting_for_keys_vip') {
                    await setData('onboarded_' + chatId, 'true');
                    await showMainMenu(chatId);
                } else {
                    await showMainMenu(chatId);
                }
                return;
            }
            var parts = cleanText.split(':');
            if (parts.length === 2) {
                var apiKey = parts[0].trim();
                var secretKey = parts[1].trim();
                await sendTyping(chatId);
                await sendMessage(chatId, '🔍 Checking keys...');
                var encryptedApiKey = encrypt(apiKey);
                var encryptedSecretKey = encrypt(secretKey);
                await setData('user_' + chatId, JSON.stringify({
                    apiKey: encryptedApiKey,
                    secretKey: encryptedSecretKey,
                    exchangeId: 'binance',
                    connectedAt: Date.now()
                }));
                if (state === 'waiting_for_keys_vip') {
                    await activateVipTrial(chatId);
                    await setData('state_' + chatId, 'idle');
                    await setData('onboarded_' + chatId, 'true');
                    await showVipActivated(chatId);
                    return;
                }
                await setData('state_' + chatId, 'idle');
                await sendMessage(chatId, getText(lang, 'connect_success', 'Binance'));
                await showMainMenu(chatId);
            } else {
                var errorKeyboard = {
                    inline_keyboard: [
                        [{ text: '🔄 ' + (lang === 'ru' ? 'Попробовать снова' : 'Try again'), callback_data: 'menu_connect' }],
                        [{ text: '📖 ' + (lang === 'ru' ? 'Инструкция' : 'Help'), callback_data: 'help_q1' }],
                        [{ text: '🏠 ' + (lang === 'ru' ? 'В меню' : 'Main menu'), callback_data: 'back_to_menu' }]
                    ]
                };
                await sendMessage(chatId, getText(lang, 'invalid_format'), errorKeyboard);
            }
            return;
        }

        var antiscamStates = ['antiscam_url', 'antiscam_contract', 'antiscam_dex', 'antiscam_file', 'antiscam_impersonation', 'antiscam_wallet'];
        if (antiscamStates.indexOf(state) !== -1) {
            if (cleanText === '/cancel' || cleanText === '❌ Отмена' || cleanText === '❌ Cancel') {
                await setData('state_' + chatId, 'idle');
                await sendMessage(chatId, getText(lang, 'scan_cancelled'));
                await showMainMenu(chatId);
                return;
            }
            if (state.indexOf('file') === -1 && !isValidUrl(cleanText) && !isValidContractAddress(cleanText)) {
                var statePrompts = {
                    'antiscam_url': lang === 'ru' ? 'ссылку' : 'link',
                    'antiscam_contract': lang === 'ru' ? 'адрес контракта (0x...)' : 'contract address (0x...)',
                    'antiscam_dex': lang === 'ru' ? 'адрес контракта (0x...)' : 'contract address (0x...)',
                    'antiscam_wallet': lang === 'ru' ? 'адрес кошелька (0x...)' : 'wallet address (0x...)'
                };
                var expected = statePrompts[state] || (lang === 'ru' ? 'данные для проверки' : 'data to check');
                await sendMessage(chatId, '⚠️ ' + (lang === 'ru' ? 'Я жду ' : 'I\'m waiting for ') + expected + '.\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
                return;
            }
            await handleAntiScamInput(chatId, cleanText, lang, update, messageId);
            return;
        }

        if (state === 'waiting_for_trend_search') {
            if (cleanText === '/cancel' || cleanText === '❌ Отмена' || cleanText === '❌ Cancel') {
                await setData('state_' + chatId, 'idle');
                await sendMessage(chatId, '❌ Search cancelled.');
                await showMainMenu(chatId);
                return;
            }
            await handleTrendSearchInput(chatId, cleanText, lang, messageId);
            return;
        }

        if (state === 'waiting_for_contract_search') {
            if (cleanText === '/cancel' || cleanText === '❌ Отмена' || cleanText === '❌ Cancel') {
                await setData('state_' + chatId, 'idle');
                await sendMessage(chatId, '❌ Search cancelled.');
                await showMainMenu(chatId);
                return;
            }
            if (!cleanText.startsWith('0x') || cleanText.length < 42) {
                await sendMessage(chatId, '❌ Invalid contract address.\n\nSend address starting with 0x... (42 characters)\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
                await setData('state_' + chatId, 'waiting_for_contract_search');
                return;
            }
            await handleContractSearch(chatId, cleanText, lang, messageId);
            await setData('state_' + chatId, 'idle');
            return;
        }

        if (state === 'alert_price') {
            var parts = cleanText.split(' ');
            if (parts.length === 2) {
                var symbol = parts[0].toUpperCase();
                var target = parseFloat(parts[1]);
                if (!isNaN(target)) {
                    var result = await createAlert(chatId, 'price', { symbol: symbol, target: target, direction: 'above' });
                    if (result.error) { await sendMessage(chatId, result.error); return; }
                    await sendMessage(chatId, getText(lang, 'alert_created'));
                    await setData('state_' + chatId, 'idle');
                    return;
                }
            } else if (parts.length === 3 && parts[2].toLowerCase() === 'below') {
                var symbol = parts[0].toUpperCase();
                var target = parseFloat(parts[1]);
                if (!isNaN(target)) {
                    var result = await createAlert(chatId, 'price', { symbol: symbol, target: target, direction: 'below' });
                    if (result.error) { await sendMessage(chatId, result.error); return; }
                    await sendMessage(chatId, getText(lang, 'alert_created'));
                    await setData('state_' + chatId, 'idle');
                    return;
                }
            }
            await sendMessage(chatId, '❌ Invalid format. Use "BTC 70000" or "BTC 65000 below"\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            return;
        }

        if (state === 'alert_change') {
            var parts = cleanText.split(' ');
            if (parts.length === 2) {
                var symbol = parts[0].toUpperCase();
                var target = parseFloat(parts[1]);
                if (!isNaN(target)) {
                    var result = await createAlert(chatId, 'change', { symbol: symbol, target: target });
                    if (result.error) { await sendMessage(chatId, result.error); return; }
                    await sendMessage(chatId, getText(lang, 'alert_created'));
                    await setData('state_' + chatId, 'idle');
                    return;
                }
            }
            await sendMessage(chatId, '❌ Invalid format. Use "BTC 5"\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            return;
        }

        if (state === 'alert_volume') {
            var parts = cleanText.split(' ');
            if (parts.length === 2) {
                var symbol = parts[0].toUpperCase();
                var target = parseFloat(parts[1]);
                if (!isNaN(target)) {
                    var result = await createAlert(chatId, 'volume', { symbol: symbol, target: target });
                    if (result.error) { await sendMessage(chatId, result.error); return; }
                    await sendMessage(chatId, getText(lang, 'alert_created'));
                    await setData('state_' + chatId, 'idle');
                    return;
                }
            }
            await sendMessage(chatId, '❌ Invalid format. Use "BTC 1000000" (volume)\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            return;
        }

        if (cleanText === '/start') {
            console.log('📩 /start from ' + chatId);
            var onboarded = await getData('onboarded_' + chatId);
            if (!onboarded) {
                await sendUpdatedMessage(chatId, getText(lang, 'language_select'), getOnboardLanguageKeyboard());
                return;
            }
            await showMainMenu(chatId);
            return;
        }

        if (cleanText === '/help') {
            await showHelpMenu(chatId);
            return;
        }

        if (cleanText === '/connect') {
            await sendMessage(chatId, getText(lang, 'connect_prompt') + '\n\n' + getText(lang, 'cancel'), getCancelKeyboard(lang));
            await setData('state_' + chatId, 'waiting_for_keys');
            return;
        }

        if (cleanText === '/disconnect') {
            await deleteData('user_' + chatId);
            await sendMessage(chatId, getText(lang, 'connect_disconnected'));
            await showMainMenu(chatId);
            return;
        }

        if (cleanText === '/alerts') {
            await showAlertMenu(chatId);
            return;
        }

        if (cleanText === '/autotrade') {
            await showAutotradeMenu(chatId);
            return;
        }

        if (cleanText === '/diary') {
            await sendUpdatedMessage(chatId, getText(lang, 'mood_title'), getDiaryMenuKeyboard(lang));
            return;
        }

        // --- AI Советник ---
        if (cleanText === '/ai' || cleanText.startsWith('/ai ')) {
            var question = cleanText === '/ai' ? '' : cleanText.replace('/ai ', '');
            await handleAICommand(chatId, question, lang, messageId);
            return;
        }

        if (cleanText === '/analyze') {
            var savedData = await getData('user_' + chatId);
            if (!savedData) {
                var errorKeyboard = {
                    inline_keyboard: [
                        [{ text: '🔐 ' + (lang === 'ru' ? 'Подключить биржу' : 'Connect exchange'), callback_data: 'menu_connect' }],
                        [{ text: '📖 ' + (lang === 'ru' ? 'Инструкция' : 'Help'), callback_data: 'menu_help' }],
                        [{ text: '🏠 ' + (lang === 'ru' ? 'В меню' : 'Main menu'), callback_data: 'back_to_menu' }]
                    ]
                };
                await sendMessage(chatId, getText(lang, 'analyzing_no_keys'), errorKeyboard);
                return;
            }
            
            await sendMessage(chatId, getText(lang, 'analyzing_step', [1, 4, lang === 'ru' ? 'Подключение к бирже...' : 'Connecting to exchange...']));
            
            try {
                var user = typeof savedData === 'string' ? JSON.parse(savedData) : savedData;
                var apiKey = decrypt(user.apiKey);
                var secretKey = decrypt(user.secretKey);
                
                await sendMessage(chatId, getText(lang, 'analyzing_step', [2, 4, lang === 'ru' ? 'Получение баланса...' : 'Fetching balance...']));
                var exchange = await connectExchange(user.exchangeId, apiKey, secretKey);
                var balance = await exchange.fetchBalance();
                var total = balance.total;
                var coins = Object.keys(total).filter(function(key) { return total[key] > 0; });
                
                if (coins.length === 0) {
                    await sendMessage(chatId, getText(lang, 'no_coins'));
                    return;
                }
                
                await sendMessage(chatId, getText(lang, 'analyzing_step', [3, 4, lang === 'ru' ? 'Запрос цен...' : 'Fetching prices...']));
                
                var totalUSDT = 0;
                var assets = [];
                var btcAmount = 0;
                var usdtAmount = 0;
                
                for (var i = 0; i < coins.length; i++) {
                    var coin = coins[i];
                    if (coin === 'USDT') {
                        usdtAmount += total[coin];
                        totalUSDT += total[coin];
                        continue;
                    }
                    
                    try {
                        var ticker = await exchange.fetchTicker(coin + '/USDT');
                        var value = total[coin] * ticker.last;
                        totalUSDT += value;
                        
                        if (coin === 'BTC') {
                            btcAmount += value;
                        } else {
                            assets.push({
                                symbol: coin,
                                value: value,
                                amount: total[coin],
                                price: ticker.last,
                                change24h: ticker.percentage || 0
                            });
                        }
                    } catch (e) {
                        assets.push({
                            symbol: coin,
                            value: 0,
                            amount: total[coin],
                            price: 0,
                            change24h: 0,
                            error: true
                        });
                    }
                }
                
                var btcPercent = totalUSDT > 0 ? (btcAmount / totalUSDT) * 100 : 0;
                var usdtPercent = totalUSDT > 0 ? (usdtAmount / totalUSDT) * 100 : 0;
                var altTotal = assets.reduce(function(sum, a) { return sum + a.value; }, 0);
                var altPercent = totalUSDT > 0 ? (altTotal / totalUSDT) * 100 : 0;
                
                assets.sort(function(a, b) { return b.value - a.value; });
                var mode = await getData('mode_' + chatId) || 'beginner';
                
                await sendMessage(chatId, getText(lang, 'analyzing_step', [4, 4, lang === 'ru' ? 'Расчет рисков...' : 'Calculating risks...']));
                
                await setData('analysis_' + chatId, JSON.stringify({
                    totalUSDT: totalUSDT,
                    btcPercent: btcPercent,
                    altPercent: altPercent,
                    usdtPercent: usdtPercent,
                    assets: assets.map(function(a) { return { symbol: a.symbol, value: a.value, weight: totalUSDT > 0 ? (a.value / totalUSDT) * 100 : 0 }; }),
                    riskLevel: 'low',
                    riskScore: 0,
                    timestamp: Date.now()
                }), 86400);
                
                var report = getText(lang, 'analyzing_done') + '\n\n';
                report += '📊 PORTFOLIO ANALYSIS\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
                report += '💰 Total value: $' + totalUSDT.toFixed(2) + ' USDT\n';
                report += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';
                
                report += '📊 ASSET ALLOCATION\n';
                report += 'BTC:      ' + createProgressBarUI(btcPercent) + ' ' + btcPercent.toFixed(1) + '%\n';
                report += 'Alts:     ' + createProgressBarUI(altPercent) + ' ' + altPercent.toFixed(1) + '%\n';
                report += 'Stables:  ' + createProgressBarUI(usdtPercent) + ' ' + usdtPercent.toFixed(1) + '%\n\n';
                
                var modeLabel = mode === 'beginner' ? 'Beginner' : 'Experienced';
                var targetBTC = mode === 'beginner' ? 50 : 40;
                var targetAlt = mode === 'beginner' ? 30 : 40;
                var targetStable = 20;
                
                report += '🎯 Target weights (' + modeLabel + '):\n';
                report += 'BTC:  ' + targetBTC + '%  (yours: ' + btcPercent.toFixed(1) + '%)\n';
                report += 'Alts: ' + targetAlt + '%  (yours: ' + altPercent.toFixed(1) + '%)\n';
                report += 'Stables: ' + targetStable + '%  (yours: ' + usdtPercent.toFixed(1) + '%)\n\n';
                
                report += '📈 ASSETS\n';
                var maxAssets = Math.min(assets.length, 10);
                for (var i = 0; i < maxAssets; i++) {
                    var asset = assets[i];
                    if (asset.value > 0) {
                        var weight = (asset.value / totalUSDT) * 100;
                        report += '• ' + asset.symbol + ': ' + asset.amount.toFixed(4) + ' ≈ $' + asset.value.toFixed(2) + ' (' + weight.toFixed(1) + '%)\n';
                        if (asset.change24h !== 0) {
                            report += '  24h change: ' + (asset.change24h > 0 ? '+' : '') + asset.change24h.toFixed(2) + '%\n';
                        }
                    } else if (asset.error) {
                        report += '• ' + asset.symbol + ': ' + asset.amount.toFixed(4) + ' (price unavailable)\n';
                    }
                }
                report += '\n';
                
                var recommendations = [];
                
                if (btcPercent < targetBTC - 5) {
                    recommendations.push('📈 Buy more BTC to reach target ' + targetBTC + '%');
                } else if (btcPercent > targetBTC + 5) {
                    recommendations.push('📉 Sell some BTC to reduce to ' + targetBTC + '%');
                }
                
                if (altPercent > targetAlt + 5) {
                    recommendations.push('⚠️ Too many altcoins. Reduce to ' + targetAlt + '%');
                }
                
                if (usdtPercent < targetStable - 5) {
                    recommendations.push('🛡️ Increase stables to ' + targetStable + '% for protection');
                }
                
                for (var i = 0; i < assets.length; i++) {
                    var asset = assets[i];
                    if (asset.value > 0 && (asset.value / totalUSDT) * 100 > 15) {
                        recommendations.push('⚠️ ' + asset.symbol + ' is ' + ((asset.value / totalUSDT) * 100).toFixed(1) + '% of portfolio. Reduce to 10-15%');
                    }
                }
                
                if (recommendations.length === 0) {
                    report += '✅ Portfolio is balanced! No recommendations.\n';
                } else {
                    report += '💡 RECOMMENDATIONS\n';
                    for (var i = 0; i < recommendations.length; i++) {
                        report += '• ' + recommendations[i] + '\n';
                    }
                }
                
                report += '\n━━━━━━━━━━━━━━━━━━━━━━━\n';
                report += '🛡️ Void Node — your crypto guardian\n';
                report += '\n⚠️ This is not financial advice.';
                
                var keyboard = {
                    inline_keyboard: [
                        [{ text: '📥 CSV report', callback_data: 'action_export_csv' }],
                        [{ text: '🔄 Refresh', callback_data: 'action_analyze' }],
                        [{ text: getText(lang, 'back_to_functions'), callback_data: 'back_to_functions' }]
                    ]
                };
                
                await sendMessage(chatId, report, keyboard);
                await addHistory(chatId, getText(lang, 'history_analyze'), '$' + totalUSDT.toFixed(2));
                
            } catch (error) {
                console.error('Analysis error:', error);
                var errorKeyboard = {
                    inline_keyboard: [
                        [{ text: '🔄 ' + (lang === 'ru' ? 'Попробовать снова' : 'Try again'), callback_data: 'action_analyze' }],
                        [{ text: '📖 ' + (lang === 'ru' ? 'Инструкция' : 'Help'), callback_data: 'menu_help' }],
                        [{ text: '🏠 ' + (lang === 'ru' ? 'В меню' : 'Main menu'), callback_data: 'back_to_menu' }]
                    ]
                };
                await sendMessage(chatId, '❌ ' + (lang === 'ru' ? 'Ошибка анализа' : 'Analysis error') + ': ' + error.message, errorKeyboard);
            }
            return;
        }

        if (cleanText === '/history') {
            await showHistoryMenu(chatId);
            return;
        }

        if (cleanText === '/plans' || cleanText === '/subscribe') {
            await showPlansMenu(chatId);
            return;
        }

        if (cleanText === '/settings') {
            await showSettingsMenu(chatId);
            return;
        }

        if (cleanText === '/news' || cleanText.startsWith('/news ')) {
            var coin = cleanText === '/news' ? null : cleanText.replace('/news ', '').trim();
            await handleNewsCommand(chatId, coin, lang, messageId);
            return;
        }

        if (cleanText === '/panic') {
            await setData('panic_' + chatId, JSON.stringify({ active: true, lastCheck: Date.now() }));
            await sendMessage(chatId, getText(lang, 'panic_start'));
            return;
        }

        if (cleanText === '/panic_stop') {
            await deleteData('panic_' + chatId);
            await sendMessage(chatId, getText(lang, 'panic_stop'));
            return;
        }

        if (cleanText === '/exit') {
            await showMainMenu(chatId);
            return;
        }

        await sendMessage(chatId, getText(lang, 'default_response', cleanText));

    } catch (error) {
        console.error('Message error:', error);
        var errorKeyboard = {
            inline_keyboard: [
                [{ text: '🔄 ' + (lang === 'ru' ? 'Попробовать снова' : 'Try again'), callback_data: 'back_to_menu' }],
                [{ text: '📖 ' + (lang === 'ru' ? 'Инструкция' : 'Help'), callback_data: 'menu_help' }]
            ]
        };
        await sendMessage(chatId, getText(lang, 'error_general', error.message), errorKeyboard);
    }
}

// ============================================================
// 28. CRYPTOBOT WEBHOOK
// ============================================================
async function handleCryptoWebhook(request) {
    try {
        var update = request.body;
        if (update.update_type === 'invoice_paid') {
            var payload = update.payload;
            var parts = payload.split('_');
            var planId = parts[1];
            var chatId = parseInt(parts[2]);
            var lang = await getData('lang_' + chatId) || 'ru';
            var plan = await activatePlan(chatId, planId);
            if (plan) {
                await sendMessage(chatId, getText(lang, 'plans_success', plan.name));
                await showMainMenu(chatId);
                await addHistory(chatId, '💳 Payment', plan.name + ' activated');
            }
        }
        return { status: 200 };
    } catch (error) {
        console.error('Webhook error:', error);
        return { status: 500, error: error.message };
    }
}

// ============================================================
// 29. BACKGROUND TASKS
// ============================================================
function runTaskWithRecovery(task, name, interval) {
    var run = async function() {
        try {
            await task();
        } catch (error) {
            console.error('❌ ' + name + ' error:', error);
        } finally {
            setTimeout(run, interval);
        }
    };
    setTimeout(run, 5000);
}

runTaskWithRecovery(checkAlerts, 'checkAlerts', CONFIG.ALERT_CHECK_INTERVAL);
runTaskWithRecovery(runAutotrade, 'runAutotrade', CONFIG.AUTOTRADE_CHECK_INTERVAL);
runTaskWithRecovery(checkPanic, 'checkPanic', CONFIG.PANIC_CHECK_INTERVAL);

// ============================================================
// 30. AI СОВЕТНИК — ИСПРАВЛЕННАЯ ВЕРСИЯ
// ============================================================

// Проверяем наличие ключа OpenRouter
var HAS_OPENROUTER = typeof OPENROUTER_API_KEY !== 'undefined' && OPENROUTER_API_KEY && OPENROUTER_API_KEY.length > 10;

// Бесплатные модели OpenRouter
var FREE_MODELS = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
    'google/gemma-2-9b-it:free',
    'microsoft/phi-3-mini-128k-instruct:free'
];

var CURRENT_AI_MODEL = FREE_MODELS[0];

// ============================================================
// 30.1. AI КОНТЕКСТ
// ============================================================
class AIContext {
    constructor() {
        this.contexts = new Map();
        this.maxHistory = 20;
    }

    getContext(chatId) {
        if (!this.contexts.has(chatId)) {
            this.contexts.set(chatId, {
                history: [],
                lastAnalysis: null,
                lastNews: null,
                lastSnowball: null
            });
        }
        return this.contexts.get(chatId);
    }

    addMessage(chatId, role, content) {
        var context = this.getContext(chatId);
        context.history.push({ role: role, content: content, timestamp: Date.now() });
        if (context.history.length > this.maxHistory) {
            context.history.shift();
        }
    }

    async refreshData(chatId, lang) {
        var context = this.getContext(chatId);
        
        var analysisData = await getData('analysis_' + chatId);
        if (analysisData) {
            context.lastAnalysis = typeof analysisData === 'string' ? JSON.parse(analysisData) : analysisData;
            context.lastAnalysis.timestamp = Date.now();
        }
        
        var newsResult = await newsManager.getPersonalizedNews(chatId, lang);
        if (newsResult && !newsResult.error) {
            context.lastNews = newsResult;
        }
        
        var keysUser = await loadUserKeys(chatId);
        if (keysUser) {
            try {
                var exchange = await connectExchange(keysUser.exchangeId, keysUser.apiKey, keysUser.secretKey);
                var balance = await exchange.fetchBalance();
                var total = balance.total;
                var tokens = [];
                for (var symbol in total) {
                    if (total.hasOwnProperty(symbol) && symbol !== 'USDT' && total[symbol] > 0.0001) {
                        try {
                            var ticker = await exchange.fetchTicker(symbol + '/USDT');
                            if (ticker && ticker.last) {
                                tokens.push({
                                    symbol: symbol,
                                    amount: total[symbol],
                                    price: ticker.last,
                                    value: total[symbol] * ticker.last,
                                    change24h: ticker.percentage || 0,
                                    volume24h: ticker.quoteVolume || 0
                                });
                            }
                        } catch (e) {}
                    }
                }
                tokens.sort(function(a, b) { return b.change24h - a.change24h; });
                context.lastSnowball = {
                    tokens: tokens,
                    timestamp: Date.now(),
                    best: tokens[0] || null,
                    worst: tokens[tokens.length - 1] || null
                };
            } catch (e) {
                console.error('AI Snowball refresh error:', e);
            }
        }
        
        return context;
    }

    getSystemPrompt(lang) {
        if (lang === 'ru') {
            return 'Ты профессиональный крипто-советник. Твоя задача — защищать пользователя от глупых решений.\n\n' +
                'Ты обязан:\n' +
                '1. Быть честным — не придумывай факты, используй только данные из портфеля\n' +
                '2. Не соглашаться с пользователем, если он хочет сделать что-то рискованное\n' +
                '3. Предупреждать о рисках, даже если пользователь не спрашивает\n' +
                '4. Давать конкретные цифры и проценты из портфеля\n' +
                '5. Если у тебя нет данных — скажи это честно и предложи выполнить /analyze\n' +
                '6. Быть кратким — максимум 3-5 предложений на ответ\n' +
                '7. Использовать эмодзи для наглядности (📈📉⚠️✅🔴🟢)\n\n' +
                'Ты НЕ должен:\n' +
                '- Давать финансовые советы "купи/продай"\n' +
                '- Предсказывать цену\n' +
                '- Придумывать данные, которых нет в портфеле\n' +
                '- Соглашаться с пользователем, если он хочет рискнуть\n\n' +
                'Если пользователь просит совет по конкретной монете — скажи, что у тебя нет данных и предложи проверить через /trend или /news';
        } else {
            return 'You are a professional crypto advisor. Your task is to protect the user from stupid decisions.\n\n' +
                'You must:\n' +
                '1. Be honest — don\'t make up facts, use only portfolio data\n' +
                '2. Disagree with the user if they want to do something risky\n' +
                '3. Warn about risks, even if the user doesn\'t ask\n' +
                '4. Give specific numbers and percentages from the portfolio\n' +
                '5. If you don\'t have data — say so honestly and suggest running /analyze\n' +
                '6. Be brief — maximum 3-5 sentences per response\n' +
                '7. Use emojis for clarity (📈📉⚠️✅🔴🟢)\n\n' +
                'You MUST NOT:\n' +
                '- Give financial advice "buy/sell"\n' +
                '- Predict price\n' +
                '- Make up data not in the portfolio\n' +
                '- Agree with the user if they want to take risks\n\n' +
                'If the user asks for advice on a specific coin — say you don\'t have data and suggest checking via /trend or /news';
        }
    }

    buildPrompt(chatId, userQuestion, lang) {
        var context = this.getContext(chatId);
        var prompt = this.getSystemPrompt(lang) + '\n\n';
        
        if (context.lastAnalysis) {
            var a = context.lastAnalysis;
            prompt += (lang === 'ru' ? '📊 ПОРТФЕЛЬ:\n' : '📊 PORTFOLIO:\n');
            prompt += (lang === 'ru' ? 'Общая стоимость: $' : 'Total value: $') + a.totalUSDT.toFixed(2) + '\n';
            prompt += 'BTC: ' + a.btcPercent.toFixed(1) + '% | Alts: ' + a.altPercent.toFixed(1) + '% | Stables: ' + a.usdtPercent.toFixed(1) + '%\n';
            if (a.assets && a.assets.length > 0) {
                prompt += (lang === 'ru' ? 'Активы: ' : 'Assets: ');
                var assetStrings = a.assets.slice(0, 5).map(function(asset) {
                    return asset.symbol + ' (' + asset.weight.toFixed(1) + '%)';
                });
                prompt += assetStrings.join(', ') + '\n';
            }
            prompt += '\n';
        } else {
            prompt += (lang === 'ru' ? '⚠️ Нет данных о портфеле. Выполни /analyze.\n\n' : '⚠️ No portfolio data. Run /analyze.\n\n');
        }

        if (context.lastNews && context.lastNews.articles && context.lastNews.articles.length > 0) {
            prompt += (lang === 'ru' ? '📰 СВЕЖИЕ НОВОСТИ ПО ПОРТФЕЛЮ:\n' : '📰 LATEST NEWS FOR YOUR PORTFOLIO:\n');
            var topNews = context.lastNews.articles.slice(0, 3);
            for (var i = 0; i < topNews.length; i++) {
                var article = topNews[i];
                prompt += '• ' + (article.title || 'News') + ' (' + (article.asset || '') + ')\n';
            }
            prompt += '\n';
        }

        if (context.lastSnowball && context.lastSnowball.tokens && context.lastSnowball.tokens.length > 0) {
            prompt += (lang === 'ru' ? '📈 ДИНАМИКА ТОКЕНОВ (24h):\n' : '📈 TOKEN DYNAMICS (24h):\n');
            var top5 = context.lastSnowball.tokens.slice(0, 5);
            for (var i = 0; i < top5.length; i++) {
                var t = top5[i];
                var sign = t.change24h > 0 ? '+' : '';
                prompt += '• ' + t.symbol + ': ' + sign + t.change24h.toFixed(1) + '%\n';
            }
            prompt += '\n';
        }

        if (context.history.length > 0) {
            prompt += (lang === 'ru' ? '💬 ИСТОРИЯ ДИАЛОГА:\n' : '💬 CONVERSATION HISTORY:\n');
            var lastMessages = context.history.slice(-5);
            for (var i = 0; i < lastMessages.length; i++) {
                var msg = lastMessages[i];
                prompt += (msg.role === 'user' ? '👤 ' : '🤖 ') + msg.content + '\n';
            }
            prompt += '\n';
        }

        prompt += (lang === 'ru' ? '❓ Вопрос пользователя: ' : '❓ User question: ') + userQuestion + '\n\n';
        prompt += (lang === 'ru' ? '📌 ТВОЙ ОТВЕТ:' : '📌 YOUR RESPONSE:');
        
        return prompt;
    }

    // ===== ЭТА ФУНКЦИЯ СТАЛА ASYNC (ИСПРАВЛЕНО) =====
    async generateResponse(chatId, question, lang) {
        var context = this.getContext(chatId);
        var lowerQ = question.toLowerCase();
        var isRu = lang === 'ru';
        
        // --- 1. Вопрос о портфеле ---
        if (lowerQ.includes('портфель') || lowerQ.includes('portfolio') || 
            lowerQ.includes('актив') || lowerQ.includes('asset') ||
            lowerQ.includes('баланс') || lowerQ.includes('balance')) {
            
            if (!context.lastAnalysis) {
                return isRu ? 
                    '⚠️ У меня нет данных о твоем портфеле.\n\nВыполни /analyze, чтобы я мог помочь тебе с анализом.' :
                    '⚠️ I don\'t have data about your portfolio.\n\nRun /analyze so I can help you with analysis.';
            }
            
            var a = context.lastAnalysis;
            var riskEmoji = a.riskLevel === 'high' ? '🔴' : a.riskLevel === 'medium' ? '🟡' : '🟢';
            var riskText = isRu ? 
                (a.riskLevel === 'high' ? 'Высокий' : a.riskLevel === 'medium' ? 'Средний' : 'Низкий') :
                (a.riskLevel === 'high' ? 'High' : a.riskLevel === 'medium' ? 'Medium' : 'Low');
            
            var response = isRu ? 
                '📊 *ТВОЙ ПОРТФЕЛЬ*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' :
                '📊 *YOUR PORTFOLIO*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
            
            response += (isRu ? '💰 Общая стоимость: $' : '💰 Total value: $') + a.totalUSDT.toFixed(2) + '\n';
            response += (isRu ? '📊 Распределение:\n' : '📊 Allocation:\n');
            response += '  BTC: ' + a.btcPercent.toFixed(1) + '%\n';
            response += '  Alts: ' + a.altPercent.toFixed(1) + '%\n';
            response += '  Stables: ' + a.usdtPercent.toFixed(1) + '%\n\n';
            response += riskEmoji + ' ' + (isRu ? 'Риск: ' : 'Risk: ') + riskText + '\n\n';
            
            if (a.riskLevel === 'high') {
                response += isRu ? 
                    '⚠️ *ВНИМАНИЕ!* Высокий риск. Рекомендую увеличить долю стейблов до 20-30%.\n\n🛡️ Включи автоторговлю (Уровень 1) для защиты.' :
                    '⚠️ *WARNING!* High risk. I recommend increasing stables to 20-30%.\n\n🛡️ Enable autotrading (Level 1) for protection.';
            } else if (a.riskLevel === 'medium') {
                response += isRu ? 
                    '🟡 Средний риск. Портфель сбалансирован, но есть пространство для улучшения.\n\n📌 Регулярно обновляй анализ (/analyze).' :
                    '🟡 Medium risk. Portfolio is balanced, but there is room for improvement.\n\n📌 Regularly update analysis (/analyze).';
            } else {
                response += isRu ? 
                    '🟢 Низкий риск. Хорошо диверсифицированный портфель. Молодец! 👍' :
                    '🟢 Low risk. Well diversified portfolio. Good job! 👍';
            }
            
            return response;
        }
        
        // --- 2. Вопрос о риске ---
        if (lowerQ.includes('риск') || lowerQ.includes('risk') || 
            lowerQ.includes('опасн') || lowerQ.includes('danger')) {
            
            if (!context.lastAnalysis) {
                return isRu ? 
                    '⚠️ Чтобы оценить риск, выполни /analyze.' :
                    '⚠️ To assess risk, run /analyze.';
            }
            
            var a = context.lastAnalysis;
            var riskEmoji = a.riskLevel === 'high' ? '🔴' : a.riskLevel === 'medium' ? '🟡' : '🟢';
            var riskText = isRu ? 
                (a.riskLevel === 'high' ? 'Высокий' : a.riskLevel === 'medium' ? 'Средний' : 'Низкий') :
                (a.riskLevel === 'high' ? 'High' : a.riskLevel === 'medium' ? 'Medium' : 'Low');
            
            var response = isRu ?
                '📊 *ОЦЕНКА РИСКА*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                riskEmoji + ' Уровень риска: *' + riskText + '*\n\n' :
                '📊 *RISK ASSESSMENT*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                riskEmoji + ' Risk level: *' + riskText + '*\n\n';
            
            if (a.riskLevel === 'high') {
                response += isRu ?
                    '⚠️ *Что делать:*\n• Увеличь долю стейблов до 20-30%\n• Не открывай крупные позиции\n• Установи стоп-лоссы\n\n💡 Включи автоторговлю (Уровень 1) для защиты.' :
                    '⚠️ *What to do:*\n• Increase stables to 20-30%\n• Don\'t open large positions\n• Set stop-losses\n\n💡 Enable autotrading (Level 1) for protection.';
            } else if (a.riskLevel === 'medium') {
                response += isRu ?
                    '🟡 Риск умеренный. Рекомендую:\n• Следить за концентрацией активов\n• Диверсифицировать альты\n• Держать 20% в стейблах' :
                    '🟡 Moderate risk. I recommend:\n• Monitor asset concentration\n• Diversify alts\n• Keep 20% in stables';
            } else {
                response += isRu ?
                    '🟢 Отлично! Риск низкий. Продолжай в том же духе. 👍\n\n📌 Совет: регулярно обновляй анализ (/analyze).' :
                    '🟢 Great! Low risk. Keep it up. 👍\n\n📌 Tip: regularly update analysis (/analyze).';
            }
            
            return response;
        }
        
        // --- 3. Вопрос о конкретной монете ---
        var coinMatch = question.match(/(BTC|ETH|SOL|BNB|ADA|XRP|DOGE|SHIB|MATIC|DOT|AVAX|LINK|UNI|PEPE|ARB|OP|APT|SUI|NEAR|ATOM|LTC|BCH|FIL|FTM|AAVE|MKR|CRV|SNX|COMP|ZEC|XLM|ALGO|HBAR|RUNE|FLOW|WAVES|NEO|DASH|KSM|ENJ|CHZ|SAND|MANA|AXS|GALA|GRT|REN|BAT|ZIL|ICX|EGLD|VRA|CKB|MINA|CELO|KAVA|INJ|SEI|TIA|PYTH|JUP|ONDO|STRK|ENA|ZK|VANA|MOVE|LAYER|ME|BIO)\b/i);
        
        if (coinMatch) {
            var coin = coinMatch[0].toUpperCase();
            if (context.lastSnowball && context.lastSnowball.tokens) {
                var token = context.lastSnowball.tokens.find(function(t) { return t.symbol === coin; });
                if (token) {
                    var sign = token.change24h > 0 ? '+' : '';
                    var emoji = token.change24h > 5 ? '📈' : token.change24h < -5 ? '📉' : '➡️';
                    var response = isRu ?
                        '📊 *' + coin + '*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                        '💰 Цена: $' + token.price.toFixed(2) + '\n' +
                        '📊 24h: ' + sign + token.change24h.toFixed(1) + '% ' + emoji + '\n' +
                        '💵 Объем: $' + (token.volume24h / 1000000).toFixed(1) + 'M\n\n' :
                        '📊 *' + coin + '*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                        '💰 Price: $' + token.price.toFixed(2) + '\n' +
                        '📊 24h: ' + sign + token.change24h.toFixed(1) + '% ' + emoji + '\n' +
                        '💵 Volume: $' + (token.volume24h / 1000000).toFixed(1) + 'M\n\n';
                    
                    if (token.change24h > 5) {
                        response += isRu ?
                            '📈 ' + coin + ' сильно растет. Но будь осторожен — коррекция может быть резкой.\n\n⚠️ Не рекомендую покупать на пике.' :
                            '📈 ' + coin + ' is rising strongly. But be careful — correction can be sharp.\n\n⚠️ I don\'t recommend buying at the peak.';
                    } else if (token.change24h < -5) {
                        response += isRu ?
                            '📉 ' + coin + ' падает. Если у тебя есть этот актив — проверь, не пора ли зафиксировать убыток.\n\n🛡️ Включи защиту (Уровень 1 автоторговли).' :
                            '📉 ' + coin + ' is falling. If you have this asset — check if it\'s time to cut losses.\n\n🛡️ Enable protection (Autotrading Level 1).';
                    } else {
                        response += isRu ?
                            '➡️ ' + coin + ' стабилен. Хорошее время для анализа, но не для спешных решений.' :
                            '➡️ ' + coin + ' is stable. Good time for analysis, but not for rushed decisions.';
                    }
                    
                    return response;
                }
            }
            
            return isRu ?
                '🤔 У меня нет данных по ' + coin + ' в твоем портфеле.\n\n📌 Проверь через /news ' + coin + ' или /trend для ' + coin :
                '🤔 I don\'t have data for ' + coin + ' in your portfolio.\n\n📌 Check via /news ' + coin + ' or /trend for ' + coin;
        }
        
        // --- 4. Вопрос о новостях ---
        if (lowerQ.includes('новост') || lowerQ.includes('news')) {
            if (context.lastNews && context.lastNews.articles && context.lastNews.articles.length > 0) {
                var response = isRu ? '📰 *СВЕЖИЕ НОВОСТИ*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' : '📰 *LATEST NEWS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
                var top3 = context.lastNews.articles.slice(0, 3);
                for (var i = 0; i < top3.length; i++) {
                    var article = top3[i];
                    response += '📌 ' + (article.title || 'News') + '\n';
                    if (article.asset) response += '   🎯 ' + article.asset + '\n';
                    if (article.source && article.source.name) response += '   📎 ' + article.source.name + '\n';
                    response += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';
                }
                response += isRu ? '💡 Хочешь больше новостей? /news' : '💡 Want more news? /news';
                return response;
            }
            return isRu ?
                '📭 Новостей по твоим активам пока нет.\n\n💡 Попробуй /news или /news BTC' :
                '📭 No news for your assets yet.\n\n💡 Try /news or /news BTC';
        }
        
        // --- 5. Совет по действию (защита от глупых решений) ---
        if (lowerQ.includes('стоит') || lowerQ.includes('should') || 
            lowerQ.includes('надо') || lowerQ.includes('нужно') ||
            lowerQ.includes('покупат') || lowerQ.includes('buy') ||
            lowerQ.includes('продав') || lowerQ.includes('sell') ||
            lowerQ.includes('входить') || lowerQ.includes('enter') ||
            lowerQ.includes('выходить') || lowerQ.includes('exit')) {
            
            var response = isRu ?
                '⚠️ *Я НЕ ДАЮ СОВЕТОВ "КУПИТЬ/ПРОДАТЬ"*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                'Это рискованно и запрещено правилами.\n\n' +
                'Вместо этого я могу:\n' +
                '📊 Показать текущее состояние портфеля\n' +
                '📈 Рассказать о рисках\n' +
                '📰 Показать новости по активам\n' +
                '🛡️ Посоветовать защитные стратегии\n\n' +
                '💡 Выполни /analyze для полного анализа.\n' +
                '🔄 Или задай конкретный вопрос о портфеле.' :
                '⚠️ *I DO NOT GIVE "BUY/SELL" ADVICE*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                'This is risky and prohibited.\n\n' +
                'Instead I can:\n' +
                '📊 Show current portfolio state\n' +
                '📈 Tell about risks\n' +
                '📰 Show news for your assets\n' +
                '🛡️ Recommend protection strategies\n\n' +
                '💡 Run /analyze for full analysis.\n' +
                '🔄 Or ask a specific question about your portfolio.';
            
            return response;
        }
        
        // --- 6. Приветствие (ТУТ БЫЛ AWAIT, ТЕПЕРЬ ВСЕ РАБОТАЕТ) ---
        if (lowerQ.includes('привет') || lowerQ.includes('hello') || lowerQ.includes('hi') || lowerQ.includes('здравствуй')) {
            var name = 'друг';
            try {
                var url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/getChat';
                var response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId })
                });
                var data = await response.json();
                if (data.ok && data.result) {
                    name = data.result.username || data.result.first_name || 'друг';
                }
            } catch (e) {}
            
            return isRu ?
                '👋 Привет, ' + name + '! Я твой крипто-советник.\n\n' +
                'Я помогаю:\n' +
                '📊 Анализировать портфель\n' +
                '📈 Оценивать риски\n' +
                '📰 Следить за новостями\n' +
                '🛡️ Защищать от глупых решений\n\n' +
                'Задай мне вопрос или выполни /analyze для полного анализа.' :
                '👋 Hello, ' + name + '! I\'m your crypto advisor.\n\n' +
                'I help:\n' +
                '📊 Analyze portfolio\n' +
                '📈 Assess risks\n' +
                '📰 Follow news\n' +
                '🛡️ Protect from stupid decisions\n\n' +
                'Ask me a question or run /analyze for full analysis.';
        }
        
        // --- 7. Дефолтный ответ ---
        var response = isRu ?
            '🤔 *Я тебя понял, но мне нужно больше информации.*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            'Я могу помочь с:\n' +
            '📊 Анализом портфеля — спроси "какой мой портфель?"\n' +
            '📈 Рисками — спроси "какой риск?"\n' +
            '📰 Новостями — спроси "что нового?"\n' +
            '🪙 Конкретными монетами — спроси "что с BTC?"\n\n' +
            '⚠️ Я не даю советов "купить/продать". Я защищаю тебя от рисков.\n\n' +
            '💡 Выполни /analyze для полного анализа портфеля.' :
            '🤔 *I understand you, but I need more information.*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            'I can help with:\n' +
            '📊 Portfolio analysis — ask "what is my portfolio?"\n' +
            '📈 Risks — ask "what is the risk?"\n' +
            '📰 News — ask "what\'s new?"\n' +
            '🪙 Specific coins — ask "what about BTC?"\n\n' +
            '⚠️ I don\'t give "buy/sell" advice. I protect you from risks.\n\n' +
            '💡 Run /analyze for full portfolio analysis.';
        
        return response;
    }

    async getResponse(chatId, question, lang) {
        await this.refreshData(chatId, lang);
        
        var context = this.getContext(chatId);
        this.addMessage(chatId, 'user', question);
        
        var limitCheck = await checkLimit(chatId, 'ai');
        if (!limitCheck.allowed) {
            return { 
                error: limitCheck.reason + '\n\n' + (lang === 'ru' ? 
                    '💡 Попробуй спросить что-то о портфеле или выполни /analyze' : 
                    '💡 Try asking about your portfolio or run /analyze')
            };
        }
        
        var answer = await this.generateResponse(chatId, question, lang);
        this.addMessage(chatId, 'assistant', answer);
        
        return { success: true, answer: answer };
    }
}

var aiContext = new AIContext();

// ============================================================
// 30.2. OPENROUTER ИНТЕГРАЦИЯ
// ============================================================

function getNextFreeModel() {
    var currentIndex = FREE_MODELS.indexOf(CURRENT_AI_MODEL);
    var nextIndex = (currentIndex + 1) % FREE_MODELS.length;
    return FREE_MODELS[nextIndex];
}

async function getAIResponseWithOpenRouter(chatId, question, lang) {
    if (!HAS_OPENROUTER) {
        console.log('⚠️ No OpenRouter key, using deterministic AI');
        return await aiContext.getResponse(chatId, question, lang);
    }
    
    await aiContext.refreshData(chatId, lang);
    var context = aiContext.getContext(chatId);
    
    var limitCheck = await checkLimit(chatId, 'ai');
    if (!limitCheck.allowed) {
        return { error: limitCheck.reason };
    }
    
    var prompt = aiContext.buildPrompt(chatId, question, lang);
    
    try {
        var response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + OPENROUTER_API_KEY,
                'HTTP-Referer': 'https://t.me/' + BOT_USERNAME,
                'X-Title': 'Void Node Bot'
            },
            body: JSON.stringify({
                model: CURRENT_AI_MODEL,
                messages: [
                    { role: 'system', content: aiContext.getSystemPrompt(lang) },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 600,
                temperature: 0.7
            })
        });
        
        var data = await response.json();
        
        if (data.error) {
            console.error('OpenRouter error:', data.error);
            if (data.error.code === 402 || data.error.message.includes('insufficient')) {
                CURRENT_AI_MODEL = getNextFreeModel();
                console.log('🔄 Switching to model:', CURRENT_AI_MODEL);
                return await getAIResponseWithOpenRouter(chatId, question, lang);
            }
            return await aiContext.getResponse(chatId, question, lang);
        }
        
        var answer = data.choices[0].message.content;
        aiContext.addMessage(chatId, 'assistant', answer);
        
        return { success: true, answer: answer };
        
    } catch (error) {
        console.error('OpenRouter fetch error:', error);
        return await aiContext.getResponse(chatId, question, lang);
    }
}

// ============================================================
// 30.3. ОБРАБОТЧИК КОМАНДЫ /ai
// ============================================================
async function handleAICommand(chatId, question, lang, messageId) {
    await sendTyping(chatId);
    
    if (!question || question.trim().length === 0) {
        var helpText = lang === 'ru' ?
            '🤖 *AI СОВЕТНИК*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            'Задай мне вопрос о портфеле.\n\n' +
            '📌 *Примеры вопросов:*\n' +
            '• "Какой мой портфель?"\n' +
            '• "Какой риск?"\n' +
            '• "Что с BTC?"\n' +
            '• "Покажи новости"\n' +
            '• "Стоит ли покупать?" (я скажу "нет" 😅)\n\n' +
            '🛡️ Я защищаю тебя от рисков и не даю советов "купить/продать".\n\n' +
            (HAS_OPENROUTER ? '🧠 Модель: `' + CURRENT_AI_MODEL + '`\n' : '') +
            '📊 Перед первым вопросом выполни /analyze — я буду использовать эти данные.' :
            '🤖 *AI ADVISOR*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            'Ask me a question about your portfolio.\n\n' +
            '📌 *Example questions:*\n' +
            '• "What is my portfolio?"\n' +
            '• "What is the risk?"\n' +
            '• "What about BTC?"\n' +
            '• "Show news"\n' +
            '• "Should I buy?" (I will say "no" 😅)\n\n' +
            '🛡️ I protect you from risks and don\'t give "buy/sell" advice.\n\n' +
            (HAS_OPENROUTER ? '🧠 Model: `' + CURRENT_AI_MODEL + '`\n' : '') +
            '📊 Run /analyze first — I will use this data.';
        
        await sendUpdatedMessage(chatId, helpText, getBackKeyboard(lang), 'Markdown', messageId);
        return;
    }
    
    var result;
    if (HAS_OPENROUTER) {
        result = await getAIResponseWithOpenRouter(chatId, question, lang);
    } else {
        result = await aiContext.getResponse(chatId, question, lang);
    }
    
    if (result.error) {
        var errorKeyboard = {
            inline_keyboard: [
                [{ text: '📊 ' + (lang === 'ru' ? 'Анализ портфеля' : 'Analyze portfolio'), callback_data: 'action_analyze' }],
                [{ text: '🔙 ' + (lang === 'ru' ? 'Назад' : 'Back'), callback_data: 'back_to_functions' }]
            ]
        };
        await sendUpdatedMessage(chatId, result.error, errorKeyboard, 'Markdown', messageId);
        return;
    }
    
    var keyboard = {
        inline_keyboard: [
            [{ text: '🔄 ' + (lang === 'ru' ? 'Обновить данные' : 'Refresh data'), callback_data: 'menu_ai' }],
            [{ text: '🔙 ' + (lang === 'ru' ? 'Назад к функциям' : 'Back to functions'), callback_data: 'back_to_functions' }]
        ]
    };
    
    await sendUpdatedMessage(chatId, result.answer, keyboard, 'Markdown', messageId);
}

console.log('🤖 AI Advisor initialized with OpenRouter support');
console.log('📡 OpenRouter key: ' + (HAS_OPENROUTER ? '✅ Found' : '❌ Not found (using deterministic mode)'));
console.log('🧠 Current model: ' + CURRENT_AI_MODEL);

// ============================================================
// 31. EXPRESS SERVER
// ============================================================
var app = express();
app.use(express.json());

app.get('/health', function(req, res) {
    res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

app.post('/webhook', async function(req, res) {
    console.log('📩 Webhook called!');
    try {
        var update = req.body;
        if (update.callback_query) {
            await handleCallback(update);
        } else if (update.message) {
            await handleMessage(update);
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error);
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

var PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', function() {
    console.log('✅ Bot started on port ' + PORT);
    console.log('📡 Webhook URL: https://your-domain.onrender.com/webhook');
});

console.log('🚀 BOT READY!');
console.log('📊 All functions loaded!');

// ============================================================
// END OF FILE
// ============================================================
