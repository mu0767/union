import assert from 'node:assert/strict';
import { solveRaidHybrid } from './planner-hybrid-engine-v2.js';

const elements=['철갑','수냉','작열','풍압','전격'];
function fixture(reachedFinal){
  const earlyRound=reachedFinal?3:2;
  const bosses=[1,2,3].flatMap(round=>elements.map(element=>({id:`${round}-${element}`,name:element,round,element,hp:round===3&&!reachedFinal?10_000:100})));
  bosses.push({id:'final',name:'Final',round:4,element:'풍압',hp:'infinite'});
  const results=bosses.filter(b=>b.round<=earlyRound&&b.id!==`${earlyRound}-전격`).map(b=>({userId:'done',bossId:b.id,damage:b.hp,nikkes:[]}));
  const party=(id,element,damage)=>({id,name:id,element,normalDamage:damage,finalDamage:damage,nikkes:[0,1,2,3,4].map(n=>id+n)});
  const users=[
    {id:'strong',name:'Strong',active:true,attacksLeft:1,parties:[party('exact','전격',100),party('strong-last','풍압',1000)]},
    {id:'support',name:'Support',active:true,attacksLeft:1,parties:[party('overkill','전격',150),party('weak-last','풍압',10)]}
  ];
  return {users,bosses,results,locks:[],settings:{startAt:'2026-09-07T05:00',damageTolerance:0},__solverMaxSeconds:8};
}

for(const reachedFinal of [true,false]){
  const state=fixture(reachedFinal);
  const plan=await solveRaidHybrid(state);
  assert.equal(plan.summary.reachedFinal,reachedFinal);
  assert(plan.attacks.some(a=>a.partyId==='strong-last'&&a.round===(reachedFinal?4:3)), 'Preserve the strong attack for the last round instead of minimizing early overkill');
  assert(plan.attacks.some(a=>a.partyId==='overkill'), 'Accept early overkill to increase last-round damage');
  assert.equal(plan.summary.totalOverkill,50);
  assert.equal(plan.summary.targetDamage,1000);
  if(reachedFinal)assert.equal(plan.summary.finalDamage,1000);
  console.log('PASS:',reachedFinal?'final boss':'last reachable round',plan.summary);
}

const gap=fixture(false);
gap.settings.damageTolerance=50;
gap.results.push({userId:'done',bossId:'3-전격',damage:10_000,nikkes:[]});
gap.users[0].parties[1].normalDamage=50;
gap.users[1].parties[0].normalDamage=50;
const gapPlan=await solveRaidHybrid(gap);
assert.equal(gapPlan.summary.targetDamage,50);
assert(gapPlan.attacks.some(a=>a.partyId==='strong-last'));
assert.equal(gapPlan.attacks.find(a=>a.partyId==='overkill').afterHp,50);
console.log('PASS: last-round damage outranks filling an earlier allowed HP gap');
