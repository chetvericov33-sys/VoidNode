'use strict';

function isValidTelegramUpdateId(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function isFreshWebhookDate(value, now = Date.now(), maxAgeMs = 72 * 60 * 60 * 1000, maxFutureSkewMs = 5 * 60 * 1000) {
    if (typeof value !== 'string' || !value.trim()) return true;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return false;
    const age = now - timestamp;
    return age <= maxAgeMs && age >= -maxFutureSkewMs;
}

function parseCryptoInvoiceId(value) {
    const id = String(value == null ? '' : value);
    return /^\d{1,20}$/.test(id) && !/^0+$/.test(id) ? id : null;
}

function parseCryptoWebhookPayload(value) {
    let payload = value;
    if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch (error) { return null; }
    }
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
}

function parsePaymentChatId(value) {
    const raw = String(value == null ? '' : value);
    if (!/^\d{1,20}$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validateCryptoPaidInvoice(invoice, paymentRecord, invoiceId) {
    if (!invoice || typeof invoice !== 'object' || Array.isArray(invoice)) return 'Invalid invoice payload';
    if (String(invoice.status || '').toLowerCase() !== 'paid') return 'Invoice is not paid';
    if (String(paymentRecord && paymentRecord.invoiceId || '') !== invoiceId) return 'Invoice metadata mismatch';
    if (String(invoice.asset || '').toUpperCase() !== String(paymentRecord && paymentRecord.asset || '').toUpperCase()) return 'Asset mismatch';
    if (String(invoice.amount) !== String(paymentRecord && paymentRecord.amount)) return 'Amount mismatch';
    return null;
}

module.exports = {
    isValidTelegramUpdateId,
    isFreshWebhookDate,
    parseCryptoInvoiceId,
    parseCryptoWebhookPayload,
    parsePaymentChatId,
    validateCryptoPaidInvoice
};
