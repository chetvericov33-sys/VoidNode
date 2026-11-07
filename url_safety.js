'use strict';

const TRUSTED_DOMAINS = Object.freeze([
  'binance.com',
  'bybit.com',
  'okx.com',
  'metamask.io',
  'trustwallet.com'
]);

const REDIRECTOR_DOMAINS = Object.freeze(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rebrand.ly', 'ow.ly']);

const REDIRECT_PARAM_NAMES = new Set(['url', 'u', 'target', 'dest', 'destination', 'redirect', 'redirect_url', 'redirect_uri', 'next', 'continue', 'return', 'return_url', 'out']);

const BRAND_DOMAINS = Object.freeze([
  'binance.com',
  'bybit.com',
  'okx.com',
  'metamask.io',
  'trustwallet.com'
]);

function classifyUrlSafety(input, options = {}) {
  const blacklisted = options.blacklisted === true;
  if (blacklisted) {
    return { status: 'SUSPICIOUS', safe: false, reason: 'Domain is present in the local blacklist.' };
  }

  let parsed;
  try {
    parsed = new URL(String(input));
  } catch {
    return { status: 'UNKNOWN', safe: false, reason: 'URL syntax could not be validated.' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    return { status: 'SUSPICIOUS', safe: false, reason: 'URL uses an unsupported protocol or embedded credentials.' };
  }

  const rawHostname = parsed.hostname.toLowerCase();
  const hostname = rawHostname.endsWith('.') ? rawHostname.slice(0, -1) : rawHostname;
  if (!hostname) {
    return { status: 'UNKNOWN', safe: false, reason: 'Hostname is missing.' };
  }

  const trusted = options.trustedDomains || TRUSTED_DOMAINS;
  if (parsed.protocol === 'https:' && trusted.some(domain => hostname === domain)) {
    return { status: 'SAFE', safe: true, reason: 'HTTPS host matches the configured trusted-domain allowlist.' };
  }

  const trustedBrandSubdomain = BRAND_DOMAINS.some(domain => hostname.endsWith('.' + domain));
  if (trustedBrandSubdomain) {
    return { status: 'UNKNOWN', safe: false, reason: 'This is a subdomain of a protected brand; only the exact configured host is allowlisted.' };
  }

  const labels = hostname.split('.');
  const brandMatch = BRAND_DOMAINS.find(domain => {
    const brand = domain.split('.')[0];
    return labels.some(label => label.includes(brand)) || hostname.includes(brand);
  });
  if (brandMatch) {
    return { status: 'SUSPICIOUS', safe: false, reason: 'Hostname resembles a protected brand but is not its exact trusted domain.' };
  }

  return { status: 'UNKNOWN', safe: false, reason: 'No reliable reputation evidence is available for this domain.' };
}

function inspectUrlRedirects(input, options = {}, depth = 0) {
  if (options.blacklisted === true) return classifyUrlSafety(input, options);
  if (depth >= 5) {
    return { status: 'UNKNOWN', safe: false, reason: 'Redirect inspection reached the maximum nesting depth.' };
  }
  let parsed;
  try {
    parsed = new URL(String(input));
  } catch {
    return { status: 'UNKNOWN', safe: false, reason: 'URL syntax could not be validated.' };
  }

  const host = parsed.hostname.toLowerCase().endsWith('.') ? parsed.hostname.toLowerCase().slice(0, -1) : parsed.hostname.toLowerCase();
  if (REDIRECTOR_DOMAINS.includes(host)) {
    return { status: 'UNKNOWN', safe: false, reason: 'This is a URL-shortening service; its destination has not been resolved.' };
  }

  const candidates = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!REDIRECT_PARAM_NAMES.has(key.toLowerCase()) || !value) continue;
    let candidate = value;
    try { candidate = decodeURIComponent(candidate); } catch {}
    if (candidate.startsWith('https://') || candidate.startsWith('http://')) candidates.push(candidate);
  }

  if (candidates.length === 0) return classifyUrlSafety(input, options);

  const verdicts = candidates.map(candidate => inspectUrlRedirects(candidate, options, depth + 1));
  if (verdicts.some(verdict => verdict.status === 'SUSPICIOUS')) {
    return { status: 'SUSPICIOUS', safe: false, reason: 'A redirect parameter points to a suspicious destination.' };
  }
  return { status: 'UNKNOWN', safe: false, reason: 'A redirect destination is embedded in the URL; the final navigation target has not been verified.' };
}

function getUrlAlertLevel(result) {
  if (result && result.status === 'SAFE') return 'SAFE';
  if (result && result.status === 'SUSPICIOUS') return 'SUSPICIOUS';
  return 'UNKNOWN';
}

module.exports = { classifyUrlSafety, inspectUrlRedirects, getUrlAlertLevel, TRUSTED_DOMAINS };
