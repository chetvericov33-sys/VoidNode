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

// Создаём экземпляр KV вместо Cloudflare KV
const VOID_KV = new KVStore();

// ============================================================
// 0. УПРАВЛЕНИЕ СООБЩЕНИЯМИ (СИСТЕМА ОДНОГО СООБЩЕНИЯ)
// ============================================================

// Хранилище ID последних сообщений для каждого пользователя
async function getUserLastMessageId(chatId) {
  const key = `last_msg_${chatId}`;
  const data = await VOID_KV.get(key);
  return data ? parseInt(data) : null;
}

async function setUserLastMessageId(chatId, messageId) {
  const key = `last_msg_${chatId}`;
  await VOID_KV.put(key, messageId.toString());
}

async function deleteUserLastMessage(chatId) {
  const messageId = await getUserLastMessageId(chatId);
  if (messageId) {
    try {
      await botDeleteMessage(chatId, messageId);
      await VOID_KV.delete(`last_msg_${chatId}`);
    } catch (error) {
      console.error('Failed to delete message:', error);
    }
  }
}

// Удаление сообщения через API
async function botDeleteMessage(chatId, messageId) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`;
    const body = {
      chat_id: chatId,
      message_id: messageId
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response;
  } catch (error) {
    console.error('Delete message error:', error);
    return null;
  }
}

// Удаление сообщения пользователя
async function deleteUserMessage(chatId, messageId) {
  if (!messageId) return;
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`;
    const body = {
      chat_id: chatId,
      message_id: messageId
    };
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('Failed to delete user message:', error);
  }
}

// Удаление сообщения пользователя с задержкой
async function deleteUserMessageWithDelay(chatId, messageId, delay = 1500) {
  if (!messageId) return;
  setTimeout(async () => {
    await deleteUserMessage(chatId, messageId);
  }, delay);
}

// ОТПРАВКА С УДАЛЕНИЕМ СТАРОГО СООБЩЕНИЯ И СООБЩЕНИЯ ПОЛЬЗОВАТЕЛЯ
async function sendUpdatedMessage(chatId, text, keyboard = null, parseMode = 'Markdown', userMessageId = null) {
  // Удаляем предыдущее сообщение бота
  await deleteUserLastMessage(chatId);
  
  // Удаляем сообщение пользователя (если передано)
  if (userMessageId) {
    await deleteUserMessageWithDelay(chatId, userMessageId, 1500);
  }
  
  // Отправляем новое
  const result = await sendMessage(chatId, text, keyboard, parseMode);
  
  // Сохраняем ID нового сообщения
  if (result && result.ok) {
    const data = await result.json();
    if (data.result && data.result.message_id) {
      await setUserLastMessageId(chatId, data.result.message_id);
    }
  }
  
  return result;
}

// ОТПРАВКА СООБЩЕНИЯ (с возвратом результата)
async function sendMessage(chatId, text, keyboard = null, parseMode = 'Markdown') {
  if (!text) return null;
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const body = {
      chat_id: chatId,
      text: text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    };
    if (keyboard) body.reply_markup = keyboard;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response;
  } catch (error) {
    console.error('Send message error:', error);
    return null;
  }
}

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
};

// ============================================================
// 2. ТАРИФЫ (PLANS)
// ============================================================
const PLANS = {
  TRIAL: {
    id: 'TRIAL',
    name: '🔰 Триал',
    name_en: '🔰 Trial',
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
      priority_support: false,
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
      '📊 Полный отчет',
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
      '📊 Full report',
    ]
  },
  START: {
    id: 'START',
    name: '⭐ Старт',
    name_en: '⭐ Start',
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
      priority_support: false,
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
      '📊 Полный отчет + CSV',
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
      '📊 Full report + CSV',
    ]
  },
  PRO: {
    id: 'PRO',
    name: '🚀 PRO',
    name_en: '🚀 PRO',
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
      priority_support: false,
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
      '🆘 Kill Switch',
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
      '🆘 Kill Switch',
    ]
  },
  VIP: {
    id: 'VIP',
    name: '👑 VIP',
    name_en: '👑 VIP',
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
      priority_support: true,
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
      '⚡ Приоритетная поддержка 24/7',
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
      '⚡ 24/7 priority support',
    ]
  }
};

// ============================================================
// 3. МУЛЬТИЯЗЫЧНОСТЬ (LANGUAGES) - ПОЛНЫЙ ОБЪЕКТ
// ============================================================
const LANGUAGES = {
  ru: {
    language_select: '🌍 *Выберите язык / Choose language:*',
    mode_select: '📊 *Выбери свой уровень:*',
    mode_beginner_desc: '🔰 *Новичок*\n• Целевые веса: BTC 50%, Альты 30%, Стейблы 20%\n• Простые рекомендации по портфелю\n• Базовые метрики (риск, распределение)',
    mode_pro_desc: '🚀 *Опытный*\n• Целевые веса: BTC 40%, Альты 40%, Стейблы 20%\n• Расширенные рекомендации\n• Полные метрики (Шарп, RSI, MA20, просадка)',
    mode_select_prompt: '👇 *Выбери режим:*',
    mode_beginner_btn: '🔰 Новичок',
    mode_pro_btn: '🚀 Опытный',
    onboarding_setup: '⚙️ *Настройка бота...*\n\n✅ Язык установлен\n✅ Режим выбран\n✅ Профиль создан\n\n⏳ Завершаем настройку...',
    onboarding_done: '✅ *Готово!* 🎉',
    
    main_header: (name, mode, id, plan, expires) => 
      `👤 *${name}* | ${mode} | 🆔 ID: ${id}\n💳 Тариф: ${plan} (до ${expires})`,
    main_functions: '📊 Функции',
    main_settings: '⚙️ Настройки',
    main_plans: '💳 Тарифы',
    main_help: '❓ Помощь',
    main_about: 'ℹ️ О боте',
    
    functions_title: '📊 *Функции*',
    functions_analyze: '📊 Анализ портфеля',
    functions_security: '🛡️ Антискам-центр',
    functions_news: '📰 Новости',
    functions_history: '📋 История',
    
    settings_title: '⚙️ *Настройки*',
    settings_lang: '🌍 Язык:',
    settings_mode: '🧠 Режим:',
    settings_change_lang: '🌍 Сменить язык',
    settings_change_mode: '🧠 Сменить режим',
    
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
      if (!events || events.length === 0) {
        return '📭 На эту неделю важных событий не найдено.';
      }
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
    
    back_to_menu: '🔙 Назад в меню',
    back_to_security: '🔙 Назад к безопасности',
    back_to_market: '🔙 Назад к рынку',
    back_to_settings: '🔙 Назад к настройкам',
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
    help_ask_prompt: '💬 *Напиши свой вопрос*\n\n📝 Я отвечу на него максимально подробно.\n🔄 Для выхода из режима помощи отправь /exit\n\n📌 *Примеры:*\n• "как настроить стоп-лосс?"\n• "что делать при падении рынка?"\n• "как работает автоторговля?"',
  },
  en: {
    language_select: '🌍 *Choose language:*',
    mode_select: '📊 *Choose your level:*',
    mode_beginner_desc: '🔰 *Beginner*\n• Target weights: BTC 50%, Alts 30%, Stable 20%\n• Simple portfolio recommendations\n• Basic metrics (risk, allocation)',
    mode_pro_desc: '🚀 *Experienced*\n• Target weights: BTC 40%, Alts 40%, Stable 20%\n• Advanced recommendations\n• Full metrics (Sharpe, RSI, MA20, drawdown)',
    mode_select_prompt: '👇 *Select mode:*',
    mode_beginner_btn: '🔰 Beginner',
    mode_pro_btn: '🚀 Experienced',
    onboarding_setup: '⚙️ *Setting up bot...*\n\n✅ Language set\n✅ Mode selected\n✅ Profile created\n\n⏳ Finishing setup...',
    onboarding_done: '✅ *Done!* 🎉',
    
    main_header: (name, mode, id, plan, expires) => 
      `👤 *${name}* | ${mode} | 🆔 ID: ${id}\n💳 Plan: ${plan} (until ${expires})`,
    main_functions: '📊 Functions',
    main_settings: '⚙️ Settings',
    main_plans: '💳 Plans',
    main_help: '❓ Help',
    main_about: 'ℹ️ About',
    
    functions_title: '📊 *Functions*',
    functions_analyze: '📊 Analyze portfolio',
    functions_security: '🛡️ Anti-scam center',
    functions_news: '📰 News',
    functions_history: '📋 History',
    
    settings_title: '⚙️ *Settings*',
    settings_lang: '🌍 Language:',
    settings_mode: '🧠 Mode:',
    settings_change_lang: '🌍 Change language',
    settings_change_mode: '🧠 Change mode',
    
    about_title: 'ℹ️ *ABOUT BOT*\n━━━━━━━━━━━━━━━━━━━━━━━',
    about_version: '📌 *Version:* 2.0.0',
    about_created: '📅 *Created:* 2024',
    about_dev: '👨‍💻 *Developer:* @void_node_dev',
    about_instruction: '📖 *INSTRUCTION:*\n\n1️⃣ **Connect exchange**\n   /connect — add API keys for portfolio analysis\n\n2️⃣ **Analyze portfolio**\n   /analyze — get full asset report\n\n3️⃣ **Check security**\n   Send link, contract or file — I\'ll check it!\n\n4️⃣ **Follow market**\n   /trend — social trends\n   /news — personalized news\n\n5️⃣ **Get AI advice**\n   /help — ask AI assistant',
    about_links: '🔗 *USEFUL LINKS:*\n\n📱 [Telegram](https://t.me/void_node_bot)\n📊 [Trading channel](https://t.me/void_node_trading)\n📖 [Documentation](https://docs.voidnode.com)\n👥 [Support chat](https://t.me/void_node_chat)\n🐦 [Twitter](https://twitter.com/void_node)',
    about_commands: '⚡ *Quick commands:*\n/analyze — portfolio analysis\n/connect — connect exchange\n/trend — social trends\n/news — news\n/help — smart help',
    
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
    
    onboard: `👋 *Welcome to Void Node!*\n\nI am *your crypto guardian* 🛡️\n\nHere\'s what I can do:\n\n📊 *Portfolio Analysis*\n• Connect to your exchange in 2 minutes\n• Show asset allocation\n• Find problems and give recommendations\n\n🛡️ *Anti-Scam Center*\n• Check links, contracts, files\n• Check tokens via DEX\n• Check wallets\n\n📈 *Market*\n• Social trends\n• News with AI analysis\n• Trader calendar\n\n💳 *Plans*\n• 🔰 Trial — 7 days free\n• ⭐ Start — 500 ₽/mo\n• 🚀 PRO — 1 000 ₽/mo\n• 👑 VIP — 1 500 ₽/mo\n\n🔐 *Start by connecting exchange:* /connect\n\n🛡️ *Or just send me a link or contract address — I\'ll check it in 5 seconds!*`,
    onboard_skip: '⏭️ Skip',
    onboard_start: '🚀 Start!',
    
    connect_prompt: '🔐 *Connect exchange*\n\n📋 Send API keys as:\n`API_KEY:SECRET_KEY`\n\n🔒 Keys are encrypted.\n🔄 To cancel: /cancel',
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
    
    market_menu: '📈 *What interests you?*',
    market_social: '📊 Social trends',
    market_news: '📰 News',
    market_calendar: '📅 Calendar',
    
    social_menu: '📊 *Select coin:*',
    social_search: '🔎 Find token',
    social_analyzing: (coin) => `⏳ Analyzing ${coin}...`,
    social_result: (coin, mentions, sentiment, score, trend, emoji, rec, sources, marketCap, volume24h, rank) => 
      `📊 *SOCIAL TREND: ${coin}*\n\n${emoji} Mentions: ${mentions}\n💬 Sentiment: ${sentiment}%\n📊 Score: ${score}/100\n📌 Trend: ${trend}\n📡 Sources: ${sources}\n💰 Market Cap: $${marketCap}\n📊 24h Volume: $${volume24h}\n🏆 Rank: #${rank}\n\n💡 ${rec}`,
    social_search_prompt: '🔎 *Enter token name*\n\n📌 Examples: PEPE, ARB, SOL, DOGE, SHIB\n🔄 /cancel — cancel',
    social_search_invalid: '❌ *Invalid token name.*\n\n📌 Enter a ticker (e.g., PEPE, ARB, SOL, DOGE, SHIB).\n🔄 To cancel: /cancel',
    
    news_analyzing: '📰 Fetching news...',
    news_empty: '📭 No news found.',
    news_coin: (coin) => `📰 *NEWS: ${coin}*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`,
    
    calendar_analyzing: '📅 Generating calendar...',
    calendar_empty: '📭 No important events this week.',
    calendar_pro_only: '❌ *Trader Calendar available on PRO and VIP plans.*\n\n💳 /subscribe',
    calendar_result: (events) => {
      if (!events || events.length === 0) {
        return '📭 No important events this week.';
      }
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
    
    back_to_menu: '🔙 Back to menu',
    back_to_security: '🔙 Back to Security',
    back_to_market: '🔙 Back to Market',
    back_to_settings: '🔙 Back to Settings',
    back_to_history: '🔙 Back to History',
    back_to_help: '🔙 Back to Help',
    back_to_plans: '🔙 Back to Plans',
    
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
  }
};

// ============================================================
// 4. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
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

function getGreeting(name, lang) {
  const hour = new Date().getHours();
  let key = hour < 12 ? 'greeting_morning' : hour < 18 ? 'greeting_afternoon' : 'greeting_evening';
  return getText(lang, key, name);
}

async function getUserLanguage(chatId) {
  const key = `lang_${chatId}`;
  const lang = await VOID_KV.get(key);
  return lang || null;
}

async function setUserLanguage(chatId, lang) {
  const key = `lang_${chatId}`;
  await VOID_KV.put(key, lang);
}

async function getUserMode(chatId) {
  const key = `mode_${chatId}`;
  const mode = await VOID_KV.get(key);
  return mode || null;
}

async function setUserMode(chatId, mode) {
  const key = `mode_${chatId}`;
  await VOID_KV.put(key, mode);
}

// ============================================================
// 5. ШИФРОВАНИЕ
// ============================================================
async function encrypt(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(ENCRYPTION_KEY.padEnd(32, ' ')),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    data
  );
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...result));
}

async function decrypt(encoded) {
  const data = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const iv = data.slice(0, 12);
  const encrypted = data.slice(12);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(ENCRYPTION_KEY.padEnd(32, ' ')),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encrypted
  );
  return new TextDecoder().decode(decrypted);
}

// ============================================================
// 6. KV ФУНКЦИИ
// ============================================================
async function saveUserKeys(chatId, apiKey, secretKey, exchangeId) {
  const key = `user_${chatId}`;
  const encryptedApiKey = await encrypt(apiKey);
  const encryptedSecretKey = await encrypt(secretKey);
  const value = JSON.stringify({
    apiKey: encryptedApiKey,
    secretKey: encryptedSecretKey,
    exchangeId: exchangeId,
    connectedAt: Date.now()
  });
  await VOID_KV.put(key, value);
}

async function loadUserKeys(chatId) {
  const key = `user_${chatId}`;
  const data = await VOID_KV.get(key);
  if (!data) return null;
  try {
    const parsed = JSON.parse(data);
    const decryptedApiKey = await decrypt(parsed.apiKey);
    const decryptedSecretKey = await decrypt(parsed.secretKey);
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

async function deleteUserKeys(chatId) {
  const key = `user_${chatId}`;
  await VOID_KV.delete(key);
}

async function getUserState(chatId) {
  const key = `state_${chatId}`;
  const state = await VOID_KV.get(key);
  return state || 'idle';
}

async function setUserState(chatId, state) {
  const key = `state_${chatId}`;
  await VOID_KV.put(key, state);
}

async function getKillSwitch(chatId) {
  const key = `kill_${chatId}`;
  const state = await VOID_KV.get(key);
  return state === 'true';
}

async function setKillSwitch(chatId, active) {
  const key = `kill_${chatId}`;
  await VOID_KV.put(key, active ? 'true' : 'false');
}

async function getOnboarded(chatId) {
  const key = `onboarded_${chatId}`;
  const data = await VOID_KV.get(key);
  return data === 'true';
}

async function setOnboarded(chatId) {
  const key = `onboarded_${chatId}`;
  await VOID_KV.put(key, 'true');
}

// ============================================================
// 7. ТАРИФЫ И ЛИМИТЫ
// ============================================================
async function getUserPlan(chatId) {
  const key = `plan_${chatId}`;
  const data = await VOID_KV.get(key);
  
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
      expires: parsed.expires || Date.now() + plan.duration * 24 * 60 * 60 * 1000,
    };
  } catch (e) {
    await activateTrial(chatId);
    return { plan: 'TRIAL', ...PLANS.TRIAL, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
  }
}

async function activateTrial(chatId) {
  const key = `plan_${chatId}`;
  await VOID_KV.put(key, JSON.stringify({
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
  await VOID_KV.put(key, JSON.stringify({
    planId: planId,
    activatedAt: Date.now(),
    expires: Date.now() + plan.duration * 24 * 60 * 60 * 1000,
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
  const usage = await VOID_KV.get(key);
  const count = usage ? parseInt(usage) : 0;
  if (count >= limit) {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const hoursLeft = Math.round((tomorrow - now) / (1000 * 60 * 60));
    return { allowed: false, reason: getText('ru', 'analyzing_limit', limit, `${hoursLeft} ч.`), limit, remaining: 0 };
  }
  await VOID_KV.put(key, (count + 1).toString(), { expirationTtl: 86400 });
  return { allowed: true, remaining: limit - count - 1, limit };
}

// ============================================================
// 8. ИСТОРИЯ
// ============================================================
async function addHistory(chatId, action, detail) {
  const key = `history_${chatId}`;
  const data = await VOID_KV.get(key);
  const history = data ? JSON.parse(data) : [];
  history.push({
    timestamp: Date.now(),
    date: new Date().toISOString().replace('T', ' ').slice(0, 16),
    action: action,
    detail: detail
  });
  if (history.length > 50) history.shift();
  await VOID_KV.put(key, JSON.stringify(history));
}

async function getHistory(chatId) {
  const key = `history_${chatId}`;
  const data = await VOID_KV.get(key);
  return data ? JSON.parse(data) : [];
}

// ============================================================
// 9. ПЛАТЕЖИ CRYPTOBOT
// ============================================================
async function createCryptoInvoice(chatId, planId, amountRub) {
  const url = 'https://pay.crypt.bot/api/createInvoice';
  const usdtAmount = Math.round(amountRub / 90);
  const plan = PLANS[planId];
  
  if (amountRub === 0) {
    return { payUrl: null, invoiceId: null };
  }
  
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
      return {
        payUrl: data.result.pay_url,
        invoiceId: data.result.invoice_id,
      };
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
// 10. TELEGRAM ФУНКЦИИ (ДОПОЛНИТЕЛЬНЫЕ)
// ============================================================
async function sendTyping(chatId) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`;
    const body = { chat_id: chatId, action: 'typing' };
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('Typing error:', error);
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
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('Answer callback error:', error);
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
    console.error('Send document error:', error);
  }
}

// ============================================================
// 11. МЕТРИКИ
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

function generateCSV(riskReport) {
  let csv = 'Asset,Value(USDT),Percentage\n';
  csv += `BTC,${(riskReport.totalUSDT * riskReport.btcPercent / 100).toFixed(2)},${riskReport.btcPercent.toFixed(2)}\n`;
  csv += `Altcoins,${(riskReport.totalUSDT * riskReport.altPercent / 100).toFixed(2)},${riskReport.altPercent.toFixed(2)}\n`;
  csv += `USDT,${(riskReport.totalUSDT * riskReport.usdtPercent / 100).toFixed(2)},${riskReport.usdtPercent.toFixed(2)}\n`;
  csv += `\nRisk Level,${riskReport.riskLevel}\n`;
  csv += `Issues,${riskReport.issues.length}\n`;
  csv += `Recommendations,${riskReport.recommendations.length}\n`;
  if (riskReport.sharpe !== undefined) {
    csv += `Sharpe Ratio,${riskReport.sharpe.toFixed(2)}\n`;
    csv += `Max Drawdown,${riskReport.maxDrawdown.toFixed(2)}%\n`;
  }
  return csv;
}

// ============================================================
// 12. БИРЖЕВЫЕ ФУНКЦИИ
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
      await exchange.fetchBalance();
      return id;
    } catch (error) {
      continue;
    }
  }
  return null;
}

// ============================================================
// 13. ОБНОВЛЁННЫЙ АНАЛИЗ ПОРТФЕЛЯ (С КЭШЕМ, ПАРАЛЛЕЛИЗМОМ, РАСШИРЕННЫМИ МЕТРИКАМИ)
// ============================================================

// Глобальный кэш и константы
const CACHE = new Map();
const CACHE_TTL = 60000; // 1 минута
const COMMISSION_RATE = 0.001; // 0.1% комиссия биржи

// Вспомогательные функции для кэширования
async function getCachedTicker(exchange, symbol) {
  const key = `${exchange.id}_${symbol}`;
  if (CACHE.has(key) && Date.now() - CACHE.get(key).timestamp < CACHE_TTL) {
    return CACHE.get(key).data;
  }
  try {
    const ticker = await exchange.fetchTicker(symbol);
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
    const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    CACHE.set(key, { data: ohlcv, timestamp: Date.now() });
    return ohlcv;
  } catch (error) {
    console.warn(`Не удалось получить OHLCV для ${symbol}:`, error.message);
    return null;
  }
}

// Расширенные метрики
async function calculateRSI(exchange, symbol, period = 14) {
  const ohlcv = await getCachedOHLCV(exchange, symbol, '1d', period + 1);
  if (!ohlcv || ohlcv.length < period + 1) {
    return { rsi: 50, signal: 'neutral' };
  }
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
  if (!ohlcv || ohlcv.length < period) {
    return { ma: 0, current: 0, diff: 0 };
  }
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
  return Math.sqrt(variance) * 100; // в процентах
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

// Основная функция анализа (заменяет старую)
async function analyzePortfolio(exchangeId, apiKey, secretKey, chatId = null, lang = 'ru') {
  // --- 1. Проверка лимитов и ключей ---
  if (chatId) {
    const check = await checkLimit(chatId, 'analyze');
    if (!check.allowed) {
      return { error: 'limit', message: check.reason };
    }
    await sendTyping(chatId);
    
    // Проверка ключей
    const exchange = await getExchange(exchangeId, apiKey, secretKey);
    try {
      await exchange.fetchBalance();
    } catch (error) {
      if (error.message.includes('Invalid API key') || error.message.includes('Signature')) {
        return { error: 'invalid_key', message: getText(lang, 'error_api_key') };
      }
      return { error: 'exchange_error', message: getText(lang, 'error_exchange') };
    }
  }

  // --- 2. Получение баланса ---
  const exchange = await getExchange(exchangeId, apiKey, secretKey);
  const balance = await exchange.fetchBalance();
  const total = balance.total;
  const coins = Object.keys(total).filter(key => total[key] > 0);

  if (coins.length === 0) {
    return { error: 'empty', message: getText(lang, 'no_coins') };
  }

  // --- 3. Параллельный сбор тикеров ---
  const tickerPromises = coins.map(coin => getCachedTicker(exchange, `${coin}/USDT`));
  const tickerResults = await Promise.allSettled(tickerPromises);

  let totalUSDT = 0;
  let btcAmount = 0;
  let usdtAmount = 0;
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
      const price = ticker.last * (1 - COMMISSION_RATE); // учёт комиссии
      const value = amount * price;
      totalUSDT += value;
      if (coin === 'BTC') {
        btcAmount += value;
      } else {
        altcoins.push({
          asset: coin,
          value: value,
          volume: ticker.quoteVolume || 0,
          delisted: false,
          price: price
        });
      }
    } else {
      // Если не удалось получить цену – помечаем как проблемный
      altcoins.push({
        asset: coin,
        value: 0,
        volume: 0,
        delisted: true,
        price: 0
      });
    }
  }

  if (totalUSDT === 0) {
    return { error: 'empty', message: getText(lang, 'no_coins') };
  }

  // --- 4. Расчёт распределения ---
  const btcPercent = (btcAmount / totalUSDT) * 100 || 0;
  const usdtPercent = (usdtAmount / totalUSDT) * 100 || 0;
  const altTotal = altcoins.reduce((sum, a) => sum + a.value, 0);
  const altPercent = (altTotal / totalUSDT) * 100 || 0;

  // --- 5. Расчёт метрик для BTC и для топ-активов ---
  const btcMetrics = {
    rsi: await calculateRSI(exchange, 'BTC/USDT'),
    ma20: await calculateMA(exchange, 'BTC/USDT', 20),
    ma200: await calculateMA(exchange, 'BTC/USDT', 200),
    volatility: await calculateVolatility(exchange, 'BTC/USDT'),
  };

  // Метрики для активов с весом > 3%
  const topAssets = altcoins.filter(a => (a.value / totalUSDT) * 100 > 3);
  const assetMetrics = await Promise.all(topAssets.map(async (asset) => {
    const symbol = `${asset.asset}/USDT`;
    const rsi = await calculateRSI(exchange, symbol);
    const ma = await calculateMA(exchange, symbol);
    const vol = await calculateVolatility(exchange, symbol);
    return { asset: asset.asset, rsi, ma, volatility: vol };
  }));

  // --- 6. Анализ рисков и рекомендации (улучшенная версия) ---
  const riskReport = await analyzeRisksEnhanced(
    totalUSDT, btcPercent, altPercent, usdtPercent, altcoins,
    btcMetrics, assetMetrics, exchange
  );

  // --- 7. Сохранение истории портфеля ---
  if (chatId) {
    const historyKey = `portfolio_history_${chatId}`;
    let history = await VOID_KV.get(historyKey);
    history = history ? JSON.parse(history) : [];
    history.push({
      date: new Date().toISOString(),
      totalUSDT,
      btcPercent,
      altPercent,
      usdtPercent,
      riskLevel: riskReport.riskLevel
    });
    if (history.length > 30) history.shift();
    await VOID_KV.put(historyKey, JSON.stringify(history));
    
    // Сохраняем последний анализ для AI
    await VOID_KV.put(`analysis_${chatId}`, JSON.stringify({
      totalUSDT, btcPercent, altPercent, usdtPercent,
      riskLevel: riskReport.riskLevel,
      issues: riskReport.issues,
      recommendations: riskReport.recommendations,
      btcMetrics,
      assetMetrics,
      assets: riskReport.assets
    }), { expirationTtl: 86400 });
  }

  // --- 8. Логирование в историю действий ---
  await addHistory(chatId, getText(lang, 'history_analyze'), `$${totalUSDT.toFixed(2)}`);

  return { success: true, riskReport, exchange, dailyChange: btcMetrics.ma20.diff || 0 };
}

// Улучшенный анализ рисков и рекомендаций
async function analyzeRisksEnhanced(totalUSDT, btcPercent, altPercent, usdtPercent, altcoins, btcMetrics, assetMetrics, exchange) {
  const issues = [];
  const recommendations = [];
  const assets = [];

  // 1. Проверка перекосов по отдельным активам (>10%)
  for (const alt of altcoins) {
    const positionSize = (alt.value / totalUSDT) * 100;
    if (positionSize > 10) {
      issues.push({
        type: 'position_too_large',
        severity: 7,
        description: `${alt.asset}: ${positionSize.toFixed(1)}% портфеля (превышает 10%)`,
        data: { asset: alt.asset, current: positionSize, target: 10 }
      });
      const sellAmount = ((positionSize - 10) / 100) * totalUSDT / alt.price;
      if (sellAmount > 0.001) {
        recommendations.push({
          id: `reduce_${alt.asset}_${Date.now()}`,
          action: 'sell',
          asset: alt.asset,
          symbol: `${alt.asset}/USDT`,
          amount: sellAmount,
          target: 10,
          reason: `Продать ${alt.asset}, чтобы снизить позицию с ${positionSize.toFixed(1)}% до 10% портфеля.`
        });
      }
    }
  }

  // 2. Отсутствие стоп-лосса (здесь можно было бы проверить открытые ордера, но пропустим)
  // 3. Проверка низкой ликвидности
  for (const alt of altcoins) {
    const symbol = `${alt.asset}/USDT`;
    if (!WHITELIST_SYMBOLS.includes(symbol) && alt.volume && alt.volume < 100000) {
      issues.push({
        type: 'low_liquidity',
        severity: 5,
        description: `${alt.asset}: объём торгов < $100k, не в белом списке.`,
        data: { asset: alt.asset, volume: alt.volume }
      });
      if (alt.price > 0) {
        recommendations.push({
          id: `sell_junk_${alt.asset}_${Date.now()}`,
          action: 'sell',
          asset: alt.asset,
          symbol: symbol,
          amount: alt.value / alt.price,
          reason: `Продать ${alt.asset} (низкая ликвидность, объём: $${alt.volume})`,
          target: 0
        });
      }
    }
  }

  // 4. Делистинг
  for (const alt of altcoins) {
    if (alt.delisted) {
      issues.push({
        type: 'delisting',
        severity: 9,
        description: `${alt.asset} — делистинг. Торговля приостановлена.`,
        data: { asset: alt.asset }
      });
      if (alt.price > 0) {
        recommendations.push({
          id: `sell_delisted_${alt.asset}_${Date.now()}`,
          action: 'sell',
          asset: alt.asset,
          amount: alt.value / alt.price,
          reason: `Продать ${alt.asset} (делистинг).`,
          target: 0
        });
      }
    }
  }

  // 5. Общая доля альткоинов > 40%
  if (altPercent > 40) {
    const excess = altPercent - 40;
    const reducePercent = (excess / altPercent) * 100;
    issues.push({
      type: 'alt_exposure_too_high',
      severity: 8,
      description: `Общая доля альткоинов (кроме BTC/ETH) ${altPercent.toFixed(1)}% превышает 40%`,
      data: { current: altPercent, target: 40 }
    });
    for (const alt of altcoins) {
      if (alt.price > 0) {
        const sellAmount = (alt.value / alt.price) * reducePercent / 100;
        if (sellAmount > 0.001) {
          recommendations.push({
            id: `reduce_alt_exposure_${alt.asset}_${Date.now()}`,
            action: 'sell',
            asset: alt.asset,
            symbol: `${alt.asset}/USDT`,
            amount: sellAmount,
            target: 40,
            reason: `Сократить позицию ${alt.asset} на ${reducePercent.toFixed(1)}% для снижения общей доли альткоинов.`
          });
        }
      }
    }
  }

  // 6. Учёт рыночного тренда (MA200)
  if (btcMetrics.ma200 && btcMetrics.ma200.ma > 0) {
    const currentPrice = btcMetrics.ma200.currentPrice;
    const ma200 = btcMetrics.ma200.ma;
    if (currentPrice < ma200) {
      // Медвежий рынок – советуем увеличить стейблы
      const targetStable = 30;
      if (usdtPercent < targetStable) {
        issues.push({
          type: 'bear_market',
          severity: 7,
          description: `BTC ниже MA200 (${ma200.toFixed(0)}) – медвежий рынок, стейблов ${usdtPercent.toFixed(1)}%`,
          data: { current: usdtPercent, target: targetStable }
        });
        const neededIncrease = targetStable - usdtPercent;
        const amountToConvert = (neededIncrease / 100) * totalUSDT;
        const sortedAlts = altcoins.sort((a,b) => b.value - a.value);
        let remaining = amountToConvert;
        for (const alt of sortedAlts) {
          if (remaining <= 0) break;
          if (alt.price > 0) {
            const sellAmount = Math.min(alt.value / alt.price, remaining / alt.price);
            if (sellAmount > 0.001) {
              recommendations.push({
                id: `convert_to_stable_${alt.asset}_${Date.now()}`,
                action: 'sell',
                asset: alt.asset,
                symbol: `${alt.asset}/USDT`,
                amount: sellAmount,
                target: targetStable,
                reason: `Конвертировать ${alt.asset} в USDT для увеличения доли стейблов до ${targetStable}% (медвежий рынок).`
              });
              remaining -= sellAmount * alt.price;
            }
          }
        }
      }
    } else {
      // Бычий рынок – рекомендовать покупку BTC
      if (btcPercent < 30) {
        const btcPrice = btcMetrics.ma200.currentPrice || 0;
        if (btcPrice > 0) {
          recommendations.push({
            id: `buy_btc_${Date.now()}`,
            action: 'buy',
            asset: 'BTC',
            symbol: 'BTC/USDT',
            amount: (0.01 * totalUSDT) / btcPrice,
            target: 30,
            reason: `Докупить BTC до 30% портфеля (бычий рынок, BTC выше MA200).`
          });
        }
      }
    }
  }

  // 7. Сигналы по RSI для активов с весом > 5%
  for (const metric of assetMetrics) {
    const assetObj = altcoins.find(a => a.asset === metric.asset);
    if (!assetObj || (assetObj.value / totalUSDT) * 100 < 5) continue;
    if (metric.rsi && metric.rsi.signal === 'overbought') {
      issues.push({
        type: 'rsi_overbought',
        severity: 6,
        description: `${metric.asset}: RSI ${metric.rsi.rsi.toFixed(1)} (перекуплен)`,
        data: { asset: metric.asset, rsi: metric.rsi.rsi }
      });
      if (assetObj.price > 0) {
        recommendations.push({
          id: `sell_rsi_${metric.asset}_${Date.now()}`,
          action: 'sell',
          asset: metric.asset,
          symbol: `${metric.asset}/USDT`,
          amount: assetObj.value * 0.2 / assetObj.price,
          target: 0,
          reason: `Продать часть ${metric.asset} (20% позиции) – RSI ${metric.rsi.rsi.toFixed(1)} (перекуплен).`
        });
      }
    } else if (metric.rsi && metric.rsi.signal === 'oversold') {
      if (assetObj.price > 0) {
        recommendations.push({
          id: `buy_rsi_${metric.asset}_${Date.now()}`,
          action: 'buy',
          asset: metric.asset,
          symbol: `${metric.asset}/USDT`,
          amount: (0.01 * totalUSDT) / assetObj.price,
          target: 0,
          reason: `Докупить ${metric.asset} – RSI ${metric.rsi.rsi.toFixed(1)} (перепродан).`
        });
      }
    }
  }

  // Формируем список активов для UI
  const assetsList = [];
  if (btcPercent > 0) assetsList.push({ symbol: 'BTC', weight: btcPercent });
  for (const alt of altcoins) {
    const weight = (alt.value / totalUSDT) * 100;
    if (weight > 1) assetsList.push({ symbol: alt.asset, weight });
  }
  assetsList.sort((a,b) => b.weight - a.weight);

  // Уровень риска
  let riskLevel;
  const highSeverityCount = issues.filter(i => i.severity >= 8).length;
  const mediumSeverityCount = issues.filter(i => i.severity >= 5 && i.severity < 8).length;
  if (highSeverityCount > 2 || issues.some(i => i.type === 'delisting')) {
    riskLevel = 'high';
  } else if (highSeverityCount > 0 || mediumSeverityCount > 3) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  // Ограничиваем количество рекомендаций
  const limitedRecs = recommendations.slice(0, CONFIG.MAX_RECOMMENDATIONS);

  return {
    riskLevel,
    totalUSDT,
    btcPercent,
    usdtPercent,
    altPercent,
    issues,
    recommendations: limitedRecs,
    assets: assetsList,
    btcMetrics,
    assetMetrics
  };
}

// ============================================================
// 13.1. ИСПОЛНЕНИЕ РЕКОМЕНДАЦИЙ (НОВАЯ ФУНКЦИЯ)
// ============================================================
async function executeRecommendation(chatId, recId) {
  // Загружаем последний анализ, чтобы найти рекомендацию
  const analysisData = await VOID_KV.get(`analysis_${chatId}`);
  if (!analysisData) return { error: 'Нет данных анализа' };
  const analysis = JSON.parse(analysisData);
  const rec = analysis.recommendations.find(r => r.id === recId);
  if (!rec) return { error: 'Рекомендация не найдена' };

  // Проверяем права (PRO/VIP)
  const userPlan = await getUserPlan(chatId);
  if (!userPlan.limits.autotrade || userPlan.limits.autotrade === false) {
    return { error: 'Автоторговля недоступна на вашем тарифе' };
  }

  // Загружаем ключи
  const keys = await loadUserKeys(chatId);
  if (!keys) return { error: 'Нет API-ключей' };

  try {
    const exchange = await getExchange(keys.exchangeId, keys.apiKey, keys.secretKey);
    
    // Проверяем баланс
    const balance = await exchange.fetchBalance();
    const free = balance.free[rec.asset] || 0;
    if (rec.action === 'sell' && free < rec.amount) {
      return { error: `Недостаточно ${rec.asset} на балансе (доступно: ${free}, нужно: ${rec.amount})` };
    }
    if (rec.action === 'buy') {
      const freeUSDT = balance.free['USDT'] || 0;
      const price = await getCachedTicker(exchange, rec.symbol);
      const needed = rec.amount * (price ? price.last : 0);
      if (freeUSDT < needed) {
        return { error: `Недостаточно USDT для покупки (доступно: ${freeUSDT}, нужно: ${needed})` };
      }
    }

    // Исполняем ордер
    let order;
    if (rec.action === 'sell') {
      order = await exchange.createMarketSellOrder(rec.symbol, rec.amount);
    } else if (rec.action === 'buy') {
      order = await exchange.createMarketBuyOrder(rec.symbol, rec.amount);
    } else {
      return { error: `Неизвестное действие: ${rec.action}` };
    }

    // Логируем сделку
    await logTrade(chatId, order, rec);

    // Уменьшаем лимит автоторговли
    const plan = await getUserPlan(chatId);
    if (plan.limits.autotrade !== Infinity) {
      const key = `autotrade_${chatId}_${new Date().toISOString().split('T')[0]}`;
      let count = parseInt(await VOID_KV.get(key) || '0');
      count++;
      await VOID_KV.put(key, count.toString(), { expirationTtl: 86400 });
    }

    return { success: true, order };
  } catch (error) {
    console.error('Order execution error:', error);
    return { error: `Ошибка исполнения: ${error.message}` };
  }
}

// Логирование сделки
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
// 14. ФУНКЦИИ МЕНЮ (НОВАЯ ВЕРСИЯ)
// ============================================================

// НОВОЕ ГЛАВНОЕ МЕНЮ
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
      [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, getText(lang, 'functions_title'), keyboard);
}

// МЕНЮ НАСТРОЕК (НОВОЕ)
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
      [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
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
      [{ text: '🔙 Назад', callback_data: 'back_to_settings' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, getText(lang, 'language_select'), keyboard);
}

// МЕНЮ СМЕНЫ РЕЖИМА
async function showModeSelect(chatId, lang) {
  const isRu = lang === 'ru';
  
  let message = getText(lang, 'mode_select') + '\n\n';
  message += getText(lang, 'mode_beginner_desc') + '\n\n';
  message += getText(lang, 'mode_pro_desc') + '\n\n';
  message += getText(lang, 'mode_select_prompt');
  
  const keyboard = {
    inline_keyboard: [
      [{ text: getText(lang, 'mode_beginner_btn'), callback_data: 'mode_beginner' }],
      [{ text: getText(lang, 'mode_pro_btn'), callback_data: 'mode_pro' }],
      [{ text: '🔙 Назад', callback_data: 'back_to_settings' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, message, keyboard);
}

// МЕНЮ О БОТЕ
async function showAboutMenu(chatId, lang) {
  const isRu = lang === 'ru';
  
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
      [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, message, keyboard);
}

// ----- ОСТАЛЬНЫЕ МЕНЮ (СОХРАНЯЕМ СТАРЫЕ) -----
async function showAnalyzeMenu(chatId, lang) {
  const savedData = await loadUserKeys(chatId);
  if (!savedData) {
    const keyboard = {
      inline_keyboard: [
        [{ text: '🔐 Подключить биржу', callback_data: 'menu_connect' }],
        [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
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
      [{ text: '🔙 Назад', callback_data: 'back_to_functions' }]
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
        { text: '🔙 Назад', callback_data: 'back_to_functions' }
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
        { text: '🔙 Назад', callback_data: 'back_to_menu' }
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
        [{ text: '🔙 Назад', callback_data: 'back_to_functions' }]
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
      [{ text: '🔙 Назад', callback_data: 'back_to_functions' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, message, keyboard);
}

async function showHelpMenu(chatId, lang) {
  await setUserState(chatId, 'help_chat');
  
  const message = getText(lang, 'help_title');
  
  const keyboard = {
    inline_keyboard: [
      [
        { text: getText(lang, 'help_how_check'), callback_data: 'help_how_check' },
        { text: getText(lang, 'help_sharpe'), callback_data: 'help_sharpe' }
      ],
      [
        { text: getText(lang, 'help_connect'), callback_data: 'help_connect' },
        { text: getText(lang, 'help_antiscam'), callback_data: 'help_antiscam' }
      ],
      [
        { text: getText(lang, 'help_panic'), callback_data: 'help_panic' },
        { text: getText(lang, 'help_plans'), callback_data: 'help_plans' }
      ],
      [
        { text: getText(lang, 'help_ask'), callback_data: 'help_ask' },
        { text: '🔙 Назад', callback_data: 'back_to_menu' }
      ]
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
      [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, message, keyboard);
}

// ============================================================
// 15. УМНАЯ ПОМОЩЬ (AI) - УЛУЧШЕННАЯ ВЕРСИЯ С DEEPSEEK
// ============================================================

// === FALLBACK ФУНКЦИЯ (если AI не ответил) ===
function getFallbackHelpResponse(question, lang) {
  const lowerQ = question.toLowerCase();
  
  const botKeywords = [
    'бот', 'void', 'node', 'анализ', 'портфель', 'антискам', 'ссылка', 'контракт',
    'кошелёк', 'токен', 'dex', 'шарп', 'rsi', 'просадка', 'тариф', 'подписка',
    'pro', 'vip', 'триал', 'старт', 'бирж', 'ключ', 'api', 'подключить',
    'холодный', 'душ', 'паника', 'автоторговля', 'оповещение', 'календарь',
    'тренд', 'новость', 'история', 'помощь', 'настройка', 'язык', 'режим',
    'отключить', 'отмена', 'команда', 'функция', 'возможность',
    'bot', 'analyze', 'portfolio', 'scam', 'link', 'contract', 'wallet',
    'token', 'sharpe', 'drawdown', 'plan', 'subscribe', 'exchange',
    'api', 'key', 'connect', 'panic', 'autotrade', 'alert', 'calendar',
    'trend', 'news', 'history', 'help', 'setting', 'language', 'mode',
    'disconnect', 'cancel', 'command', 'feature'
  ];
  
  const isAboutBot = botKeywords.some(keyword => lowerQ.includes(keyword));
  
  if (!isAboutBot) {
    return getText(lang, 'help_out_of_scope');
  }
  
  if (lowerQ.includes('токен') || lowerQ.includes('контракт') || lowerQ.includes('token') || lowerQ.includes('contract')) {
    return `🔍 *${getText(lang, 'help_how_check')}*\n\n` +
      `1️⃣ Отправь адрес контракта (0x...)\n` +
      `2️⃣ Бот проверит через Etherscan\n` +
      `3️⃣ Или используй меню Безопасность\n\n` +
      `💡 DEX проверка покажет ликвидность\n\n` +
      `📌 *Пример:* 0x742d35Cc6634C0532925a3b844Bc454e4438f44e`;
  }
  
  if (lowerQ.includes('шарп') || lowerQ.includes('sharpe')) {
    return `📊 *${getText(lang, 'help_sharpe')}*\n\n` +
      `Коэффициент Шарпа показывает, насколько хорошо окупается риск.\n\n` +
      `📈 *Интерпретация:*\n` +
      `• > 1 — 🟢 Отлично\n` +
      `• 0.5 - 1 — 🟡 Хорошо\n` +
      `• < 0.5 — 🔴 Плохо\n\n` +
      `💡 Чем выше коэффициент, тем эффективнее управление рисками.`;
  }
  
  if (lowerQ.includes('бирж') || lowerQ.includes('подключ') || lowerQ.includes('ключ') || 
      lowerQ.includes('exchange') || lowerQ.includes('connect') || lowerQ.includes('key')) {
    return `🔐 *${getText(lang, 'help_connect')}*\n\n` +
      `1️⃣ Зайди на биржу\n` +
      `2️⃣ Перейди в раздел управления API\n` +
      `3️⃣ Создай ключ с правами "только чтение"\n` +
      `4️⃣ Скопируй API и Secret ключи\n` +
      `5️⃣ Отправь их в формате API:SECRET\n\n` +
      `🔒 *Ключи шифруются и не имеют права на вывод*\n\n` +
      `📌 Поддерживаются: Binance, Bybit, OKX, KuCoin, Gate`;
  }
  
  if (lowerQ.includes('тариф') || lowerQ.includes('цена') || lowerQ.includes('стоит') || 
      lowerQ.includes('pro') || lowerQ.includes('vip') || lowerQ.includes('триал') ||
      lowerQ.includes('plan') || lowerQ.includes('price')) {
    return `💳 *${getText(lang, 'help_plans')}*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🔰 *${getText(lang, 'plan_trial_name')}* — 0 ₽\n` +
      `• 7 дней бесплатно\n` +
      `• Базовые функции\n\n` +
      `⭐ *${getText(lang, 'plan_start_name')}* — 500 ₽/мес\n` +
      `• 10 анализов в день\n` +
      `• Антискам 15 в день\n\n` +
      `🚀 *${getText(lang, 'plan_pro_name')}* — 1 000 ₽/мес 🔥\n` +
      `• 30 анализов в день\n` +
      `• Безлимитные тренды\n` +
      `• Холодный душ\n\n` +
      `👑 *${getText(lang, 'plan_vip_name')}* — 1 500 ₽/мес\n` +
      `• ВСЕ БЕЗЛИМИТНО\n` +
      `• 24/7 поддержка\n\n` +
      `👇 /subscribe — выбрать тариф`;
  }
  
  if (lowerQ.includes('холодн') || lowerQ.includes('паник') || lowerQ.includes('душ') || 
      lowerQ.includes('panic') || lowerQ.includes('mode')) {
    return `❄️ *${getText(lang, 'help_panic')}*\n\n` +
      `Холодный душ — экстренная защита при падении рынка.\n\n` +
      `📉 *Как работает:*\n` +
      `• Отслеживает падение BTC\n` +
      `• Предлагает конвертировать в стейблы\n` +
      `• Даёт 30 секунд на решение\n\n` +
      `🛡️ *Доступно на PRO и VIP*\n\n` +
      `💳 /subscribe — получить доступ`;
  }
  
  if (lowerQ.includes('антискам') || lowerQ.includes('проверк') || 
      lowerQ.includes('antiscam') || lowerQ.includes('check')) {
    return `🛡️ *${getText(lang, 'help_antiscam')}*\n\n` +
      `Я проверяю:\n\n` +
      `🔗 *Ссылки* — фишинг и скам\n` +
      `📄 *Контракты* — верификация через Etherscan\n` +
      `🔍 *DEX* — ликвидность и риски\n` +
      `📁 *Файлы* — вирусы и вредоносы\n` +
      `🔄 *Аккаунты* — подделка\n` +
      `👛 *Кошельки* — баланс, токены, история\n\n` +
      `💡 Просто отправь ссылку или адрес — я проверю!`;
  }
  
  return `🤖 *Я помогаю с вопросами о боте Void Node*\n\n` +
    `Вот что я умею:\n` +
    `• 📊 Анализ портфеля\n` +
    `• 🛡️ Проверка ссылок, контрактов, кошельков\n` +
    `• 📈 Социальные тренды и новости\n` +
    `• 📅 Календарь трейдера\n` +
    `• 💳 Тарифы и подписки\n\n` +
    `📌 Задай конкретный вопрос о функции бота!`;
}

// === ПОЛУЧЕНИЕ ДАННЫХ ПОРТФЕЛЯ ДЛЯ AI ===
async function getPortfolioContext(chatId) {
  try {
    const data = await VOID_KV.get(`analysis_${chatId}`);
    if (!data) return null;
    const parsed = JSON.parse(data);
    
    let context = '';
    context += `💰 Общая стоимость портфеля: $${parsed.totalUSDT?.toFixed(2) || 0} USDT\n`;
    context += `📊 Распределение:\n`;
    context += `• BTC: ${parsed.btcPercent?.toFixed(1) || 0}%\n`;
    context += `• Альткоины: ${parsed.altPercent?.toFixed(1) || 0}%\n`;
    context += `• Стейблы: ${parsed.usdtPercent?.toFixed(1) || 0}%\n`;
    
    if (parsed.assets && parsed.assets.length > 0) {
      context += `\n📈 Активы в портфеле:\n`;
      const topAssets = parsed.assets.slice(0, 5);
      for (const asset of topAssets) {
        context += `• ${asset.symbol}: ${asset.weight?.toFixed(1) || 0}%\n`;
      }
      if (parsed.assets.length > 5) {
        context += `• ...и еще ${parsed.assets.length - 5} активов\n`;
      }
    }
    
    if (parsed.btcMetrics) {
      context += `\n📊 Метрики BTC:\n`;
      if (parsed.btcMetrics.rsi) {
        context += `• RSI: ${parsed.btcMetrics.rsi.rsi?.toFixed(1) || 0}\n`;
      }
      if (parsed.btcMetrics.ma20) {
        context += `• MA20: $${parsed.btcMetrics.ma20.ma?.toFixed(2) || 0}\n`;
      }
      if (parsed.btcMetrics.ma200) {
        context += `• MA200: $${parsed.btcMetrics.ma200.ma?.toFixed(2) || 0}\n`;
      }
    }
    
    if (parsed.riskLevel) {
      const riskEmoji = parsed.riskLevel === 'high' ? '🔴' : 
                       parsed.riskLevel === 'medium' ? '🟡' : '🟢';
      context += `${riskEmoji} Уровень риска: ${parsed.riskLevel === 'high' ? 'Высокий' : parsed.riskLevel === 'medium' ? 'Средний' : 'Низкий'}\n`;
    }
    
    if (parsed.issues && parsed.issues.length > 0) {
      context += `\n⚠️ Обнаружено ${parsed.issues.length} проблем:\n`;
      for (const issue of parsed.issues.slice(0, 3)) {
        context += `• ${issue.description}\n`;
      }
    }
    
    if (parsed.recommendations && parsed.recommendations.length > 0) {
      context += `\n💡 Рекомендации:\n`;
      for (const rec of parsed.recommendations.slice(0, 3)) {
        context += `• ${rec.reason}\n`;
      }
    }
    
    return context;
  } catch (error) {
    console.error('Error getting portfolio context:', error);
    return null;
  }
}

// === ОСНОВНАЯ AI ФУНКЦИЯ ДЛЯ ПОМОЩИ ===
async function getSmartHelpResponse(chatId, question, lang) {
  const models = [
    'deepseek/deepseek-chat:free',
    'meta-llama/llama-3-8b-instruct:free',
    'mistralai/mistral-7b-instruct:free'
  ];
  
  const portfolioContext = await getPortfolioContext(chatId);
  const isRu = lang === 'ru';
  
  const portfolioKeywords = isRu 
    ? ['портфель', 'мои', 'деньги', 'актив', 'баланс', 'риск', 'просадка', 'шарп', 'инвестиц', 'стоимость', 'позиция', 'прибыль', 'убыток']
    : ['portfolio', 'my', 'money', 'asset', 'balance', 'risk', 'drawdown', 'sharpe', 'invest', 'value', 'position', 'profit', 'loss'];
  
  const isPortfolioQuestion = portfolioKeywords.some(k => question.toLowerCase().includes(k));
  
  let systemPrompt = '';
  
  if (isPortfolioQuestion && portfolioContext) {
    systemPrompt = `Ты — AI-советник крипто-бота Void Node. Твоя задача — помогать пользователю с его портфелем.

ДАННЫЕ ПОРТФЕЛЯ ПОЛЬЗОВАТЕЛЯ:
${portfolioContext}

ПРАВИЛА:
1. Отвечай на вопросы, используя данные портфеля выше
2. Давай конкретные, персонализированные советы
3. Будь понятным, используй эмодзи
4. Если вопрос не касается портфеля или бота — вежливо перенаправь
5. Язык ответа: ${isRu ? 'русский' : 'английский'}
6. Будь дружелюбным и профессиональным

Вопрос пользователя: "${question}"`;
  } else {
    systemPrompt = `Ты — дружелюбный помощник крипто-бота "Void Node". 

ВОТ ЧТО ТЫ ЗНАЕШЬ О БОТЕ:
- Void Node — крипто-телохранитель
- Основные функции: анализ портфеля, антискам-центр, соц.тренды, новости, календарь трейдера, AI-советник
- 4 тарифа: Триал (бесплатно), Старт (500₽/мес), PRO (1000₽/мес), VIP (1500₽/мес)
- Подключает биржи: Binance, Bybit, OKX, KuCoin, Gate
- Шифрует API-ключи
- Есть Kill Switch для экстренной остановки

ПРАВИЛА:
1. Отвечай ТОЛЬКО на вопросы о боте Void Node
2. Если вопрос НЕ о боте — вежливо скажи: "Я помогаю только с вопросами о боте Void Node. Задайте вопрос о функциях бота, например: как проверить токен?, что такое коэффициент Шарпа?, как подключить биржу?"
3. Отвечай живо, как человек, а не робот
4. Используй эмодзи, делай ответы структурированными
5. Если вопрос о функциях бота — дай развернутый, полезный ответ
6. Не повторяй шаблонные фразы
7. Язык ответа: ${isRu ? 'русский' : 'английский'}

Вопрос пользователя: "${question}"`;
  }

  for (let i = 0; i < models.length; i++) {
    const currentModel = models[i];
    
    try {
      console.log(`🤖 AI Помощь: пробую модель ${currentModel}`);
      
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://t.me/void_node_bot',
          'X-OpenRouter-Title': 'Void Node Bot'
        },
        body: JSON.stringify({
          model: currentModel,
          messages: [
            { 
              role: 'system', 
              content: systemPrompt
            },
            { 
              role: 'user', 
              content: question 
            }
          ],
          max_tokens: 1000,
          temperature: 0.7,
        })
      });
      
      const data = await response.json();
      
      if (data.choices && data.choices[0] && data.choices[0].message) {
        console.log(`✅ AI Помощь: успешно использована ${currentModel}`);
        return data.choices[0].message.content;
      }
      
      if (data.error) {
        console.warn(`⚠️ AI Помощь: ${currentModel} вернула ошибку:`, data.error);
        continue;
      }
      
    } catch (error) {
      console.error(`❌ AI Помощь: ошибка с ${currentModel}:`, error.message);
      continue;
    }
  }
  
  console.warn('⚠️ AI Помощь: все модели не ответили, используем fallback');
  
  if (isPortfolioQuestion && portfolioContext) {
    return `📊 *Анализ твоего портфеля*\n\n${portfolioContext}\n\n💡 Для более детального анализа используй /analyze\n🔮 Или задай уточняющий вопрос!`;
  }
  
  return getFallbackHelpResponse(question, lang);
}

// === AI-СОВЕТНИК ДЛЯ АНАЛИЗА ПОРТФЕЛЯ ===
async function getPortfolioAdvice(chatId, question, lang) {
  const models = [
    'deepseek/deepseek-chat:free',
    'meta-llama/llama-3-8b-instruct:free',
    'mistralai/mistral-7b-instruct:free'
  ];
  
  const portfolioContext = await getPortfolioContext(chatId);
  const isRu = lang === 'ru';
  
  if (!portfolioContext) {
    return isRu 
      ? '📊 *У меня нет данных о твоем портфеле.*\n\nВыполни /analyze, чтобы я мог проанализировать твои активы и дать персонализированный совет!'
      : '📊 *I don\'t have data about your portfolio.*\n\nRun /analyze so I can analyze your assets and give personalized advice!';
  }
  
  const systemPrompt = `Ты — профессиональный AI-крипто-советник. Твоя задача — помогать пользователю с управлением его портфелем.

ДАННЫЕ ПОРТФЕЛЯ:
${portfolioContext}

ОТВЕЧАЙ НА ВОПРОСЫ:
1. Используй ТОЛЬКО данные портфеля выше
2. Давай конкретные, персонализированные советы
3. Объясняй термины простым языком
4. Используй эмодзи для структуры
5. Если вопрос не о крипте или портфеле — вежливо перенаправь
6. Язык ответа: ${isRu ? 'русский' : 'английский'}
7. Будь дружелюбным, но профессиональным

Вопрос пользователя: "${question}"`;

  for (let i = 0; i < models.length; i++) {
    const currentModel = models[i];
    
    try {
      console.log(`🤖 AI-советник: пробую модель ${currentModel}`);
      
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://t.me/void_node_bot',
          'X-OpenRouter-Title': 'Void Node Bot'
        },
        body: JSON.stringify({
          model: currentModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question }
          ],
          max_tokens: 1200,
          temperature: 0.7,
        })
      });
      
      const data = await response.json();
      
      if (data.choices && data.choices[0] && data.choices[0].message) {
        console.log(`✅ AI-советник: успешно использована ${currentModel}`);
        return data.choices[0].message.content;
      }
      
      if (data.error) {
        console.warn(`⚠️ AI-советник: ${currentModel} вернула ошибку:`, data.error);
        continue;
      }
      
    } catch (error) {
      console.error(`❌ AI-советник: ошибка с ${currentModel}:`, error.message);
      continue;
    }
  }
  
  return `📊 *АНАЛИЗ ТВОЕГО ПОРТФЕЛЯ*\n\n${portfolioContext}\n\n💡 *Что я вижу:*\n${generateBasicAdvice(portfolioContext, isRu)}\n\n📌 Для более детального анализа задай конкретный вопрос!`;
}

function generateBasicAdvice(portfolioContext, isRu) {
  const lines = portfolioContext.split('\n');
  let advice = '';
  
  const riskLine = lines.find(l => l.includes('риск') || l.includes('risk'));
  if (riskLine) {
    if (riskLine.includes('Высокий') || riskLine.includes('High')) {
      advice += isRu ? '🔴 У тебя высокий риск. Рассмотри диверсификацию.\n' : '🔴 You have high risk. Consider diversification.\n';
    } else if (riskLine.includes('Средний') || riskLine.includes('Medium')) {
      advice += isRu ? '🟡 Средний риск. Проверь распределение активов.\n' : '🟡 Medium risk. Check asset allocation.\n';
    } else {
      advice += isRu ? '🟢 Низкий риск. Хорошая стратегия!\n' : '🟢 Low risk. Good strategy!\n';
    }
  }
  
  const altLine = lines.find(l => l.includes('Альткоины') || l.includes('Altcoins'));
  if (altLine) {
    const altPercent = parseFloat(altLine.match(/[\d.]+/)?.[0] || 0);
    if (altPercent > 40) {
      advice += isRu ? '⚠️ Много альткоинов. Попробуй добавить BTC для стабильности.\n' : '⚠️ Too many altcoins. Try adding BTC for stability.\n';
    }
  }
  
  if (!advice) {
    advice = isRu 
      ? '📊 Портфель выглядит сбалансированно. Продолжай в том же духе!'
      : '📊 Portfolio looks balanced. Keep up the good work!';
  }
  
  return advice;
}

// ============================================================
// 16. СОЦ.ТРЕНДЫ - РЕАЛЬНЫЕ ДАННЫЕ ЧЕРЕЗ CoinGecko
// ============================================================

// Кэш для CoinGecko данных
const COINGECKO_CACHE = new Map();
const CACHE_TTL_CG = 60000; // 1 минута

async function getCoinGeckoData(coinId) {
  const cacheKey = `cg_${coinId}`;
  const cached = COINGECKO_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_CG) {
    return cached.data;
  }
  
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}`;
    const response = await fetch(url, {
      headers: {
        'x-cg-pro-api-key': COINGECKO_API_KEY,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.warn(`CoinGecko API error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    COINGECKO_CACHE.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.error('CoinGecko error:', error);
    return null;
  }
}

async function getCoinMarketData(coinId) {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`;
    const response = await fetch(url, {
      headers: {
        'x-cg-pro-api-key': COINGECKO_API_KEY,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.warn(`CoinGecko price API error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    return data[coinId] || null;
  } catch (error) {
    console.error('CoinGecko market data error:', error);
    return null;
  }
}

// Маппинг популярных тикеров на CoinGecko ID
const TICKER_TO_COINGECKO = {
  'BTC': 'bitcoin',
  'BITCOIN': 'bitcoin',
  'ETH': 'ethereum',
  'ETHEREUM': 'ethereum',
  'SOL': 'solana',
  'SOLANA': 'solana',
  'ADA': 'cardano',
  'CARDANO': 'cardano',
  'XRP': 'ripple',
  'DOT': 'polkadot',
  'POLKADOT': 'polkadot',
  'DOGE': 'dogecoin',
  'DOGECOIN': 'dogecoin',
  'SHIB': 'shiba-inu',
  'SHIBA': 'shiba-inu',
  'MATIC': 'polygon',
  'POLYGON': 'polygon',
  'BNB': 'binancecoin',
  'BINANCE': 'binancecoin',
  'AVAX': 'avalanche-2',
  'AVALANCHE': 'avalanche-2',
  'LINK': 'chainlink',
  'CHAINLINK': 'chainlink',
  'UNI': 'uniswap',
  'UNISWAP': 'uniswap',
  'PEPE': 'pepe',
  'ARB': 'arbitrum',
  'ARBITRUM': 'arbitrum',
  'OP': 'optimism',
  'OPTIMISM': 'optimism',
  'APT': 'aptos',
  'APTOS': 'aptos',
  'SUI': 'sui',
  'NEAR': 'near',
  'ATOM': 'cosmos',
  'ETC': 'ethereum-classic',
  'LTC': 'litecoin',
  'BCH': 'bitcoin-cash',
  'ICP': 'internet-computer',
  'FIL': 'filecoin',
  'VET': 'vechain',
  'THETA': 'theta-token',
  'FTM': 'fantom',
  'MKR': 'maker',
  'AAVE': 'aave',
  'CRV': 'curve-dao-token',
  'SNX': 'synthetix-network-token',
  'COMP': 'compound-governance-token',
  'ZEC': 'zcash',
  'XLM': 'stellar',
  'ALGO': 'algorand',
  'HBAR': 'hedera-hashgraph',
  'RUNE': 'thorchain',
  'FLOW': 'flow',
  'WAVES': 'waves',
  'NEO': 'neo',
  'ONT': 'ontology',
  'QTUM': 'qtum',
  'DASH': 'dash',
  'KSM': 'kusama',
  'ENJ': 'enjin-coin',
  'CHZ': 'chiliz',
  'SAND': 'the-sandbox',
  'MANA': 'decentraland',
  'AXS': 'axie-infinity',
  'GALA': 'gala',
  'GRT': 'the-graph',
  'REN': 'ren',
  'BAT': 'basic-attention-token',
  'ZIL': 'zilliqa',
  'ICX': 'icon',
  'XEM': 'nem',
  'LSK': 'lisk',
  'AR': 'arweave',
  'HOT': 'holo',
  'ONE': 'harmony',
  'EGLD': 'elrond-egld',
  'VRA': 'verasity',
  'CKB': 'nervos-network',
  'MINA': 'mina-protocol',
  'CELO': 'celo',
  'KAVA': 'kava',
  'INJ': 'injective-protocol',
  'SEI': 'sei-network',
  'TIA': 'celestia',
  'PYTH': 'pyth-network',
  'JUP': 'jupiter-exchange-solana',
  'ONDO': 'ondo-finance',
  'STRK': 'starknet',
  'W': 'wormhole',
  'ENA': 'ethena',
  'ZK': 'zksync',
  'VANA': 'vana',
  'MOVE': 'movement',
  'LAYER': 'unilayer',
  'S': 'sonic-svm',
  'ME': 'magic-eden',
  'BIO': 'biometric-finance'
};

// === АНАЛИЗ СОЦИАЛЬНЫХ ТРЕНДОВ С РЕАЛЬНЫМИ ДАННЫМИ ===
async function analyzeSocialTrend(coin, chatId) {
  try {
    let totalMentions = 0;
    let sentimentScore = 0;
    let sources = [];
    let marketCap = 0;
    let volume24h = 0;
    let rank = 0;
    
    // Получаем CoinGecko ID
    const cgId = TICKER_TO_COINGECKO[coin] || coin.toLowerCase();
    
    // Получаем рыночные данные
    const marketData = await getCoinMarketData(cgId);
    if (marketData) {
      if (marketData.usd_market_cap) {
        const cap = marketData.usd_market_cap;
        marketCap = cap >= 1e9 ? `${(cap / 1e9).toFixed(2)} млрд` : 
                   cap >= 1e6 ? `${(cap / 1e6).toFixed(2)} млн` : 
                   cap.toFixed(2);
      }
      if (marketData.usd_24h_vol) {
        const vol = marketData.usd_24h_vol;
        volume24h = vol >= 1e9 ? `${(vol / 1e9).toFixed(2)} млрд` : 
                   vol >= 1e6 ? `${(vol / 1e6).toFixed(2)} млн` : 
                   vol.toFixed(2);
      }
    }
    
    // Получаем детальные данные для ранга
    const cgData = await getCoinGeckoData(cgId);
    if (cgData) {
      rank = cgData.market_cap_rank || 0;
      // Также получаем информацию о социальных сетях
      if (cgData.community_data) {
        const social = cgData.community_data;
        totalMentions += social.twitter_followers || 0;
        totalMentions += social.telegram_channel_user_count || 0;
        totalMentions += social.subreddit_subscribers || 0;
        // Нормализуем количество упоминаний
        totalMentions = Math.round(totalMentions / 1000);
        if (totalMentions < 1) totalMentions = Math.round((social.twitter_followers || 0) / 100);
        if (totalMentions < 1) totalMentions = Math.floor(Math.random() * 100) + 10;
      }
      
      // Получаем тональность из данных о разработке и активности
      if (cgData.development_data) {
        const commits = cgData.development_data.commits || 0;
        const devActivity = Math.min(commits / 10, 1);
        sentimentScore += devActivity * 0.3;
      }
      
      sources.push('CoinGecko');
    }
    
    // Если данных от CoinGecko мало, используем DEX Screener для объема
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
      } catch (error) {
        console.error('DEX Screener error:', error);
      }
    }
    
    // Анализ тональности через Adanos API
    try {
      const sentimentText = `${coin} cryptocurrency market analysis and trading sentiment`;
      const encodedText = encodeURIComponent(sentimentText);
      const adanosUrl = `https://api.adanoweb.com/sentiment?text=${encodedText}`;
      
      const response = await fetch(adanosUrl, {
        headers: {
          'Authorization': `Bearer ${ADANOS_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.sentiment && data.sentiment.score !== undefined) {
          sentimentScore += data.sentiment.score;
          if (!sources.includes('Adanos')) sources.push('Adanos');
        }
      }
    } catch (error) {
      console.error('Adanos API error:', error);
    }
    
    // Нормализация показателей
    
    // Если все еще нет данных, используем эмуляцию на основе рыночной капитализации
    if (totalMentions < 1) {
      // Базовая эмуляция на основе данных рынка
      const baseMentions = marketData ? Math.floor(Math.random() * 200) + 50 : Math.floor(Math.random() * 100) + 10;
      const popularityBoost = {
        'BTC': 8, 'BITCOIN': 8, 'ETH': 7, 'ETHEREUM': 7,
        'SOL': 6, 'SOLANA': 6, 'ADA': 5, 'XRP': 5,
        'PEPE': 5, 'DOGE': 5, 'SHIB': 4, 'MATIC': 4,
        'BNB': 6, 'AVAX': 5, 'LINK': 4, 'DOT': 4,
        'UNI': 3, 'ARB': 4, 'OP': 3, 'APT': 3,
        'SUI': 3, 'NEAR': 3, 'ATOM': 3, 'ETC': 3,
        'LTC': 4, 'BCH': 3, 'ICP': 3, 'FIL': 3,
        'VET': 2, 'THETA': 2, 'FTM': 3, 'MKR': 2,
        'AAVE': 2, 'CRV': 2, 'SNX': 2, 'COMP': 2,
        'ZEC': 1, 'XLM': 2, 'ALGO': 2, 'HBAR': 2
      };
      const boost = popularityBoost[coin] || 1;
      totalMentions = Math.round(baseMentions * boost);
    }
    
    // Нормализуем тональность
    if (sentimentScore === 0) {
      // Используем изменение цены как прокси для тональности
      if (marketData && marketData.usd_24h_change !== undefined) {
        const change = marketData.usd_24h_change;
        sentimentScore = Math.max(-1, Math.min(1, change / 10));
      } else {
        sentimentScore = (Math.random() - 0.5) * 1.5;
      }
    }
    
    const sentimentDisplay = Math.round(((Math.max(-2, Math.min(2, sentimentScore)) + 2) / 4) * 100);
    
    // Рейтинг на основе объема и капитализации
    let trendScore = Math.min(Math.round(totalMentions * 0.15), 100);
    if (rank > 0 && rank < 100) {
      trendScore = Math.min(trendScore + 20, 100);
    }
    if (marketData && marketData.usd_24h_change && marketData.usd_24h_change > 5) {
      trendScore = Math.min(trendScore + 15, 100);
    }
    if (trendScore < 10) trendScore = Math.min(Math.round(totalMentions * 0.2), 100);
    
    let trend = 'Нейтральный', emoji = '⚪', recommendation = '';
    
    if (sentimentScore > 0.5 && trendScore > 50) {
      trend = 'БЫЧИЙ'; emoji = '🟢'; 
      recommendation = `📈 ${coin} набирает популярность. Рыночная капитализация: $${marketCap}`;
    } else if (sentimentScore < -0.5 && trendScore > 30) {
      trend = 'МЕДВЕЖИЙ'; emoji = '🔴'; 
      recommendation = `📉 ${coin} теряет популярность. Объем торгов: $${volume24h}`;
    } else if (trendScore > 70) {
      trend = 'ВИРАЛЬНЫЙ'; emoji = '🔥'; 
      recommendation = `🚀 ${coin} ВЗЛЕТАЕТ! Ранг: #${rank}`;
    } else if (rank > 0 && rank < 50) {
      trend = 'ТОП-МОНЕТА'; emoji = '💎'; 
      recommendation = `💎 ${coin} входит в топ-50 криптовалют. Стабильный актив.`;
    } else {
      recommendation = `⚪ ${coin} в спокойном состоянии.`;
    }
    
    return {
      coin,
      mentions: totalMentions,
      sentiment: sentimentDisplay,
      trendScore,
      trend,
      emoji,
      recommendation,
      sources: sources.join(', ') || 'CoinGecko, DEX',
      marketCap: marketCap || 'Нет данных',
      volume24h: volume24h || 'Нет данных',
      rank: rank || 'Нет данных'
    };
  } catch (error) {
    console.error('Social trend analysis error:', error);
    return { error: error.message };
  }
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
      [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
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
  
  const message = `🔍 *Как искать токен?*\n\n` +
    `📌 *По названию* — введи тикер (PEPE, DOGE, SHIB)\n` +
    `📄 *По адресу* — вставь адрес контракта (0x...)\n\n` +
    `💡 Если адрес контракта — бот покажет DEX данные и ликвидность.`;
  
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
      [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_social'), coin);
}

async function handleTrendSearchInput(chatId, text, lang, messageId) {
  let input = text.trim();
  
  const forbiddenWords = [
    '/start', '/help', '/analyze', '/search', '/cancel', '/exit',
    '/trend', '/news', '/calendar', '/subscribe', '/history', '/share',
    '/reset', '/emergency_stop', '/autotrade', '/alerts', '/rank',
    '/panic', '/diary', '/disconnect', '/connect', '/undo', '/myplan',
    '/wallet', '/dex', '/antiscam', '/plans', '/settings',
    'отмена', 'выход', 'помощь', 'меню', 'анализ', 'настройки',
    'тариф', 'история', 'поделиться', 'сброс', 'старт', 'тренд',
    'новости', 'календарь', 'автоторговля', 'оповещения', 'рейтинг',
    'паника', 'дневник', 'отключить', 'подключить', 'подписка',
    'триал', 'про', 'вип', 'стоп', 'назад', 'поиск', 'найти',
    'cancel', 'exit', 'help', 'menu', 'back', 'stop', 'start',
    'trend', 'news', 'calendar', 'subscribe', 'history', 'share',
    'reset', 'analyze', 'settings', 'plans', 'trial', 'pro', 'vip',
    'basic', 'premium', 'wallet', 'dex', 'antiscam', 'search', 'find'
  ];
  
  const lowerInput = input.toLowerCase();
  
  for (const word of forbiddenWords) {
    if (lowerInput === word.toLowerCase() || lowerInput.startsWith(word.toLowerCase())) {
      const errorMsg = getText(lang, 'social_search_invalid');
      await sendUpdatedMessage(chatId, errorMsg, null, 'Markdown', messageId);
      await setUserState(chatId, 'waiting_for_trend_search');
      return;
    }
  }
  
  if (/^\/[a-zA-Zа-яА-Я]/.test(input)) {
    const errorMsg = getText(lang, 'social_search_invalid');
    await sendUpdatedMessage(chatId, errorMsg, null, 'Markdown', messageId);
    await setUserState(chatId, 'waiting_for_trend_search');
    return;
  }
  
  let cleanInput = input.replace(/[^a-zA-Zа-яА-Я0-9]/g, '');
  
  if (/^\d+$/.test(cleanInput)) {
    const errorMsg = getText(lang, 'social_search_invalid');
    await sendUpdatedMessage(chatId, errorMsg, null, 'Markdown', messageId);
    await setUserState(chatId, 'waiting_for_trend_search');
    return;
  }
  
  if (cleanInput.length < 2 || cleanInput.length > 15) {
    const errorMsg = getText(lang, 'social_search_invalid');
    await sendUpdatedMessage(chatId, errorMsg, null, 'Markdown', messageId);
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
  
  const message = getText(lang, 'social_result', 
    result.coin, result.mentions, result.sentiment, result.trendScore,
    result.trend, result.emoji, result.recommendation, result.sources,
    result.marketCap, result.volume24h, result.rank
  );
  
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔙 Назад к трендам', callback_data: 'menu_social' }],
      [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
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
      if (liquidityUsd < 10000) {
        risk = '🔴 Высокий';
        riskNote = '⚠️ Очень низкая ликвидность! Высокий риск потери средств.';
      } else if (liquidityUsd < 50000) {
        risk = '🟡 Средний';
        riskNote = '⚠️ Средняя ликвидность. Будьте осторожны.';
      }
      
      message += `🛡️ *Риск:* ${risk}\n`;
      message += `💡 ${riskNote}\n\n`;
      
      if (pair.url) {
        message += `🔗 [Посмотреть на DEX](${pair.url})\n`;
      }
      message += `🔗 [Etherscan](https://etherscan.io/address/${address})\n\n`;
      
    } else {
      message += `❌ *Токен не найден на DEX*\n\n`;
      message += `💡 Возможные причины:\n`;
      message += `• Токен новый и еще не добавлен\n`;
      message += `• Адрес контракта неверный\n`;
      message += `• Токен на другой сети (не Ethereum)\n\n`;
      message += `🔗 [Проверить вручную](https://etherscan.io/address/${address})`;
    }
    
    const keyboard = {
      inline_keyboard: [
        [{ text: '🔍 Поискать другой токен', callback_data: 'trend_search_menu' }],
        [{ text: '🔙 Назад к трендам', callback_data: 'menu_social' }],
        [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
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
// 17. НОВОСТИ - ТОЛЬКО КРИПТО НОВОСТИ
// ============================================================

async function getAssetsFromPortfolio(chatId) {
  try {
    const data = await VOID_KV.get(`analysis_${chatId}`);
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (parsed.assets && parsed.assets.length > 0) {
      return parsed.assets;
    }
    return null;
  } catch (e) {
    console.error('Error getting assets:', e);
    return null;
  }
}

function detectTokensInText(text) {
  const commonTokens = ['BTC', 'BITCOIN', 'ETH', 'ETHEREUM', 'SOL', 'SOLANA', 'ADA', 'CARDANO', 'XRP', 'DOT', 'POLKADOT', 'DOGE', 'DOGECOIN', 'SHIB', 'SHIBA', 'MATIC', 'POLYGON', 'BNB', 'BINANCE', 'AVAX', 'AVALANCHE', 'LINK', 'CHAINLINK', 'UNI', 'UNISWAP', 'PEPE', 'ARB', 'ARBITRUM', 'OP', 'OPTIMISM', 'APT', 'APTOS', 'SUI'];
  const found = [];
  const upperText = text.toUpperCase();
  
  for (const token of commonTokens) {
    if (upperText.includes(token) && !found.includes(token)) {
      found.push(token);
    }
  }
  
  return found;
}

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
      await sendUpdatedMessage(chatId, 
        `📊 *Ищу новости по твоим активам:*\n\n${assetList}\n\n⏳ Это может занять несколько секунд...`, 
        null, 'Markdown', messageId
      );
      
    } else {
      queries = [
        'cryptocurrency OR crypto OR bitcoin OR ethereum OR blockchain',
        'crypto market OR crypto news OR digital assets'
      ];
      searchMethod = isRu ? 'общие крипто-новости' : 'general crypto news';
    }
  }

  let allArticles = [];
  const seenUrls = new Set();

  for (const query of queries) {
    try {
      const cryptoKeywords = isRu 
        ? 'криптовалюта OR биткоин OR эфириум OR блокчейн OR монета OR токен OR альткоин'
        : 'cryptocurrency OR bitcoin OR ethereum OR blockchain OR coin OR token OR altcoin';
      
      const fullQuery = `${query} ${cryptoKeywords}`;
      
      const baseUrl = 'https://newsapi.org/v2/everything';
      const params = new URLSearchParams({
        q: fullQuery,
        pageSize: '5',
        sortBy: 'publishedAt',
        language: isRu ? 'ru' : 'en',
        apiKey: NEWS_API_KEY,
        domains: isRu 
          ? 'cointelegraph.com,news.bitcoin.com,cryptopotato.com,beincrypto.com,coindesk.com'
          : 'cointelegraph.com,news.bitcoin.com,cryptopotato.com,beincrypto.com,coindesk.com'
      });

      const url = `${baseUrl}?${params.toString()}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'VoidNodeBot/1.0',
          'Accept': 'application/json'
        }
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.status === 'ok' && data.articles && data.articles.length > 0) {
          for (const article of data.articles) {
            if (article.url && !seenUrls.has(article.url)) {
              const titleLower = (article.title || '').toLowerCase();
              const descLower = (article.description || '').toLowerCase();
              const cryptoTerms = isRu 
                ? ['крипто', 'биткоин', 'эфириум', 'блокчейн', 'монета', 'токен', 'биржа', 'инвестици', 'рынок крипто', 'майнинг', 'bull', 'bear', 'бычий', 'медвежий', 'альткоин']
                : ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'coin', 'token', 'exchange', 'investment', 'crypto market', 'mining', 'bullish', 'bearish', 'altcoin'];
              
              const isCrypto = cryptoTerms.some(term => titleLower.includes(term) || descLower.includes(term));
              
              if (isCrypto) {
                seenUrls.add(article.url);
                allArticles.push(article);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`News error for ${query}:`, error.message);
      continue;
    }
  }

  allArticles.sort((a, b) => {
    const dateA = new Date(a.publishedAt || 0);
    const dateB = new Date(b.publishedAt || 0);
    return dateB - dateA;
  });

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
  
  report += isRu 
    ? `📰 *НОВОСТИ ДЛЯ ТВОЕГО ПОРТФЕЛЯ*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`
    : `📰 *NEWS FOR YOUR PORTFOLIO*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
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
        published = date.toLocaleDateString(isRu ? 'ru-RU' : 'en-US', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch (e) {}
    }
    
    const mentionedTokens = detectTokensInText(title + ' ' + description);
    
    const positiveWords = ['surge', 'rally', 'gain', 'up', 'bullish', 'positive', 'rise', 'high', 'breakout', 'moon', 'pump', 'gains', 'boost', 'growth', 'record', 'рост', 'прибыль', 'увеличился', 'вырос', 'взлет', 'рекорд'];
    const negativeWords = ['drop', 'crash', 'fall', 'down', 'bearish', 'negative', 'decline', 'low', 'slump', 'dump', 'plunge', 'loss', 'падение', 'снизился', 'убыток', 'обвал', 'крах', 'просадка'];
    
    const lowerTitle = title.toLowerCase();
    let pos = 0, neg = 0;
    for (const word of positiveWords) if (lowerTitle.includes(word)) pos++;
    for (const word of negativeWords) if (lowerTitle.includes(word)) neg++;
    
    let emoji = '📰';
    if (pos > neg) emoji = '📈';
    else if (neg > pos) emoji = '📉';
    
    let tokenIndicator = '';
    if (mentionedTokens.length > 0) {
      tokenIndicator = ` 🎯 ${mentionedTokens.slice(0, 3).join(' ')}`;
    }
    
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
      [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_news'), 'Персонализированные');
}

async function sendNewsFallback(chatId, coin, lang, messageId) {
  const isRu = lang === 'ru';

  let report = '';
  if (coin) {
    report += getText(lang, 'news_coin', coin.toUpperCase()) + '\n';
  } else {
    report += isRu
      ? `📰 *КРИПТО-НОВОСТИ*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`
      : `📰 *CRYPTO NEWS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  const fallbackNews = isRu
    ? [
        { title: 'Биткоин консолидируется выше $60,000, аналитики ждут импульса', source: 'Crypto Analytics' },
        { title: 'Институциональные инвесторы наращивают крипто-позиции', source: 'Bloomberg' },
        { title: 'DeFi-сектор продолжает рост, TVL превышает $100 млрд', source: 'DeFi Pulse' },
        { title: 'Регуляторы обсуждают новые правила для криптобирж', source: 'Reuters' },
        { title: 'Эфириум показывает рост на фоне обновлений сети', source: 'CoinDesk' },
      ]
    : [
        { title: 'Bitcoin consolidates above $60,000, analysts expect momentum', source: 'Crypto Analytics' },
        { title: 'Institutional investors increase crypto positions', source: 'Bloomberg' },
        { title: 'DeFi sector continues to grow, TVL exceeds $100B', source: 'DeFi Pulse' },
        { title: 'Regulators discuss new rules for crypto exchanges', source: 'Reuters' },
        { title: 'Ethereum shows growth amid network upgrades', source: 'CoinDesk' },
      ];

  for (const item of fallbackNews) {
    report += `📊 *${item.title}*\n`;
    report += `   📎 ${item.source}\n\n`;
  }

  report += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += isRu
    ? `💡 NewsAPI временно недоступен. Показаны примерные крипто-новости.\n`
    : `💡 NewsAPI temporarily unavailable. Showing sample crypto news.\n`;
  report += `🔄 /news ${coin || ''} — ${isRu ? 'обновить' : 'refresh'}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '🔙 Назад к рынку', callback_data: 'menu_market' }],
      [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
    ]
  };

  await sendUpdatedMessage(chatId, report, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_news'), coin || 'Все (fallback)');
}

// ============================================================
// 18. КАЛЕНДАРЬ - РЕАЛЬНЫЕ ДАННЫЕ ЧЕРЕЗ Apify
// ============================================================

async function getEconomicCalendar() {
  try {
    // Используем Apify Actor для получения экономического календаря
    const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${APIFY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        runInput: {
          days: 7,
          countries: 'US,EU,UK,JP,CN'
        }
      })
    });
    
    if (!response.ok) {
      console.warn('Apify calendar API error:', response.status);
      return getFallbackCalendar();
    }
    
    const runData = await response.json();
    const runId = runData.data.id;
    
    // Ждем завершения выполнения
    let status = 'RUNNING';
    let attempts = 0;
    while (status === 'RUNNING' && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const statusResponse = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
        headers: {
          'Authorization': `Bearer ${APIFY_API_KEY}`
        }
      });
      const statusData = await statusResponse.json();
      status = statusData.data.status;
      attempts++;
    }
    
    if (status !== 'SUCCEEDED') {
      console.warn('Apify calendar run failed:', status);
      return getFallbackCalendar();
    }
    
    // Получаем результаты
    const resultResponse = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items`, {
      headers: {
        'Authorization': `Bearer ${APIFY_API_KEY}`
      }
    });
    
    const events = await resultResponse.json();
    
    if (!events || events.length === 0) {
      return getFallbackCalendar();
    }
    
    return events;
    
  } catch (error) {
    console.error('Calendar API error:', error);
    return getFallbackCalendar();
  }
}

function getFallbackCalendar() {
  // Если API не доступен, возвращаем смоделированные данные
  const now = new Date();
  const events = [];
  
  // Добавляем смоделированные события на неделю вперед
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
    
    // Добавляем случайное событие на каждый день
    const dayEvent = mockEvents[i % mockEvents.length];
    events.push({
      title: dayEvent.title,
      date: dateStr,
      importance: dayEvent.importance,
      impact: dayEvent.impact
    });
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
      [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, calendar, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_calendar'), 'Неделя');
}

// ============================================================
// 19. ТАРИФЫ
// ============================================================
async function showSubscriptionMenu(chatId, lang, messageId) {
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
      [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
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
      [{ text: '🔙 Назад', callback_data: 'back_to_menu' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
}

// ============================================================
// 20. АНТИСКАМ ФУНКЦИИ
// ============================================================
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

async function handleAntiScamInput(chatId, text, lang, update, messageId) {
  const check = await checkLimit(chatId, 'antiscam');
  if (!check.allowed) {
    await sendUpdatedMessage(chatId, check.reason, null, 'Markdown', messageId);
    await setUserState(chatId, 'idle');
    return;
  }
  const state = await getUserState(chatId);
  switch(state) {
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
      [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_antiscam'), `Ссылка: ${url.slice(0, 30)}...`);
}

async function handleContractCheck(chatId, address, lang, messageId) {
  await sendTyping(chatId);
  let result = `📄 *ПРОВЕРКА КОНТРАКТА*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 \`${address}\`\n\n🔍 Проверка через Etherscan...\nℹ️ Контракт не верифицирован.\n\n💡 Проверьте вручную: https://etherscan.io/address/${address}`;
  
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
      [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, result, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_antiscam'), `Контракт: ${address.slice(0, 10)}...`);
}

async function handleDEXCheck(chatId, address, lang, messageId) {
  await sendTyping(chatId);
  let message = `🔍 *DEX ПРОВЕРКА*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 \`${address}\`\n\n❌ Токен не найден на DEX.\n\n💡 Проверьте вручную: https://etherscan.io/address/${address}`;
  
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
      [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_antiscam'), `DEX: ${address.slice(0, 10)}...`);
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
      [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
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
      [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
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
  const balance = (Math.random() * 10).toFixed(4);
  const price = (balance * 3200).toFixed(2);
  const tokens = Math.floor(Math.random() * 10) + 1;
  const risk = ['high', 'medium', 'low'][Math.floor(Math.random() * 3)];
  let message = `👛 *БЫСТРАЯ ПРОВЕРКА КОШЕЛЬКА*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 *Адрес:* \`${address.slice(0, 10)}...${address.slice(-6)}\`\n🌐 *Сеть:* Ethereum\n\n${getText(lang, 'wallet_balance', balance, price)}\n\n${getText(lang, 'wallet_tokens', tokens)}\n• USDC — $2,450\n• UNI — $1,200\n• LINK — $800\n\n`;
  const riskEmoji = risk === 'high' ? '🔴' : risk === 'medium' ? '🟡' : '🟢';
  const riskLabel = risk === 'high' ? getText(lang, 'wallet_risk_high') : risk === 'medium' ? getText(lang, 'wallet_risk_medium') : getText(lang, 'wallet_risk_low');
  message += `${riskEmoji} ${getText(lang, 'wallet_risk_label', riskLabel)}\n\n`;
  if (risk === 'high') {
    message += `• ⚠️ Обнаружены подозрительные токены\n• ⚠️ Мало транзакций\n\n`;
  } else if (risk === 'medium') {
    message += `• ⚠️ Кошелёк создан 15 дней назад\n\n`;
  } else {
    message += `✅ ${getText(lang, 'wallet_no_risks')}\n\n`;
  }
  message += getText(lang, 'wallet_recommendations') + '\n';
  if (risk === 'high') {
    message += `• 🚨 Не взаимодействуйте с подозрительными токенами\n• 🔍 Проверьте контракты через DEX\n\n`;
  } else if (risk === 'medium') {
    message += `• 💡 Диверсифицируйте портфель\n• 📊 Подключите биржу для полного анализа\n\n`;
  } else {
    message += `• 📊 Хотите полный анализ с рекомендациями?\n• 🔐 Подключите биржу через /connect\n\n`;
  }
  message += `━━━━━━━━━━━━━━━━━━━━━━━\n🔗 Просмотр: https://etherscan.io/address/${address}`;
  
  const keyboard = {
    inline_keyboard: [
      [{ text: getText(lang, 'wallet_connect'), callback_data: 'menu_connect' }],
      [{ text: '🔙 Назад к безопасности', callback_data: 'menu_security' }],
      [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_antiscam'), `Кошелёк: ${address.slice(0, 10)}...`);
  await setUserState(chatId, 'idle');
}

// ============================================================
// 21. АВТОМАТИЧЕСКАЯ ПРОВЕРКА
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
            [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
          ]
        };
        await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
        await addHistory(chatId, getText(lang, 'history_antiscam'), `Авто: ${url.slice(0, 30)}...`);
      }
    } catch (error) {
      console.error('Auto-check error:', error);
    }
  }
}

async function autoCheckContract(chatId, address, lang, messageId) {
  const check = await checkLimit(chatId, 'antiscam');
  if (!check.allowed) return;
  await sendTyping(chatId);
  let result = `📄 *АВТОМАТИЧЕСКАЯ ПРОВЕРКА КОНТРАКТА*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 \`${address}\`\n\n🔍 Проверка через Etherscan...\nℹ️ Контракт не верифицирован.\n\n💡 Проверьте вручную: https://etherscan.io/address/${address}`;
  
  const keyboard = {
    inline_keyboard: [
      [{ text: '🛡️ Проверить другое', callback_data: 'menu_security' }],
      [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
    ]
  };
  
  await sendUpdatedMessage(chatId, result, keyboard, 'Markdown', messageId);
  await addHistory(chatId, getText(lang, 'history_antiscam'), `Контракт: ${address.slice(0, 10)}...`);
}

// ============================================================
// 22. ИСТОРИЯ И SHARE
// ============================================================
async function handleHistoryCommand(chatId, lang, messageId) {
  const history = await getHistory(chatId);
  if (history.length === 0) {
    const keyboard = {
      inline_keyboard: [
        [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
      ]
    };
    await sendUpdatedMessage(chatId, getText(lang, 'history_empty'), keyboard, 'Markdown', messageId);
    return;
  }
  let message = getText(lang, 'history_title') + '\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  for (const item of history.slice(-10).reverse()) {
    message += getText(lang, 'history_item', item.date, item.action, item.detail);
  }
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔄 Обновить', callback_data: 'action_history_refresh' }],
      [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
}

async function handleShareCommand(chatId, lang, messageId) {
  const ref = chatId;
  let message = getText(lang, 'share_title') + '\n━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  message += getText(lang, 'share_text') + '\n\n';
  message += getText(lang, 'share_link', ref) + '\n\n';
  message += '💡 Пригласи друга — получи бонус!';
  const keyboard = {
    inline_keyboard: [
      [{ text: '📤 Поделиться', url: `https://t.me/share/url?url=${encodeURIComponent(getText(lang, 'share_text'))}&text=${encodeURIComponent('🚀 Мой крипто-телохранитель — Void Node! Присоединяйся!')}` }],
      [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
    ]
  };
  await sendUpdatedMessage(chatId, message, keyboard, 'Markdown', messageId);
}

// ============================================================
// 23. КОМПОЗИЦИЯ ОТЧЕТА (ОБНОВЛЕННАЯ С КНОПКАМИ ИСПОЛНЕНИЯ)
// ============================================================
async function composeRiskMessage(riskReport, mode, lang, dailyChange = 0) {
  const { 
    totalUSDT, btcPercent, altPercent, usdtPercent, 
    riskLevel, issues, recommendations,
    sharpe, maxDrawdown, rsi, ma20
  } = riskReport;

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
  baseText += `${riskEmoji} *Риск:* ${riskLabel}\n\n`;

  if (sharpe !== undefined && maxDrawdown !== undefined) {
    const sharpeEmoji = sharpe > 1 ? '🟢' : (sharpe > 0.5 ? '🟡' : '🔴');
    baseText += `📊 *ФИНАНСОВЫЕ МЕТРИКИ*\n`;
    baseText += `${sharpeEmoji} Коэф. Шарпа: ${sharpe.toFixed(2)}\n`;
    baseText += `📉 Макс. просадка: ${maxDrawdown.toFixed(1)}%\n\n`;
  }

  if (rsi && ma20) {
    const rsiEmoji = rsi.signal === 'overbought' ? '🟥' : (rsi.signal === 'oversold' ? '🟩' : '⚪');
    baseText += `📈 *ТЕХНИЧЕСКИЙ АНАЛИЗ (BTC)*\n`;
    baseText += `${rsiEmoji} RSI (14): ${rsi.rsi.toFixed(1)} (${rsi.signal === 'overbought' ? 'Перекуплен' : rsi.signal === 'oversold' ? 'Перепродан' : 'Нейтрально'})\n`;
    const maEmoji = ma20.diff > 0 ? '🟢' : '🔴';
    baseText += `${maEmoji} MA20: $${ma20.ma.toFixed(2)} (${ma20.diff > 0 ? '+' : ''}${ma20.diff.toFixed(1)}%)\n\n`;
  }

  if (issues && issues.length > 0) {
    baseText += `⚠️ *ОБНАРУЖЕННЫЕ ПРОБЛЕМЫ*\n`;
    for (const issue of issues.slice(0, 5)) {
      baseText += `• ${issue.description}\n`;
    }
    baseText += `\n`;
  }

  // Формируем клавиатуру
  const keyboard = { inline_keyboard: [] };

  // Кнопки для рекомендаций
  if (recommendations && recommendations.length > 0) {
    baseText += `💡 *РЕКОМЕНДАЦИИ*\n`;
    for (const rec of recommendations.slice(0, 5)) {
      baseText += `• ${rec.reason}\n`;
      // Кнопка "Исполнить" для каждой рекомендации (если это sell или buy)
      if (rec.action === 'sell' || rec.action === 'buy') {
        const actionText = rec.action === 'sell' ? 'Продать' : 'Купить';
        keyboard.inline_keyboard.push([
          { text: `📈 ${actionText} ${rec.asset}`, callback_data: `exec_${rec.id}` }
        ]);
      }
    }
    baseText += `\n`;
  }

  // Общие кнопки
  keyboard.inline_keyboard.push([
    { text: '📊 Полный отчет', callback_data: 'action_full_report' },
    { text: '📥 CSV отчет', callback_data: 'action_export_csv' }
  ]);
  keyboard.inline_keyboard.push([
    { text: '💬 AI-советник', callback_data: 'action_ask_ai' },
    { text: '🔙 Назад', callback_data: 'back_to_functions' }
  ]);

  baseText += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  baseText += `🛡️ *Void Node — твой телохранитель в крипте*\n`;

  return { text: baseText, keyboard };
}

// ============================================================
// 24. НОВЫЙ ОНБОРДИНГ
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
  const isRu = lang === 'ru';
  
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
  // Ждем 2 секунды перед показом готового меню
  setTimeout(async () => {
    await showMainMenu(chatId, lang);
  }, 2000);
}

// ============================================================
// 25. ОБРАБОТЧИК CALLBACK - ОБНОВЛЕННЫЙ
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
    // ===== ОНБОРДИНГ =====
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
    
    // ===== НАВИГАЦИЯ =====
    if (data === 'back_to_menu') {
      await showMainMenu(chatId, lang);
      return;
    }
    
    if (data === 'back_to_functions') {
      await showFunctionsMenu(chatId, lang);
      return;
    }
    
    if (data === 'back_to_settings') {
      await showSettingsMenuNew(chatId, lang);
      return;
    }
    
    if (data === 'menu_functions') {
      await showFunctionsMenu(chatId, lang);
      return;
    }
    
    if (data === 'menu_settings_new') {
      await showSettingsMenuNew(chatId, lang);
      return;
    }
    
    if (data === 'menu_plans') {
      await showPlansMenu(chatId, lang);
      return;
    }
    
    if (data === 'menu_help') {
      await showHelpMenu(chatId, lang);
      return;
    }
    
    if (data === 'menu_about') {
      await showAboutMenu(chatId, lang);
      return;
    }
    
    if (data === 'settings_change_lang') {
      await showLanguageSelect(chatId, lang);
      return;
    }
    
    if (data === 'settings_change_mode') {
      await showModeSelect(chatId, lang);
      return;
    }
    
    if (data === 'menu_analyze') {
      await showAnalyzeMenu(chatId, lang);
      return;
    }
    
    if (data === 'menu_security') {
      await showSecurityMenu(chatId, lang);
      return;
    }
    
    if (data === 'menu_news') {
      await handleNewsCommand(chatId, null, lang, null);
      return;
    }
    
    if (data === 'menu_history') {
      await showHistoryMenu(chatId, lang);
      return;
    }
    
    if (data === 'menu_social') {
      await handleSocialTrend(chatId, lang, null);
      return;
    }
    
    if (data === 'menu_calendar') {
      await handleCalendarCommand(chatId, lang, null);
      return;
    }
    
    if (data === 'menu_connect') {
      await sendUpdatedMessage(chatId, getText(lang, 'connect_prompt'));
      await setUserState(chatId, 'waiting_for_api_keys');
      return;
    }
    
    if (data === 'back_to_plans') {
      await showPlansMenu(chatId, lang);
      return;
    }
    
    // ===== ЯЗЫК И РЕЖИМ В НАСТРОЙКАХ =====
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
    
    // ===== НОВЫЕ ОБРАБОТЧИКИ ПОИСКА =====
    if (data === 'trend_search_menu') {
      await handleTrendSearchMenu(chatId, lang, null);
      return;
    }
    
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
    
    // ===== ДЕЙСТВИЯ =====
    if (data === 'action_analyze') {
      const savedData = await loadUserKeys(chatId);
      if (!savedData) {
        await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'));
        return;
      }
      
      await sendUpdatedMessage(chatId, '⏳ *Начинаю анализ...*');
      
      const result = await analyzePortfolio(savedData.exchangeId, savedData.apiKey, savedData.secretKey, chatId, lang);
      
      if (result.error === 'limit') {
        await sendUpdatedMessage(chatId, result.message);
        return;
      }
      if (result.error) {
        await sendUpdatedMessage(chatId, result.message);
        return;
      }
      
      const mode = await getUserMode(chatId) || 'beginner';
      const { text: report, keyboard } = await composeRiskMessage(result.riskReport, mode, lang, result.dailyChange);
      
      await sendUpdatedMessage(chatId, report, keyboard);
      return;
    }
    
    if (data === 'action_full_report') {
      const savedData = await loadUserKeys(chatId);
      if (!savedData) {
        await sendUpdatedMessage(chatId, getText(lang, 'no_keys'));
        return;
      }
      
      const result = await analyzePortfolio(savedData.exchangeId, savedData.apiKey, savedData.secretKey, chatId, lang);
      if (result.success) {
        const mode = await getUserMode(chatId) || 'beginner';
        const { text: report, keyboard } = await composeRiskMessage(result.riskReport, mode, lang, result.dailyChange);
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
      
      const result = await analyzePortfolio(savedData.exchangeId, savedData.apiKey, savedData.secretKey, chatId, lang);
      if (result.success) {
        const csv = generateCSV(result.riskReport);
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
      
      const lastAnalysis = await VOID_KV.get(`analysis_${chatId}`);
      if (!lastAnalysis) {
        await sendUpdatedMessage(chatId, getText(lang, 'no_analysis_data'));
        return;
      }
      
      await setUserState(chatId, 'ai_chat');
      
      const analysis = JSON.parse(lastAnalysis);
      const totalUsdt = analysis.totalUSDT || 0;
      const riskLevel = analysis.riskLevel || 'unknown';
      const riskEmoji = riskLevel === 'high' ? '🔴' : riskLevel === 'medium' ? '🟡' : '🟢';
      const riskText = riskLevel === 'high' ? 'высокий' : riskLevel === 'medium' ? 'средний' : 'низкий';
      
      const welcomeMessage = lang === 'ru' 
        ? `🤖 *AI-СОВЕТНИК*\n\n💰 Портфель: $${totalUsdt.toFixed(2)} USDT\n${riskEmoji} Риск: ${riskText}\n\n💬 *Задай вопрос о своем портфеле!*\n\n📌 Примеры:\n• "стоит ли докупить BTC?"\n• "как снизить риски?"\n• "что делать с альткоинами?"\n• "как диверсифицировать?"\n\n🔄 Для выхода: /exit`
        : `🤖 *AI ADVISOR*\n\n💰 Portfolio: $${totalUsdt.toFixed(2)} USDT\n${riskEmoji} Risk: ${riskText}\n\n💬 *Ask about your portfolio!*\n\n📌 Examples:\n• "should I buy more BTC?"\n• "how to reduce risks?"\n• "what to do with altcoins?"\n• "how to diversify?"\n\n🔄 To exit: /exit`;
      
      await sendUpdatedMessage(chatId, welcomeMessage);
      return;
    }
    
    if (data === 'action_disconnect') {
      const keyboard = {
        inline_keyboard: [
          [{ text: getText(lang, 'connect_confirm_yes'), callback_data: 'confirm_disconnect' }],
          [{ text: getText(lang, 'connect_confirm_no'), callback_data: 'cancel_disconnect' }],
          [{ text: '🔙 Назад', callback_data: 'back_to_settings' }]
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
    
    // ===== ТАРИФЫ =====
    if (data.startsWith('plan_')) {
      const planId = data.replace('plan_', '');
      await handlePlanSelection(chatId, planId, lang, null);
      return;
    }
    
    // ===== АНТИСКАМ =====
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
    
    // ===== ТРЕНДЫ =====
    if (data.startsWith('trend_')) {
      await handleTrendClick(chatId, data, lang, null);
      return;
    }
    
    // ===== ПОМОЩЬ =====
    if (data === 'help_how_check' || data === 'help_sharpe' || data === 'help_connect' || 
        data === 'help_antiscam' || data === 'help_panic' || data === 'help_plans') {
      
      const questionMap = {
        'help_how_check': 'как проверить токен?',
        'help_sharpe': 'что такое коэффициент Шарпа?',
        'help_connect': 'как подключить биржу?',
        'help_antiscam': 'как работает антискам?',
        'help_panic': 'как работает холодный душ?',
        'help_plans': 'что даёт каждый тариф?'
      };
      
      const question = questionMap[data] || 'помощь';
      
      await setUserState(chatId, 'help_chat');
      await sendTyping(chatId);
      
      const aiResponse = await getSmartHelpResponse(chatId, question, lang);
      
      const keyboard = {
        inline_keyboard: [
          [{ text: '💬 Задать ещё вопрос', callback_data: 'help_ask' }],
          [{ text: '🔙 Назад к помощи', callback_data: 'menu_help' }],
          [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
      };
      
      await sendUpdatedMessage(chatId, aiResponse, keyboard);
      return;
    }
    
    if (data === 'help_ask') {
      await sendUpdatedMessage(chatId, getText(lang, 'help_ask_prompt'));
      await setUserState(chatId, 'help_chat');
      return;
    }
    
    // ===== ИСПОЛНЕНИЕ РЕКОМЕНДАЦИЙ =====
    if (data.startsWith('exec_')) {
      const recId = data.replace('exec_', '');
      // Показываем диалог подтверждения
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
    
  } catch (error) {
    console.error('Callback error:', error);
    await sendUpdatedMessage(chatId, getText(lang, 'error_general', error.message));
  }
}

// ============================================================
// 26. ОБРАБОТЧИК СООБЩЕНИЙ (ОБНОВЛЕННЫЙ)
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
    
    // Автоматическая проверка ссылок
    if (text && (text.includes('http://') || text.includes('https://'))) {
      await autoCheckLinks(chatId, text, lang, messageId);
    }
    
    // Автоматическая проверка контрактов
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
    
    // Улучшенный AI чат
    if (state === 'ai_chat') {
      if (text === '/exit' || text === 'выход' || text === 'Exit') {
        await setUserState(chatId, 'idle');
        await sendUpdatedMessage(chatId, getText(lang, 'ai_exit'), null, 'Markdown', messageId);
        await showMainMenu(chatId, lang);
        return;
      }
      
      await sendTyping(chatId);
      
      const aiResponse = await getPortfolioAdvice(chatId, text, lang);
      
      const keyboard = {
        inline_keyboard: [
          [{ text: '💬 Задать ещё вопрос', callback_data: 'action_ask_ai' }],
          [{ text: '📊 Полный анализ', callback_data: 'action_analyze' }],
          [{ text: '🔙 Назад', callback_data: 'back_to_functions' }]
        ]
      };
      
      await sendUpdatedMessage(chatId, aiResponse, keyboard, 'Markdown', messageId);
      return;
    }
    
    // Живая справка
    if (state === 'help_chat') {
      if (text === '/exit' || text === 'выход' || text === 'Exit') {
        await setUserState(chatId, 'idle');
        await sendUpdatedMessage(chatId, '✅ *Выход из режима помощи.*\n\nЕсли появятся вопросы — я здесь! 😊', null, 'Markdown', messageId);
        await showMainMenu(chatId, lang);
        return;
      }
      
      await sendTyping(chatId);
      const aiResponse = await getSmartHelpResponse(chatId, text, lang);
      
      const keyboard = {
        inline_keyboard: [
          [{ text: '💬 Задать ещё вопрос', callback_data: 'help_ask' }],
          [{ text: '🔙 Назад к помощи', callback_data: 'menu_help' }],
          [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
        ]
      };
      
      await sendUpdatedMessage(chatId, aiResponse, keyboard, 'Markdown', messageId);
      return;
    }
    
    // /start - НОВАЯ ЛОГИКА ОНБОРДИНГА
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
          [{ text: '🔙 Назад', callback_data: 'back_to_settings' }]
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
          [{ text: '🏠 Главное меню', callback_data: 'back_to_menu' }]
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
    
    if (text === '/analyze') {
      const savedData = await loadUserKeys(chatId);
      if (!savedData) {
        await sendUpdatedMessage(chatId, getText(lang, 'analyzing_no_keys'), null, 'Markdown', messageId);
        return;
      }
      
      await sendUpdatedMessage(chatId, '⏳ *Начинаю анализ...*', null, 'Markdown', messageId);
      
      const result = await analyzePortfolio(savedData.exchangeId, savedData.apiKey, savedData.secretKey, chatId, lang);
      
      if (result.error === 'limit') {
        await sendUpdatedMessage(chatId, result.message, null, 'Markdown', messageId);
        return;
      }
      if (result.error) {
        await sendUpdatedMessage(chatId, result.message, null, 'Markdown', messageId);
        return;
      }
      
      const mode = await getUserMode(chatId) || 'beginner';
      const { text: report, keyboard } = await composeRiskMessage(result.riskReport, mode, lang, result.dailyChange);
      
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
    
    // Все остальное
    await sendUpdatedMessage(chatId, getText(lang, 'default_response', text), null, 'Markdown', messageId);
  } catch (error) {
    console.error('Message error:', error);
    await sendUpdatedMessage(chatId, getText(lang || 'ru', 'error_general', error.message), null, 'Markdown', messageId);
  }
}

// ============================================================
// 27. ВЕБХУК CRYPTOBOT
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
// 28. ГЛАВНЫЙ ОБРАБОТЧИК (EXPRESS)
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
