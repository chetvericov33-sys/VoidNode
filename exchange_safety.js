'use strict';

const SUPPORTED_EXCHANGES = Object.freeze(['binance', 'bybit', 'gate', 'kraken']);
const CCXT_REQUEST_TIMEOUT_MS = 15000;

function validateExchangeId(exchangeId) {
    return typeof exchangeId === 'string' && SUPPORTED_EXCHANGES.includes(exchangeId);
}

function createReadOnlyExchangeConfig(exchangeId, apiKey, secretKey) {
    if (!validateExchangeId(exchangeId)) {
        throw new Error('Unsupported exchange');
    }
    if (typeof apiKey !== 'string' || typeof secretKey !== 'string' ||
        apiKey.length < 8 || apiKey.length > 256 ||
        secretKey.length < 8 || secretKey.length > 512) {
        throw new Error('Invalid API credentials');
    }

    return {
        apiKey,
        secret: secretKey,
        enableRateLimit: true,
        timeout: CCXT_REQUEST_TIMEOUT_MS,
        options: {
            defaultType: 'spot'
        }
    };
}

module.exports = {
    SUPPORTED_EXCHANGES,
    CCXT_REQUEST_TIMEOUT_MS,
    validateExchangeId,
    createReadOnlyExchangeConfig
};
