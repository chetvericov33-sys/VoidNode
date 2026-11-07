'use strict';
const assert = require('assert');
const {parseFeed,normalizeSymbol,filterNewsForAsset,articleMentionsAsset} = require('./crypto_news');
const now = Date.parse('2026-11-07T12:00:00Z');
const xml = '<?xml version="1.0"?><rss><channel>' +
'<item><title><![CDATA[Bitcoin ETF inflows rise sharply]]></title><link>https://example.com/btc</link><description>Institutional demand increases &amp; price rises.</description><pubDate>Sat, 07 Nov 2026 11:00:00 GMT</pubDate></item>' +
'<item><title>Old Ethereum story</title><link>https://example.com/old</link><description>Old.</description><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>' +
'<item><title>Missing publication date</title><link>https://example.com/no-date</link></item>' +
'</channel></rss>';
const parsed = parseFeed(xml,'Test Source',now);
assert.strictEqual(parsed.length,1);
assert.strictEqual(parsed[0].title,'Bitcoin ETF inflows rise sharply');
assert.strictEqual(parsed[0].description,'Institutional demand increases & price rises.');
assert.strictEqual(parsed[0].source.name,'Test Source');
assert.strictEqual(normalizeSymbol('BTC/USDT:USDT'),'BTC');
assert.strictEqual(articleMentionsAsset({title:'Ethereum upgrade is live',description:''},'ETH/USDT'),true);
assert.strictEqual(articleMentionsAsset({title:'Markets discuss the ether',description:''},'ETH'),true);
assert.strictEqual(articleMentionsAsset({title:'The weather is sunny',description:'BTC ticker mentioned'},'BTC'),true);
assert.strictEqual(filterNewsForAsset(parsed,'BTC').length,1);
console.log('Crypto RSS news tests: PASS');
