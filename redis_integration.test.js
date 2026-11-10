'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
    forEachKeyByPrefix,
    createPendingDisconnectIfUserMatches,
    completeDisconnectIfMatches,
    restoreDisconnectIfMatches,
    replaceUserAndClearPending,
    deletePendingDisconnectIfMatches
} = require('./disconnect_storage');
const { registerReferralIfUnused, activateReferralBonusIfUnprocessed } = require('./referral_storage');

const host = process.env.REDIS_HOST || '127.0.0.1';
const port = String(process.env.REDIS_PORT || '6379');

function command(args) {
    const output = execFileSync('redis-cli', ['-h', host, '-p', port, '--json', ...args.map(String)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    return output ? JSON.parse(output) : null;
}

const redis = {
    ping() { return command(['PING']); },
    get(key) { return command(['GET', key]); },
    set(key, value, options = {}) {
        const args = ['SET', key, value];
        if (options.nx) args.push('NX');
        if (options.ex) args.push('EX', options.ex);
        return command(args);
    },
    del(key) { return command(['DEL', key]); },
    scan(cursor, options = {}) {
        return command(['SCAN', cursor, 'MATCH', options.match || '*', 'COUNT', options.count || 100]);
    },
    eval(script, keys, args) {
        return command(['EVAL', script, keys.length, ...keys, ...args]);
    }
};

async function withTimeout(promise) { return promise; }
function ok(condition, message) { assert.ok(condition, message); }

async function main() {
    assert.equal(redis.ping(), 'PONG', 'Redis service must respond to PING');
    if (process.env.REDIS_TEST_ALLOW_FLUSHDB !== '1') {
        throw new Error('Refusing destructive FLUSHDB: set REDIS_TEST_ALLOW_FLUSHDB=1 only for an isolated disposable Redis instance');
    }
    command(['FLUSHDB']);

    // Disconnect lifecycle: compare-and-set, undo, finalization, and reconnect.
    const chatId = '81001';
    const originalUser = JSON.stringify({ exchange: 'demo', key: 'old' });
    const pending = JSON.stringify({ userRecord: originalUser, scheduledAt: Date.now() });
    await redis.set('user_' + chatId, originalUser);
    ok(await createPendingDisconnectIfUserMatches(redis, withTimeout, chatId, originalUser, pending), 'pending disconnect should be created for matching user');
    ok(!(await createPendingDisconnectIfUserMatches(redis, withTimeout, chatId, 'stale-user', pending)), 'stale user record must not create pending disconnect');
    ok(!(await deletePendingDisconnectIfMatches(redis, withTimeout, chatId, 'stale-pending')), 'stale pending record must not be deleted');
    ok(await restoreDisconnectIfMatches(redis, withTimeout, chatId, pending, originalUser), 'matching pending disconnect should restore user');
    assert.equal(await redis.get('pending_disconnect_' + chatId), null, 'undo should clear pending marker');
    await redis.set('pending_disconnect_' + chatId, pending);
    ok(await completeDisconnectIfMatches(redis, withTimeout, chatId, pending, originalUser), 'matching pending disconnect should finalize');
    assert.equal(await redis.get('user_' + chatId), null, 'finalization should delete user record');
    await redis.set('pending_disconnect_' + chatId, pending);
    const replacementUser = JSON.stringify({ exchange: 'demo', key: 'new' });
    ok(await replaceUserAndClearPending(redis, withTimeout, chatId, replacementUser), 'reconnect should atomically replace user and clear pending');
    assert.equal(await redis.get('user_' + chatId), replacementUser);
    assert.equal(await redis.get('pending_disconnect_' + chatId), null);

    // SCAN paging: create enough keys to force multi-page iteration and ensure unrelated keys are excluded.
    for (let i = 0; i < 275; i++) await redis.set('pending_disconnect_scan_' + i, 'x');
    await redis.set('other_prefix_1', 'x');
    const scanned = [];
    await forEachKeyByPrefix(redis, withTimeout, 'pending_disconnect_scan_', async keys => scanned.push(...keys));
    assert.equal(new Set(scanned).size, 275, 'SCAN must visit all matching keys without duplicates');
    ok(scanned.every(key => key.startsWith('pending_disconnect_scan_')), 'SCAN must filter by prefix');

    // Referral registration race: Lua must allow exactly one inviter for one referee.
    const registrations = await Promise.all([
        registerReferralIfUnused(redis, withTimeout, 82001, 83001, 1000),
        registerReferralIfUnused(redis, withTimeout, 82001, 83002, 1001),
        registerReferralIfUnused(redis, withTimeout, 82001, 83003, 1002)
    ]);
    assert.equal(registrations.filter(Boolean).length, 1, 'only one concurrent referral registration may win');
    const winner = await redis.get('ref_referrer_82001');
    ok(['83001', '83002', '83003'].includes(winner), 'referee must have exactly one valid referrer');
    const invited = JSON.parse(await redis.get('ref_invited_' + winner));
    assert.equal(invited.length, 1, 'inviter history must contain one referee entry');

    // Referral bonus idempotency: retrying one invoice must not extend the plan twice.
    await redis.set('ref_referrer_82002', '83010');
    await redis.set('plan_83010', JSON.stringify({ planId: 'PRO', expires: 5000 }));
    const firstBonus = await activateReferralBonusIfUnprocessed(redis, withTimeout, '99001', 82002, 'PRO', 7, 10000);
    const retryBonus = await activateReferralBonusIfUnprocessed(redis, withTimeout, '99001', 82002, 'PRO', 7, 11000);
    assert.deepEqual(retryBonus, firstBonus, 'retry must return the original processed bonus result');
    const updatedPlan = JSON.parse(await redis.get('plan_83010'));
    assert.equal(updatedPlan.expires, 10000 + 7 * 86400000, 'referrer expiry must be extended exactly once');
    assert.equal(JSON.parse(await redis.get('ref_bonus_83010')).length, 1, 'bonus history must contain one entry');

    // Lease ownership: a stale token cannot renew or release a newer owner’s lock.
    await redis.set('integration_lock', 'owner-current', { ex: 30 });
    const renewScript = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) else return 0 end";
    assert.equal(Number(await redis.eval(renewScript, ['integration_lock'], ['owner-stale', 60])), 0, 'stale lease must not renew');
    assert.equal(Number(await redis.eval(renewScript, ['integration_lock'], ['owner-current', 60])), 1, 'current lease owner must renew');
    const releaseScript = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
    assert.equal(Number(await redis.eval(releaseScript, ['integration_lock'], ['owner-stale'])), 0, 'stale lease must not release');
    assert.equal(await redis.get('integration_lock'), 'owner-current', 'current lease must remain held');

    console.log('REDIS INTEGRATION TEST: PASS — disconnect CAS, SCAN paging, referral races/idempotency, lease ownership');
}

main().catch(error => {
    console.error('REDIS INTEGRATION TEST: FAIL');
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
