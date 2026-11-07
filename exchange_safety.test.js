'use strict';

const assert = require('node:assert/strict');
const {
    SUPPORTED_EXCHANGES,
    CCXT_REQUEST_TIMEOUT_MS,
    validateExchangeId,
    createReadOnlyExchangeConfig
} = require('./exchange_safety');

for (const id of ['binance', 'bybit', 'gate', 'kraken']) {
    assert.equal(validateExchangeId(id), true);
    const config = createReadOnlyExchangeConfig(id, 'A'.repeat(32), 'B'.repeat(32));
    assert.equal(config.enableRateLimit, true);
    assert.equal(config.timeout, CCXT_REQUEST_TIMEOUT_MS);
    assert.equal(config.options.defaultType, 'spot');
    assert.equal(config.apiKey, 'A'.repeat(32));
    assert.equal(config.secret, 'B'.repeat(32));
}

assert.deepEqual(SUPPORTED_EXCHANGES, ['binance', 'bybit', 'gate', 'kraken']);
for (const id of ['okx', 'kucoin', 'constructor', '__proto__', 'toString', '', null, 1]) {
    assert.equal(validateExchangeId(id), false);
    assert.throws(() => createReadOnlyExchangeConfig(id, 'A'.repeat(32), 'B'.repeat(32)), /Unsupported exchange/);
}
for (const [apiKey, secret] of [
    ['', 'B'.repeat(32)],
    ['A'.repeat(7), 'B'.repeat(32)],
    ['A'.repeat(257), 'B'.repeat(32)],
    ['A'.repeat(32), 'B'.repeat(7)],
    ['A'.repeat(32), 'B'.repeat(513)],
    [null, 'B'.repeat(32)],
    ['A'.repeat(32), {}]
]) {
    assert.throws(() => createReadOnlyExchangeConfig('binance', apiKey, secret), /Invalid API credentials/);
}

const config = createReadOnlyExchangeConfig('binance', 'A'.repeat(32), 'B'.repeat(32));
assert.equal(Object.prototype.hasOwnProperty.call(config, 'urls'), false);
assert.equal(Object.prototype.hasOwnProperty.call(config, 'proxy'), false);
assert.equal(Object.prototype.hasOwnProperty.call(config, 'fetchImplementation'), false);

console.log('EXCHANGE SAFETY TEST: PASS');
