// ============================================================
// БОТ VOID NODE — ПОЛНАЯ ВЕРСИЯ 2.0 (ЧАСТЬ 1/3)
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

// ============================================================
// 2. КОНФИГУРАЦИЯ (ВСЕ КЛЮЧИ ИЗ .ENV)
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

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не найден в переменных окружения!');
    process.exit(1);
}

// ============================================================
// 3. КОНСТАНТЫ КОНФИГУРАЦИИ
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
// 4. KV-ХРАНИЛИЩЕ (ЗАМЕНА CLOUDFLARE KV)
// ============================================================
class KVStore {
    constructor() {
        this.filePath = path.join(__dirname, 'data.json');
        this.data = {};
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки данных:', error);
            this.data = {};
        }
    }

    save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
        } catch (error) {
            console.error('❌ Ошибка сохранения данных:', error);
        }
    }

    async get(key) {
        return this.data[key] || null;
    }

    async put(key, value) {
        this.data[key] = value;
        this.save();
    }

    async delete(key) {
        delete this.data[key];
        this.save();
    }
}

const VOID_KV = new KVStore();

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
// 6. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ KV
// ============================================================
async function getData(key) {
    return await VOID_KV.get(key);
}

async function setData(key, value) {
    await VOID_KV.put(key, value);
}

async function deleteData(key) {
    await VOID_KV.delete(key);
}

// ============================================================
// 7. ТАРИФЫ (PLANS)
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
// 8. ФУНКЦИИ ТАРИФОВ И ЛИМИТОВ
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
        if (parsed.expires && parsed.expires < Date.now() && parsed.planId !== 'TRIAL') {
            await activateTrial(chatId);
            return { plan: 'TRIAL', ...PLANS.TRIAL, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
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
// 9. МУЛЬТИЯЗЫЧНОСТЬ (LANGUAGES) — ПОЛНАЯ ВЕРСИЯ
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

        // ===== ГЛАВНОЕ МЕНЮ =====
        main_header: (name, mode, id, plan, expires) => `👤 *${name}* | ${mode} | 🆔 ID: ${id}\n💳 Тариф: ${plan} (до ${expires})`,
        main_functions: '📊 Функции',
        main_settings: '⚙️ Настройки',
        main_plans: '💳 Тарифы',
        main_help: '❓ Помощь',
        main_about: 'ℹ️ О боте',
        back_to_menu: '🔙 Назад в меню',

        // ===== ФУНКЦИИ =====
        functions_title: '📊 *Функции*',
        functions_analyze: '📊 Анализ портфеля',
        functions_security: '🛡️ Антискам-центр',
        functions_news: '📰 Новости',
        functions_history: '📋 История',
        back_to_functions: '🔙 Назад к функциям',

        // ===== НАСТРОЙКИ =====
        settings_title: '⚙️ *Настройки*',
        settings_lang: '🌍 Язык:',
        settings_mode: '🧠 Режим:',
        settings_change_lang: '🌍 Сменить язык',
        settings_change_mode: '🧠 Сменить режим',
        back_to_settings: '🔙 Назад к настройкам',

        // ===== ПОМОЩЬ (НОВАЯ ВЕРСИЯ) =====
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
        back_to_help: '🔙 Назад к помощи',

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

        // ===== ОСТАЛЬНЫЕ КЛЮЧИ =====
        about_title: 'ℹ️ *О БОТЕ*\n━━━━━━━━━━━━━━━━━━━━━━━',
        about_version: '📌 *Версия:* 2.0.0',
        about_created: '📅 *Создан:* 2024',
        about_dev: '👨‍💻 *Разработчик:* @void_node_dev',
        about_instruction: '📖 *ИНСТРУКЦИЯ:*\n\n1️⃣ **Подключи биржу**\n   /connect — добавь API-ключи для анализа портфеля\n\n2️⃣ **Анализируй портфель**\n   /analyze — получи полный отчет по активам\n\n3️⃣ **Проверяй безопасность**\n   Отправь ссылку, контракт или файл — я проверю!\n\n4️⃣ **Следи за рынком**\n   /trend — соц.тренды\n   /news — персонализированные новости\n\n5️⃣ **Получи AI-совет**\n   /help — задай вопрос AI-помощнику',
        about_links: '🔗 *ПОЛЕЗНЫЕ ССЫЛКИ:*\n\n📱 [Telegram](https://t.me/void_node_bot)\n📊 [Трейдинг-канал](https://t.me/void_node_trading)\n📖 [Документация](https://docs.voidnode.com)\n👥 [Чат поддержки](https://t.me/void_node_chat)\n🐦 [Twitter](https://twitter.com/void_node)',
        about_commands: '⚡ *Быстрые команды:*\n/analyze — анализ портфеля\n/connect — подключить биржу\n/trend — соц.тренды\n/news — новости\n/help — умная помощь',
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
        onboard: `👋 *Добро пожаловать в Void Node!*\n\nЯ — *твой крипто-телохранитель* 🛡️\n\nВот что я умею:\n\n📊 *Анализ портфеля*\n• Подключаюсь к твоей бирже за 2 минуты\n• Показываю распределение активов\n• Нахожу проблемы и даю рекомендации\n\n🛡️ *Антискам-центр*\n• Проверяю ссылки, контракты, файлы\n• Проверяю токены через DEX\n• Проверяю кошельки\n\n📈 *Рынок*\n• Социальные тренды\n• Новости с AI-анализом\n• Календарь трейдера\n\n💳 *Тарифы*\n• 🔰 Триал — 7 дней бесплатно\n• ⭐ Старт — 500 ₽/мес\n• 🚀 PRO — 1 000 ₽/мес\n• 👑 VIP — 1 500 ₽/мес\n\n🔐 *Начни с подключения биржи:* /connect\n\n🛡️ *Или просто отправь мне ссылку или адрес контракта — я проверю за 5 секунд!*`,
        onboard_skip: '⏭️ Пропустить',
        onboard_start: '🚀 Начать!',
        connect_prompt: '🔐 *Подключи биржу*\n\n📋 Отправь API-ключи в формате:\n`API_KEY:SECRET_KEY`\n\n🔒 Ключи шифруются и не имеют права на вывод.\n🔄 Для отмены: /cancel',
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
        market_menu: '📈 *Что вас интересует?*',
        market_social: '📊 Соц.тренды',
        market_news: '📰 Новости',
        market_calendar: '📅 Календарь',
        social_menu: '📊 *Выберите монету:*',
        social_search: '🔎 Найти токен',
        social_analyzing: (coin) => `⏳ Анализирую ${coin}...`,
        social_result: (coin, mentions, sentiment, score, trend, emoji, rec, sources, marketCap, volume24h, rank) =>
            `📊 *SOCIAL TREND: ${coin}*\n\n${emoji} *Упоминаний:* ${mentions}\n💬 *Тональность:* ${sentiment}%\n📊 *Рейтинг:* ${score}/100\n📌 *Тренд:* ${trend}\n📡 *Источники:* ${sources}\n💰 *Рыночная капа:* $${marketCap}\n📊 *Объем 24ч:* $${volume24h}\n🏆 *Ранг:* #${rank}\n\n💡 ${rec}`,
        social_search_prompt: '🔎 *Введите название токена*\n\n📌 Примеры: PEPE, ARB, SOL, DOGE, SHIB\n🔄 /cancel — отмена',
        social_search_invalid: '❌ *Некорректное название токена.*\n\n📌 Введите тикер (например: PEPE, ARB, SOL, DOGE, SHIB).\n🔄 Для отмены: /cancel',
        news_analyzing: '📰 Получаю новости...',
        news_empty: '📭 Новостей не найдено.',
        news_coin: (coin) => `📰 *НОВОСТИ: ${coin}*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`,
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
        back_to_security: '🔙 Назад к безопасности',
        back_to_market: '🔙 Назад к рынку',
        back_to_history: '🔙 Назад к истории',
        back_to_help: '🔙 Назад к помощи',
        back_to_plans: '🔙 Назад к тарифам',
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
        help_title: '🤖 *УМНАЯ ПОМОЩЬ*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n💬 *Просто напиши свой вопрос, и я отвечу!*\n🔄 Для выхода: /exit\n\n📌 *Примеры вопросов:*\n• "как проверить токен?"\n• "что такое коэффициент Шарпа?"\n• "как подключить биржу?"\n• "что значит риск высокий?"\n• "как работает холодный душ?"\n\n💬 Или выбери частый вопрос:',
        help_ask: '💬 Задать свой вопрос',
        help_how_check: '🔍 Как проверить токен?',
        help_sharpe: '📊 Коэффициент Шарпа',
        help_connect: '🔐 Подключить биржу',
        help_antiscam: '🛡️ Антискам-центр',
        help_panic: '❄️ Холодный душ',
        help_plans: '💳 Тарифы',
        help_out_of_scope: '🤖 *Я помогаю только с вопросами о боте Void Node!*\n\n📌 *Задай вопрос об одной из функций:*\n• 📊 Анализ портфеля\n• 🛡️ Антискам-центр\n• 📈 Соц.тренды\n• 📅 Календарь трейдера\n• 💳 Тарифы\n• 🔐 Подключение биржи\n• ❄️ Холодный душ\n\n💡 Например: "как подключить биржу?" или "что даёт PRO тариф?"',
        help_ask_prompt: '💬 *Напиши свой вопрос*\n\n📝 Я отвечу на него максимально подробно.\n🔄 Для выхода из режима помощи отправь /exit\n\n📌 *Примеры:*\n• "как настроить стоп-лосс?"\n• "что делать при падении рынка?"\n• "как работает автоторговля?"'
    },
    // ===== АНГЛИЙСКАЯ ВЕРСИЯ (СОКРАЩЕННАЯ ДЛЯ ОБЪЁМА) =====
    en: {
        help_menu_title: '❓ *Help*\n\nSelect a question to get a quick answer:',
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
        greeting_morning: (name) => `☀️ *Good morning, ${name}!*`,
        greeting_afternoon: (name) => `☀️ *Good afternoon, ${name}!*`,
        greeting_evening: (name) => `🌙 *Good evening, ${name}!*`,
        help_contact_moderator_message: '👤 *Contact moderator*\n\nWrite to @clofeLEAN — he will help you!\n\n📌 Also you can ask in our support chat:\n📱 [Support chat](https://t.me/void_node_chat)\n\n⏳ We reply within 15 minutes (working hours).\n\n🔄 VIP users have 24/7 priority support.',
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
        onboard: `👋 *Welcome to Void Node!*\n\nI am *your crypto guardian* 🛡️\n\nHere's what I can do:\n\n📊 *Portfolio Analysis*\n• Connect to your exchange in 2 minutes\n• Show asset allocation\n• Find problems and give recommendations\n\n🛡️ *Anti-Scam Center*\n• Check links, contracts, files\n• Check tokens via DEX\n• Check wallets\n\n📈 *Market*\n• Social trends\n• News with AI analysis\n• Trader calendar\n\n💳 *Plans*\n• 🔰 Trial — 7 days free\n• ⭐ Start — 500 ₽/mo\n• 🚀 PRO — 1 000 ₽/mo\n• 👑 VIP — 1 500 ₽/mo\n\n🔐 *Start by connecting exchange:* /connect\n\n🛡️ *Or just send me a link or contract address — I'll check it in 5 seconds!*`
    }
};

// ============================================================
// 10. ФУНКЦИЯ ПОЛУЧЕНИЯ ТЕКСТА ПО КЛЮЧУ
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
// БОТ VOID NODE — ПОЛНАЯ ВЕРСИЯ 2.0 (ЧАСТЬ 2/3)
// ============================================================

// ============================================================
// 11. УПРАВЛЕНИЕ СООБЩЕНИЯМИ (СИСТЕМА ОДНОГО СООБЩЕНИЯ)
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
// 12. TELEGRAM ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
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
// 13. МЕТРИКИ И ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
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
// 14. БИРЖЕВЫЕ ФУНКЦИИ
// ============================================================

async function connectExchange(apiKey, secretKey, exchangeId = 'binance') {
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
// 15. ИСТОРИЯ ДЕЙСТВИЙ
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
// 16. ПЛАТЕЖИ CRYPTOBOT
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
// 17. ОБРАБОТЧИК ВЫБОРА ТАРИФА
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
// 18. АНТИСКАМ ФУНКЦИИ
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
            const balResp = await fetch(balUrl);
            const balData = await balResp.json();
            if (balData.status === '1') balance = parseFloat(balData.result) / 1e18;
            const tokenUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&page=1&offset=100&sort=desc&apikey=${ETHERSCAN_API_KEY}`;
            const tokenResp = await fetch(tokenUrl);
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
// 19. ОБРАБОТЧИКИ АНТИСКАМА
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
                [{ text: getText(lang, 'back_to_security'), callback_data: 'menu_security' }],
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
// 20. АВТОМАТИЧЕСКАЯ ПРОВЕРКА
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
// БОТ VOID NODE — ПОЛНАЯ ВЕРСИЯ 2.0 (ЧАСТЬ 3/3)
// ============================================================

// ============================================================
// 21. МЕНЮ И ИНТЕРФЕЙС
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

// ============================================================
// 22. ПОМОЩЬ (НОВАЯ ВЕРСИЯ С 10 КНОПКАМИ)
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
// 23. ТАРИФЫ (МЕНЮ)
// ============================================================

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
// 24. ОНБОРДИНГ
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
// 25. ОБРАБОТЧИК CALLBACK
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

        // ===== ДЕЙСТВИЯ =====
        if (data === 'action_analyze') {
            const savedData = await getData(`user_${chatId}`);
            if (!savedData) {
                await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'));
                return;
            }
            await sendUpdatedMessage(chatId, '⏳ *Начинаю анализ...*');
            const user = JSON.parse(savedData);
            const apiKey = decrypt(user.apiKey);
            const secretKey = decrypt(user.secretKey);
            try {
                const exchange = await connectExchange(apiKey, secretKey, user.exchangeId);
                const balance = await exchange.fetchBalance();
                const total = balance.total;
                const coins = Object.keys(total).filter(key => total[key] > 0);
                if (coins.length === 0) {
                    await sendUpdatedMessage(chatId, '📭 *На балансе нет монет.*');
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
                    } catch (e) {
                        // пропускаем монеты без пары с USDT
                    }
                }
                for (const a of assets) {
                    a.weight = (a.value / totalUSDT) * 100;
                }
                assets.sort((a, b) => b.weight - a.weight);
                const userPlan = await getUserPlan(chatId);
                const mode = await getData(`mode_${chatId}`) || 'beginner';
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
                    timestamp: Date.now()
                };
                const report = await composeReport(engineResult, mode, lang, 0);
                await sendUpdatedMessage(chatId, report.text, report.keyboard, 'Markdown');
                await addHistory(chatId, getText(lang, 'history_analyze'), `$${totalUSDT.toFixed(2)}`);
            } catch (error) {
                await sendUpdatedMessage(chatId, `❌ Ошибка анализа: ${error.message}`);
            }
            return;
        }

        if (data === 'action_export_csv') {
            const savedData = await getData(`user_${chatId}`);
            if (!savedData) {
                await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'));
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
                await sendUpdatedMessage(chatId, '✅ *CSV отчет отправлен!*');
            } catch (error) {
                await sendUpdatedMessage(chatId, getText(lang, 'export_error'));
            }
            return;
        }

        if (data === 'action_history_refresh') {
            await showHistoryMenu(chatId, lang);
            return;
        }

        if (data === 'action_disconnect') {
            await deleteData(`user_${chatId}`);
            await sendUpdatedMessage(chatId, getText(lang, 'connect_disconnected'));
            await showMainMenu(chatId, lang);
            return;
        }

        if (data === 'action_ask_ai') {
            await sendUpdatedMessage(chatId, getText(lang, 'ai_mode'));
            await setData(`state_${chatId}`, 'ai_chat');
            return;
        }

        // ===== ТРЕНДЫ ПОИСК =====
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

    } catch (error) {
        console.error('❌ Callback error:', error);
        await sendUpdatedMessage(chatId, getText(lang, 'error_general', error.message));
    }
}

// ============================================================
// 26. ОБРАБОТЧИК СООБЩЕНИЙ
// ============================================================

async function handleMessage(update) {
    const chatId = update.message.chat.id;
    const text = update.message.text || '';
    const messageId = update.message.message_id;
    const userName = update.message.from.first_name || 'Друг';
    let lang = await getData(`lang_${chatId}`) || 'ru';
    let state = await getData(`state_${chatId}`) || 'idle';

    try {
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
                    timestamp: Date.now()
                };
                const report = await composeReport(engineResult, mode, lang, 0);
                await sendUpdatedMessage(chatId, report.text, report.keyboard, 'Markdown', messageId);
                await addHistory(chatId, getText(lang, 'history_analyze'), `$${totalUSDT.toFixed(2)}`);
            } catch (error) {
                await sendUpdatedMessage(chatId, `❌ Ошибка анализа: ${error.message}`, null, 'Markdown', messageId);
            }
            return;
        }

        // ===== АНТИСКАМ (ССЫЛКА ИЛИ КОНТРАКТ) =====
        if (text.startsWith('http://') || text.startsWith('https://') || (text.startsWith('0x') && text.length >= 42)) {
            await handleAntiscamInput(chatId, text, lang, update, messageId);
            return;
        }

        // ===== ОТВЕТ ПО УМОЛЧАНИЮ =====
        await sendUpdatedMessage(chatId, getText(lang, 'default_response', text), null, 'Markdown', messageId);

    } catch (error) {
        console.error('❌ Message error:', error);
        await sendUpdatedMessage(chatId, getText(lang, 'error_general', error.message), null, 'Markdown', messageId);
    }
}

// ============================================================
// 27. КОМПОЗИЦИЯ ОТЧЕТА
// ============================================================

async function composeReport(engineResult, mode, lang, dailyChange = 0) {
    const { totalUSDT, btcPercent, altPercent, usdtPercent, assets, riskLevel, riskScore } = engineResult;

    let baseText = `📊 *АНАЛИЗ ПОРТФЕЛЯ*\n`;
    baseText += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    baseText += `💰 *Общая стоимость:* $${totalUSDT?.toFixed(2) || 0} USDT\n`;
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
    baseText += `${riskEmoji} *Риск:* ${riskLabel} (${riskScore || 0} баллов)\n\n`;

    if (assets && assets.length > 0) {
        baseText += `📊 *Активы:*\n`;
        for (const a of assets.slice(0, 10)) {
            baseText += `• ${a.symbol}: ${a.weight.toFixed(1)}% ($${a.value.toFixed(2)})\n`;
        }
        if (assets.length > 10) {
            baseText += `\n... и еще ${assets.length - 10} активов`;
        }
        baseText += `\n\n`;
    }

    const keyboard = {
        inline_keyboard: [
            [{ text: '📥 CSV отчет', callback_data: 'action_export_csv' }],
            [{ text: '💬 AI-советник', callback_data: 'action_ask_ai' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_functions' }]
        ]
    };

    baseText += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    baseText += `🛡️ *Void Node — твой телохранитель в крипте*\n`;
    baseText += `\n⚠️ *Это не финансовая рекомендация.*`;

    return { text: baseText, keyboard };
}

// ============================================================
// 28. ТРЕНДЫ (ЗАГЛУШКА)
// ============================================================

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
        const message = `📊 *SOCIAL TREND: ${coin}*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `💵 *Цена:* Нет данных\n` +
            `📈 *Изменение 24ч:* Нет данных\n` +
            `📊 *Объем 24ч:* Нет данных\n` +
            `💰 *Рыночная капа:* Нет данных\n` +
            `🏆 *Ранг:* Нет данных\n` +
            `⚪ *Тренд:* Нейтральный\n\n` +
            `💡 Социальные тренды временно недоступны. Используйте /analyze для анализа портфеля.`;
        const keyboard = {
            inline_keyboard: [
                [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
                [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
    } catch (error) {
        await sendUpdatedMessage(chatId, `❌ ${error.message}`, null, 'Markdown', messageId);
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
    await sendTyping(chatId);
    try {
        const message = `📊 *SOCIAL TREND: ${coin}*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `💵 *Цена:* Нет данных\n` +
            `📈 *Изменение 24ч:* Нет данных\n` +
            `📊 *Объем 24ч:* Нет данных\n` +
            `💰 *Рыночная капа:* Нет данных\n` +
            `🏆 *Ранг:* Нет данных\n` +
            `⚪ *Тренд:* Нейтральный\n\n` +
            `💡 Данные по ${coin} временно недоступны. Попробуйте позже.`;
        const keyboard = {
            inline_keyboard: [
                [{ text: '🔙 Назад к трендам', callback_data: 'menu_social' }],
                [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
            ]
        };
        await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
        await addHistory(chatId, getText(lang, 'history_social'), coin);
    } catch (error) {
        await sendUpdatedMessage(chatId, `❌ ${error.message}`, null, 'Markdown', messageId);
    }
    await setData(`state_${chatId}`, 'idle');
}

async function handleContractSearch(chatId, address, lang, messageId) {
    await sendTyping(chatId);
    try {
        const dexUrl = `https://api.dexscreener.com/latest/dex/search?q=${address}`;
        const response = await fetch(dexUrl);
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
        await sendUpdatedMessage(chatId, '❌ *Ошибка при поиске контракта.*\n\nПопробуйте позже или проверьте адрес вручную.', null, 'Markdown', messageId);
    }
    await setData(`state_${chatId}`, 'idle');
}

// ============================================================
// 29. НОВОСТИ И КАЛЕНДАРЬ (ЗАГЛУШКИ)
// ============================================================

async function handleNewsCommand(chatId, coin, lang, messageId) {
    const check = await checkLimit(chatId, 'news');
    if (!check.allowed) {
        await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
        return;
    }
    await sendTyping(chatId);
    const report = `📰 *КРИПТО-НОВОСТИ*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 *Биткоин консолидируется выше $60,000*\n` +
        `   📎 Crypto Analytics\n\n` +
        `📊 *Институциональные инвесторы наращивают позиции*\n` +
        `   📎 Bloomberg\n\n` +
        `📊 *DeFi-сектор продолжает рост*\n` +
        `   📎 DeFi Pulse\n\n` +
        `🔄 /news — обновить`;
    const keyboard = {
        inline_keyboard: [
            [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
            [{ text: getText(lang, 'back_to_menu'), callback_data: 'back_to_menu' }]
        ]
    };
    await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
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
    const events = [
        { title: 'Решение по ставке ФРС', date: '15.08.2026', importance: '🔴 Высокая', impact: 'Высокое' },
        { title: 'Индекс потребительских цен (CPI)', date: '16.08.2026', importance: '🔴 Высокая', impact: 'Высокое' },
        { title: 'Отчет по занятости', date: '17.08.2026', importance: '🟡 Средняя', impact: 'Среднее' }
    ];
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
// 30. КРИПТОБОТ WEBHOOK
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
// 31. EXPRESS СЕРВЕР
// ============================================================

const app = express();
app.use(express.json());

// Logging
app.use((req, res, next) => {
    console.log(`📩 ${req.method} ${req.url}`);
    next();
});

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime()
    });
});

// Webhook
app.post('/webhook', async (req, res) => {
    try {
        const update = req.body;
        console.log(`📩 Webhook received: ${JSON.stringify(update).slice(0, 200)}...`);

        if (update.callback_query) {
            await handleCallback(update);
            res.sendStatus(200);
            return;
        }

        if (update.message) {
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
// 32. ЗАПУСК СЕРВЕРА
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Бот запущен на порту ${PORT}`);
    console.log(`📡 Webhook URL: https://ваш-домен.onrender.com/webhook`);
    console.log(`🩺 Health Check: https://ваш-домен.onrender.com/health`);
});

// ============================================================
// 33. ОБРАБОТКА КРИТИЧЕСКИХ ОШИБОК
// ============================================================

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

console.log('✅ Бот полностью загружен!');
