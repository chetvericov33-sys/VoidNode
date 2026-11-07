'use strict';

const assert = require('node:assert/strict');
const { activateReferralBonusIfUnprocessed } = require('./referral_storage');

async function run() {
    const values = new Map([
        ['ref_referrer_200', '100'],
        ['plan_100', JSON.stringify({ planId: 'SILVER', expires: 1000 })]
    ]);
    const redis = {
        async get(key) { return values.has(key) ? values.get(key) : null; },
        async eval(script, keys, args) {
            assert.ok(script.includes("redis.call('EXISTS', KEYS[4])"));
            assert.ok(script.includes("table.insert(bonuses"));
            if (values.has(keys[3])) return values.get(keys[3]);
            if (values.get(keys[0]) !== args[0]) return null;
            const planRaw = values.get(keys[1]);
            if (!planRaw) return null;
            const plan = JSON.parse(planRaw);
            const now = Number(args[1]);
            const days = Number(args[2]);
            const newExpires = Math.max(Number(plan.expires || 0), now) + days * 86400000;
            plan.expires = newExpires;
            const bonuses = values.has(keys[2]) ? JSON.parse(values.get(keys[2])) : [];
            bonuses.push({ from: args[3], plan: args[4], days, date: now });
            values.set(keys[1], JSON.stringify(plan));
            values.set(keys[2], JSON.stringify(bonuses));
            const result = JSON.stringify({ referrerId: args[0], bonusDays: days, newExpires });
            values.set(keys[3], result);
            return result;
        }
    };
    const passthrough = promise => promise;

    const first = await activateReferralBonusIfUnprocessed(redis, passthrough, '9001', 200, 'SILVER', 5, 10000);
    assert.deepEqual(first, { referrerId: 100, bonusDays: 5, newExpires: 10000 + 5 * 86400000 });
    assert.equal(JSON.parse(values.get('plan_100')).expires, first.newExpires);
    assert.equal(JSON.parse(values.get('ref_bonus_100')).length, 1);

    const duplicate = await activateReferralBonusIfUnprocessed(redis, passthrough, '9001', 200, 'SILVER', 5, 20000);
    assert.deepEqual(duplicate, first);
    assert.equal(JSON.parse(values.get('ref_bonus_100')).length, 1);

    const second = await activateReferralBonusIfUnprocessed(redis, passthrough, '9002', 200, 'PLATINUM', 15, 20000);
    assert.deepEqual(second, { referrerId: 100, bonusDays: 15, newExpires: first.newExpires + 15 * 86400000 });
    assert.equal(JSON.parse(values.get('ref_bonus_100')).length, 2);

    await assert.rejects(
        activateReferralBonusIfUnprocessed(redis, passthrough, 'bad-id', 200, 'SILVER', 5, 30000),
        /Invalid referral bonus parameters/
    );
    console.log('referral_storage.test.js: all tests passed');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
