import { CpModel, CpSolver, CpSolverStatus } from './vendor/cpsat/index.js';

const feasible = status => status === CpSolverStatus.OPTIMAL || status === CpSolverStatus.FEASIBLE;

export async function solveRaidCpSat(state, progress = () => {}) {
  progress('CP-SAT 엔진 로딩 중…');
  const solver = await CpSolver.create();
  progress('CP-SAT 모델 구성 중…');

  const users=(state.users||[]).filter(u=>u.active&&u.attacksLeft>0);
  const bosses=state.bosses||[];
  const normal=bosses.filter(b=>[1,2,3].includes(b.round));
  const final=bosses.find(b=>b.round===4);
  if(normal.length!==15||!final)throw new Error('보스 정보가 올바르지 않습니다.');

  const actual=new Map(), used=new Map(), resultCount=new Map();
  const add=(map,key,v)=>map.set(key,(map.get(key)||0)+v);
  for(const r of state.results||[]){
    add(actual,r.bossId,Number(r.damage||0));
    add(resultCount,r.userId,1);
    if(!used.has(r.userId))used.set(r.userId,new Set());
    for(const n of r.nikkes||[])used.get(r.userId).add(n);
  }

  const model=new CpModel('union-raid');
  const zero=model.newConstant(0);
  const asExpr=value=>value?.toLinearExpr?value.toLinearExpr():value;
  const sum=items=>items.reduce((acc,item)=>acc.plus(asExpr(item)),zero.times(0));
  const candidates=[];

  for(const user of users){
    for(const party of user.parties||[]){
      if(!Number.isSafeInteger(party.normalDamage)||party.normalDamage<=0)continue;
      if(!Array.isArray(party.nikkes)||party.nikkes.length!==5)continue;
      if(party.nikkes.some(n=>used.get(user.id)?.has(n)))continue;
      for(const boss of bosses){
        if(party.element!==boss.element)continue;
        if(boss.round!==4&&(actual.get(boss.id)||0)>=boss.hp)continue;
        const damage=boss.round===4?(party.finalDamage??party.normalDamage):party.normalDamage;
        if(!Number.isSafeInteger(damage)||damage<=0)continue;
        const x=model.newBoolVar('x_'+candidates.length);
        candidates.push({x,user,party,boss,damage});
      }
    }
  }
  if(!candidates.length)throw new Error('배치 가능한 공격 후보가 없습니다.');

  for(const user of users){
    const own=candidates.filter(c=>c.user.id===user.id);
    model.add(sum(own.map(c=>c.x)).le(user.attacksLeft));
    const names=new Set(own.flatMap(c=>c.party.nikkes));
    for(const name of names){
      const vars=own.filter(c=>c.party.nikkes.includes(name)).map(c=>c.x);
      model.add(sum(vars).le(1));
    }
  }

  const clear=[1,2,3].map(r=>model.newBoolVar('clear_r'+r));
  model.add(clear[1].minus(clear[0]).le(0));
  model.add(clear[2].minus(clear[1]).le(0));

  const bossDamageExpr=new Map();
  const overVars=[];
  for(const boss of normal){
    const vars=candidates.filter(c=>c.boss.id===boss.id);
    const expr=sum(vars.map(c=>c.x.times(c.damage)));
    bossDamageExpr.set(boss.id,expr);
    const idx=boss.round-1;
    const remaining=Math.max(0,boss.hp-(actual.get(boss.id)||0));
    model.add(expr.ge(clear[idx].times(remaining)));
    const maxPossible=(actual.get(boss.id)||0)+vars.reduce((s,c)=>s+c.damage,0);
    const over=model.newIntVar(0,Math.max(0,maxPossible-boss.hp),'over_'+boss.id);
    model.add(over.ge(expr.plus((actual.get(boss.id)||0)-boss.hp)));
    overVars.push(over);
  }

  for(const c of candidates){
    if(c.boss.round===2)model.add(c.x.minus(clear[0]).le(0));
    else if(c.boss.round===3)model.add(c.x.minus(clear[1]).le(0));
    else if(c.boss.round===4)model.add(c.x.minus(clear[2]).le(0));
  }

  for(const lock of state.locks||[]){
    const match=candidates.find(c=>c.user.id===lock.userId&&c.party.id===lock.partyId&&c.boss.id===lock.bossId);
    if(match)model.add(match.x.equals(1));
  }

  const stageExpr=sum(clear);
  const attackExpr=sum(candidates.map(c=>c.x));
  const overExpr=sum(overVars);
  const finalExpr=sum(candidates.filter(c=>c.boss.round===4).map(c=>c.x.times(c.damage)));

  const solvePhase=(label,seconds,objective,mode)=>{
    progress(label);
    mode==='max'?model.maximize(objective):model.minimize(objective);
    return solver.solve(model,{
      maxTimeInSeconds:seconds,
      numWorkers:1,
      onSolution:s=>progress(label+' · 개선값 '+Math.round(s.objectiveValue).toLocaleString('ko-KR'))
    });
  };
  const hintFrom=result=>{
    model.clearHints();
    for(const c of candidates)model.addHint(c.x,result.value(c.x));
    for(const v of clear)model.addHint(v,result.value(v));
  };

  let result=solvePhase('1/4 도달 라운드 최적화 중…',5,stageExpr,'max');
  if(!feasible(result.status))throw new Error('CP-SAT이 실행 가능한 공격 계획을 찾지 못했습니다.');
  const bestStage=Math.round(result.value(clear[0])+result.value(clear[1])+result.value(clear[2]));
  model.add(stageExpr.equals(bestStage));hintFrom(result);

  result=solvePhase('2/4 공격권 사용 최적화 중…',5,attackExpr,'max');
  if(!feasible(result.status))throw new Error('공격권 최적화 중 실행 가능한 계획을 잃었습니다.');
  const bestCount=Math.round(candidates.reduce((s,c)=>s+result.value(c.x),0));
  model.add(attackExpr.equals(bestCount));hintFrom(result);

  result=solvePhase('3/4 오버딜 최소화 중…',15,overExpr,'min');
  if(!feasible(result.status))throw new Error('오버딜 최적화 중 실행 가능한 계획을 찾지 못했습니다.');
  const bestOver=Math.round(overVars.reduce((s,v)=>s+result.value(v),0));
  model.add(overExpr.equals(bestOver));hintFrom(result);

  result=solvePhase('4/4 최종보스 딜 최적화 중…',5,finalExpr,'max');
  if(!feasible(result.status))throw new Error('최종보스 최적화 중 실행 가능한 계획을 찾지 못했습니다.');

  progress('최선 계획 정리 중…');
  const chosen=candidates.filter(c=>result.value(c.x)>0.5);
  const bossOrder=new Map(bosses.map((b,i)=>[b.id,i]));
  chosen.sort((a,b)=>a.boss.round-b.boss.round||(bossOrder.get(a.boss.id)-bossOrder.get(b.boss.id))||a.user.name.localeCompare(b.user.name));

  const remaining=new Map(bosses.map(b=>[b.id,b.round===4?'infinite':Math.max(0,b.hp-(actual.get(b.id)||0))]));
  const counts=new Map();
  const origin=new Date(state.settings?.startAt||Date.now());
  const pad=n=>String(n).padStart(2,'0');
  const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const attacks=chosen.map(c=>{
    const before=remaining.get(c.boss.id);
    const after=before==='infinite'?'infinite':Math.max(0,before-c.damage);
    const over=before==='infinite'?0:Math.max(0,c.damage-before);
    remaining.set(c.boss.id,after);
    add(counts,c.user.id,1);
    const start=new Date(origin.getTime()+(c.boss.round-1)*60*60000);
    return {
      start:iso(start),timeLabel:'',isNow:false,
      userId:c.user.id,userName:c.user.name,partyId:c.party.id,partyName:c.party.name,nikkes:[...c.party.nikkes],
      bossId:c.boss.id,bossName:c.boss.name,round:c.boss.round,element:c.boss.element,damage:c.damage,
      beforeHp:before,afterHp:after,overkill:over,
      attackNumber:(resultCount.get(c.user.id)||0)+(counts.get(c.user.id)||0)
    };
  });

  const finalDamage=chosen.filter(c=>c.boss.round===4).reduce((s,c)=>s+c.damage,0);
  return {
    status:result.status===CpSolverStatus.OPTIMAL?'OPTIMAL':'FEASIBLE',
    summary:{
      reachedFinal:bestStage===3,
      reachedRound:bestStage+1,
      attackCount:attacks.length,
      totalOverkill:bestOver,
      finalDamage
    },
    attacks,
    diagnostics:{activeUsers:users.length,candidates:candidates.length,totalAttackLimit:users.reduce((s,u)=>s+u.attacksLeft,0)}
  };
}
