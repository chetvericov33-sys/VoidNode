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
console.log('Risk Engine tests passed:', cases.length+'/'+cases.length);
console.log('Audit example:', JSON.stringify(audit));
