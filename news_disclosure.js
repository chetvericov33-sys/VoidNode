'use strict';

function isMarketOrNewsQuestion(question) {
    var q = String(question || '').toLowerCase().replace(/ё/g, 'е');
    var broadNewsIntent = /новост|событи|что происходит|что нового|рынок|крипторын|market|crypto|news|what is happening|what's happening|latest|today|почему.{0,60}(падает|растет|снижается|просел)|(?:падает|растет|снижается|просел).{0,60}(?:рынок|биткоин|bitcoin|btc|эфир|ethereum|eth|sol|solana)|(?:down|fall|drop|rise|pump|dump|surge|rally|crash|hack|launch|listing|upgrade|regulation|etf)/i.test(q);
    var knownAsset = /\b(?:btc|eth|sol|bnb|ada|xrp|doge|shib|matic|dot|avax|link|uni|pepe|arb|op|apt|sui|near|atom|ltc|bch|fil|ftm|aave|mkr|crv|snx|comp|zec|xlm|algo|hbar|rune|flow|waves|neo|dash|ksm|enj|chz|sand|mana|axs|gala|grt|ton|trx|inj|sei|tia|jup|wif|bonk|ondo|render|fet|tao|pendle|ena)\b/i.test(q);
    return broadNewsIntent || (knownAsset && /падает|растет|снижается|просел|новост|событи|почему|что с|что по|обзор|анализ|down|fall|drop|rise|pump|dump|news|what about|what happened|price action/i.test(q));
}
function isSimplePriceQuestion(question) {
    var q = String(question || '').toLowerCase().replace(/ё/g, 'е');
    return /цена|курс|котировк|сколько стоит|почем|текущая стоимость|price|quote|how much is|current value|trading at/i.test(q);
}
function formatNewsDisclosure(lang) {
    if (lang === 'ru') return '⚠️ Примечание: информация о новостях и событиях получена из открытых источников и не прошла независимую проверку. Она может быть неполной или неточной; важные сведения рекомендуется сверять с первоисточником.';
    return '⚠️ Note: news and event information comes from public sources and has not been independently verified. It may be incomplete or inaccurate; check important claims against the original source.';
}
function appendNewsDisclosure(answer, lang) {
    var text = String(answer || '').trim();
    var notice = formatNewsDisclosure(lang);
    if (!text) return notice;
    if (text.indexOf(notice) !== -1) return text;
    return text + '\n\n' + notice;
}
function appendNewsUnavailableNotice(answer, lang) {
    var text = String(answer || '').trim();
    var notice = lang === 'ru'
        ? '⚠️ Сейчас не удалось получить свежие публикации из новостных источников. Я не могу подтвердить текущие события; ответ не следует воспринимать как новостную сводку в реальном времени.'
        : '⚠️ Fresh publications could not be retrieved from news sources right now. I cannot confirm current events; do not treat this as a real-time news briefing.';
    if (!text) return notice;
    if (text.indexOf(notice) !== -1) return text;
    return text + '\n\n' + notice;
}
module.exports = {
    isMarketOrNewsQuestion: isMarketOrNewsQuestion,
    isSimplePriceQuestion: isSimplePriceQuestion,
    formatNewsDisclosure: formatNewsDisclosure,
    appendNewsDisclosure: appendNewsDisclosure,
    appendNewsUnavailableNotice: appendNewsUnavailableNotice
};
