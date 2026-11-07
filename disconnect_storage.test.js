'use strict';

const assert = require('node:assert/strict');
const { deletePendingDisconnectIfMatches } = require('./disconnect_storage');

async function run() {
    const values = new Map([['pending_disconnect_42', 'old-pending']]);
    const calls = [];
    const redis = {
        async eval(script, keys, args) {
            calls.push({ script, keys, args });
            assert.match(script, /GET', KEYS\[1\]\) ~= ARGV\[1\]/);
            assert.match(script, /return redis\.call\('DEL', KEYS\[1\]\)/);
            if (values.get(keys[0]) !== args[0]) return 0;
            return values.delete(keys[0]) ? 1 : 0;
        }
    };
    const passthroughTimeout = promise => promise;

    // A stale recovery read must not delete a newer pending request.
    values.set('pending_disconnect_42', 'new-pending');
    assert.equal(await deletePendingDisconnectIfMatches(redis, passthroughTimeout, 42, 'old-pending'), false);
    assert.equal(values.get('pending_disconnect_42'), 'new-pending');

    // The exact malformed value inspected by recovery can be safely removed.
    assert.equal(await deletePendingDisconnectIfMatches(redis, passthroughTimeout, 42, 'new-pending'), true);
    assert.equal(values.has('pending_disconnect_42'), false);
    assert.deepEqual(calls[0].keys, ['pending_disconnect_42']);
    assert.deepEqual(calls[0].args, ['old-pending']);

    await assert.rejects(
        deletePendingDisconnectIfMatches(redis, async () => { throw new Error('timeout'); }, 42, 'anything'),
        /timeout/
    );
    console.log('DISCONNECT STORAGE TEST: PASS');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
