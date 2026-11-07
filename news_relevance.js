'use strict';

const CRYPTO_TOPIC = /крипт|биткоин|bitcoin|\bbtc\b|эфир|ethereum|\beth\b|solana|\bsol\b|blockchain|блокчейн|defi|дефи|web3|web 3|nft|стейблкоин|stablecoin|токен|token|альткоин|altcoin|майнинг|mining|криптобирж|crypto exchange|binance|coinbase|bybit|kraken|okx|uniswap|opensea|xrp|ripple|dogecoin|\bdoge\b|cardano|\bada\b|avalanche|\bavax\b|polkadot|\bdot\b/i;
const EVENT_SIGNAL = /вырос|рост|паден|снизил|обвал|скач|ралли|торг|курс|цен[ауы]|капитализац|приток|отток|инвестиц|запуст|запуск|анонс|объявил|announce|unveil|reveal|обновлен|обновил|листинг|делистинг|одобр|отклони|запрет|разреш|регулир|регулятор|центробанк|суд|иск|штраф|взлом|атак|эксплойт|уязвим|потер|вывод средств|приостанов|ETF|SEC|CFTC|санкц|банкрот|купил|продал|приобрел|партнерств|интеграц|голосован|хардфорк|форк|halving|surge|rally|fell|drops?|plung|soar|gain|loss|price|market cap|inflow|outflow|fund flow|launch|upgrade|listing|delist|approv|reject|ban|regulat|regulator|central bank|court|lawsuit|fine|hack|exploit|vulnerab|enforcement|crackdown|outage|suspend|withdraw|bankrupt|acquir|invest|partnership|integrat|vote|hard fork|halving/i;
const LOW_VALUE_CONTENT = /с нуля|для начинающ|для нович|что такое|как начать|как купить|как продать|инструкц|пошагов|обучен|курс для|руководств|гайд|guide|tutorial|beginner|for beginners|how to buy|how to start|what is crypto|learn crypto|sponsored|партнерск[а-яё]* материал|реклам[а-яё]* материал/i;

function normalizeAssetSymbol(value) {
    return String(value || '').split('/')[0].split(':')[0].trim().replace(/[^A-Za-z0-9]/g, '');
}
function isRelevantCryptoNews(article, assetSymbols) {
    if (!article || typeof article !== 'object') return false;
    var title = String(article.title || '').replace(/<[^>]*>/g, ' ').trim();
    var description = String(article.description || '').replace(/<[^>]*>/g, ' ').trim();
    if (!title || title.length < 12 || LOW_VALUE_CONTENT.test(title)) return false;
    var headlineAndSummary = title + ' ' + description.slice(0, 900);
    var cryptoContext = CRYPTO_TOPIC.test(title) || CRYPTO_TOPIC.test(description.slice(0, 500));
    var assets = Array.isArray(assetSymbols) ? assetSymbols : [];
    var assetMentioned = assets.some(function(raw) {
        var symbol = normalizeAssetSymbol(raw);
        if (!symbol || symbol.length < 2) return false;
        return new RegExp('(^|[^A-Za-z0-9])' + symbol + '([^A-Za-z0-9]|$)', 'i').test(headlineAndSummary);
    });
    if (!cryptoContext && !assetMentioned) return false;
    if (!EVENT_SIGNAL.test(headlineAndSummary)) return false;
    // A ticker mentioned only in the summary of an unrelated headline is not enough.
    if (!cryptoContext && assetMentioned && !EVENT_SIGNAL.test(title)) return false;
    return true;
}
function filterRelevantCryptoNews(articles, assetSymbols) {
    if (!Array.isArray(articles)) return [];
    return articles.filter(function(article) { return isRelevantCryptoNews(article, assetSymbols); });
}
module.exports = { isRelevantCryptoNews: isRelevantCryptoNews, filterRelevantCryptoNews: filterRelevantCryptoNews, normalizeAssetSymbol: normalizeAssetSymbol };
