'use strict';
const assert = require('assert');
const { normalizeBalanceEntries, validateSpotTicker, assessMarketLiquidity } = require('./market_data');

const normalized = normalizeBalanceEntries({ btc: '0.2', ETH: 1, usdt: 50 });
assert.deepStrictEqual(normalized.entries, [
  { symbol: 'BTC', amount: 0.2 },
  { symbol: 'ETH', amount: 1 },
  { symbol: 'USDT', amount: 50 }
]);
assert.deepStrictEqual(normalizeBalanceEntries({ BTC: 1, btc: 2 }).duplicates, ['BTC']);
const validMarket = {active:true,spot:true,type:'spot',base:'BTC',quote:'USDT',symbol:'BTC/USDT'};
assert.strictEqual(validateSpotTicker(validMarket, {symbol:'BTC/USDT',last:65000}, 'BTC', 'USDT').ok, true);
assert.strictEqual(validateSpotTicker(null, {symbol:'BTC/USDT',last:65000}, 'BTC', 'USDT').reason, 'market_pair_unavailable');
assert.strictEqual(validateSpotTicker({active:true,spot:false,type:'swap',base:'BTC',quote:'USDT',symbol:'BTC/USDT:USDT'}, {last:65000}, 'BTC', 'USDT').reason, 'market_not_spot');
assert.strictEqual(validateSpotTicker({active:true,spot:true,type:'spot',base:'ETH',quote:'USDT',symbol:'ETH/USDT'}, {last:3000}, 'BTC', 'USDT').reason, 'market_pair_mismatch');
assert.strictEqual(validateSpotTicker(validMarket, {symbol:'ETH/USDT',last:65000}, 'BTC', 'USDT').reason, 'ticker_pair_mismatch');
assert.strictEqual(validateSpotTicker(validMarket, {symbol:'BTC/USDT',last:-1}, 'BTC', 'USDT').reason, 'invalid_or_unavailable_price');
assert.strictEqual(validateSpotTicker(validMarket, {symbol:'BTC/USDT',last:0}, 'BTC', 'USDT').reason, 'invalid_or_unavailable_price');
const liquidityConfig = { MAX_SPREAD_PCT: 2, MIN_QUOTE_VOLUME_USDT: 10000 };
assert.strictEqual(assessMarketLiquidity({bid:100,ask:101}, liquidityConfig).lowLiquidity, false, 'missing quote volume must remain unverified, not low');
assert.strictEqual(assessMarketLiquidity({bid:100,ask:103,quoteVolume:50000}, liquidityConfig).lowLiquidity, true, 'wide spread must flag low liquidity');
assert.strictEqual(assessMarketLiquidity({bid:100,ask:101,quoteVolume:5000}, liquidityConfig).lowLiquidity, true, 'low quote volume must flag low liquidity');
assert.strictEqual(assessMarketLiquidity({bid:100,ask:101,quoteVolume:-1}, liquidityConfig).lowLiquidity, false, 'invalid quote volume must not be treated as a measured zero');
console.log('Market data tests passed');
