import { CpModel, CpSolver, CpSolverStatus, LinearExpr } from './vendor/cpsat/index.js';

const feasible = status => status === CpSolverStatus.OPTIMAL || status === CpSolverStatus.FEASIBLE;
const statusText = status => status === CpSolverStatus.OPTIMAL ? 'OPTIMAL' : status === CpSolverStatus.FEASIBLE ? 'FEASIBLE' : 'UNKNOWN';

export async function solveRaidCpSat(state, progress = () => {}) {
  progress('CP-SAT 엔진 로딩 중…');
  const solver = await CpSolver.create();
  progress('CP-SAT 전역 모델 구성 중…');

  const users=(state.users||[]).filter(u=>u.active&&u.attacksLeft>0);
  const bosses=state.bosses||[];
  const normal=bosses.filter(b=>[1,2,3].includes(b.round));
  const final=bosses.find(b=>b.round===4);
  const tolerance=state.settings?.damageTolerance??1_000_000_000;
  const maxSeconds=Math.max(1,Math.min(300,Number(state.__solverMaxSeconds??state.settings?.solverMaxSeconds??300)||300));
  const seed=Math.max(1,Math.floor(Number(state.__solverSeed)||1));
  const hardware=Math.max(1,Math.floor(Number(globalThis.navigator?.hardwareConcurrency)||1));
  const solverWorkers=globalThis.crossOriginIsolated===true?Math.min(8,hardware):1;
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

  const model=new CpModel('union-raid-global');
  const sum=items=>items.reduce((acc,item)=>acc.plus(
    item instanceof LinearExpr ? item : item.toLinearExpr()
  ),LinearExpr.fromConstant(0));
  const candidates=[];
  const clearThreshold=boss=>Math.max(0,boss.hp-tolerance-(actual.get(boss.id)||0));
  const actualRemaining=boss=>Math.max(0,boss.hp-(actual.get(boss.id)||0));

  for(const user of users){
    if(!Number.isInteger(user.attacksLeft)||user.attacksLeft<0||user.attacksLeft>3)throw new Error(`${user.name}: 남은 공격권은 0~3이어야 합니다.`);
    for(const party of user.parties||[]){
      if(!Number.isSafeInteger(party.normalDamage)||party.normalDamage<=0)continue;
      if(!Array.isArray(party.nikkes)||party.nikkes.length!==5||new Set(party.nikkes).size!==5)continue;
      if(party.nikkes.some(n=>used.get(user.id)?.has(n)))continue;
      for(const boss of bosses){
        if(party.element!==boss.element)continue;
        if(boss.round!==4&&clearThreshold(boss)===0)continue;
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

  const assignedByBoss=new Map();
  const effectiveByBoss=new Map();
  for(const boss of normal){
    const vars=candidates.filter(c=>c.boss.id===boss.id);
    const expr=sum(vars.map(c=>c.x.times(c.damage)));
    assignedByBoss.set(boss.id,expr);
    const required=clearThreshold(boss);
    model.add(expr.ge(clear[boss.round-1].times(required)));
    const remaining=actualRemaining(boss);
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
    if(!match)throw new Error('잠긴 공격 중 현재 조건에서 배치할 수 없는 항목이 있습니다.');
    model.add(match.x.equals(1));
  }

  const stageExpr=sum(clear);
  const finalExpr=sum(candidates.filter(c=>c.boss.round===4).map(c=>c.x.times(c.damage)));
  const startedAt=Date.now();
  const remainingSeconds=()=>Math.max(0,(maxSeconds*1000-(Date.now()-startedAt))/1000);
  const solvePhase=(label,objective,mode)=>{
    const seconds=remainingSeconds();
    if(seconds<0.05)return null;
    progress(`${label} · 최대 ${Math.ceil(seconds)}초 · ${solverWorkers} worker`);
    mode==='max'?model.maximize(objective):model.minimize(objective);
    return solver.solve(model,{
      maxTimeInSeconds:seconds,
      numWorkers:solverWorkers,
      randomSeed:seed,
      randomizeSearch:true,
      onSolution:s=>progress(`${label} · 현재값 ${Math.round(s.objectiveValue).toLocaleString('ko-KR')}`)
    });
  };
  const hintFrom=result=>{
    model.clearHints();
    for(const c of candidates)model.addHint(c.x,result.value(c.x));
    for(const v of clear)model.addHint(v,result.value(v));
  };

  const optimization={stage:'SKIPPED',target:'SKIPPED',waste:'SKIPPED'};
  let result=solvePhase('1/3 최대 도달 라운드 증명 중…',stageExpr,'max');
  if(!result||!feasible(result.status))throw new Error('CP-SAT이 실행 가능한 공격 계획을 찾지 못했습니다.');
  optimization.stage=statusText(result.status);
  const bestStage=Math.round(result.value(clear[0])+result.value(clear[1])+result.value(clear[2]));
  const targetRound=bestStage+1;

  // Never spend time on a lower-priority objective until the higher-priority one
  // has been proven optimal. If the five-minute budget expires here, return the
  // best stage-feasible plan and mark it as unproven instead of pretending that
  // a secondary objective was optimized.
  let targetExpr=null;
  let targetValue=null;
  if(result.status===CpSolverStatus.OPTIMAL&&remainingSeconds()>0.05){
    model.add(stageExpr.equals(bestStage));
    hintFrom(result);
    const targetVars=targetRound===4
      ? candidates.filter(c=>c.boss.round===4)
      : normal.filter(b=>b.round===targetRound).map(b=>effectiveByBoss.get(b.id));
    targetExpr=targetRound===4
      ? finalExpr
      : sum(targetVars);
    targetValue=current=>Math.round(targetRound===4
      ? targetVars.reduce((total,c)=>total+c.damage*current.value(c.x),0)
      : targetVars.reduce((total,v)=>total+current.value(v),0));
    const targetResult=solvePhase(
      targetRound===4?'2/3 최종보스 딜 최적해 증명 중…':`2/3 R${targetRound} 유효 딜 최적해 증명 중…`,
      targetExpr,'max'
    );
    if(targetResult&&feasible(targetResult.status)){
      result=targetResult;
      optimization.target=statusText(targetResult.status);
    }
  }

  let planningWaste=null;
  if(optimization.target==='OPTIMAL'&&remainingSeconds()>0.05){
    const bestTarget=targetValue(result);
    model.add(targetExpr.equals(bestTarget));
    hintFrom(result);

    const wasteVars=[];
    for(const boss of normal){
      if(boss.round>targetRound)continue;
      const expr=assignedByBoss.get(boss.id);
      const vars=candidates.filter(c=>c.boss.id===boss.id);
      const maxAssigned=vars.reduce((s,c)=>s+c.damage,0);
      if(!maxAssigned)continue;
      // Earlier cleared rounds only need to reach HP - tolerance. Any planned
      // damage above that threshold consumes resources that could have been used
      // later. On the target round, only true HP overkill is waste because useful
      // damage up to the actual remaining HP is the phase-2 objective.
      const baseline=boss.round<targetRound?clearThreshold(boss):actualRemaining(boss);
      const waste=model.newIntVar(0,Math.max(0,maxAssigned-baseline),'waste_'+boss.id);
      model.add(waste.ge(expr.minus(baseline)));
      wasteVars.push(waste);
    }
    if(wasteVars.length){
      const wasteExpr=sum(wasteVars);
      const wasteResult=solvePhase('3/3 목표 유지 · 낭비 딜 최소화 증명 중…',wasteExpr,'min');
      if(wasteResult&&feasible(wasteResult.status)){
        result=wasteResult;
        optimization.waste=statusText(wasteResult.status);
        planningWaste=Math.round(wasteVars.reduce((total,v)=>total+wasteResult.value(v),0));
      }
    }else{
      optimization.waste='OPTIMAL';
      planningWaste=0;
    }
  }

  progress('전역 최적화 결과 정리 중…');
  const chosen=candidates.filter(c=>result.value(c.x)>0.5);
  const plannedDamage=new Map(actual);
  for(const c of chosen)add(plannedDamage,c.boss.id,c.damage);
  const cleared=b=>(plannedDamage.get(b.id)||0)>=Math.max(0,b.hp-tolerance);
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
  const reachedRound=reachedStage+1;
  const targetDamage=reachedStage===3?finalDamage:normal.filter(b=>b.round===reachedRound).reduce((total,b)=>{
    const hp=actualRemaining(b);
    const damage=chosen.filter(c=>c.boss.id===b.id).reduce((s,c)=>s+c.damage,0);
    return total+Math.min(hp,damage);
  },0);
  if(planningWaste==null){
    planningWaste=normal.filter(b=>b.round<=reachedRound).reduce((total,b)=>{
      const damage=chosen.filter(c=>c.boss.id===b.id).reduce((s,c)=>s+c.damage,0);
      const baseline=b.round<reachedRound?clearThreshold(b):actualRemaining(b);
      return total+Math.max(0,damage-baseline);
    },0);
  }
  const provenOptimal=optimization.stage==='OPTIMAL'&&optimization.target==='OPTIMAL'&&optimization.waste==='OPTIMAL';
  return {
    status:provenOptimal?'OPTIMAL':'FEASIBLE',
    summary:{
      reachedFinal:reachedStage===3,
      reachedRound,
      attackCount:attacks.length,
      totalOverkill:attacks.reduce((s,a)=>s+a.overkill,0),
      planningWaste,
      damageTolerance:tolerance,
      unusedAttacks:users.reduce((s,u)=>s+u.attacksLeft,0)-attacks.length,
      targetRound:reachedRound,
      targetDamage,
      finalDamage,
      optimization
    },
    attacks,
    diagnostics:{
      activeUsers:users.length,
      candidates:candidates.length,
      totalAttackLimit:users.reduce((s,u)=>s+u.attacksLeft,0),
      solverWorkers,
      seed,
      elapsedSeconds:Math.round((Date.now()-startedAt)/1000)
    }
  };
}
