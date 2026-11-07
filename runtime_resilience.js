'use strict';

const ALLOWED_HTTPS_HOSTS = Object.freeze([
    'api.telegram.org',
    'pay.crypt.bot',
    'api.etherscan.io',
    'api.dexscreener.com',
    'api.coingecko.com',
    'newsapi.org',
    'openrouter.ai',
    'finnhub.io'
]);
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function validateOutboundUrl(input, allowedHosts = ALLOWED_HTTPS_HOSTS) {
    let url;
    try {
        url = new URL(String(input));
    } catch {
        throw new Error('Outbound URL is invalid');
    }
    if (url.protocol !== 'https:') throw new Error('Outbound URL must use HTTPS');
    if (url.username || url.password) throw new Error('Outbound URL must not contain credentials');
    if (url.port && url.port !== '443') throw new Error('Outbound URL uses a disallowed port');
    const hostname = url.hostname.toLowerCase().replace(/\\.$/, '');
    if (!allowedHosts.includes(hostname)) throw new Error('Outbound host is not allowlisted');
    return url;
}

function withTimeout(promise, ms, label) {
    const timeoutMs = Number(ms || 8000);
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error((label || 'Operation') + ' timeout after ' + timeoutMs + 'ms')), timeoutMs);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function fetchWithTimeout(input, options = {}, ms, label, config = {}) {
    const timeoutMs = Number(ms || 10000);
    const allowedHosts = Array.isArray(config.allowedHosts) ? config.allowedHosts : ALLOWED_HTTPS_HOSTS;
    validateOutboundUrl(input, allowedHosts);
    const maxResponseBytes = Number.isSafeInteger(config.maxResponseBytes) && config.maxResponseBytes > 0
        ? config.maxResponseBytes
        : DEFAULT_MAX_RESPONSE_BYTES;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        // Never follow redirects: a trusted API endpoint must not redirect this server
        // to an arbitrary host, private IP, or cloud metadata endpoint.
        const response = await fetch(input, { ...options, redirect: 'error', signal: controller.signal });
        const declaredLength = Number(response.headers && response.headers.get('content-length'));
        if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
            controller.abort();
            throw new Error((label || 'HTTP response') + ' exceeded response size limit');
        }
        if (!response.body) return response;
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxResponseBytes) {
                controller.abort();
                try { await reader.cancel(); } catch {}
                throw new Error((label || 'HTTP response') + ' exceeded response size limit');
            }
            chunks.push(Buffer.from(value));
        }
        const body = Buffer.concat(chunks);
        const noBodyStatus = [204, 205, 304].includes(response.status);
        return new Response(noBodyStatus ? null : body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
        });
    } catch (error) {
        if (controller.signal.aborted && !String(error.message || '').includes('exceeded response size limit')) {
            throw new Error((label || 'HTTP request') + ' timeout after ' + timeoutMs + 'ms');
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function probeRedisConnection(redis, timeoutMs = 5000) {
    if (!redis || typeof redis.ping !== 'function') return false;
    try {
        const result = await withTimeout(redis.ping(), timeoutMs, 'Redis health check');
        return result === 'PONG' || result === 'pong' || result === true;
    } catch (error) {
        return false;
    }
}

function startLeaseHeartbeat(renew, intervalMs, onLost) {
    if (typeof renew !== 'function') throw new TypeError('Lease renewal callback is required');
    const delay = Math.max(1000, Number(intervalMs) || 10000);
    let stopped = false;
    let healthy = true;
    let inFlight = false;
    const timer = setInterval(async () => {
        if (stopped || inFlight || !healthy) return;
        inFlight = true;
        try {
            if (await renew() !== true) {
                healthy = false;
                if (typeof onLost === 'function') onLost();
            }
        } catch (error) {
            healthy = false;
            if (typeof onLost === 'function') onLost(error);
        } finally {
            inFlight = false;
        }
    }, delay);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return {
        stop() {
            stopped = true;
            clearInterval(timer);
        },
        isHealthy() {
            return healthy;
        }
    };
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

module.exports = {
    withTimeout,
    fetchWithTimeout,
    validateOutboundUrl,
    ALLOWED_HTTPS_HOSTS,
    DEFAULT_MAX_RESPONSE_BYTES,
    probeRedisConnection,
    startLeaseHeartbeat,
    BoundedTTLCache
};
