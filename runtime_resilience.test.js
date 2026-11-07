'use strict';

const assert = require('node:assert/strict');
const { withTimeout, BoundedTTLCache } = require('./runtime_resilience');

async function run() {
    assert.equal(await withTimeout(Promise.resolve('ok'), 50, 'test'), 'ok');
    await assert.rejects(withTimeout(new Promise(resolve => setTimeout(resolve, 50)), 5, 'slow'), /slow timeout/);

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
