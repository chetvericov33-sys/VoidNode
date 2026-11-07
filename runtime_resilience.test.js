'use strict';

const assert = require('node:assert/strict');
const { withTimeout, fetchWithTimeout, validateOutboundUrl, probeRedisConnection, startLeaseHeartbeat, BoundedTTLCache } = require('./runtime_resilience');

async function run() {
    assert.equal(await withTimeout(Promise.resolve('ok'), 50, 'test'), 'ok');
    await assert.rejects(withTimeout(new Promise(resolve => setTimeout(resolve, 50)), 5, 'slow'), /slow timeout/);

    const originalFetch = global.fetch;
    let receivedSignal = false;
    global.fetch = (url, options) => new Promise((resolve, reject) => {
        receivedSignal = options.signal instanceof AbortSignal;
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    await assert.rejects(fetchWithTimeout('https://example.invalid', {}, 5, 'test fetch', { allowedHosts: ['example.invalid'] }), /test fetch timeout/);
    assert.equal(receivedSignal, true);
    global.fetch = originalFetch;

    assert.equal(validateOutboundUrl('https://api.telegram.org/bot123/getMe').hostname, 'api.telegram.org');
    assert.throws(() => validateOutboundUrl('http://api.telegram.org/'), /HTTPS/);
    assert.throws(() => validateOutboundUrl('https://127.0.0.1/'), /not allowlisted/);
    assert.throws(() => validateOutboundUrl('https://api.telegram.org:8443/'), /disallowed port/);
    assert.throws(() => validateOutboundUrl('https://user:pass@api.telegram.org/'), /credentials/);

    let requestOptions;
    global.fetch = async (url, options) => {
        requestOptions = options;
        return new Response('bounded response', { status: 200, headers: { 'content-type': 'text/plain' } });
    };
    const boundedResponse = await fetchWithTimeout('https://api.telegram.org/test', { redirect: 'follow' }, 100, 'bounded test');
    assert.equal(requestOptions.redirect, 'error');
    assert.equal(await boundedResponse.text(), 'bounded response');
    await assert.rejects(
        fetchWithTimeout('https://api.telegram.org/test', {}, 100, 'large test', { maxResponseBytes: 4 }),
        /response size limit/
    );
    global.fetch = originalFetch;

    assert.equal(await probeRedisConnection({ ping: async () => 'PONG' }, 20), true);
    assert.equal(await probeRedisConnection({ ping: async () => 'NOPE' }, 20), false);
    assert.equal(await probeRedisConnection({ ping: () => new Promise(() => {}) }, 5), false);
    assert.equal(await probeRedisConnection({}, 5), false);

    let renewCalls = 0;
    const healthyLease = startLeaseHeartbeat(async () => { renewCalls++; return true; }, 10);
    await new Promise(resolve => setTimeout(resolve, 35));
    healthyLease.stop();
    assert.equal(healthyLease.isHealthy(), true);
    assert.ok(renewCalls >= 1);

    let lostCallbackCalled = false;
    const lostLease = startLeaseHeartbeat(async () => false, 10, () => { lostCallbackCalled = true; });
    await new Promise(resolve => setTimeout(resolve, 25));
    lostLease.stop();
    assert.equal(lostLease.isHealthy(), false);
    assert.equal(lostCallbackCalled, true);

    const cache = new BoundedTTLCache({ maxEntries: 2, defaultTtlMs: 20 });
    cache.set('a', 0);
    cache.set('b', false);
    assert.equal(cache.get('a'), 0);
    assert.equal(cache.get('b'), false);
    cache.set('c', 'new');
    assert.equal(cache.size, 2);
    assert.equal(cache.get('a'), null);
    assert.equal(cache.get('b'), false);
    assert.equal(cache.get('c'), 'new');

    cache.set('short', 'expires', 0.01);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(cache.get('short'), null);
    console.log('RUNTIME RESILIENCE TEST: PASS');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
