// Browser port of solver.py: CP-SAT constraints and lexicographic objectives.
// Runs in a dedicated worker, never on the UI thread.
export async function solveRaid(state, api, progress = () => {}) {
  const {CpModel,CpSolver,Domain,LinearExpr} = api;
  const sum = values => LinearExpr.from(LinearExpr.sum(values));
  const model = new CpModel();
  const settings=state.settings || {}, duration=Number(settings.attackMinutes);
  const origin=new Date(settings.startAt), end=new Date(settings.endAt), now=new Date(settings.now);
  if (![origin,end,now].every(d=>Number.isFinite(d.getTime())) || end<=origin) throw Error('레이드 시작·종료 시각을 확인해 주세요.');
  if (!Number.isInteger(duration) || duration<=0 || typeof settings.simultaneous!=='boolean') throw Error('공격 소요 시간과 동시 공격 설정을 확인해 주세요.');
  const horizon=Math.floor((end-origin)/60000), lower=Math.max(0,Math.ceil((now-origin)/60000));
  if (horizon>44640) throw Error('레이드 기간은 31일 이내로 설정해 주세요.');
  const elements=['철갑','수냉','작열','풍압','전격'];
  const users=(state.users||[]).filter(u=>u.active), bosses=state.bosses||[], normal=bosses.filter(b=>[1,2,3].includes(b.round)), final=bosses.find(b=>b.round===4);
  if(users.length>32)throw Error('참가자는 최대 32명입니다.');
  if(new Set(bosses.map(b=>b.id)).size!==bosses.length || normal.length!==15 || bosses.filter(b=>b.round===4).length!==1)throw Error('일반 보스 15명과 최종보스 한 명이 필요합니다.');
  for(const round of [1,2,3]) if(new Set(normal.filter(b=>b.round===round).map(b=>b.element)).size!==5)throw Error('각 라운드에는 속성별 보스가 하나씩 필요합니다.');
  for(const b of bosses) if(!elements.includes(b.element)||(b.round!==4&&(!Number.isSafeInteger(b.hp)||b.hp<=0)))throw Error('보스 속성·체력을 확인해 주세요.');
  const actual=new Map(), used=new Map(), resultCount=new Map();
  const add=(map,key,value)=>map.set(key,(map.get(key)||0)+value);
  const group=(map,key,value)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(value);};
  for(const r of state.results||[]) {
    const u=state.users.find(u=>u.id===r.userId), p=u?.parties.find(p=>p.id===r.partyId), b=bosses.find(b=>b.id===r.bossId);
    const nikkes=r.nikkes||p?.nikkes;
    if(!b||!nikkes||!Number.isSafeInteger(r.damage)||r.damage<0||(r.element||p?.element)!==b.element)throw Error('완료 공격의 보스·니케·딜량을 확인해 주세요.');
    if(!used.has(r.userId))used.set(r.userId,new Set());
    nikkes.forEach(n=>used.get(r.userId).add(n)); add(actual,b.id,r.damage);add(resultCount,r.userId,1);
  }
  function windowsFor(user) {
    const windows=[];
    const day=new Date(origin);day.setHours(5,0,0,0);day.setDate(day.getDate()-1);
    for(;day<=end;day.setDate(day.getDate()+1))for(const w of user.availability||[]) {
      const parse=v=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw Error(`${user.name}: 가능 시간 형식을 확인해 주세요.`);return v.split(':').map(Number);};
      const [sh,sm]=parse(w.start),[eh,em]=parse(w.end);
      const a=new Date(day),b=new Date(day);a.setMinutes(a.getMinutes()+((sh-5+24)%24)*60+sm);b.setMinutes(b.getMinutes()+((eh-5+24)%24)*60+em);if(b<=a)b.setDate(b.getDate()+1);
      const first=Math.max(lower,Math.ceil((a-origin)/60000)),last=Math.min(horizon-duration,Math.floor((b-origin)/60000)-duration);
      if(first<=last)windows.push([first,last]);
    }
    return windows;
  }
  const candidates=[],byUser=new Map(),byNikke=new Map(),byBoss=new Map(),userIntervals=new Map(),allIntervals=[];
  for(const u of users) {
    if(!Number.isInteger(u.attacksLeft)||u.attacksLeft<0||u.attacksLeft>3)throw Error(`${u.name}: 남은 공격권은 0~3이어야 합니다.`);
    const windows=windowsFor(u);if(!windows.length||!u.attacksLeft)continue;
    for(const p of u.parties||[]) {
      if(!elements.includes(p.element)||!Number.isSafeInteger(p.normalDamage)||p.normalDamage<0||(p.finalDamage!=null&&(!Number.isSafeInteger(p.finalDamage)||p.finalDamage<0)))throw Error(`${u.name}: 파티 속성·딜량을 확인해 주세요.`);
      if(!Array.isArray(p.nikkes)||p.nikkes.length!==5||p.nikkes.some(n=>typeof n!=='string'||!n.trim())||new Set(p.nikkes).size!==5)throw Error(`${u.name} / ${p.name}: 서로 다른 니케 5명이 필요합니다.`);
      if(p.nikkes.some(n=>used.get(u.id)?.has(n)))continue;
      for(const b of bosses) {
        if(p.element!==b.element || (b.round!==4&&(actual.get(b.id)||0)>=b.hp))continue;
        const damage=b.round===4?(p.finalDamage??p.normalDamage):p.normalDamage;
        const i=candidates.length,x=model.newBoolVar(`x${i}`),start=model.newIntVarFromDomain(Domain.fromIntervals(windows),`s${i}`),finish=model.newIntVar(0,horizon,`e${i}`);
        const interval=model.newOptionalIntervalVar(start,duration,finish,x,`i${i}`);
        const c={x,start,finish,user:u,party:p,boss:b,damage,windows};candidates.push(c);
        group(byUser,u.id,c);group(byBoss,b.id,c);group(userIntervals,u.id,interval);allIntervals.push(interval);
        for(const n of p.nikkes)group(byNikke,`${u.id}:${n}`,c);
      }
    }
  }
  for(const u of users)model.add(sum((byUser.get(u.id)||[]).map(c=>c.x)).le(u.attacksLeft));
  for(const cs of byNikke.values())model.add(sum(cs.map(c=>c.x)).le(1));
  for(const intervals of userIntervals.values())model.addNoOverlap(intervals);
  if(!settings.simultaneous)model.addNoOverlap(allIntervals);
  const clear=new Map(),effective=new Map(),overkill=new Map(),clearTime=new Map(),totals=new Map();
  const maxDamage=candidates.reduce((s,c)=>s+c.damage,0)+[...actual.values()].reduce((s,n)=>s+n,0);
  if(!Number.isSafeInteger(maxDamage))throw Error('딜량 합계가 지원 범위를 초과했습니다.');
  for(const [i,b] of normal.entries()) {
    const cs=byBoss.get(b.id)||[],total=model.newIntVar(0,Math.max(b.hp,maxDamage),`total${i}`),eff=model.newIntVar(0,b.hp,`eff${i}`),cl=model.newBoolVar(`clear${i}`),over=model.newIntVar(0,maxDamage,`over${i}`),ct=model.newIntVar(0,horizon,`ct${i}`);
    model.add(total.eq(sum(cs.map(c=>c.x.times(c.damage))).plus(actual.get(b.id)||0)));
    model.addMinEquality(eff,[total,b.hp]);model.add(total.ge(b.hp)).onlyEnforceIf(cl);model.add(total.le(b.hp-1)).onlyEnforceIf(cl.not());model.add(over.eq(total.minus(eff)));
    for(const c of cs)model.add(ct.ge(c.finish)).onlyEnforceIf(c.x);
    clear.set(b.id,cl);effective.set(b.id,eff);overkill.set(b.id,over);clearTime.set(b.id,ct);totals.set(b.id,total);
  }
  for(const c of candidates)if(c.boss.round>1)for(const b of normal.filter(b=>b.round===c.boss.round-1)) {
    model.add(c.x.le(clear.get(b.id)));model.add(c.start.ge(clearTime.get(b.id))).onlyEnforceIf(c.x);
  }
  const lockKeys=new Set();
  for(const lock of state.locks||[]) {
    const key=JSON.stringify([lock.userId,lock.partyId,lock.bossId]);
    if(lockKeys.has(key))throw Error('같은 공격이 두 번 잠겨 있습니다.');lockKeys.add(key);
    const c=candidates.find(c=>c.user.id===lock.userId&&c.party.id===lock.partyId&&c.boss.id===lock.bossId);
    if(!c)throw Error('잠긴 공격이 불가능합니다. 남은 공격권·사용 니케·가능 시간·보스를 확인해 주세요.');
    model.add(c.x.eq(1));
  }
  const opened=[];
  for(const round of [1,2,3]) {
    const flags=normal.filter(b=>b.round===round).map(b=>clear.get(b.id)),flag=model.newBoolVar(`round${round+1}`);
    for(const f of flags)model.add(flag.le(f));model.add(flag.ge(sum(flags).minus(flags.length-1)));opened.push(flag);
  }
  const solver=new CpSolver();let best=null,allOptimal=true;
  // A complete feasible hint prevents a time limit during presolve from losing
  // every result. CP-SAT still improves the same lexicographic objectives.
  if(!(state.locks||[]).length) {
    const damage=new Map(actual),chars=new Map([...used].map(([u,n])=>[u,new Set(n)])),counts=new Map(),selected=[];
    let clock=lower;
    while(selected.length<users.reduce((s,u)=>s+u.attacksLeft,0)) {
      const round=[1,2,3].find(r=>normal.some(b=>b.round===r&&(damage.get(b.id)||0)<b.hp))||4;
      let pick=null;
      for(const c of candidates) {
        if(c.boss.round!==round||!c.damage||(counts.get(c.user.id)||0)>=c.user.attacksLeft||c.party.nikkes.some(n=>chars.get(c.user.id)?.has(n)))continue;
        const hp=c.boss.round===4?Infinity:Math.max(0,c.boss.hp-(damage.get(c.boss.id)||0));if(!hp)continue;
        const times=c.windows.map(([a,b])=>Math.max(a,clock)<=b?Math.max(a,clock):Infinity),minute=Math.min(...times);if(!Number.isFinite(minute))continue;
        const score=c.boss.round===4?c.damage:Math.min(hp,c.damage)-Math.max(0,c.damage-hp)*0.01;
        if(!pick||minute<pick.minute||minute===pick.minute&&score>pick.score)pick={...c,minute,score};
      }
      if(!pick)break;
      selected.push(pick);clock=pick.minute+duration;add(counts,pick.user.id,1);add(damage,pick.boss.id,pick.damage);
      if(!chars.has(pick.user.id))chars.set(pick.user.id,new Set());pick.party.nikkes.forEach(n=>chars.get(pick.user.id).add(n));
    }
    const stage=[1,2,3].filter(r=>normal.filter(b=>b.round===r).every(b=>(damage.get(b.id)||0)>=b.hp)).length;
    best={stage,selected};
    const values=model.proto().variables.map(v=>Number(v.domain[0]));
    for(const c of candidates){const chosen=selected.find(p=>p.x.index===c.x.index);values[c.x.index]=chosen?1:0;values[c.start.index]=chosen?.minute??c.windows[0][0];values[c.finish.index]=chosen?chosen.minute+duration:0;}
    for(const b of normal){const total=damage.get(b.id)||0;values[totals.get(b.id).index]=total;values[effective.get(b.id).index]=Math.min(total,b.hp);values[clear.get(b.id).index]=total>=b.hp?1:0;values[overkill.get(b.id).index]=Math.max(0,total-b.hp);values[clearTime.get(b.id).index]=Math.max(0,...selected.filter(c=>c.boss.id===b.id).map(c=>c.minute+duration));}
    opened.forEach((v,i)=>values[v.index]=normal.filter(b=>b.round===i+1).every(b=>(damage.get(b.id)||0)>=b.hp)?1:0);
    model.proto().solutionHint={vars:values.map((_,i)=>i),values};
  }
  const stages=sum(opened);
  function capture(){return {stage:Math.round(solver.value(stages)),selected:candidates.filter(c=>solver.booleanValue(c.x)).map(c=>({...c,minute:solver.value(c.start)}))};}
  async function optimize(objective,maximize,label,seconds) {
    progress(label);if(maximize)model.maximize(objective);else model.minimize(objective);
    const status=solver.statusName(await solver.solve(model,{maxTimeInSeconds:seconds,numSearchWorkers:4}));
    console.info('CP-SAT',label,status,solver.wallTime);
    if(status==='MODEL_INVALID')throw Error('계산 모델 검증에 실패했습니다. 입력한 날짜와 딜량을 확인해 주세요.');
    if(status!=='OPTIMAL')allOptimal=false;
    if(!['OPTIMAL','FEASIBLE'].includes(status)) {
      if(best)return false;
      throw Error(status==='INFEASIBLE'?'현재 잠금과 가능 시간으로 실행 가능한 계획이 없습니다.':`계획을 찾지 못했습니다 (${status}). 잠금과 남은 시간을 확인해 주세요.`);
    }
    best=capture();
    const optimum=Math.round(solver.value(objective));model.add(LinearExpr.from(objective).eq(optimum));
    // Seed later objectives with the last valid assignment; never read an UNKNOWN response.
    const values=solver.response().solution;
    model.proto().solutionHint={vars:values.map((_,i)=>i),values:[...values]};
    return true;
  }
  const solved=await optimize(stages,true,'도달 가능한 라운드 계산 중…',8);
  const secondary=best.stage===3?sum((byBoss.get(final.id)||[]).map(c=>c.x.times(c.damage))):sum(normal.filter(b=>b.round===best.stage+1).map(b=>effective.get(b.id)));
  if(solved && await optimize(secondary,true,'남은 공격의 딜량 최적화 중…',10)) {
    if(await optimize(sum([...overkill.values()]),false,'오버딜을 줄이는 중…',5)) {
      const starts=candidates.map((c,i)=>{const value=model.newIntVar(0,horizon,`scheduled${i}`);model.addMultiplicationEquality(value,[c.start,c.x]);return value;});
      await optimize(sum(starts),false,'공격 시간 정리 중…',3);
    }
  }
  const remaining=new Map(bosses.map(b=>[b.id,b.round===4?'infinite':Math.max(0,b.hp-(actual.get(b.id)||0))])),counts=new Map();
  const pad=n=>String(n).padStart(2,'0'),iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const attacks=best.selected.sort((a,b)=>a.minute-b.minute||a.boss.round-b.boss.round||a.boss.name.localeCompare(b.boss.name)).map(c=>{
    const b=c.boss,before=remaining.get(b.id),after=before==='infinite'?'infinite':Math.max(0,before-c.damage),over=before==='infinite'?0:Math.max(0,c.damage-before),start=new Date(origin.getTime()+c.minute*60000);remaining.set(b.id,after);add(counts,c.user.id,1);
    return {start:iso(start),timeLabel:`${pad(start.getMonth()+1)}/${pad(start.getDate())} ${pad(start.getHours())}:${pad(start.getMinutes())}`,isNow:start<=new Date(now.getTime()+duration*60000),userId:c.user.id,userName:c.user.name,partyId:c.party.id,partyName:c.party.name,nikkes:c.party.nikkes,bossId:b.id,bossName:b.name,round:b.round,element:b.element,damage:c.damage,beforeHp:before,afterHp:after,overkill:over,attackNumber:(resultCount.get(c.user.id)||0)+counts.get(c.user.id)};
  });
  return {status:allOptimal?'OPTIMAL':'FEASIBLE',summary:{reachedFinal:best.stage===3,reachedRound:best.stage+1,attackCount:attacks.length,totalOverkill:attacks.reduce((s,a)=>s+a.overkill,0),finalDamage:attacks.filter(a=>a.round===4).reduce((s,a)=>s+a.damage,0)},attacks};
}
