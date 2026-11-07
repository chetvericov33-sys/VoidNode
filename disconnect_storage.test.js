'use strict';

const assert = require('node:assert/strict');
const {
    scanKeysByPrefix,
    createPendingDisconnectIfUserMatches,
    deletePendingDisconnectIfMatches
} = require('./disconnect_storage');

async function run() {
    const values = new Map([
        ['user_42', 'user-v1'],
        ['pending_disconnect_42', 'old-pending']
    ]);
    const calls = [];
    const redis = {
        async eval(script, keys, args) {
            calls.push({ script, keys, args });
            if (keys.length === 2) {
                assert.match(script, /GET', KEYS\[1\]\) ~= ARGV\[1\]/);
                if (values.get(keys[0]) !== args[0]) return 0;
                values.set(keys[1], args[1]);
                return 1;
            }
            assert.match(script, /GET', KEYS\[1\]\) ~= ARGV\[1\]/);
            assert.match(script, /return redis\.call\('DEL', KEYS\[1\]\)/);
            if (values.get(keys[0]) !== args[0]) return 0;
            return values.delete(keys[0]) ? 1 : 0;
        },
        async scan(cursor, options) {
            assert.equal(options.match, 'pending_disconnect_*');
            assert.equal(options.count, 100);
            return cursor === '0'
                ? ['17', ['pending_disconnect_1']]
                : ['0', ['pending_disconnect_2']];
        }
    };
    const passthroughTimeout = promise => promise;

    // Conditional scheduling must not overwrite a pending request if reconnect changed the user record.
    values.set('user_42', 'user-v2');
    assert.equal(await createPendingDisconnectIfUserMatches(redis, passthroughTimeout, 42, 'user-v1', 'pending-old'), false);
    assert.equal(values.get('pending_disconnect_42'), 'old-pending');

    // When the expected user record is current, scheduling succeeds atomically.
    assert.equal(await createPendingDisconnectIfUserMatches(redis, passthroughTimeout, 42, 'user-v2', 'pending-new'), true);
    assert.equal(values.get('pending_disconnect_42'), 'pending-new');

    // A stale recovery read must not delete a newer pending request.
    assert.equal(await deletePendingDisconnectIfMatches(redis, passthroughTimeout, 42, 'old-pending'), false);
    assert.equal(values.get('pending_disconnect_42'), 'pending-new');

    // The exact malformed value inspected by recovery can be safely removed.
    assert.equal(await deletePendingDisconnectIfMatches(redis, passthroughTimeout, 42, 'pending-new'), true);
    assert.equal(values.has('pending_disconnect_42'), false);

    // SCAN walks every page and returns the matching keys.
    assert.deepEqual(await scanKeysByPrefix(redis, passthroughTimeout, 'pending_disconnect_'), [
        'pending_disconnect_1',
        'pending_disconnect_2'
    ]);

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
