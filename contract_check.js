'use strict';

function classifyEtherscanVerification(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.status === '1' && typeof data.result === 'string' && data.result.trim()) return true;
    if (data.status === '0' && typeof data.result === 'string' &&
        /contract source code not verified|source code not verified|not verified/i.test(data.result)) return false;
    return null;
}

function createContractCheckFailure(address) {
    return {
        address,
        isVerified: null,
        isHoneypot: null,
        canSell: null,
        canBuy: null,
        ownershipRenounced: null,
        liquidityLocked: null,
        riskLevel: '⚪ UNKNOWN — ОШИБКА ПРОВЕРКИ',
        riskScore: null,
        details: ['❌ Проверка не завершена: источник данных недоступен или вернул ошибку.'],
        warnings: [
            '⚠️ Результат UNKNOWN — нельзя делать вывод, что контракт безопасен или является honeypot.',
            '⚠️ Возможность покупки и продажи не проверена симуляцией.'
        ],
        recommendations: ['🔍 Повторите проверку позже и проверьте контракт через независимые источники.']
    };
}

module.exports = { classifyEtherscanVerification, createContractCheckFailure };
