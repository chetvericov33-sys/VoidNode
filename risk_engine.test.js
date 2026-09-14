const assert=require('assert');
const {calculateRiskBreakdown}=require('./risk_engine');

function level(score){return score>=70?'critical':score>=45?'high':score>=20?'medium':'low';}
function score(top,stable,alts,meaningful,coverageComplete=true){
  return calculateRiskBreakdown({top,weights:[top],stable,alts,meaningful,coverageComplete,targets:{BTC:50,USDT:20,ALTS:30}});
}

const scenarios=[
  ['balanced',40,20,40,5,true,['low','medium']],
  ['high concentration',70,10,20,4,true,['high','critical']],
  ['extreme concentration',85,10,5,3,true,['high','critical']],
  ['low reserve',45,10,45,4,true,['medium','high']],
  ['high alts',35,10,55,5,true,['medium','high']],
  ['weak diversification',96,4,0,2,true,['high','critical']],
  ['partial data',50,25,25,3,false,['medium','high']],
  ['single alt',80,20,80,2,true,['high','critical']],
  ['concentration 42',42,15,57,4,true,['medium','high']],
  ['conservative',35,40,25,4,true,['low','medium']]
];

for(const s of scenarios){
  const r=score(s[1],s[2],s[3],s[4],s[5]);
  const sum=r.breakdown.reduce((a,x)=>a+x.points,0);
  assert.strictEqual(r.score,sum,`${s[0]}: score must equal factor sum`);
  assert(r.score>=0&&r.score<=100,`${s[0]}: score out of range`);
  assert(s[6].includes(level(r.score)),`${s[0]}: unexpected level ${level(r.score)} for ${r.score}`);
}

// User-facing audit example: 42% top position must contribute exactly +18 concentration points.
const audit=score(42,15,57,4,true);
const concentration=audit.breakdown.find(x=>x.key==='concentration');
assert.strictEqual(concentration.points,18);
const multi=calculateRiskBreakdown({top:42,weights:[42,35,18],stable:5,alts:53,meaningful:3,coverageComplete:true,targets:{BTC:50,USDT:20,ALTS:30}});
const multiConcentration=multi.breakdown.find(x=>x.key==='concentration');
assert.strictEqual(multiConcentration.subFactors[0].points,18);
assert(multiConcentration.subFactors[1].points>0);
assert.strictEqual(audit.score,concentration.points+audit.breakdown.filter(x=>x.key!=='concentration').reduce((a,x)=>a+x.points,0));

console.log(`Risk Engine benchmark: ${scenarios.length}/${scenarios.length} scenarios passed`);
console.log(`Audit example: concentration=${concentration.points}, total=${audit.score}/100, level=${level(audit.score)}`);
