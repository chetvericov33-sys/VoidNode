'use strict';
const assert = require('assert');
const {
    isValidTelegramUpdateId, isFreshWebhookDate, parseCryptoInvoiceId,
    parseCryptoWebhookPayload, parsePaymentChatId, validateCryptoPaidInvoice
} = require('./webhook_safety');

assert.strictEqual(isValidTelegramUpdateId(0), true);
assert.strictEqual(isValidTelegramUpdateId(42), true);
assert.strictEqual(isValidTelegramUpdateId(-1), false);
assert.strictEqual(isValidTelegramUpdateId(Number.MAX_SAFE_INTEGER + 1), false);
assert.strictEqual(isValidTelegramUpdateId('42'), false);

const now = Date.parse('2026-11-07T12:00:00Z');
assert.strictEqual(isFreshWebhookDate('2026-11-07T11:00:00Z', now), true);
assert.strictEqual(isFreshWebhookDate('2026-11-04T11:59:59Z', now), false);
assert.strictEqual(isFreshWebhookDate('2026-11-07T12:04:59Z', now), true);
assert.strictEqual(isFreshWebhookDate('2026-11-07T12:05:01Z', now), false);
assert.strictEqual(isFreshWebhookDate('not-a-date', now), false);
assert.strictEqual(isFreshWebhookDate(undefined, now), true);
assert.strictEqual(isFreshWebhookDate(123, now), false);
assert.strictEqual(parseCryptoInvoiceId(Number.MAX_SAFE_INTEGER + 1), null);

assert.strictEqual(parseCryptoInvoiceId(12345), '12345');
assert.strictEqual(parseCryptoInvoiceId('00123'), '00123');
assert.strictEqual(parseCryptoInvoiceId(''), null);
assert.strictEqual(parseCryptoInvoiceId('0'), null);
assert.strictEqual(parseCryptoInvoiceId('12x'), null);
assert.strictEqual(parseCryptoInvoiceId('1'.repeat(21)), null);

assert.deepStrictEqual(parseCryptoWebhookPayload('{"invoice_id":123}'), { invoice_id: 123 });
assert.strictEqual(parseCryptoWebhookPayload('{bad json'), null);
assert.strictEqual(parseCryptoWebhookPayload([]), null);
assert.strictEqual(parseCryptoWebhookPayload(null), null);

assert.strictEqual(parsePaymentChatId('123456'), 123456);
assert.strictEqual(parsePaymentChatId('123x'), null);
assert.strictEqual(parsePaymentChatId('-123'), null);
assert.strictEqual(parsePaymentChatId('9007199254740992'), null);

const record = { invoiceId: '123', asset: 'USDT', amount: '10' };
const invoice = { status: 'paid', asset: 'USDT', amount: '10' };
assert.strictEqual(validateCryptoPaidInvoice(invoice, record, '123'), null);
assert.strictEqual(validateCryptoPaidInvoice({...invoice, status: 'active'}, record, '123'), 'Invoice is not paid');
assert.strictEqual(validateCryptoPaidInvoice(invoice, record, '124'), 'Invoice metadata mismatch');
assert.strictEqual(validateCryptoPaidInvoice({...invoice, asset: 'TON'}, record, '123'), 'Asset mismatch');
assert.strictEqual(validateCryptoPaidInvoice({...invoice, amount: '11'}, record, '123'), 'Amount mismatch');

console.log('webhook_safety.test.js: all tests passed');
