'use strict';

const assert = require('assert');
const { isExplicitMarketOverviewRequest } = require('./ai_intent');
const positive = ['Сделай обзор рынка','Дай сводку крипторынка','Покажи пульс рынка','Что сейчас происходит на рынке?','market overview','market pulse'];
const negative = ['Почему рынок падает?','Как рынок реагирует на оттоки ETF?','Что будет с BTC если рынок развернётся?','Объясни, как устроен рынок фьючерсов','Привет, расскажи про трейдинг','Как читать RSI на крипторынке?'];
for (const value of positive) assert.strictEqual(isExplicitMarketOverviewRequest(value), true, value);
for (const value of negative) assert.strictEqual(isExplicitMarketOverviewRequest(value), false, value);
console.log('AI intent routing tests passed');
