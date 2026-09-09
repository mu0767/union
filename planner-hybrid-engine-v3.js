import { solveRaidHybrid as solveBase } from './planner-hybrid-engine-v2.js';

const add=(m,k,v)=>m.set(k,(m.get(k)||0)+v);

export async function solveRaidHybrid(state,progress=()=>{},emitPlan=()=>{}){
  // Reserve a few seconds from the 30s wall budget for deterministic cleanup.
  const total=Math.max(1,Math.min(30,Number(state.__solverMaxSeconds||30)));
  const baseBudget=Math.max(1,total-3);
  const base=await solveBase({...state,__solverMaxSeconds:baseBudget},progress,emitPlan);
  progress('최종 sanity 개선 · 1:0 / 1:1 / 2:1 교환 검사 중…');

  const tolerance=state.settings?.damageTolerance??1_000_000_000;
  const users=(state.users||[]).filter(u=>u.active&&u.attacksLeft>0);
  const bosses=state.bosses||[];
  const normal=bosses.filter(b=>[1,2,3].includes(b.round));
  const final=bosses.find(b=>b.round===4);
  const actual=new Map(),usedActual=new Map(),resultCount=new Map();
  for(const r of state.results||[]){
    add(actual,r.bossId,Number(r.damage||0));add(resultCount,r.userId,1);
    if(!usedActual.has(r.userId))usedActual.set(r.userId,new Set());
    for(const n of r.nikkes||[])usedActual.get(r.userId).add(n);
  }
  const remaining=b=>b.round===4?Infinity:Math.max(0,Number(b.hp||0)-(actual.get(b.id)||0));
  const required=b=>b.round===4?Infinity:Math.max(0,remaining(b)-tolerance);
  const exactRequired=b=>b.round===4?Infinity:((actual.get(b.id)||0)>0?remaining(b):required(b));

  const candidateKey=c=>`${c.userId}|${c.partyId}|${c.bossId}`;
  const raw=[];
  for(const u of users)for(const p of u.parties||[]){
    if(!Array.isArray(p.nikkes)||p.nikkes.length!==5||new Set(p.nikkes).size!==5)continue;
    if(p.nikkes.some(n=>usedActual.get(u.id)?.has(n)))continue;
    for(const b of bosses){
      if(p.element!==b.element)continue;
      if(b.round!==4&&exactRequired(b)<=0)continue;
      const damage=b.round===4?(p.finalDamage??p.normalDamage):p.normalDamage;
      if(!Number.isSafeInteger(damage)||damage<=0)continue;
      raw.push({userId:u.id,userName:u.name,partyId:p.id,partyName:p.name,nikkes:[...p.nikkes],bossId:b.id,bossName:b.name,round:b.round,element:b.element,damage});
    }
  }
  const rawByKey=new Map(raw.map(c=>[candidateKey(c),c]));
  const locks=new Set((state.locks||[]).map(l=>`${l.userId}|${l.partyId}|${l.bossId}`));
  const selected=(base.attacks||[]).map(a=>rawByKey.get(`${a.userId}|${a.partyId}|${a.bossId}`)).filter(Boolean);
  // A lock is a hard reservation. The base solver may omit it, so inject every
  // still-valid locked candidate before local improvement instead of merely
  // protecting locks that happened to survive the base solution.
  const selectedKeys=new Set(selected.map(candidateKey));
  for(const key of locks){
    const locked=rawByKey.get(key);
    if(!locked)throw new Error('락된 예정 공격을 현재 조건에서 유지할 수 없습니다. 완료 공격의 사용 니케나 공격권을 확인해 주세요.');
    if(!selectedKeys.has(key)){selected.push(locked);selectedKeys.add(key);}
  }
  if(!selected.length)return base;
  const isValid=sel=>{
    const seen=new Set();
    for(const c of sel){const k=candidateKey(c);if(seen.has(k))return false;seen.add(k);}
    for(const k of locks)if(!seen.has(k))return false;
    for(const u of users){
      const own=sel.filter(c=>c.userId===u.id);
      if(own.length>u.attacksLeft)return false;
      const ns=new Set();
      for(const c of own)for(const n of c.nikkes){if(ns.has(n))return false;ns.add(n);}
    }
    const dmg=new Map(actual);for(const c of sel)add(dmg,c.bossId,c.damage);
    for(const b of normal.filter(b=>(actual.get(b.id)||0)>0&&remaining(b)>0)){
      const planned=sel.filter(c=>c.bossId===b.id).reduce((s,c)=>s+c.damage,0);
      if(planned<remaining(b))return false;
    }
    let stage=0;
    for(const r of [1,2,3]){if(normal.filter(b=>b.round===r).every(b=>(dmg.get(b.id)||0)>=Math.max(0,b.hp-tolerance)))stage=r;else break;}
    return sel.every(c=>c.round<=stage+1);
  };

  const evaluate=sel=>{
    const dmg=new Map(actual);for(const c of sel)add(dmg,c.bossId,c.damage);
    let stage=0;for(const r of [1,2,3]){if(normal.filter(b=>b.round===r).every(b=>(dmg.get(b.id)||0)>=Math.max(0,b.hp-tolerance)))stage=r;else break;}
    const targetRound=stage+1;
    const target=stage===3
      ? sel.filter(c=>c.round===4).reduce((s,c)=>s+c.damage,0)
      : normal.filter(b=>b.round===targetRound).reduce((s,b)=>s+Math.min(remaining(b),sel.filter(c=>c.bossId===b.id).reduce((x,c)=>x+c.damage,0)),0);
    let waste=0;
    for(const b of normal.filter(b=>b.round<targetRound)){
      const d=sel.filter(c=>c.bossId===b.id).reduce((s,c)=>s+c.damage,0);
      waste+=Math.max(0,d-exactRequired(b));
    }
    let over=0;
    for(const b of normal){const d=sel.filter(c=>c.bossId===b.id).reduce((s,c)=>s+c.damage,0);over+=Math.max(0,d-remaining(b));}
    return{stage,target,waste,over,count:sel.length};
  };
  const practicalSlack=(a,b)=>{
    const scale=Math.max(1,Math.floor(Math.max(a.target,b.target)/100));
    return Math.min(Math.max(1,tolerance||1),scale);
  };
  const better=(a,b)=>{
    if(a.stage!==b.stage)return a.stage>b.stage;
    const slack=practicalSlack(a,b);
    if(a.target>b.target+slack)return true;
    if(b.target>a.target+slack)return false;
    if(a.waste!==b.waste)return a.waste<b.waste;
    if(a.over!==b.over)return a.over<b.over;
    return a.count<b.count;
  };

  const alternatives=(sel,element,round,excludeKeys)=>{
    const pool=raw.filter(c=>c.element===element&&c.round===round&&!excludeKeys.has(candidateKey(c)));
    // Prefer HP-fitting / smaller attacks first; keep the neighborhood bounded.
    const b=bosses.find(x=>x.round===round&&x.element===element);
    const need=b&&round!==4?exactRequired(b):0;
    return pool.sort((a,z)=>Math.abs(a.damage-need)-Math.abs(z.damage-need)||a.damage-z.damage).slice(0,18);
  };

  let cur=[...selected],passes=0,changed=true;
  const stopAt=Date.now()+2600;
  while(changed&&passes++<6&&Date.now()<stopAt){
    changed=false;const baseEval=evaluate(cur);

    // 1:0: remove a needless attack if progress/target remain practically equal.
    for(let i=0;i<cur.length&&Date.now()<stopAt;i++){
      if(locks.has(candidateKey(cur[i])))continue;
      const trial=cur.filter((_,x)=>x!==i);
      if(isValid(trial)&&better(evaluate(trial),baseEval)){cur=trial;changed=true;break;}
    }
    if(changed)continue;

    // 1:1 cross-round swap for the same element.
    outer1:for(let i=0;i<cur.length;i++)for(let j=i+1;j<cur.length;j++){
      if(Date.now()>=stopAt)break outer1;
      const a=cur[i],b=cur[j];
      if(a.round===4||b.round===4||a.round===b.round||a.element!==b.element)continue;
      if(locks.has(candidateKey(a))||locks.has(candidateKey(b)))continue;
      const aa=rawByKey.get(`${a.userId}|${a.partyId}|${b.bossId}`),bb=rawByKey.get(`${b.userId}|${b.partyId}|${a.bossId}`);
      if(!aa||!bb)continue;
      const trial=[...cur];trial[i]=aa;trial[j]=bb;
      if(isValid(trial)&&better(evaluate(trial),baseEval)){cur=trial;changed=true;break outer1;}
    }
    if(changed)continue;

    // 2:1: replace two attacks on one boss with one fitting attack from the same boss.
    outer2:for(let i=0;i<cur.length;i++)for(let j=i+1;j<cur.length;j++){
      if(Date.now()>=stopAt)break outer2;
      const a=cur[i],b=cur[j];if(a.bossId!==b.bossId||a.round===4)continue;
      if(locks.has(candidateKey(a))||locks.has(candidateKey(b)))continue;
      const excluded=new Set(cur.map(candidateKey));
      for(const c of alternatives(cur,a.element,a.round,excluded)){
        const trial=cur.filter((_,x)=>x!==i&&x!==j);trial.push(c);
        if(isValid(trial)&&better(evaluate(trial),baseEval)){cur=trial;changed=true;break outer2;}
      }
    }
    if(changed)continue;

    // 1:2: split an oversized attack into two smaller pieces when this reduces waste.
    outer3:for(let i=0;i<cur.length;i++){
      if(Date.now()>=stopAt)break;
      const a=cur[i];if(a.round===4||locks.has(candidateKey(a)))continue;
      const excluded=new Set(cur.map(candidateKey));
      const pool=alternatives(cur,a.element,a.round,excluded).slice(0,10);
      for(let x=0;x<pool.length;x++)for(let y=x+1;y<pool.length;y++){
        if(Date.now()>=stopAt)break outer3;
        const trial=cur.filter((_,k)=>k!==i);trial.push(pool[x],pool[y]);
        if(isValid(trial)&&better(evaluate(trial),baseEval)){cur=trial;changed=true;break outer3;}
      }
    }
  }

  for(const b of normal.filter(b=>(actual.get(b.id)||0)>0&&remaining(b)>0)){
    const planned=cur.filter(c=>c.bossId===b.id).reduce((s,c)=>s+c.damage,0);
    if(planned<remaining(b))throw new Error(`${b.name} 실제 잔여 HP ${remaining(b).toLocaleString('ko-KR')} 마무리 공격이 최종 계획에서 누락되었습니다.`);
  }
  const ev=evaluate(cur);
  const bossOrder=new Map(bosses.map((b,i)=>[b.id,i]));
  cur.sort((a,b)=>a.round-b.round||(bossOrder.get(a.bossId)-bossOrder.get(b.bossId))||a.userName.localeCompare(b.userName));
  const rem=new Map(bosses.map(b=>[b.id,b.round===4?'infinite':remaining(b)])),counts=new Map();
  const origin=new Date(state.settings?.startAt||Date.now()),pad=n=>String(n).padStart(2,'0'),iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const attacks=cur.map(c=>{const before=rem.get(c.bossId),after=before==='infinite'?'infinite':Math.max(0,before-c.damage),over=before==='infinite'?0:Math.max(0,c.damage-before);rem.set(c.bossId,after);add(counts,c.userId,1);return{...c,start:iso(new Date(origin.getTime()+(c.round-1)*3600000)),timeLabel:'',isNow:false,beforeHp:before,afterHp:after,overkill:over,attackNumber:(resultCount.get(c.userId)||0)+(counts.get(c.userId)||0)};});
  const planningWaste=normal.filter(b=>b.round<ev.stage+1).reduce((s,b)=>s+Math.max(0,cur.filter(c=>c.bossId===b.id).reduce((x,c)=>x+c.damage,0)-required(b)),0);
  return{...base,status:'FEASIBLE',summary:{...base.summary,reachedFinal:ev.stage===3,reachedRound:ev.stage+1,attackCount:attacks.length,totalOverkill:attacks.reduce((s,a)=>s+a.overkill,0),planningWaste,unusedAttacks:users.reduce((s,u)=>s+u.attacksLeft,0)-attacks.length,targetRound:ev.stage+1,targetDamage:ev.target,finalDamage:ev.stage===3?ev.target:0,optimization:{...base.summary.optimization,waste:'BEAM+LOCAL+CP-SAT+SANITY'}},attacks,diagnostics:{...base.diagnostics,searchPolicy:'nested-beam-local-cpsat-final-neighborhood',finalSanityPasses:passes}};
}
