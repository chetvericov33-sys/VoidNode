'use strict';

const assert = require('node:assert/strict');
const { isPrivateIp, validateUrl } = require('./url_guard');

for (const ip of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.1.1',
    '172.16.0.1', '172.31.255.254', '192.0.2.1', '192.168.1.1',
    '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1',
    '255.255.255.255', '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1',
    'ff02::1', '2001:db8::1', '::ffff:192.168.1.1', '::ffff:127.0.0.1',
    '2002:0a00:0001::1'
]) {
    assert.equal(isPrivateIp(ip), true, ip + ' must not be treated as public');
}
for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, ip + ' is a public address');
}
for (const url of [
    'http://127.0.0.1', 'http://10.0.0.1', 'http://169.254.169.254/latest/meta-data',
    'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://[fc00::1]', 'http://localhost',
    'http://service.local', 'http://example.com:8080', 'file:///etc/passwd',
    'https://user:pass@example.com'
]) {
    assert.equal(validateUrl(url).ok, false, url + ' must be rejected');
}
for (const url of ['https://8.8.8.8', 'https://[2606:4700:4700::1111]', 'https://example.com']) {
    assert.equal(validateUrl(url).ok, true, url + ' should pass syntactic host validation');
}
console.log('URL guard tests: PASS');
