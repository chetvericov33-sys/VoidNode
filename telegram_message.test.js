'use strict';

const assert = require('assert');
const { splitTelegramMessage } = require('./telegram_message');

assert.deepStrictEqual(splitTelegramMessage('short reply', 20), ['short reply']);
assert.deepStrictEqual(splitTelegramMessage('', 20), []);
const source = ('Первая часть ответа. Вторая часть ответа.\n').repeat(500);
const chunks = splitTelegramMessage(source, 3800);
assert.ok(chunks.length > 1, 'long responses must be split');
assert.ok(chunks.every(chunk => chunk.length <= 3800), 'each Telegram message must stay below the safe limit');
assert.strictEqual(chunks.join(''), source, 'splitting must preserve all text and whitespace');
const boundarySource = 'a'.repeat(3799) + '\\n' + 'b'.repeat(100);
const boundaryChunks = splitTelegramMessage(boundarySource, 3800);
assert.ok(boundaryChunks.every(chunk => chunk.length <= 3800));
assert.strictEqual(boundaryChunks.join(''), boundarySource);
const emojiSource = '😀'.repeat(3000);
const emojiChunks = splitTelegramMessage(emojiSource, 3800);
assert.ok(emojiChunks.every(chunk => chunk.length <= 3800));
assert.strictEqual(emojiChunks.join(''), emojiSource);
console.log('Telegram message splitting tests passed');
