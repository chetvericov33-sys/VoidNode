const fs = require('fs');
const src = fs.readFileSync(__dirname + '/bot.js', 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
}

assert(src.includes("if (/^help_q[1-9]$/.test(data))"), 'generic help callback handler is missing');
assert(src.includes("var helpQuestionKey = data.replace(/^help_/, '');"), 'help callback normalization is missing');
assert(src.includes("var helpAnswerKey = 'help_answer_' + helpQuestionKey;"), 'help answer key construction is missing');
assert(!src.includes("help_answer_' + data"), 'unsafe help_answer_<data> construction remains');
assert(!src.match(/getText\([^\n]*['\"]help_answer_help_q/), 'broken translation lookup remains');

for (let i = 1; i <= 9; i++) {
  assert(src.includes(`help_answer_q${i}:`), `RU/EN translation key help_answer_q${i} missing`);
}

console.log('HELP HANDLER TEST: PASS — q1..q9 normalize correctly');
