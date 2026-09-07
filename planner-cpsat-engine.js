import { CpModel, CpSolver, CpSolverStatus, LinearExpr } from './vendor/cpsat/index.js';

const feasible = status => status === CpSolverStatus.OPTIMAL || status === CpSolverStatus.FEASIBLE;

export async function solveRaidCpSat(state, progress = () => {}) {
  progress('CP-SAT 엔진 로딩 중…');
  const solver = await CpSolver.create();
  progress('CP-SAT 모델 구성 중…');

  const users=(state.users||[]).filter(u=>u.active&&u.attacksLeft>0);
  const bosses=state.bosses||[];
  const normal=bosses.filter(b=>[1,2,3].includes(b.round));
  const final=bosses.find(b=>b.round===4);
  const tolerance=state.settings?.damageTolerance??1_000_000_000;
  if(!Number.isSafeInteger(tolerance)||tolerance<0)throw new Error('허용 딜 오차는 0 이상의 정수여야 합니다.');
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
  // LinearExpr.plus accepts expressions or constants, not raw IntVar/BoolVar.
  const sum=items=>items.reduce((acc,item)=>acc.plus(
    item instanceof LinearExpr ? item : item.toLinearExpr()
  ),LinearExpr.fromConstant(0));
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

  const effectiveByBoss=new Map();
  const overVars=[];
  for(const boss of normal){
    const vars=candidates.filter(c=>c.boss.id===boss.id);
    const expr=sum(vars.map(c=>c.x.times(c.damage)));
    const idx=boss.round-1;
    const remaining=Math.max(0,boss.hp-(actual.get(boss.id)||0));
    model.add(expr.ge(clear[idx].times(remaining===0?0:Math.max(1,remaining-tolerance))));
    const maxPossible=(actual.get(boss.id)||0)+vars.reduce((s,c)=>s+c.damage,0);
    const over=model.newIntVar(0,Math.max(0,maxPossible-boss.hp),'over_'+boss.id);
    model.add(over.ge(expr.minus(remaining+tolerance)));
    overVars.push(over);
    const effective=model.newIntVar(0,remaining,'effective_'+boss.id);
    model.add(effective.le(expr));
    effectiveByBoss.set(boss.id,effective);
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

  let allOptimal=true;
  const optimize=(label,seconds,objective,mode,previous)=>{
    const next=solvePhase(label,seconds,objective,mode);
    allOptimal=allOptimal&&next.status===CpSolverStatus.OPTIMAL;
    return feasible(next.status)?next:previous;
  };
  let result=optimize('1/4 도달 라운드 최적화 중…',5,stageExpr,'max');
  if(!result)throw new Error('CP-SAT이 실행 가능한 공격 계획을 찾지 못했습니다.');
  const bestStage=Math.round(result.value(clear[0])+result.value(clear[1])+result.value(clear[2]));
  model.add(stageExpr.equals(bestStage));hintFrom(result);

  // AGENTS.md: progress, then damage to the final/last reachable round.
  // Early overkill must never block a stronger attack on that target.
  const targetRound=bestStage+1;
  const targetVars=normal.filter(b=>b.round===targetRound).map(b=>effectiveByBoss.get(b.id));
  const targetExpr=targetRound===4?finalExpr:sum(targetVars);
  const targetValue=result=>Math.round(targetRound===4
    ?candidates.filter(c=>c.boss.round===4).reduce((s,c)=>s+c.damage*result.value(c.x),0)
    :targetVars.reduce((s,v)=>s+result.value(v),0));
  result=optimize(targetRound===4?'2/4 최종보스 딜 최대화 중…':`2/4 마지막 도달 R${targetRound} 유효 딜 최대화 중…`,15,targetExpr,'max',result);
  const bestTarget=targetValue(result);
  model.add(targetExpr.ge(bestTarget));hintFrom(result);

  result=optimize('3/4 목표 딜 유지 · 오버딜 감소 중…',8,overExpr,'min',result);
  const bestOver=Math.round(overVars.reduce((s,v)=>s+result.value(v),0));
  model.add(overExpr.le(bestOver));hintFrom(result);
  // Reserve compatible parties for spare tickets while choosing the core.
  // Otherwise a core party can consume characters needed by two spare parties.
  const reserves=[];
  for(const user of users){
    const own=candidates.filter(c=>c.user.id===user.id);
    const available=own.filter(c=>c.boss.round===bestStage+1);
    for(const party of user.parties||[]){
      const candidate=available.find(c=>c.party.id===party.id);
      if(candidate)reserves.push({...candidate,x:model.newBoolVar('reserve_'+reserves.length)});
    }
    const combined=[...own,...reserves.filter(c=>c.user.id===user.id)];
    model.add(sum(combined.map(c=>c.x)).le(user.attacksLeft));
    for(const name of new Set(combined.flatMap(c=>c.party.nikkes)))model.add(sum(combined.filter(c=>c.party.nikkes.includes(name)).map(c=>c.x)).le(1));
  }
  result=optimize('4/4 남은 공격권 편성 확보 중…',5,attackExpr.plus(sum(reserves.map(c=>c.x))),'max',result);

  progress('최선 계획 정리 중…');
  const chosen=candidates.filter(c=>result.value(c.x)>0.5);
  // Preserve the target-damage core, then spend spare tickets on the remaining
  // round. Spare attacks must not be forced into already cleared bosses.
  const plannedDamage=new Map(actual),plannedCounts=new Map();
  const plannedUsed=new Map([...used].map(([id,names])=>[id,new Set(names)]));
  const record=c=>{
    add(plannedDamage,c.boss.id,c.damage);add(plannedCounts,c.user.id,1);
    if(!plannedUsed.has(c.user.id))plannedUsed.set(c.user.id,new Set());
    c.party.nikkes.forEach(n=>plannedUsed.get(c.user.id).add(n));
  };
  chosen.forEach(record);
  const cleared=b=>(plannedDamage.get(b.id)||0)>=Math.max(1,b.hp-tolerance);
  let extraAttacks=0;
  while(true){
    const round=[1,2,3].find(r=>normal.some(b=>b.round===r&&!cleared(b)))||4;
    let pick=null;
    const reserved=reserves.filter(c=>result.value(c.x)>0.5);
    const preferred=reserved.filter(c=>c.boss.round===round&&(round===4||!cleared(c.boss))&&(plannedCounts.get(c.user.id)||0)<c.user.attacksLeft&&!c.party.nikkes.some(n=>plannedUsed.get(c.user.id)?.has(n)));
    for(const c of preferred.length?preferred:candidates){
      if(c.boss.round!==round||(round!==4&&cleared(c.boss)))continue;
      if((plannedCounts.get(c.user.id)||0)>=c.user.attacksLeft||c.party.nikkes.some(n=>plannedUsed.get(c.user.id)?.has(n)))continue;
      const hp=round===4?Infinity:Math.max(0,c.boss.hp-(plannedDamage.get(c.boss.id)||0));
      const useful=Math.min(hp,c.damage),over=Math.max(0,c.damage-hp);
      if(!pick||useful>pick.useful||useful===pick.useful&&over<pick.over)pick={...c,useful,over};
    }
    if(!pick)break;
    chosen.push(pick);record(pick);extraAttacks++;
  }
  const reachedStage=[1,2,3].filter(r=>normal.filter(b=>b.round===r).every(cleared)).length;
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
  const targetDamage=reachedStage===3?finalDamage:normal.filter(b=>b.round===reachedStage+1).reduce((total,b)=>{
    const hp=Math.max(0,b.hp-(actual.get(b.id)||0));
    const damage=chosen.filter(c=>c.boss.id===b.id).reduce((s,c)=>s+c.damage,0);
    return total+Math.min(hp,damage);
  },0);
  return {
    status:allOptimal&&!extraAttacks?'OPTIMAL':'FEASIBLE',
    summary:{
      reachedFinal:reachedStage===3,
      reachedRound:reachedStage+1,
      attackCount:attacks.length,
      totalOverkill:attacks.reduce((s,a)=>s+a.overkill,0),
      damageTolerance:tolerance,
      unusedAttacks:users.reduce((s,u)=>s+u.attacksLeft,0)-attacks.length,
      targetRound:reachedStage+1,
      targetDamage,
      finalDamage
    },
    attacks,
    diagnostics:{activeUsers:users.length,candidates:candidates.length,totalAttackLimit:users.reduce((s,u)=>s+u.attacksLeft,0)}
  };
}
