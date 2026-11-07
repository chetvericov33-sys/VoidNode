'use strict';

const assert = require('assert');
const { isRelevantCryptoNews, filterRelevantCryptoNews } = require('./news_relevance');

const btcMarket = {
    title: 'Bitcoin falls 8% as spot ETF outflows accelerate',
    description: 'Digital asset funds record their largest weekly outflows this month.'
};
const defiHack = {
    title: 'DeFi protocol loses $40 million in exploit',
    description: 'The team paused contracts after attackers drained liquidity pools.'
};
const cryptoRegulation = {
    title: 'Russia central bank targets illegal USDT crypto exchange sellers',
    description: 'Regulators announced enforcement actions against unlicensed crypto trading desks.'
};
const genericBankStory = {
    title: 'Russian banks introduce new payment rules for customers',
    description: 'The article briefly mentions that some customers use USDT.'
};
const tutorial = {
    title: 'Crypto from zero: ways to pay with USDT',
    description: 'A beginner guide explaining how to buy digital assets.'
};
const passingMention = {
    title: 'Technology stocks rally after earnings',
    description: 'One executive also mentioned owning Bitcoin.'
};

assert.strictEqual(isRelevantCryptoNews(btcMarket), true);
assert.strictEqual(isRelevantCryptoNews(defiHack), true);
assert.strictEqual(isRelevantCryptoNews(cryptoRegulation), true);
assert.strictEqual(isRelevantCryptoNews(genericBankStory), false);
assert.strictEqual(isRelevantCryptoNews(tutorial), false);
assert.strictEqual(isRelevantCryptoNews(passingMention), false);
assert.deepStrictEqual(filterRelevantCryptoNews([btcMarket, genericBankStory, tutorial]), [btcMarket]);
assert.deepStrictEqual(filterRelevantCryptoNews(null), []);

console.log('Crypto news relevance tests: PASS');
