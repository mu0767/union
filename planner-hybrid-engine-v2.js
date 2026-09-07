import { CpModel, CpSolver, CpSolverStatus, LinearExpr } from './vendor/cpsat/index.js';

const ELEMENTS=['철갑','수냉','작열','풍압','전격'];
const feasible=s=>s===CpSolverStatus.OPTIMAL||s===CpSolverStatus.FEASIBLE;
const statusText=s=>s===CpSolverStatus.OPTIMAL?'OPTIMAL':s===CpSolverStatus.FEASIBLE?'FEASIBLE':'UNKNOWN';
const add=(m,k,v)=>m.set(k,(m.get(k)||0)+v);

export async function solveRaidHybrid(state,progress=()=>{}){
  const startedAt=Date.now();
  const maxMs=Math.max(1000,Math.min(30000,Number(state.__solverMaxSeconds||30)*1000));
  const deadline=startedAt+maxMs;
  const timeLeft=()=>Math.max(0,(deadline-Date.now())/1000);
  const tolerance=state.settings?.damageTolerance??1_000_000_000;
  const users=(state.users||[]).filter(u=>u.active&&u.attacksLeft>0);
  const bosses=state.bosses||[];
  const normal=bosses.filter(b=>[1,2,3].includes(b.round));
  const final=bosses.find(b=>b.round===4);
  const powerTable=state.__levelAttackPower||{};
  if(normal.length!==15||!final)throw new Error('보스 정보가 올바르지 않습니다.');

  const actual=new Map(),usedActual=new Map(),resultCount=new Map();
  for(const r of state.results||[]){
    add(actual,r.bossId,Number(r.damage||0)); add(resultCount,r.userId,1);
    if(!usedActual.has(r.userId))usedActual.set(r.userId,new Set());
    for(const n of r.nikkes||[])usedActual.get(r.userId).add(n);
  }
  const remaining=b=>Math.max(0,Number(b.hp||0)-(actual.get(b.id)||0));
  const required=b=>Math.max(0,remaining(b)-tolerance);
  const powerFor=level=>{
    const ks=Object.keys(powerTable).map(Number).filter(k=>k<=Number(level)).sort((a,b)=>b-a);
    return ks.length?Number(powerTable[ks[0]]):null;
  };

  const raw=[];
  for(const user of users)for(const party of user.parties||[]){
    if(!Number.isSafeInteger(party.normalDamage)||party.normalDamage<=0)continue;
    if(!Array.isArray(party.nikkes)||party.nikkes.length!==5||new Set(party.nikkes).size!==5)continue;
    if(party.nikkes.some(n=>usedActual.get(user.id)?.has(n)))continue;
    for(const boss of bosses){
      if(party.element!==boss.element)continue;
      if(boss.round!==4&&required(boss)===0)continue;
      const damage=boss.round===4?(party.finalDamage??party.normalDamage):party.normalDamage;
      if(Number.isSafeInteger(damage)&&damage>0)raw.push({id:raw.length,user,party,boss,damage});
    }
  }
  if(!raw.length)throw new Error('배치 가능한 공격 후보가 없습니다.');

  const normalized=new Map();
  for(const u of users){const p=powerFor(u.level);if(!p)continue;for(const party of u.parties||[]){if(party.normalDamage>0){const a=normalized.get(party.element)||[];a.push(party.normalDamage/p);normalized.set(party.element,a);}}}
  const medians=new Map();
  for(const [e,a] of normalized){a.sort((x,y)=>x-y);const m=Math.floor(a.length/2);medians.set(e,a.length%2?a[m]:(a[m-1]+a[m])/2);}
  const eff=c=>{const p=powerFor(c.user.level),m=medians.get(c.boss.element);return p&&m?c.damage/p/m:1;};
  const elementSupply=new Map(ELEMENTS.map(e=>[e,new Set(raw.filter(c=>c.boss.element===e).map(c=>c.user.id)).size]));
  const nikkeUse=new Map();for(const c of raw)for(const n of c.party.nikkes)add(nikkeUse,n,1);
  const rarityCost=c=>{
    const supply=Math.max(1,elementSupply.get(c.boss.element)||1);
    const nikke=c.party.nikkes.reduce((s,n)=>s+Math.log1p(nikkeUse.get(n)||1),0)/5;
    return 1/supply+nikke*0.02;
  };
  const byBoss=new Map();for(const b of bosses)byBoss.set(b.id,raw.filter(c=>c.boss.id===b.id));
  const keyOf=c=>c.user.id+'|'+c.party.id+'|'+c.boss.id;

  const canAdd=(sel,c)=>{
    const own=sel.filter(x=>x.user.id===c.user.id);
    if(own.length>=c.user.attacksLeft)return false;
    const used=new Set(own.flatMap(x=>x.party.nikkes));
    return !c.party.nikkes.some(n=>used.has(n));
  };
  const bundleCanAdd=(base,bundle,c)=>canAdd([...base,...bundle],c);

  // Nested beam: a single boss may require many attacks. Grow bundles one attack
  // at a time and retain only promising partial covers instead of enumerating all combinations.
  function bundleCandidates(boss,base,limit=18){
    const already=base.filter(c=>c.boss.id===boss.id).reduce((s,c)=>s+c.damage,0);
    const need=Math.max(0,required(boss)-already);if(need<=0)return [[]];
    const all=(byBoss.get(boss.id)||[]).filter(c=>canAdd(base,c));
    if(!all.length)return [];
    const pool=[...all].sort((a,b)=>{
      const fitA=Math.abs(a.damage-need),fitB=Math.abs(b.damage-need);
      return fitA-fitB||eff(b)-eff(a)||a.damage-b.damage;
    }).slice(0,22);
    const maxDepth=Math.min(10,users.reduce((s,u)=>s+u.attacksLeft,0));
    const PARTIAL=36;
    let partial=[{arr:[],damage:0,score:1}],complete=[];
    for(let depth=0;depth<maxDepth&&partial.length;depth++){
      const next=[];
      for(const p of partial)for(const c of pool){
        if(p.arr.includes(c)||!bundleCanAdd(base,p.arr,c))continue;
        const arr=[...p.arr,c],damage=p.damage+c.damage,gap=Math.max(0,need-damage),over=Math.max(0,damage-need);
        const es=arr.reduce((s,x)=>s+eff(x),0)/arr.length;
        const rare=arr.reduce((s,x)=>s+rarityCost(x),0);
        const ds=arr.map(x=>x.damage),spread=arr.length>1?(Math.max(...ds)-Math.min(...ds))/Math.max(...ds):0;
        const score=gap/Math.max(1,need)+over/Math.max(1,need)*1.4+arr.length*0.022+rare*0.035-es*0.055-spread*0.01;
        const item={arr,damage,score,over};
        if(damage>=need)complete.push(item);else next.push(item);
      }
      const dedupe=new Map();
      for(const p of next){const k=p.arr.map(x=>x.id).sort((a,b)=>a-b).join(',');if(!dedupe.has(k)||p.score<dedupe.get(k).score)dedupe.set(k,p);}
      partial=[...dedupe.values()].sort((a,b)=>a.score-b.score).slice(0,PARTIAL);
      if(complete.length>=limit*4&&depth>=2)break;
    }
    complete.sort((a,b)=>a.score-b.score||a.over-b.over||a.arr.length-b.arr.length);
    const seen=new Set(),out=[];
    for(const p of complete){const k=p.arr.map(x=>x.id).sort((a,b)=>a-b).join(',');if(seen.has(k))continue;seen.add(k);out.push(p.arr);if(out.length>=limit)break;}
    return out;
  }

  function stateScore(s){
    let waste=0,effSum=0,rare=0;
    for(const b of normal){const d=s.sel.filter(c=>c.boss.id===b.id).reduce((x,c)=>x+c.damage,0);if(d)waste+=Math.max(0,d-required(b));}
    for(const c of s.sel){effSum+=eff(c);rare+=rarityCost(c);}
    return waste/1e9+s.sel.length*0.10+rare*0.05-effSum*0.075;
  }

  // Completed attacks are immutable history. If their real damage leaves HP behind,
  // first build a forced repair allocation from remaining legal resources so the
  // optimizer never behaves as if an already-used better attack were still available.
  function forcedRepair(base){
    let sel=[...base];
    for(const round of [1,2,3]){
      for(const boss of normal.filter(b=>b.round===round)){
        if((actual.get(boss.id)||0)<=0)continue;
        const done=(actual.get(boss.id)||0)+sel.filter(c=>c.boss.id===boss.id).reduce((s,c)=>s+c.damage,0);
        // Once real combat has been recorded on a boss, planning tolerance no longer applies:
        // any positive residual HP must be assigned to a legal remaining attack.
        let need=Math.max(0,Number(boss.hp||0)-done);
        if(need<=0)continue;
        const pool=(byBoss.get(boss.id)||[]).filter(c=>canAdd(sel,c)).sort((a,b)=>{
          const ao=Math.max(0,a.damage-need),bo=Math.max(0,b.damage-need);
          return ao-bo||Math.abs(a.damage-need)-Math.abs(b.damage-need)||eff(b)-eff(a)||a.damage-b.damage;
        });
        for(const cand of pool){
          if(!canAdd(sel,cand))continue;
          sel.push(cand);need-=cand.damage;
          if(need<=0)break;
        }
        if(need>0)return{ok:false,sel,boss,missing:need};
      }
    }
    return{ok:true,sel};
  }

  progress('완료 공격 반영 · 남은 HP 강제 보정 배치 중…');
  const repaired=forcedRepair([]);
  const repairSeed=repaired.sel;

  progress('초기 Beam Search · 라운드 자원 배치 중…');
  let beam=[{sel:repairSeed}],reached=0;
  const BEAM=24;
  for(const round of [1,2,3]){
    let roundBeam=beam,ok=true;
    for(const boss of normal.filter(b=>b.round===round)){
      const next=[];
      for(const s of roundBeam){
        for(const bundle of bundleCandidates(boss,s.sel)){
          let sel=[...s.sel],valid=true;
          for(const c of bundle){if(!canAdd(sel,c)){valid=false;break;}sel.push(c);}
          if(valid)next.push({sel});
        }
      }
      next.sort((a,b)=>stateScore(a)-stateScore(b));
      roundBeam=next.slice(0,BEAM);
      if(!roundBeam.length){ok=false;break;}
    }
    if(!ok)break;
    beam=roundBeam;reached=round;
  }
  let heuristic=beam[0]?.sel||[];
  if(reached===3){
    const finals=(byBoss.get(final.id)||[]).sort((a,b)=>b.damage-a.damage||eff(b)-eff(a));
    for(const c of finals)if(canAdd(heuristic,c))heuristic.push(c);
  }

  const evalPlan=sel=>{
    const dmg=new Map(actual);for(const c of sel)add(dmg,c.boss.id,c.damage);
    let stage=0;for(const r of [1,2,3]){if(normal.filter(b=>b.round===r).every(b=>(dmg.get(b.id)||0)>=Math.max(0,b.hp-tolerance)))stage=r;else break;}
    const tr=stage+1;
    const target=stage===3?sel.filter(c=>c.boss.round===4).reduce((s,c)=>s+c.damage,0):normal.filter(b=>b.round===tr).reduce((s,b)=>{const d=sel.filter(c=>c.boss.id===b.id).reduce((x,c)=>x+c.damage,0);return s+Math.min(remaining(b),d);},0);
    let waste=0;for(const b of normal.filter(b=>b.round<tr)){const d=sel.filter(c=>c.boss.id===b.id).reduce((s,c)=>s+c.damage,0);waste+=Math.max(0,d-required(b));}
    return{stage,target,waste};
  };
  // Practical target equivalence: tiny target differences should not block a large waste reduction.
  const targetSlack=Math.max(1,tolerance||1);
  const better=(a,b)=>{
    if(a.stage!==b.stage)return a.stage>b.stage;
    if(a.target>b.target+targetSlack)return true;
    if(b.target>a.target+targetSlack)return false;
    return a.waste<b.waste;
  };

  function localSwap(sel,maxPass=8){
    let cur=[...sel],passes=0,improved=true;
    while(improved&&passes++<maxPass){
      improved=false;const base=evalPlan(cur);
      outer:for(let i=0;i<cur.length;i++)for(let j=i+1;j<cur.length;j++){
        const a=cur[i],b=cur[j];
        if(a.boss.round===4||b.boss.round===4||a.boss.element!==b.boss.element||a.boss.round===b.boss.round)continue;
        const aa=raw.find(c=>c.user.id===a.user.id&&c.party.id===a.party.id&&c.boss.round===b.boss.round&&c.boss.element===a.boss.element);
        const bb=raw.find(c=>c.user.id===b.user.id&&c.party.id===b.party.id&&c.boss.round===a.boss.round&&c.boss.element===b.boss.element);
        if(!aa||!bb)continue;
        const trial=[...cur];trial[i]=aa;trial[j]=bb;
        const ev=evalPlan(trial);
        if(better(ev,base)){cur=trial;improved=true;break outer;}
      }
    }
    return{sel:cur,passes};
  }

  progress('로컬 개선 · 라운드 간 swap 정리 중…');
  let local=localSwap(heuristic,8);heuristic=local.sel;

  progress('CP-SAT 전역 개선 모델 구성 중…');
  const solver=await CpSolver.create();const model=new CpModel('union-raid-hybrid-v2');
  const sum=xs=>xs.reduce((a,x)=>a.plus(x instanceof LinearExpr?x:x.toLinearExpr()),LinearExpr.fromConstant(0));
  const vars=raw.map(c=>({...c,x:model.newBoolVar('x_'+c.id)}));
  for(const u of users){const own=vars.filter(c=>c.user.id===u.id);model.add(sum(own.map(c=>c.x)).le(u.attacksLeft));const ns=new Set(own.flatMap(c=>c.party.nikkes));for(const n of ns)model.add(sum(own.filter(c=>c.party.nikkes.includes(n)).map(c=>c.x)).le(1));}
  const clear=[1,2,3].map(r=>model.newBoolVar('clear_r'+r));model.add(clear[1].minus(clear[0]).le(0));model.add(clear[2].minus(clear[1]).le(0));
  const assigned=new Map(),effective=new Map();
  for(const b of normal){const cs=vars.filter(c=>c.boss.id===b.id),expr=sum(cs.map(c=>c.x.times(c.damage)));assigned.set(b.id,expr);model.add(expr.ge(clear[b.round-1].times(required(b))));const e=model.newIntVar(0,remaining(b),'eff_'+b.id);model.add(e.le(expr));effective.set(b.id,e);}
  for(const c of vars){if(c.boss.round===2)model.add(c.x.minus(clear[0]).le(0));else if(c.boss.round===3)model.add(c.x.minus(clear[1]).le(0));else if(c.boss.round===4)model.add(c.x.minus(clear[2]).le(0));}
  for(const lock of state.locks||[]){const c=vars.find(x=>x.user.id===lock.userId&&x.party.id===lock.partyId&&x.boss.id===lock.bossId);if(!c)throw new Error('잠긴 공격 중 배치할 수 없는 항목이 있습니다.');model.add(c.x.equals(1));}
  const hev=evalPlan(heuristic),hintKeys=new Set(heuristic.map(keyOf));for(const c of vars)model.addHint(c.x,hintKeys.has(keyOf(c))?1:0);for(let r=0;r<3;r++)model.addHint(clear[r],hev.stage>r?1:0);
  const solve=(label,obj,mode,seconds)=>{const budget=Math.min(seconds,timeLeft());if(budget<=0.05)return null;progress(label);mode==='max'?model.maximize(obj):model.minimize(obj);return solver.solve(model,{maxTimeInSeconds:budget,numWorkers:globalThis.crossOriginIsolated?Math.min(8,Number(globalThis.navigator?.hardwareConcurrency)||1):1,randomSeed:Number(state.__solverSeed)||1,randomizeSearch:true});};
  const stageExpr=sum(clear);let result=solve('전역 개선 1/3 · 도달 라운드 확인 중…',stageExpr,'max',Math.min(3,timeLeft()));
  if(!result||!feasible(result.status)){
    progress('CP-SAT 초기 탐색 실패 · Beam+Local 초기해를 반환합니다.');
    const ev=evalPlan(heuristic),bossOrder=new Map(bosses.map((b,i)=>[b.id,i]));
    const selected=[...heuristic].sort((a,b)=>a.boss.round-b.boss.round||(bossOrder.get(a.boss.id)-bossOrder.get(b.boss.id))||a.user.name.localeCompare(b.user.name));
    const rem=new Map(bosses.map(b=>[b.id,b.round===4?'infinite':remaining(b)])),counts=new Map();const origin=new Date(state.settings?.startAt||Date.now()),pad=n=>String(n).padStart(2,'0'),iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const attacks=selected.map(c=>{const before=rem.get(c.boss.id),after=before==='infinite'?'infinite':Math.max(0,before-c.damage),over=before==='infinite'?0:Math.max(0,c.damage-before);rem.set(c.boss.id,after);add(counts,c.user.id,1);return{start:iso(new Date(origin.getTime()+(c.boss.round-1)*3600000)),timeLabel:'',isNow:false,userId:c.user.id,userName:c.user.name,partyId:c.party.id,partyName:c.party.name,nikkes:[...c.party.nikkes],bossId:c.boss.id,bossName:c.boss.name,round:c.boss.round,element:c.boss.element,damage:c.damage,beforeHp:before,afterHp:after,overkill:over,attackNumber:(resultCount.get(c.user.id)||0)+(counts.get(c.user.id)||0)};});
    const planningWaste=normal.filter(b=>b.round<ev.stage+1).reduce((s,b)=>{const d=selected.filter(c=>c.boss.id===b.id).reduce((x,c)=>x+c.damage,0);return s+Math.max(0,d-required(b));},0);
    return{status:'FEASIBLE',summary:{reachedFinal:ev.stage===3,reachedRound:ev.stage+1,attackCount:attacks.length,totalOverkill:attacks.reduce((s,a)=>s+a.overkill,0),planningWaste,damageTolerance:tolerance,targetGranularity:0,targetBand:0,unusedAttacks:users.reduce((s,u)=>s+u.attacksLeft,0)-attacks.length,targetRound:ev.stage+1,targetDamage:ev.target,finalDamage:ev.stage===3?ev.target:0,optimization:{stage:'HEURISTIC',target:'HEURISTIC',waste:'BEAM+LOCAL'}},attacks,diagnostics:{activeUsers:users.length,candidates:raw.length,totalAttackLimit:users.reduce((s,u)=>s+u.attacksLeft,0),seed:Number(state.__solverSeed)||1,elapsedSeconds:Math.round((Date.now()-startedAt)/1000),searchPolicy:'beam-local-fallback',beamWidth:BEAM,heuristicStage:reached,localSwapPasses:local.passes}};
  }
  const bestStage=Math.round(clear.reduce((s,v)=>s+result.value(v),0));model.add(stageExpr.equals(bestStage));for(const c of vars)model.addHint(c.x,result.value(c.x));
  const targetRound=bestStage+1,targetExpr=targetRound===4?sum(vars.filter(c=>c.boss.round===4).map(c=>c.x.times(c.damage))):sum(normal.filter(b=>b.round===targetRound).map(b=>effective.get(b.id)));
  const targetMax=targetRound===4?vars.filter(c=>c.boss.round===4).reduce((s,c)=>s+c.damage,0):normal.filter(b=>b.round===targetRound).reduce((s,b)=>s+remaining(b),0);
  const gran=Math.min(Math.max(1,tolerance||1),Math.max(1,Math.floor(targetMax/100))),band=model.newIntVar(0,Math.max(0,Math.floor(targetMax/gran)),'band');model.add(targetExpr.ge(band.times(gran)));
  const cleanupReserve=Math.min(5,Math.max(2,timeLeft()*0.25));const r2=solve('전역 개선 2/3 · 큰 딜 개선 탐색 중…',band,'max',Math.max(0.5,timeLeft()-cleanupReserve));if(r2&&feasible(r2.status))result=r2;
  const bestBand=Math.round(result.value(band));model.add(band.equals(bestBand));for(const c of vars)model.addHint(c.x,result.value(c.x));
  const wastes=[];for(const b of normal.filter(b=>b.round<targetRound)){const mx=vars.filter(c=>c.boss.id===b.id).reduce((s,c)=>s+c.damage,0);if(!mx)continue;const w=model.newIntVar(0,Math.max(0,mx-required(b)),'w_'+b.id);model.add(w.ge(assigned.get(b.id).minus(required(b))));wastes.push(w);}
  if(wastes.length&&timeLeft()>0.15){const r3=solve('전역 개선 3/3 · 앞 라운드 낭비 정리 중…',sum(wastes),'min',timeLeft());if(r3&&feasible(r3.status))result=r3;}

  let selected=vars.filter(c=>result.value(c.x)>0.5).map(({x,...c})=>c);const sanity=localSwap(selected,10);selected=sanity.sel;
  const ev=evalPlan(selected),bossOrder=new Map(bosses.map((b,i)=>[b.id,i]));selected.sort((a,b)=>a.boss.round-b.boss.round||(bossOrder.get(a.boss.id)-bossOrder.get(b.boss.id))||a.user.name.localeCompare(b.user.name));
  const rem=new Map(bosses.map(b=>[b.id,b.round===4?'infinite':remaining(b)])),counts=new Map();const origin=new Date(state.settings?.startAt||Date.now()),pad=n=>String(n).padStart(2,'0'),iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const attacks=selected.map(c=>{const before=rem.get(c.boss.id),after=before==='infinite'?'infinite':Math.max(0,before-c.damage),over=before==='infinite'?0:Math.max(0,c.damage-before);rem.set(c.boss.id,after);add(counts,c.user.id,1);return{start:iso(new Date(origin.getTime()+(c.boss.round-1)*3600000)),timeLabel:'',isNow:false,userId:c.user.id,userName:c.user.name,partyId:c.party.id,partyName:c.party.name,nikkes:[...c.party.nikkes],bossId:c.boss.id,bossName:c.boss.name,round:c.boss.round,element:c.boss.element,damage:c.damage,beforeHp:before,afterHp:after,overkill:over,attackNumber:(resultCount.get(c.user.id)||0)+(counts.get(c.user.id)||0)};});
  const planningWaste=normal.filter(b=>b.round<ev.stage+1).reduce((s,b)=>{const d=selected.filter(c=>c.boss.id===b.id).reduce((x,c)=>x+c.damage,0);return s+Math.max(0,d-required(b));},0);
  return{status:'FEASIBLE',summary:{reachedFinal:ev.stage===3,reachedRound:ev.stage+1,attackCount:attacks.length,totalOverkill:attacks.reduce((s,a)=>s+a.overkill,0),planningWaste,damageTolerance:tolerance,targetGranularity:gran,targetBand:bestBand,unusedAttacks:users.reduce((s,u)=>s+u.attacksLeft,0)-attacks.length,targetRound:ev.stage+1,targetDamage:ev.target,finalDamage:ev.stage===3?ev.target:0,optimization:{stage:statusText(result.status),target:'PRACTICAL',waste:'BEAM+LOCAL+CP-SAT'}},attacks,diagnostics:{activeUsers:users.length,candidates:raw.length,totalAttackLimit:users.reduce((s,u)=>s+u.attacksLeft,0),seed:Number(state.__solverSeed)||1,elapsedSeconds:Math.round((Date.now()-startedAt)/1000),searchPolicy:'nested-beam-local-cpsat-sanity',beamWidth:BEAM,heuristicStage:reached,localSwapPasses:local.passes,sanitySwapPasses:sanity.passes}};
}
