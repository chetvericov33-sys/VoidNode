'use strict';

const assert = require('assert');
const {
    isMarketOrNewsQuestion,
    formatNewsDisclosure,
    appendNewsDisclosure,
    appendNewsUnavailableNotice
} = require('./news_disclosure');

assert.strictEqual(isMarketOrNewsQuestion('Что происходит на рынке криптовалют?'), true);
assert.strictEqual(isMarketOrNewsQuestion('Почему BTC падает сегодня?'), true);
assert.strictEqual(isMarketOrNewsQuestion('Any important crypto news today?'), true);
assert.strictEqual(isMarketOrNewsQuestion('Сколько у меня USDT в портфеле?'), false);

const ru = appendNewsDisclosure('Bitcoin снижается.', 'ru');
assert.ok(ru.includes('Bitcoin снижается.'));
assert.ok(ru.includes('открытых источников'));
assert.strictEqual(appendNewsDisclosure(ru, 'ru'), ru, 'disclosure must not be duplicated');
assert.ok(formatNewsDisclosure('en').includes('public sources'));
assert.ok(appendNewsUnavailableNotice('No live data.', 'en').includes('Fresh publications could not be retrieved'));

console.log('News disclosure tests: PASS');
