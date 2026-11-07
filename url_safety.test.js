'use strict';

const assert = require('assert');
const { classifyUrlSafety } = require('./url_safety');

assert.strictEqual(classifyUrlSafety('https://binance.com').status, 'SAFE');
assert.strictEqual(classifyUrlSafety('https://www.binance.com/login').status, 'SAFE');
assert.strictEqual(classifyUrlSafety('http://binance.com').status, 'UNKNOWN');
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

console.log('URL safety tests passed');
