'use strict';

function normalizeBalanceEntries(balances) {
  var grouped = new Map();
  Object.keys(balances || {}).forEach(function(rawSymbol) {
    var symbol = String(rawSymbol).trim().toUpperCase();
    if (!/^[A-Z0-9]{2,20}$/.test(symbol)) symbol = symbol || 'UNKNOWN';
    if (!grouped.has(symbol)) grouped.set(symbol, []);
    grouped.get(symbol).push(Number(balances[rawSymbol]));
  });
  var entries = [], duplicates = [];
  grouped.forEach(function(values, symbol) {
    if (values.length > 1) { duplicates.push(symbol); return; }
    entries.push({ symbol: symbol, amount: values[0] });
  });
  return { entries: entries, duplicates: duplicates };
}

function validateSpotTicker(market, ticker, base, quote) {
  if (!market) return { ok: false, reason: 'market_pair_unavailable' };
  if (market.active === false) return { ok: false, reason: 'market_inactive' };
  if (!(market.spot === true || market.type === 'spot')) return { ok: false, reason: 'market_not_spot' };
  if (market.base !== base || market.quote !== quote || market.symbol !== base + '/' + quote) {
    return { ok: false, reason: 'market_pair_mismatch' };
  }
  if (!ticker || (ticker.symbol && ticker.symbol !== market.symbol)) {
    return { ok: false, reason: 'ticker_pair_mismatch' };
  }
  var price = Number(ticker.last != null ? ticker.last : ticker.close);
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: 'invalid_or_unavailable_price' };
  return { ok: true, price: price };
}

module.exports = { normalizeBalanceEntries: normalizeBalanceEntries, validateSpotTicker: validateSpotTicker };
