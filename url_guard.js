'use strict';

const net = require('node:net');

function ipv4IsNonPublic(ip) {
    const octets = ip.split('.').map(Number);
    if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b, c] = octets;
    return a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && (b === 0 || b === 168)) ||
        (a === 192 && b === 88 && c === 99) ||
        (a === 198 && (b === 18 || b === 19)) ||
        (a === 198 && b === 51 && c === 100) ||
        (a === 203 && b === 0 && c === 113) ||
        a >= 224;
}

function ipv6ToBigInt(ip) {
    let value = ip.toLowerCase().split('%')[0];
    if (value.includes('.')) {
        const lastColon = value.lastIndexOf(':');
        const ipv4 = value.slice(lastColon + 1);
        if (net.isIPv4(ipv4) !== 4) return null;
        const [a,b,c,d] = ipv4.split('.').map(Number);
        value = value.slice(0, lastColon) + ':' + (((a << 8) | b).toString(16)) + ':' + (((c << 8) | d).toString(16));
    }
    const halves = value.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
    const groups = [...left, ...Array(missing).fill('0'), ...right];
    if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
    return groups.reduce((acc, group) => (acc << 16n) | BigInt('0x' + group), 0n);
}

function isPrivateIp(input) {
    const ip = String(input || '').replace(/^\[|\]$/g, '');
    const version = net.isIP(ip);
    if (version === 4) return ipv4IsNonPublic(ip);
    if (version !== 6) return false;

    const value = ipv6ToBigInt(ip);
    if (value === null) return true;
    const mappedPrefix = value >> 32n;
    if (mappedPrefix === 0xffffn) {
        const octets = [24n, 16n, 8n, 0n].map(shift => Number((value >> shift) & 255n));
        return ipv4IsNonPublic(octets.join('.'));
    }

    const top3 = value >> 125n;
    if (top3 !== 1n) return true; // Only global-unicast 2000::/3 is eligible.
    const prefix32 = value >> 96n;
    if (prefix32 === 0x20010db8n || prefix32 === 0x20010000n) return true; // Documentation and Teredo.
    if ((value >> 112n) === 0x2002n) return true; // 6to4 embeds IPv4 addresses.
    return false;
}

function validateUrl(input) {
    try {
        const url = new URL(String(input));
        if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, reason: 'protocol' };
        if (url.username || url.password) return { ok: false, reason: 'userinfo' };
        if (url.port && !['80', '443'].includes(url.port)) return { ok: false, reason: 'port' };
        const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
        if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') ||
            hostname.endsWith('.local') || isPrivateIp(hostname)) {
            return { ok: false, reason: 'private-host' };
        }
        return { ok: true, url };
    } catch {
        return { ok: false, reason: 'syntax' };
    }
}

module.exports = { isPrivateIp, validateUrl };
