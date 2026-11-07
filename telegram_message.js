'use strict';

function splitTelegramMessage(value, maxLength) {
    var text = String(value == null ? '' : value);
    var limit = Math.max(1, Number(maxLength) || 3800);
    if (!text) return [];
    var chunks = [];
    while (text.length > limit) {
        var splitAt = Math.max(text.lastIndexOf('\n', limit), text.lastIndexOf(' ', limit));
        if (splitAt < Math.floor(limit * 0.5)) splitAt = limit;
        else splitAt += 1;
        // JavaScript counts UTF-16 code units; do not separate a surrogate pair.
        if (splitAt > 0 && splitAt < text.length) {
            var prev = text.charCodeAt(splitAt - 1);
            var next = text.charCodeAt(splitAt);
            if (prev >= 0xD800 && prev <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) splitAt -= 1;
        }
        chunks.push(text.slice(0, splitAt));
        text = text.slice(splitAt);
    }
    if (text) chunks.push(text);
    return chunks;
}

module.exports = { splitTelegramMessage };
