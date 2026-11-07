'use strict';

function withTimeout(promise, ms, label) {
    const timeoutMs = Number(ms || 8000);
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error((label || 'Operation') + ' timeout after ' + timeoutMs + 'ms')), timeoutMs);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function fetchWithTimeout(url, options = {}, ms, label) {
    const timeoutMs = Number(ms || 10000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error((label || 'HTTP request') + ' timeout after ' + timeoutMs + 'ms');
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

class BoundedTTLCache {
    constructor(options = {}) {
        this.maxEntries = Math.max(1, Number(options.maxEntries) || 1000);
        this.defaultTtlMs = Math.max(1, Number(options.defaultTtlMs) || 5 * 60 * 1000);
        this.entries = new Map();
    }

    get(key) {
        const entry = this.entries.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            this.entries.delete(key);
            return null;
        }
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    set(key, value, ttlSeconds) {
        const ttlMs = Number.isFinite(Number(ttlSeconds)) && Number(ttlSeconds) > 0
            ? Number(ttlSeconds) * 1000
            : this.defaultTtlMs;
        this.entries.delete(key);
        this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
        while (this.entries.size > this.maxEntries) {
            this.entries.delete(this.entries.keys().next().value);
        }
    }

    delete(key) {
        this.entries.delete(key);
    }

    get size() {
        return this.entries.size;
    }
}

module.exports = { withTimeout, fetchWithTimeout, BoundedTTLCache };
