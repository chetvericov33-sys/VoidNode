'use strict';

async function scanKeysByPrefix(redis, withTimeout, prefix) {
    var cursor = '0';
    var keys = [];
    var seenCursors = new Set();
    do {
        if (seenCursors.has(String(cursor))) throw new Error('Redis SCAN cursor did not advance');
        seenCursors.add(String(cursor));
        var page = await withTimeout(
            redis.scan(cursor, { match: String(prefix || '') + '*', count: 100 }),
            8000,
            'Redis SCAN'
        );
        if (!Array.isArray(page) || page.length !== 2 || !Array.isArray(page[1])) {
            throw new Error('Redis SCAN returned invalid data');
        }
        cursor = String(page[0]);
        keys = keys.concat(page[1]);
    } while (cursor !== '0');
    return keys;
}

async function createPendingDisconnectIfUserMatches(redis, withTimeout, chatId, expectedUserRaw, pendingRaw) {
    const script = "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; " +
        "redis.call('SET', KEYS[2], ARGV[2]); return 1";
    const result = await withTimeout(
        redis.eval(
            script,
            ['user_' + chatId, 'pending_disconnect_' + chatId],
            [expectedUserRaw, pendingRaw]
        ),
        8000,
        'Atomic pending disconnect creation'
    );
    return Number(result) === 1;
}

async function completeDisconnectIfMatches(redis, withTimeout, chatId, pendingRaw, expectedUserRaw) {
    const script = "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; " +
        "if redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end; " +
        "redis.call('DEL', KEYS[2]); redis.call('DEL', KEYS[1]); return 1";
    const result = await withTimeout(
        redis.eval(script,
            ['pending_disconnect_' + chatId, 'user_' + chatId],
            [pendingRaw, expectedUserRaw]),
        8000,
        'Atomic exchange disconnect'
    );
    return Number(result) === 1;
}

async function restoreDisconnectIfMatches(redis, withTimeout, chatId, pendingRaw, expectedUserRaw) {
    const script = "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; " +
        "if redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end; " +
        "redis.call('SET', KEYS[2], ARGV[2]); redis.call('DEL', KEYS[1]); return 1";
    const result = await withTimeout(
        redis.eval(script,
            ['pending_disconnect_' + chatId, 'user_' + chatId],
            [pendingRaw, expectedUserRaw]),
        8000,
        'Atomic exchange disconnect undo'
    );
    return Number(result) === 1;
}

async function replaceUserAndClearPending(redis, withTimeout, chatId, userRaw) {
    const script = "redis.call('SET', KEYS[1], ARGV[1]); " +
        "redis.call('DEL', KEYS[2]); return 1";
    const result = await withTimeout(
        redis.eval(
            script,
            ['user_' + chatId, 'pending_disconnect_' + chatId],
            [userRaw]
        ),
        8000,
        'Atomic exchange reconnect'
    );
    return Number(result) === 1;
}

async function deletePendingDisconnectIfMatches(redis, withTimeout, chatId, pendingRaw) {
    const script = "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; " +
        "return redis.call('DEL', KEYS[1])";
    const result = await withTimeout(
        redis.eval(script, ['pending_disconnect_' + chatId], [pendingRaw]),
        8000,
        'Atomic pending disconnect cleanup'
    );
    return Number(result) === 1;
}

module.exports = {
    scanKeysByPrefix,
    createPendingDisconnectIfUserMatches,
    completeDisconnectIfMatches,
    restoreDisconnectIfMatches,
    replaceUserAndClearPending,
    deletePendingDisconnectIfMatches
};
