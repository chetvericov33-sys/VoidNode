'use strict';

function isExplicitMarketOverviewRequest(question) {
    var q = String(question || '').toLowerCase().replace(/ё/g, 'е').trim();
    if (!q) return false;
    return /^(?:дай|покажи|сделай|подготовь|хочу|нужен|нужна)?\\s*(?:мне\\s+)?(?:обзор|сводк[ау]|пульс|дайджест)\\s+(?:крипто)?рынк[ауы]?\\b/.test(q) ||
        /^(?:market overview|market summary|market pulse|daily market briefing)\\b/.test(q) ||
        /^(?:что|как)\\s+(?:сейчас\\s+)?(?:происходит|обстоят дела)\\s+(?:на\\s+)?(?:крипто)?рынк[еуы]?\\??$/.test(q);
}

module.exports = { isExplicitMarketOverviewRequest };
