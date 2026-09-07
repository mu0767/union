import assert from 'node:assert/strict';
import { solveRaidHybrid } from './planner-hybrid-engine-v3.js';

const elements=['철갑','수냉','작열','풍압','전격'];
const party=(id,element,damage,nikkes)=>({id,name:id,element,normalDamage:damage,finalDamage:damage,nikkes});
const bosses=()=>[1,2,3].flatMap(round=>elements.map(element=>({id:`${round}-${element}`,name:element,round,element,hp:100}))).concat({id:'final',name:'Final',round:4,element:'풍압',hp:'infinite'});
const done=(list,except=[])=>list.filter(b=>b.round!==4&&!except.includes(b.id)).map(b=>({userId:'done',bossId:b.id,damage:b.hp,nikkes:[]}));

{
  const bs=bosses();
  const open=['1-수냉','1-작열',...bs.filter(b=>b.round>=2&&b.round<=3).map(b=>b.id)];
  const results=done(bs,open);
  const users=[
    {id:'seolhwa',name:'설화',active:true,attacksLeft:1,parties:[
      party('seolhwa-water','수냉',100,['아니스','w2','w3','w4','w5']),
      party('seolhwa-fire','작열',100,['아니스','f2','f3','f4','f5'])
    ]},
    {id:'other',name:'다른유저',active:true,attacksLeft:1,parties:[party('other-fire','작열',100,['o1','o2','o3','o4','o5'])]}
  ];
  const plan=await solveRaidHybrid({users,bosses:bs,results,locks:[],settings:{startAt:'2026-09-07T05:00',damageTolerance:0},__solverMaxSeconds:8,__solverSeed:1});
  assert.equal(plan.summary.reachedRound,2,'R1 must be cleared');
  assert(plan.attacks.some(a=>a.partyId==='seolhwa-water'&&a.round===1));
  assert(plan.attacks.some(a=>a.partyId==='other-fire'&&a.round===1));
  assert(!plan.attacks.some(a=>a.partyId==='seolhwa-fire'));
  console.log('PASS: global cross-element swap');
}

{
  const bs=[1,2,3].flatMap(round=>elements.map(element=>({id:`${round}-${element}`,name:element,round,element,hp:round===1&&element==='작열'?150_841_813_600:100}))).concat({id:'final',name:'Final',round:4,element:'풍압',hp:'infinite'});
  const results=done(bs,['1-작열']);
  results.push({userId:'done',bossId:'1-작열',damage:134_146_924_370,nikkes:[]});
  const users=[
    {id:'fit',name:'미레온',active:true,attacksLeft:1,parties:[party('fit-fire','작열',15_990_954_991,['a','b','c','d','e'])]},
    {id:'over',name:'홍삼맛캔디',active:true,attacksLeft:1,parties:[party('over-fire','작열',20_304_443_028,['f','g','h','i','j'])]}
  ];
  const plan=await solveRaidHybrid({users,bosses:bs,results,locks:[],settings:{startAt:'2026-09-07T05:00',damageTolerance:1_000_000_000},__solverMaxSeconds:8,__solverSeed:2});
  assert.equal(plan.summary.reachedFinal,true);
  const r1=plan.attacks.filter(a=>a.round===1);
  assert.deepEqual(r1.map(a=>a.partyId),['over-fire']);
  assert.equal(r1[0].afterHp,0);
  assert(r1[0].overkill>0);
  console.log('PASS: actual residual HP ignores planning tolerance and is cleared exactly');
}

{
  const bs=bosses();
  bs.find(b=>b.id==='1-철갑').hp=196;
  bs.find(b=>b.id==='2-철갑').hp=200;
  const open=['1-철갑','2-철갑',...bs.filter(b=>b.round===3).map(b=>b.id)];
  const results=done(bs,open);
  const users=[
    {id:'strong',name:'216',active:true,attacksLeft:1,parties:[party('p216','철갑',216,['s1','s2','s3','s4','s5'])]},
    {id:'fit',name:'200',active:true,attacksLeft:1,parties:[party('p200','철갑',200,['f1','f2','f3','f4','f5'])]}
  ];
  const plan=await solveRaidHybrid({users,bosses:bs,results,locks:[],settings:{startAt:'2026-09-07T05:00',damageTolerance:0},__solverMaxSeconds:8,__solverSeed:3});
  assert.equal(plan.summary.reachedRound,3,'R1 and R2 must both clear');
  assert(plan.attacks.some(a=>a.partyId==='p200'&&a.round===1),'200 should fit R1');
  assert(plan.attacks.some(a=>a.partyId==='p216'&&a.round===2),'216 should be preserved for R2');
  assert(!plan.attacks.some(a=>a.partyId==='p216'&&a.round===1),'obvious 216/200 reverse assignment must be removed');
  console.log('PASS: obvious cross-round 216/200 swap');
}

// A single well-fitting attack must beat two attacks that create more waste.
{
  const bs=bosses();
  bs.find(b=>b.id==='1-철갑').hp=200;
  const open=['1-철갑',...bs.filter(b=>b.round>=2&&b.round<=3).map(b=>b.id)];
  const results=done(bs,open);
  const users=[
    {id:'one',name:'one',active:true,attacksLeft:1,parties:[party('p205','철갑',205,['a1','a2','a3','a4','a5'])]},
    {id:'twoa',name:'twoa',active:true,attacksLeft:1,parties:[party('p120','철갑',120,['b1','b2','b3','b4','b5'])]},
    {id:'twob',name:'twob',active:true,attacksLeft:1,parties:[party('p100','철갑',100,['c1','c2','c3','c4','c5'])]}
  ];
  const plan=await solveRaidHybrid({users,bosses:bs,results,locks:[],settings:{startAt:'2026-09-07T05:00',damageTolerance:0},__solverMaxSeconds:8,__solverSeed:4});
  const r1=plan.attacks.filter(a=>a.bossId==='1-철갑');
  assert.deepEqual(r1.map(a=>a.partyId),['p205']);
  console.log('PASS: 2:1 neighborhood cleanup prefers one fitting attack');
}


{
  const bs=bosses();
  const target=bs.find(b=>b.id==='1-전격');
  target.name='리빌드 빅 토르소';
  target.hp=100_000_000_000;
  const results=done(bs,['1-전격']);
  results.push({userId:'done',bossId:'1-전격',damage:99_655_495_183,nikkes:[]});
  const users=[
    {id:'closer',name:'마무리',active:true,attacksLeft:1,parties:[party('closer-electric','전격',1_000_000_000,['q1','q2','q3','q4','q5'])]}
  ];
  const plan=await solveRaidHybrid({users,bosses:bs,results,locks:[],settings:{startAt:'2026-09-07T05:00',damageTolerance:1_000_000_000},__solverMaxSeconds:8,__solverSeed:5});
  const hit=plan.attacks.find(a=>a.bossId==='1-전격');
  assert(hit,'344,504,817 residual HP must receive an additional attack');
  assert.equal(hit.afterHp,0);
  console.log('PASS: sub-1B actual residual receives mandatory cleanup attack');
}
