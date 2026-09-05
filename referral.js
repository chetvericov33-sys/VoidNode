// referral.js - Реферальная система для Void Node

const crypto = require('crypto');

class ReferralSystem {
    constructor(kv) {
        this.kv = kv;
        this.referralCodeLength = 8;
        this.rewards = {
            START: 5,  // +5 дней за START
            PRO: 10,   // +10 дней за PRO
            VIP: 15    // +15 дней за VIP
        };
    }

    // Генерация уникального реферального кода
    generateReferralCode(chatId) {
        const base = chatId.toString(36);
        const random = crypto.randomBytes(4).toString('hex');
        return (base + random).slice(0, this.referralCodeLength).toUpperCase();
    }

    // Получение или создание реферального кода пользователя
    async getOrCreateReferralCode(chatId) {
        const key = `ref_code_${chatId}`;
        let code = await this.kv.get(key);
        if (!code) {
            code = this.generateReferralCode(chatId);
            await this.kv.put(key, code);
        }
        return code;
    }

    // Получение реферера (кто пригласил) по коду
    async getReferrerByCode(code) {
        const key = `ref_code_to_user_${code}`;
        const chatId = await this.kv.get(key);
        return chatId ? parseInt(chatId) : null;
    }

    // Сохранение связи код -> пользователь
    async saveReferralCodeMapping(code, chatId) {
        const key = `ref_code_to_user_${code}`;
        await this.kv.put(key, chatId.toString());
    }

    // Регистрация перехода по реферальной ссылке
    async registerReferralClick(refereeId, referrerCode) {
        const referrerId = await this.getReferrerByCode(referrerCode);
        if (!referrerId || referrerId === refereeId) return null;

        // Проверяем, не использовал ли уже реферал этот код
        const usedKey = `ref_used_${refereeId}`;
        const used = await this.kv.get(usedKey);
        if (used) return null;

        // Сохраняем связь
        const referralKey = `ref_referrer_${refereeId}`;
        await this.kv.put(referralKey, referrerId.toString());
        await this.kv.put(usedKey, 'true');
        
        // Добавляем в список приглашенных реферера
        const listKey = `ref_invited_${referrerId}`;
        let invited = await this.kv.get(listKey);
        invited = invited ? JSON.parse(invited) : [];
        invited.push({ refereeId, date: Date.now() });
        await this.kv.put(listKey, JSON.stringify(invited));

        return referrerId;
    }

    // Обработка активации тарифа - начисление бонуса рефереру
    async processPlanActivation(refereeId, planId) {
        const referralKey = `ref_referrer_${refereeId}`;
        const referrerId = await this.kv.get(referralKey);
        if (!referrerId) return null;

        const bonusDays = this.rewards[planId] || 0;
        if (bonusDays === 0) return null;

        // Получаем текущий план реферера
        const planKey = `plan_${referrerId}`;
        let planData = await this.kv.get(planKey);
        planData = planData ? JSON.parse(planData) : null;

        if (!planData) return null;

        // Увеличиваем срок действия
        const newExpires = new Date(planData.expires);
        newExpires.setDate(newExpires.getDate() + bonusDays);
        planData.expires = newExpires.getTime();

        await this.kv.put(planKey, JSON.stringify(planData));
        
        // Логируем бонус
        const bonusKey = `ref_bonus_${referrerId}`;
        let bonuses = await this.kv.get(bonusKey);
        bonuses = bonuses ? JSON.parse(bonuses) : [];
        bonuses.push({
            from: refereeId,
            plan: planId,
            days: bonusDays,
            date: Date.now()
        });
        await this.kv.put(bonusKey, JSON.stringify(bonuses));

        return { referrerId, bonusDays, newExpires: planData.expires };
    }

    // Получение статистики реферера
    async getReferralStats(chatId) {
        const invitedKey = `ref_invited_${chatId}`;
        let invited = await this.kv.get(invitedKey);
        invited = invited ? JSON.parse(invited) : [];

        const bonusKey = `ref_bonus_${chatId}`;
        let bonuses = await this.kv.get(bonusKey);
        bonuses = bonuses ? JSON.parse(bonuses) : [];

        const totalBonuses = bonuses.reduce((sum, b) => sum + b.days, 0);

        return {
            totalInvited: invited.length,
            totalBonuses: totalBonuses,
            bonuses: bonuses,
            invited: invited
        };
    }
}

module.exports = ReferralSystem;
