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

function assessMarketLiquidity(ticker, config) {
  var bid = Number(ticker && ticker.bid), ask = Number(ticker && ticker.ask);
  var rawVolume = ticker && ticker.quoteVolume;
  var quoteVolume = rawVolume == null || rawVolume === '' ? null : Number(rawVolume);
  if (!Number.isFinite(quoteVolume) || quoteVolume < 0) quoteVolume = null;
  var spreadPct = Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid
    ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null;
  var maxSpread = Number(config && config.MAX_SPREAD_PCT);
  var minVolume = Number(config && config.MIN_QUOTE_VOLUME_USDT);
  var lowLiquidity = (spreadPct !== null && Number.isFinite(maxSpread) && spreadPct > maxSpread) ||
    (quoteVolume !== null && Number.isFinite(minVolume) && quoteVolume < minVolume);
  return { spreadPct: spreadPct, quoteVolume: quoteVolume, lowLiquidity: lowLiquidity };
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

module.exports = { normalizeBalanceEntries: normalizeBalanceEntries, validateSpotTicker: validateSpotTicker, assessMarketLiquidity: assessMarketLiquidity };
