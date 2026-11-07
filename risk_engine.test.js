'use strict';
const assert = require('assert');
const { calculateRiskBreakdown } = require('./risk_engine');
function level(r){ return r.score>=70?'critical':r.score>=45?'high':r.score>=20?'medium':'low'; }
const cases=[
 ['balanced',{top:35,weights:[35,15,30,10,10],stable:30,alts:35,meaningful:5,coverageComplete:true},['low','medium']],
 ['high concentration',{top:70,weights:[70,10,10,10],stable:10,alts:20,meaningful:4,coverageComplete:true},['high','critical']],
 ['extreme concentration',{top:85,weights:[85,10,5],stable:10,alts:5,meaningful:3,coverageComplete:true},['high','critical']],
 ['low reserve',{top:45,weights:[45,25,20,10],stable:10,alts:45,meaningful:4,coverageComplete:true},['medium','high']],
 ['partial data',{top:50,weights:[50,25,25],stable:25,alts:25,meaningful:3,coverageComplete:false},['medium','high']],
 ['concentration 42',{top:42,weights:[42,25,18,15],stable:15,alts:43,meaningful:4,coverageComplete:true},['medium','high']]
];
for(const [name,input,expected] of cases){const r=calculateRiskBreakdown(input);assert(expected.includes(level(r)), name+' => '+r.score+'/'+level(r));}
const audit=calculateRiskBreakdown({top:42,weights:[42,25,18,15],stable:15,alts:43,meaningful:4,coverageComplete:true,targets:{BTC:50,USDT:20,ALTS:30}});
assert.strictEqual(calculateRiskBreakdown({top:42,stable:15,alts:43,meaningful:4,coverageComplete:true}).score >= 20, true, '42% concentration must not be classified as low');
assert.strictEqual(calculateRiskBreakdown({top:50,stable:25,alts:25,meaningful:3,coverageComplete:false}).score >= 20, true, 'partial valuation must carry a material uncertainty penalty');
const depegNone = calculateRiskBreakdown({top:25,stable:60,alts:15,meaningful:4,coverageComplete:true,stablePegRisk:0});
const depegMaterial = calculateRiskBreakdown({top:25,stable:60,alts:15,meaningful:4,coverageComplete:true,stablePegRisk:12});
assert.strictEqual(depegMaterial.score - depegNone.score, 12, 'stablecoin peg risk must increase total score by its calculated points');
assert.strictEqual(depegMaterial.breakdown.find(function(x){return x.key==='stable_peg';}).points, 12, 'stablecoin peg factor must be visible in breakdown');
const stalePrices = calculateRiskBreakdown({top:25,stable:60,alts:15,meaningful:4,coverageComplete:true,priceFreshnessRisk:15});
assert.strictEqual(stalePrices.score - depegNone.score, 15, 'stale price risk must increase total score by its calculated points');
assert.strictEqual(stalePrices.breakdown.find(function(x){return x.key==='price_freshness';}).points, 15, 'price freshness factor must be visible in breakdown');
console.log('Risk Engine tests passed:', cases.length+'/'+cases.length);
console.log('Audit example:', JSON.stringify(audit));
