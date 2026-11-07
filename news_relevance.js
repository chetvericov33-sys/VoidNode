'use strict';

const CRYPTO_TOPIC = /крипт|биткоин|bitcoin|\bbtc\b|эфир|ethereum|\beth\b|solana|\bsol\b|blockchain|блокчейн|defi|дефи|web3|web 3|nft|стейблкоин|stablecoin|токен|token|альткоин|altcoin|майнинг|mining|криптобирж|crypto exchange|binance|coinbase|bybit|kraken|okx|uniswap|опенси|opensea|xrp|ripple|dogecoin|\bdoge\b|cardano|\bada\b|avalanche|\bavax\b|polkadot|\bdot\b/i;

const EVENT_SIGNAL = /вырос|рост|паден|снизил|обвал|скач|ралли|торг|курс|цен[ауы]|капитализац|приток|отток|инвестиц|запуст|запуск|обновлен|обновил|листинг|делистинг|одобр|отклони|запрет|разреш|регулир|регулятор|центробанк|суд|иск|штраф|взлом|атак|эксплойт|уязвим|потерял|потер|вывод средств|приостанов|ETF|SEC|CFTC|санкц|банкрот|купил|продал|приобрел|партнерств|интеграц|голосован|хардфорк|форк|halving|халвинг|surge|rally|fell|drops?|plung|soar|gain|loss|price|market cap|inflow|outflow|fund flow|launch|upgrade|listing|delist|approv|reject|ban|regulat|regulator|central bank|court|lawsuit|fine|hack|exploit|vulnerab|outage|suspend|withdraw|bankrupt|acquir|invest|partnership|integrat|vote|hard fork|halving|ETF|SEC|CFTC/i;

const LOW_VALUE_CONTENT = /с нуля|для начинающ|для нович|что такое|как начать|как купить|как продать|способ[а-яё]* оплат|инструкц|пошагов|обучен|курс для|руководств|гайд|guide|tutorial|beginner|for beginners|how to buy|how to start|what is crypto|learn crypto|sponsored|партнерск[а-яё]* материал|реклам[а-яё]* материал/i;

function isRelevantCryptoNews(article) {
    if (!article || typeof article !== 'object') return false;
    var title = String(article.title || '').replace(/<[^>]*>/g, ' ').trim();
    var description = String(article.description || '').replace(/<[^>]*>/g, ' ').trim();
    if (!title || title.length < 12) return false;
    if (LOW_VALUE_CONTENT.test(title)) return false;

    // The headline itself must be about crypto, not merely mention a ticker in passing.
    if (!CRYPTO_TOPIC.test(title)) return false;

    // Require a concrete event/market signal in the headline or its summary.
    var eventText = title + ' ' + description.slice(0, 700);
    if (!EVENT_SIGNAL.test(eventText)) return false;

    // A generic bank/payment story is not crypto-market news unless crypto is the
    // subject of the headline and an actual crypto-related event is described.
    return true;
}

function filterRelevantCryptoNews(articles) {
    if (!Array.isArray(articles)) return [];
    return articles.filter(isRelevantCryptoNews);
}

module.exports = {
    isRelevantCryptoNews: isRelevantCryptoNews,
    filterRelevantCryptoNews: filterRelevantCryptoNews
};
