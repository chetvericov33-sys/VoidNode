'use strict';

const assert = require('assert');
const { classifyUrlSafety, inspectUrlRedirects, getUrlAlertLevel } = require('./url_safety');

assert.strictEqual(classifyUrlSafety('https://binance.com').status, 'SAFE');
assert.strictEqual(classifyUrlSafety('https://www.binance.com/login').status, 'UNKNOWN');
assert.strictEqual(classifyUrlSafety('http://binance.com').status, 'SUSPICIOUS');
assert.strictEqual(classifyUrlSafety('https://binance-login.com').status, 'SUSPICIOUS');
assert.strictEqual(classifyUrlSafety('https://binance.com.attacker.test').status, 'SUSPICIOUS');
assert.strictEqual(classifyUrlSafety('https://evil-metamask.io').status, 'SUSPICIOUS');
assert.strictEqual(classifyUrlSafety('https://example.org').status, 'UNKNOWN');
assert.strictEqual(classifyUrlSafety('https://new-domain-987.example').status, 'UNKNOWN');
assert.strictEqual(classifyUrlSafety('not a url').status, 'UNKNOWN');
assert.strictEqual(classifyUrlSafety('javascript:alert(1)').status, 'SUSPICIOUS');
assert.strictEqual(classifyUrlSafety('https://user:pass@example.org').status, 'SUSPICIOUS');
assert.strictEqual(classifyUrlSafety('https://xn--binance-9za.example').status, 'SUSPICIOUS');
assert.strictEqual(classifyUrlSafety('https://example.org', { blacklisted: true }).status, 'SUSPICIOUS');

assert.strictEqual(inspectUrlRedirects('https://binance.com').status, 'SAFE');
assert.strictEqual(inspectUrlRedirects('https://binance.com/redirect?url=https%3A%2F%2Fbinance-login.com').status, 'SUSPICIOUS');
assert.strictEqual(inspectUrlRedirects('https://binance.com/redirect?url=https%3A%2F%2Fexample.org').status, 'UNKNOWN');
assert.strictEqual(inspectUrlRedirects('https://bit.ly/abc123').status, 'UNKNOWN');
assert.strictEqual(inspectUrlRedirects('https://example.org/?next=https%3A%2F%2Fmetamask-login.example').status, 'SUSPICIOUS');
assert.strictEqual(inspectUrlRedirects('https://example.org/?next=https%3A%2F%2Fexample.org%2F%3Furl%3Dhttps%253A%252F%252Fbinance-login.com').status, 'SUSPICIOUS');
assert.strictEqual(inspectUrlRedirects('https://example.org/?next=https%3A%2F%2Fexample.org%2F%3Furl%3Dhttps%253A%252F%252Fexample.org').status, 'UNKNOWN');
assert.strictEqual(getUrlAlertLevel(classifyUrlSafety('https://binance.com')), 'SAFE');
assert.strictEqual(getUrlAlertLevel(classifyUrlSafety('https://binance-login.com')), 'SUSPICIOUS');
assert.strictEqual(getUrlAlertLevel(classifyUrlSafety('https://example.org')), 'UNKNOWN');
assert.strictEqual(getUrlAlertLevel(null), 'UNKNOWN');
assert.strictEqual(getUrlAlertLevel({ status: 'UNEXPECTED' }), 'UNKNOWN');

console.log('URL safety tests passed');
