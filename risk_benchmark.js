'use strict';

const assert = require('assert');
const { calculateRiskBreakdown } = require('./risk_engine');

const cases = [
  ['Balanced', { top: 35, stable: 30, alts: 35, meaningful: 5, coverageComplete: true }, 'low'],
  ['High concentration', { top: 70, stable: 10, alts: 20, meaningful: 4, coverageComplete: true }, 'high'],
  ['Extreme concentration', { top: 85, stable: 10, alts: 5, meaningful: 3, coverageComplete: true }, 'high'],
  ['Low reserve', { top: 45, stable: 10, alts: 45, meaningful: 4, coverageComplete: true }, 'medium'],
  ['High alts', { top: 20, stable: 20, alts: 60, meaningful: 4, coverageComplete: true }, 'low'],
  ['Weak diversification', { top: 96, stable: 4, alts: 0, meaningful: 2, coverageComplete: true }, 'critical'],
  ['Partial data', { top: 50, stable: 25, alts: 25, meaningful: 3, coverageComplete: false }, 'medium'],
  ['Single alt', { top: 80, stable: 20, alts: 80, meaningful: 1, coverageComplete: true }, 'critical'],
  ['Concentration 42', { top: 42, stable: 15, alts: 43, meaningful: 4, coverageComplete: true }, 'medium'],
  ['Conservative', { top: 35, stable: 40, alts: 25, meaningful: 5, coverageComplete: true }, 'low']
];

function level(score) {
  return score >= 70 ? 'critical' : score >= 45 ? 'high' : score >= 20 ? 'medium' : 'low';
}

let pass = 0;
for (const [name, input, expected] of cases) {
  const result = calculateRiskBreakdown(input);
  const actual = level(result.score);
  assert.strictEqual(actual, expected, name + ': expected ' + expected + ', got ' + actual + ' (' + result.score + '/100)');
  console.log(name + ': ' + result.score + '/100 (' + actual + ')');
  pass++;
}
console.log('Risk benchmark:', pass + '/' + cases.length + ' passed');
