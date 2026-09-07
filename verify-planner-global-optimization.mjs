import assert from 'node:assert/strict';
import { solveRaidCpSat } from './planner-cpsat-engine.js';

const elements=['철갑','수냉','작열','풍압','전격'];
const party=(id,element,damage,nikkes)=>({id,name:id,element,normalDamage:damage,finalDamage:damage,nikkes});
const bosses=()=>[1,2,3].flatMap(round=>elements.map(element=>({id:`${round}-${element}`,name:element,round,element,hp:100}))).concat({id:'final',name:'Final',round:4,element:'풍압',hp:'infinite'});
const done=(list,except=[])=>list.filter(b=>b.round!==4&&!except.includes(b.id)).map(b=>({userId:'done',bossId:b.id,damage:b.hp,nikkes:[]}));

// Global swap regression: the shared character must be reserved for water while
// another member covers fire. A local/greedy choice of Seolhwa-fire blocks R1.
{
  const bs=bosses();
  const open=['1-수냉','1-작열'];
  const results=done(bs,open.concat(bs.filter(b=>b.round>=2&&b.round<=3).map(b=>b.id)));
  const users=[
    {id:'seolhwa',name:'설화',active:true,attacksLeft:1,parties:[
      party('seolhwa-water','수냉',100,['아니스','w2','w3','w4','w5']),
      party('seolhwa-fire','작열',100,['아니스','f2','f3','f4','f5'])
    ]},
    {id:'other',name:'다른유저',active:true,attacksLeft:1,parties:[
      party('other-fire','작열',100,['o1','o2','o3','o4','o5'])
    ]}
  ];
  const plan=await solveRaidCpSat({users,bosses:bs,results,locks:[],settings:{startAt:'2026-09-07T05:00',damageTolerance:0},__solverMaxSeconds:20,__solverSeed:1});
  assert.equal(plan.summary.reachedRound,2,'R1 must be cleared');
  assert(plan.attacks.some(a=>a.partyId==='seolhwa-water'&&a.round===1),'설화의 공유 니케는 수냉에 배치해야 한다');
  assert(plan.attacks.some(a=>a.partyId==='other-fire'&&a.round===1),'다른 유저가 작열을 담당해야 한다');
  assert(!plan.attacks.some(a=>a.partyId==='seolhwa-fire'),'설화를 작열에 고정하는 greedy 해를 선택하면 안 된다');
  console.log('PASS: global cross-element swap');
}

// Tolerance/waste regression modeled after the observed 3.6B overkill case.
// With 1B tolerance, 15.991B is enough to clear, while 20.304B causes real overkill.
{
  const bs=[1,2,3].flatMap(round=>elements.map(element=>({id:`${round}-${element}`,name:element,round,element,hp:round===1&&element==='작열'?150_841_813_600:100}))).concat({id:'final',name:'Final',round:4,element:'풍압',hp:'infinite'});
  const open=['1-작열'];
  const results=done(bs,open.concat(bs.filter(b=>b.round>=2&&b.round<=3).map(b=>b.id)));
  results.push({userId:'done',bossId:'1-작열',damage:134_146_924_370,nikkes:[]});
  // Remove the symmetric "use the other fire party on R2" tie. R2 fire is
  // already done, while the other R2 bosses remain open and cannot be cleared.
  results.push({userId:'done',bossId:'2-작열',damage:100,nikkes:[]});
  const users=[
    {id:'fit',name:'미레온',active:true,attacksLeft:1,parties:[party('fit-fire','작열',15_990_954_991,['a','b','c','d','e'])]},
    {id:'over',name:'홍삼맛캔디',active:true,attacksLeft:1,parties:[party('over-fire','작열',20_304_443_028,['f','g','h','i','j'])]}
  ];
  const plan=await solveRaidCpSat({users,bosses:bs,results,locks:[],settings:{startAt:'2026-09-07T05:00',damageTolerance:1_000_000_000},__solverMaxSeconds:20,__solverSeed:2});
  assert.equal(plan.summary.reachedRound,2,'1B tolerance should count the boss as cleared');
  const r1=plan.attacks.filter(a=>a.round===1);
  assert.deepEqual(r1.map(a=>a.partyId),['fit-fire']);
  assert.equal(r1[0].afterHp,703_934_239);
  assert.equal(r1[0].overkill,0);
  console.log('PASS: tolerance threshold prefers the low-waste clear');
}
