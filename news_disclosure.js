'use strict';

function isMarketOrNewsQuestion(question) {
    var q = String(question || '').toLowerCase().replace(/ё/g, 'е');
    return /рынок|рынке|рынка|крипторын|что происходит|что нового|новост|событи|почему.{0,60}(падает|растет|снижается|просел)|(?:падает|растет|снижается|просел).{0,60}(?:рынок|биткоин|bitcoin|btc|эфир|ethereum|eth|sol|solana)|макроэконом|инфляц|процентн.{0,20}ставк|санкц|регулирован|bitcoin|ethereum|solana|binance|market|crypto|news|what is happening|what's happening|why.{0,60}(fall|drop|rise|pump|dump)|why.{0,40}\b(?:btc|eth|sol)\b|\b(?:btc|eth|sol)\b.{0,50}\b(?:down|fall|drop|rise|up|pump|dump)\b/i.test(q);
}

function formatNewsDisclosure(lang) {
    if (lang === 'ru') {
        return '⚠️ Примечание: информация о новостях и событиях получена из открытых источников и не прошла независимую проверку. Она может быть неполной или неточной; важные сведения рекомендуется сверять с первоисточником.';
    }
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
    formatNewsDisclosure: formatNewsDisclosure,
    appendNewsDisclosure: appendNewsDisclosure,
    appendNewsUnavailableNotice: appendNewsUnavailableNotice
};
