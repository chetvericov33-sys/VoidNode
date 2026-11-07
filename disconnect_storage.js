'use strict';

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

module.exports = { deletePendingDisconnectIfMatches };
