'use strict';

const fs = require('fs');
const source = fs.readFileSync(__dirname + '/bot.js', 'utf8');

const callbackLiterals = [...source.matchAll(/callback_data\s*:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
const uniqueCallbacks = [...new Set(callbackLiterals)];
const requiredCallbackPrefixes = [
  'back_to_', 'menu_', 'history_', 'ai_', 'wallet_', 'exchange_', 'tz_',
  'settings_', 'lang_', 'mode_', 'antiscam_', 'trend_', 'plan_', 'alert_',
  'diary_mood_', 'action_', 'onboard_', 'security_fix_', 'fix_'
];
const requiredExactCallbacks = [
  'cancel_action', 'undo_disconnect', 'portfolio_changes', 'autotrade_menu', 'demo_shock',
  'help_contact_moderator'
];

function handled(callback) {
  if (requiredExactCallbacks.includes(callback)) return true;
  if (requiredCallbackPrefixes.some(prefix => callback.startsWith(prefix))) return true;
  if (/^help_q[1-9]$/.test(callback)) return true;
  return false;
}

const unhandled = uniqueCallbacks.filter(cb => !handled(cb));
if (unhandled.length) {
  throw new Error('Unhandled callback_data: ' + unhandled.join(', '));
}

const oversized = uniqueCallbacks.filter(cb => Buffer.byteLength(cb, 'utf8') > 64);
if (oversized.length) {
  throw new Error('callback_data exceeds Telegram 64-byte limit: ' + oversized.join(', '));
}

const requiredCommands = [
  '/start', '/help', '/health', '/cancel', '/reset', '/connect', '/wallet',
  '/disconnect', '/undo', '/orders', '/stops', '/briefing', '/timezone',
  '/alerts', '/autotrade', '/diary', '/ai', '/history', '/plans', '/subscribe',
  '/settings', '/news', '/panic', '/panic_stop', '/exit', '/riskbenchmark',
  '/analyze', '/demo', '/referral'
];
const missingCommands = requiredCommands.filter(cmd => {
  if (source.includes("'" + cmd + "'")) return false;
  if (cmd === '/start') return !source.includes('isStartCommand');
  if (cmd === '/reset') return !source.includes('isResetCommand');
  if (cmd === '/ai') return !source.includes("cleanText === '/ai'");
  if (cmd === '/news') return !source.includes("cleanText === '/news'");
  if (cmd === '/timezone') return !source.includes("cleanText === '/timezone'");
  return true;
});
if (missingCommands.length) {
  throw new Error('Command route missing: ' + missingCommands.join(', '));
}

for (const helper of [
  'formatDateShort', 'sendTyping', 'answerCallback', 'sendDocument',
  'isValidUrl', 'isValidContractAddress', 'escapeMarkdown', 'formatHelpAnswer',
  'getHelpAnswerKeyboard', 'showMainMenu', 'handleMessage', 'handleCallback',
  'scheduleDisconnect', 'undoDisconnect'
]) {
  if (!new RegExp('(?:async )?function\\s+' + helper + '\\b').test(source)) {
    throw new Error('Required handler/helper missing: ' + helper);
  }
}

console.log('Handler audit passed: ' + uniqueCallbacks.length + ' callback routes + ' + requiredCommands.length + ' commands');
