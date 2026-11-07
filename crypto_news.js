'use strict';
const FEEDS = [
 { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml' },
 { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
 { name: 'The Block', url: 'https://www.theblock.co/rss.xml' },
 { name: 'Decrypt', url: 'https://decrypt.co/feed' }
];
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
function decodeXml(value) {
 return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
  .replace(/&#(\d+);/g, function(_, n) { return String.fromCodePoint(Number(n)); })
  .replace(/&#x([0-9a-f]+);/gi, function(_, n) { return String.fromCodePoint(parseInt(n, 16)); });
}
function stripHtml(value) {
 return decodeXml(value).replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function readTag(xml, tag) {
 var match = xml.match(new RegExp('<(?:[\\w.-]+:)?' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?' + tag + '\\s*>', 'i'));
 return match ? decodeXml(match[1]).trim() : '';
}
function readLink(xml) {
 var link = readTag(xml, 'link');
 if (link) return stripHtml(link);
 var atom = xml.match(/<(?:[\w.-]+:)?link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
 return atom ? decodeXml(atom[1]).trim() : '';
}
function parseFeed(xml, sourceName, now) {
 now = Number(now) || Date.now();
 var blocks = String(xml || '').match(/<(?:[\w.-]+:)?(?:item|entry)\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?(?:item|entry)\s*>/gi) || [];
 var articles = [];
 blocks.forEach(function(block) {
  var title = stripHtml(readTag(block, 'title'));
  var description = stripHtml(readTag(block, 'description') || readTag(block, 'summary') || readTag(block, 'encoded') || readTag(block, 'content'));
  var url = readLink(block);
  var publishedAt = readTag(block, 'pubDate') || readTag(block, 'published') || readTag(block, 'updated') || readTag(block, 'date');
  var timestamp = Date.parse(publishedAt);
  if (!title || !url || !Number.isFinite(timestamp) || timestamp > now + 300000 || now - timestamp > MAX_AGE_MS) return;
  articles.push({ title:title.slice(0,300), description:description.slice(0,900), url:url, source:{name:sourceName}, publishedAt:new Date(timestamp).toISOString() });
 });
 return articles;
}
async function fetchCryptoRssNews(fetchWithTimeout, now) {
 var results = await Promise.all(FEEDS.map(async function(feed) {
  try {
   var response = await fetchWithTimeout(feed.url, {headers:{'User-Agent':'VoidNode-CryptoNews/1.0','Accept':'application/rss+xml, application/xml, text/xml'}}, 9000, 'Crypto RSS ' + feed.name);
   if (!response || !response.ok) throw new Error('HTTP ' + (response && response.status || 'unknown'));
   return parseFeed(await response.text(), feed.name, now);
  } catch (error) {
   console.warn('Crypto news source unavailable:', feed.name, String(error && error.message || error).slice(0,160));
   return [];
  }
 }));
 var byUrl = new Map();
 results.flat().forEach(function(article) {
  var key = article.url.split('?')[0].replace(/\/$/, '').toLowerCase();
  if (!byUrl.has(key)) byUrl.set(key, article);
 });
 return Array.from(byUrl.values()).sort(function(a,b){return Date.parse(b.publishedAt)-Date.parse(a.publishedAt);});
}
function normalizeSymbol(value) {
 return String(value || '').split('/')[0].split(':')[0].trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
}
var ALIASES = {
 BTC:['bitcoin'], ETH:['ethereum','ether'], SOL:['solana'], BNB:['binance coin'],
 XRP:['ripple'], DOGE:['dogecoin'], ADA:['cardano'], AVAX:['avalanche'],
 DOT:['polkadot'], LINK:['chainlink'], LTC:['litecoin'], BCH:['bitcoin cash'],
 TON:['toncoin','the open network'], TRX:['tron'], SHIB:['shiba inu'], PEPE:['pepe']
};
function articleMentionsAsset(article, rawSymbol) {
 var symbol = normalizeSymbol(rawSymbol);
 if (!symbol) return false;
 var text = String(article.title || '') + ' ' + String(article.description || '');
 var candidates = [symbol].concat(ALIASES[symbol] || []);
 return candidates.some(function(candidate) {
  var safe = candidate.replace(/[^A-Za-z0-9 ]/g,'').trim().replace(/ +/g,'\\s+');
  return new RegExp('(^|[^A-Za-z0-9])' + safe + '([^A-Za-z0-9]|$)','i').test(text);
 });
}
function filterNewsForAsset(articles, symbol) {
 return (Array.isArray(articles) ? articles : []).filter(function(article){return articleMentionsAsset(article,symbol);});
}
module.exports = {FEEDS:FEEDS,MAX_AGE_MS:MAX_AGE_MS,decodeXml:decodeXml,stripHtml:stripHtml,parseFeed:parseFeed,fetchCryptoRssNews:fetchCryptoRssNews,normalizeSymbol:normalizeSymbol,articleMentionsAsset:articleMentionsAsset,filterNewsForAsset:filterNewsForAsset};
