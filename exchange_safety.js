'use strict';

const SUPPORTED_EXCHANGES = Object.freeze(['binance', 'bybit', 'gate', 'kraken']);
const CCXT_REQUEST_TIMEOUT_MS = 15000;
const BLOCKED_MUTATING_METHODS = Object.freeze([
    'createOrder', 'createOrders', 'createMarketOrder', 'createLimitOrder',
    'editOrder', 'editOrders', 'cancelOrder', 'cancelOrders', 'cancelAllOrders',
    'withdraw', 'transfer', 'setLeverage', 'setMarginMode', 'setPositionMode',
    'addMargin', 'reduceMargin', 'borrowMargin', 'repayMargin',
    'closePosition', 'closeAllPositions'
]);

function validateExchangeId(exchangeId) {
    return typeof exchangeId === 'string' && SUPPORTED_EXCHANGES.includes(exchangeId);
}

function enforceReadOnlyExchange(exchange) {
    if (!exchange || (typeof exchange !== 'object' && typeof exchange !== 'function')) {
        throw new Error('Invalid exchange client');
    }
    for (const method of BLOCKED_MUTATING_METHODS) {
        Object.defineProperty(exchange, method, {
            configurable: false,
            enumerable: false,
            writable: false,
            value: async function blockedExchangeMutation() {
                throw new Error('Read-only mode: exchange mutations are disabled');
            }
        });
    }
    return exchange;
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
    BLOCKED_MUTATING_METHODS,
    validateExchangeId,
    enforceReadOnlyExchange,
    createReadOnlyExchangeConfig
};
