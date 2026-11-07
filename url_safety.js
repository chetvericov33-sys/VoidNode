'use strict';

const TRUSTED_DOMAINS = Object.freeze([
  'binance.com',
  'bybit.com',
  'okx.com',
  'metamask.io',
  'trustwallet.com'
]);

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

  const hostname = parsed.hostname.toLowerCase().replace(/\\.$/, '');
  if (!hostname) {
    return { status: 'UNKNOWN', safe: false, reason: 'Hostname is missing.' };
  }

  const trusted = options.trustedDomains || TRUSTED_DOMAINS;
  if (parsed.protocol === 'https:' && trusted.some(domain => hostname === domain || hostname.endsWith('.' + domain))) {
    return { status: 'SAFE', safe: true, reason: 'HTTPS host matches the configured trusted-domain allowlist.' };
  }

  const labels = hostname.split('.');
  const brandMatch = BRAND_DOMAINS.find(domain => {
    const brand = domain.split('.')[0];
    return labels.some(label => label.includes(brand)) || hostname.includes(brand);
  });
  if (brandMatch) {
    return { status: 'SUSPICIOUS', safe: false, reason: 'Hostname resembles a protected brand but is not on its trusted domain.' };
  }

  return { status: 'UNKNOWN', safe: false, reason: 'No reliable reputation evidence is available for this domain.' };
}

module.exports = { classifyUrlSafety, TRUSTED_DOMAINS };
