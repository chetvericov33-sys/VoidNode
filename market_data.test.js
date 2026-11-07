'use strict';
const assert = require('assert');
const { normalizeBalanceEntries, validateSpotTicker } = require('./market_data');

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
console.log('Market data tests passed');
