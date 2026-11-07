'use strict';

const assert = require('node:assert/strict');
const {
    scanKeysByPrefix,
    createPendingDisconnectIfUserMatches,
    completeDisconnectIfMatches,
    restoreDisconnectIfMatches,
    replaceUserAndClearPending,
    deletePendingDisconnectIfMatches
} = require('./disconnect_storage');

async function run() {
    const values = new Map([['user_42', 'user-v1'], ['pending_disconnect_42', 'old-pending']]);
    const redis = {
        async eval(script, keys, args) {
            if (script.includes("redis.call('SET', KEYS[1], ARGV[1])")) {
                values.set(keys[0], args[0]);
                values.delete(keys[1]);
                return 1;
            }
            if (keys.length === 2 && script.includes("redis.call('DEL', KEYS[2])")) {
                if (values.get(keys[0]) !== args[0] || values.get(keys[1]) !== args[1]) return 0;
                values.delete(keys[1]);
                values.delete(keys[0]);
                return 1;
            }
            if (keys.length === 2 && script.includes("redis.call('SET', KEYS[2], ARGV[2])")) {
                if (values.get(keys[0]) !== args[0] || values.get(keys[1]) !== args[1]) return 0;
                values.set(keys[1], args[1]);
                values.delete(keys[0]);
                return 1;
            }
            if (keys.length === 2) {
                if (values.get(keys[0]) !== args[0]) return 0;
                values.set(keys[1], args[1]);
                return 1;
            }
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

    values.set('user_42', 'user-v2');
    assert.equal(await createPendingDisconnectIfUserMatches(redis, passthroughTimeout, 42, 'user-v1', 'pending-old'), false);
    assert.equal(values.get('pending_disconnect_42'), 'old-pending');

    assert.equal(await createPendingDisconnectIfUserMatches(redis, passthroughTimeout, 42, 'user-v2', 'pending-new'), true);
    assert.equal(values.get('pending_disconnect_42'), 'pending-new');

    assert.equal(await deletePendingDisconnectIfMatches(redis, passthroughTimeout, 42, 'old-pending'), false);
    assert.equal(values.get('pending_disconnect_42'), 'pending-new');

    assert.equal(await deletePendingDisconnectIfMatches(redis, passthroughTimeout, 42, 'pending-new'), true);
    assert.equal(values.has('pending_disconnect_42'), false);

    values.set('pending_disconnect_42', 'pending-during-reconnect');
    assert.equal(await replaceUserAndClearPending(redis, passthroughTimeout, 42, 'user-v3'), true);
    assert.equal(values.get('user_42'), 'user-v3');
    assert.equal(values.has('pending_disconnect_42'), false);

    assert.equal(await createPendingDisconnectIfUserMatches(redis, passthroughTimeout, 42, 'user-v2', 'stale-pending'), false);
    assert.equal(values.get('user_42'), 'user-v3');


    // Undo wins atomically only while both snapshots still match.
    values.set('user_42', 'user-v4');
    values.set('pending_disconnect_42', 'pending-undo');
    assert.equal(await restoreDisconnectIfMatches(redis, passthroughTimeout, 42, 'pending-undo', 'user-v4'), true);
    assert.equal(values.get('user_42'), 'user-v4');
    assert.equal(values.has('pending_disconnect_42'), false);

    // Finalization wins atomically and removes both matching records.
    values.set('user_42', 'user-v5');
    values.set('pending_disconnect_42', 'pending-finalize');
    assert.equal(await completeDisconnectIfMatches(redis, passthroughTimeout, 42, 'pending-finalize', 'user-v5'), true);
    assert.equal(values.has('user_42'), false);
    assert.equal(values.has('pending_disconnect_42'), false);

    // A stale undo/finalizer cannot touch a replacement connection.
    values.set('user_42', 'user-v6');
    values.set('pending_disconnect_42', 'pending-v6');
    assert.equal(await completeDisconnectIfMatches(redis, passthroughTimeout, 42, 'pending-v5', 'user-v5'), false);
    assert.equal(await restoreDisconnectIfMatches(redis, passthroughTimeout, 42, 'pending-v6', 'user-v5'), false);
    assert.equal(values.get('user_42'), 'user-v6');

    assert.deepEqual(await scanKeysByPrefix(redis, passthroughTimeout, 'pending_disconnect_'), [
        'pending_disconnect_1', 'pending_disconnect_2'
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
