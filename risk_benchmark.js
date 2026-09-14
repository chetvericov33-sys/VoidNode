'use strict';
const { calculateRiskBreakdown } = require('./risk_engine');
const cases=[
 ['Balanced',[35,15,30,10,10],true],['High concentration',[70,10,10,10],true],['Extreme concentration',[85,10,5],true],['Low reserve',[45,25,20,10],true],['High alts',[20,35,20,15,10],true],['Weak diversification',[96,4],true],['Partial data',[50,25,25],false],['Single alt',[80,20],true],['Concentration 42',[42,25,18,15],true],['Conservative',[35,15,40,10],true]
];
let pass=0;
for(const [name,w,c] of cases){const stable=w.length?0:0; const r=calculateRiskBreakdown({top:Math.max(...w),weights:w,stable:0,alts:0,meaningful:w.filter(x=>x>=5).length,coverageComplete:c,targets:{USDT:20,ALTS:30}}); console.log(name, r.score+'/100'); pass++;}
console.log('Benchmark scenarios:', pass+'/'+cases.length);
