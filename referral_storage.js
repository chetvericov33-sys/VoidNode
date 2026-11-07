'use strict';

async function activateReferralBonusIfUnprocessed(redis, withTimeout, invoiceId, refereeId, planId, bonusDays, now = Date.now()) {
    const invoice = String(invoiceId || '');
    const referee = String(refereeId || '');
    const days = Number(bonusDays);
    if (!/^\d{1,20}$/.test(invoice) || !/^\d{1,20}$/.test(referee) || !Number.isSafeInteger(days) || days <= 0) {
        throw new TypeError('Invalid referral bonus parameters');
    }

    const referrerKey = 'ref_referrer_' + referee;
    const referrerId = await withTimeout(redis.get(referrerKey), 8000, 'Referral lookup');
    if (!referrerId || !/^\d{1,20}$/.test(String(referrerId))) return null;

    const script = "if redis.call('EXISTS', KEYS[4]) == 1 then return redis.call('GET', KEYS[4]) end; " +
        "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return nil end; " +
        "local planRaw = redis.call('GET', KEYS[2]); if not planRaw then return nil end; " +
        "local okPlan, plan = pcall(cjson.decode, planRaw); " +
        "if not okPlan or type(plan) ~= 'table' then return redis.error_reply('Invalid referrer plan record') end; " +
        "local oldExpiry = tonumber(plan.expires or 0); if not oldExpiry then return redis.error_reply('Invalid referrer plan expiry') end; " +
        "local now = tonumber(ARGV[2]); local days = tonumber(ARGV[3]); " +
        "local newExpiry = math.max(oldExpiry, now) + days * 86400000; plan.expires = newExpiry; " +
        "local bonusesRaw = redis.call('GET', KEYS[3]); local bonuses = {}; " +
        "if bonusesRaw then local okBonuses, decoded = pcall(cjson.decode, bonusesRaw); " +
        "if not okBonuses or type(decoded) ~= 'table' then return redis.error_reply('Invalid referral bonus history') end; bonuses = decoded end; " +
        "table.insert(bonuses, { from = ARGV[4], plan = ARGV[5], days = days, date = now }); " +
        "redis.call('SET', KEYS[2], cjson.encode(plan)); " +
        "redis.call('SET', KEYS[3], cjson.encode(bonuses)); " +
        "local result = cjson.encode({ referrerId = ARGV[1], bonusDays = days, newExpires = newExpiry }); " +
        "redis.call('SET', KEYS[4], result, 'EX', ARGV[6]); return result";

    const raw = await withTimeout(
        redis.eval(
            script,
            [referrerKey, 'plan_' + referrerId, 'ref_bonus_' + referrerId, 'ref_bonus_processed_' + invoice],
            [String(referrerId), now, days, referee, String(planId), 180 * 24 * 60 * 60]
        ),
        8000,
        'Atomic referral bonus activation'
    );
    if (!raw) return null;
    const result = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!result || typeof result !== 'object') return null;
    return {
        referrerId: Number(result.referrerId),
        bonusDays: Number(result.bonusDays),
        newExpires: Number(result.newExpires)
    };
}

module.exports = { activateReferralBonusIfUnprocessed };
