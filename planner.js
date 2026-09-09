'use strict';
const $ = id => document.getElementById(id);
const ELEMENTS = ['철갑','수냉','작열','풍압','전격'];
const BOSS_DISPLAY_ORDER = ['철갑','수냉','작열','전격','풍압'];
const SEED_ELEMENTS = ['철갑','수냉','작열','전격','풍압'];
const displayNumber = value => Number(value || 0).toLocaleString('ko-KR');
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const characters = [...new Map([...(window.NIKKE_CHARACTER_CATALOG||[]),...(window.NIKKE_CHARACTERS||[])].map(x=>[x.name,x])).values()].sort((a,b)=>b.name.length-a.name.length);
const characterImage = name => { const c=characters.find(x=>x.name===name); return c?.image || c?.source || ''; };
const defaultBosses = [
  [99856279200,99856279200,150841813600,150841813600,99856279200],
  [149784418800,149784418800,226262720400,226262720400,149784418800],
  [292455295750,292455295750,349230901500,349230901500,292455295750]
];
const bossNames = ['레이턴스','툼스톤','모더니아','애니힐리오','리빌드 빅 토르소'];
let state;
let selectedUser = null;

function splitCharacters(text) {
  const compact = text.replace(/\s/g,'');
  function walk(rest, found) {
    if (!rest) return found.length === 5 ? found.map(c => c.name) : null;
    for (const c of characters) {
      const key = c.name.replace(/\s/g,'');
      if (rest.startsWith(key)) { const result = walk(rest.slice(key.length), [...found,c]); if (result) return result; }
    }
    return null;
  }
  return walk(compact,[]) || text.split(/\s*[/,]\s*/).filter(Boolean);
}
function parseSeed() {
  const lines = window.UNION_RAID_TEXT.replace(/^\uFEFF/,'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const users=[]; let i=0;
  while(i<lines.length) {
    const name=lines[i++]; const level=Number((lines[i++].match(/\d+/)||[0])[0]); const parties=[];
    for(let elementIndex=0;elementIndex<5;elementIndex++) {
      i++;
      for(let p=0;p<3;p++) {
        const team=lines[i++], damageText=lines[i++];
        parties.push({id:uid(),name:`${SEED_ELEMENTS[elementIndex]} 파티 ${p+1}`,element:SEED_ELEMENTS[elementIndex],nikkes:splitCharacters(team).slice(0,5),normalDamage:/^미보유/.test(damageText)?0:Number(damageText.replace(/,/g,'')),finalDamage:null});
      }
    }
    users.push({id:uid(),name,level,active:true,attacksLeft:3,availability:[{start:'05:00',end:'05:00'}],parties});
  }
  const bosses=[];
  for(let round=1;round<=3;round++) ELEMENTS.forEach((element,index)=>bosses.push({id:`r${round}-${element}`,round,name:bossNames[index],element,hp:defaultBosses[round-1][index]}));
  bosses.push({id:'final',round:4,name:'애니힐리오',element:'풍압',hp:'infinite'});
  const now=new Date();
  const local = d => new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  return {settings:{startAt:local(now),endAt:local(new Date(now.getTime()+24*60*60*1000)),now:local(now),attackMinutes:10,simultaneous:false,finalElement:'풍압'},users,bosses,results:[],locks:[],plan:null};
}
function parseUnionRaidSeed() {
  const rows = window.UNION_RAID_TEXT.replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1).map(line => line.split(','));
  const usersByName = new Map();
  for (const row of rows) {
    if (row.length < 12) continue;
    const [name, levelText, bossElement, partyElement, deck, ...rest] = row;
    if (!ELEMENTS.includes(bossElement)) continue;
    if (!usersByName.has(name)) usersByName.set(name, {id:uid(),name,level:Number(levelText)||null,active:true,attacksLeft:3,availability:[{start:'05:00',end:'05:00'}],parties:[]});
    const damageText = (rest[5] || '').replace(/,/g, '').trim();
    const damage = /^\d+$/.test(damageText) ? Number(damageText) : 0;
    usersByName.get(name).parties.push({id:uid(),name:`${bossElement} 덱 ${deck}`,element:bossElement,nikkes:rest.slice(0,5).map(value=>value.trim()),normalDamage:damage,finalDamage:null,sourceElement:partyElement.trim()});
  }
  const bosses=[];
  for(let round=1;round<=3;round++) ELEMENTS.forEach((element,index)=>bosses.push({id:`r${round}-${element}`,round,name:bossNames[index],element,hp:defaultBosses[round-1][index]}));
  bosses.push({id:'final',round:4,name:'애니힐리오',element:'풍압',hp:'infinite'});
  const now=new Date(); const local=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  return {settings:{startAt:local(now),endAt:local(new Date(now.getTime()+24*60*60*1000)),now:local(now),attackMinutes:10,simultaneous:false,finalElement:'풍압'},users:[...usersByName.values()],bosses,results:[],locks:[],plan:null};
}
function validateState(value) {
  if (!value || !Array.isArray(value.users) || value.users.length>32 || !Array.isArray(value.bosses) || !Array.isArray(value.results) || !Array.isArray(value.locks)) throw new Error('저장 데이터 형식이 올바르지 않습니다.');
  return value;
}
function ensurePlanningSettings() {
  const now = new Date();
  const local = d => new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  state.settings ||= {};
  state.settings.startAt ||= local(now);
  state.settings.endAt ||= local(new Date(now.getTime()+24*60*60*1000));
  state.settings.now ||= local(now);
  state.settings.attackMinutes ||= 10;
  if (state.settings.simultaneous === '') state.settings.simultaneous = false;
}
function localSave(message='') { localStorage.setItem('union-planner-v2',JSON.stringify(state)); if(message) $('planner-status').textContent=message; }
function compactPlannerState(){
  const plan=state.plan?{
    status:state.plan.status,
    summary:state.plan.summary,
    attacks:(state.plan.attacks||[]).map(a=>({
      userName:a.userName||state.users.find(u=>u.id===a.userId)?.name,
      partyName:a.partyName||state.users.find(u=>u.id===a.userId)?.parties.find(p=>p.id===a.partyId)?.name,
      bossId:a.bossId,damage:a.damage,attackNumber:a.attackNumber,start:a.start
    }))
  }:null;
  return {
    v:2,
    settings:state.settings,
    bosses:state.bosses.map(b=>({id:b.id,round:b.round,name:b.name,element:b.element,hp:b.hp})),
    users:state.users.map(u=>({name:u.name,active:u.active,attacksLeft:u.attacksLeft,availability:u.availability})),
    results:state.results.map(r=>({
      id:r.id,userName:r.userName||state.users.find(u=>u.id===r.userId)?.name,
      partyName:r.partyName||state.users.find(u=>u.id===r.userId)?.parties.find(p=>p.id===r.partyId)?.name,
      bossId:r.bossId,damage:r.damage,plannedDamage:r.plannedDamage,planStart:r.planStart,attackNumber:r.attackNumber,at:r.at
    })),
    locks:(state.locks||[]).map(l=>({
      userName:state.users.find(u=>u.id===l.userId)?.name,
      partyName:state.users.find(u=>u.id===l.userId)?.parties.find(p=>p.id===l.partyId)?.name,
      bossId:l.bossId
    })).filter(l=>l.userName&&l.partyName&&l.bossId),
    plan
  };
}
function expandPlannerState(saved){
  if(!saved||saved.v!==2)return validateState(saved);
  const next=parseUnionRaidSeed();
  next.settings={...next.settings,...saved.settings};
  if(Array.isArray(saved.bosses)&&saved.bosses.length===next.bosses.length)next.bosses=saved.bosses.map(b=>({...b}));
  for(const su of saved.users||[]){
    const u=next.users.find(x=>x.name===su.name);if(!u)continue;
    u.active=su.active!==false;u.attacksLeft=Number.isInteger(su.attacksLeft)?su.attacksLeft:u.attacksLeft;
    if(Array.isArray(su.availability))u.availability=su.availability;
  }
  next.results=(saved.results||[]).map(r=>{
    const u=next.users.find(x=>x.name===r.userName),p=u?.parties.find(x=>x.name===r.partyName),b=next.bosses.find(x=>x.id===r.bossId);
    if(!u||!p||!b)return null;
    return {id:r.id||uid(),userId:u.id,userName:u.name,partyId:p.id,partyName:p.name,nikkes:[...p.nikkes],element:p.element,bossId:b.id,bossName:b.name,round:b.round,damage:Number(r.damage)||0,plannedDamage:r.plannedDamage,planStart:r.planStart,attackNumber:r.attackNumber,at:r.at};
  }).filter(Boolean);
  next.locks=(saved.locks||[]).map(l=>{
    const u=next.users.find(x=>x.name===l.userName),p=u?.parties.find(x=>x.name===l.partyName),b=next.bosses.find(x=>x.id===l.bossId);
    return u&&p&&b?{id:uid(),userId:u.id,partyId:p.id,bossId:b.id}:null;
  }).filter(Boolean);
  if(saved.plan){
    const attacks=(saved.plan.attacks||[]).map(a=>{
      const u=next.users.find(x=>x.name===a.userName),p=u?.parties.find(x=>x.name===a.partyName),b=next.bosses.find(x=>x.id===a.bossId);
      if(!u||!p||!b)return null;
      return {start:a.start,timeLabel:'',isNow:false,userId:u.id,userName:u.name,partyId:p.id,partyName:p.name,nikkes:[...p.nikkes],bossId:b.id,bossName:b.name,round:b.round,element:b.element,damage:Number(a.damage)||0,beforeHp:null,afterHp:null,overkill:0,attackNumber:a.attackNumber};
    }).filter(Boolean);
    next.plan={status:saved.plan.status||'FEASIBLE',summary:saved.plan.summary||{},attacks};
  }
  return validateState(next);
}
async function plannerStoreRequest(action, plannerState) {
  const endpoint=window.UNION_SHARED_URL;
  if(!endpoint)throw new Error('공유 저장소 주소가 없습니다.');
  const response=await fetch(action==='planner'?endpoint+`?action=planner&t=${Date.now()}`:endpoint,{
    method:action==='planner'?'GET':'POST',cache:'no-store',
    ...(action==='planner'?{}:{headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'save-planner',plannerState})})
  });
  const data=await response.json();if(!response.ok||data.error)throw new Error(data.error||`HTTP ${response.status}`);return data;
}
async function saveShared(message='') {
  localSave(message);
  try{const saved=await plannerStoreRequest('save-planner',compactPlannerState());sharedPlannerVersion=Number(saved.version)||sharedPlannerVersion;if(message)$('planner-status').textContent=message+' · 공유 저장 완료';}
  catch(error){$('planner-status').textContent=(message?message+' · ':'')+'공유 저장 실패: '+error.message;throw error;}
}
function availabilityText(user){return user.availability.map(w=>`${w.start}-${w.end}`).join(', ')}
function parseAvailability(text){
  if(!text.trim())return [];
  return text.split(',').map(value=>{const m=value.trim().match(/^((?:[01]\d|2[0-3]):[0-5]\d)\s*-\s*((?:[01]\d|2[0-3]):[0-5]\d)$/);if(!m)throw new Error(`시간 형식을 확인해 주세요: ${value}`);return{start:m[1],end:m[2]};});
}
function renderMembers(){
  $('member-count').textContent=`${state.users.length}명`;
  $('member-list').innerHTML=state.users.map(u=>`<button class="member-button${u.id===selectedUser?' active':''}" data-user="${u.id}"><span>${escapeHTML(u.name)}</span><small>${u.active?'참여':'제외'} · ${u.attacksLeft}타</small></button>`).join('');
  renderMemberEditor();
}
function renderMemberEditor(){
  const user=state.users.find(u=>u.id===selectedUser);$('member-editor').hidden=!user;$('member-editor-empty').hidden=!!user;if(!user)return;
  const f=$('member-editor');$('member-title').textContent=`${user.name} · Lv. ${user.level||'-'}`;f.elements.name.value=user.name;f.elements.active.checked=user.active;f.elements.attacksLeft.value=user.attacksLeft;f.elements.availability.value=availabilityText(user);
  $('party-body').innerHTML=user.parties.map(p=>`<tr data-party="${p.id}"><td><input name="partyName" value="${escapeHTML(p.name)}" required maxlength="50"></td><td><select name="element">${ELEMENTS.map(e=>`<option${e===p.element?' selected':''}>${e}</option>`).join('')}</select></td><td><input class="nikke-input" name="nikkes" value="${escapeHTML(p.nikkes.join(' / '))}" required placeholder="니케 5명 / 로 구분"></td><td><input name="normalDamage" inputmode="numeric" value="${displayNumber(p.normalDamage)}" required></td><td><input name="finalDamage" inputmode="numeric" value="${p.finalDamage==null?'':displayNumber(p.finalDamage)}" placeholder="미입력 시 일반 딜"></td><td><button type="button" class="icon-button" data-remove-party="${p.id}">삭제</button></td></tr>`).join('');
}
function readMemberForm(){
  const user=state.users.find(u=>u.id===selectedUser), f=$('member-editor');if(!user)return;
  const rows=[...$('party-body').querySelectorAll('tr')];const parties=rows.map(row=>{const nikkes=row.querySelector('[name=nikkes]').value.split(/\s*[/,]\s*/).filter(Boolean);if(nikkes.length!==5||new Set(nikkes).size!==5)throw new Error(`${row.querySelector('[name=partyName]').value}: 서로 다른 니케 5명이 필요합니다.`);const number=name=>{const raw=row.querySelector(`[name=${name}]`).value.trim();if(!raw&&name==='finalDamage')return null;const n=Number(raw.replace(/,/g,''));if(!Number.isSafeInteger(n)||n<0)throw new Error('딜량은 0 이상의 정수로 입력해 주세요.');return n};return{id:row.dataset.party,name:row.querySelector('[name=partyName]').value.trim(),element:row.querySelector('[name=element]').value,nikkes,normalDamage:number('normalDamage'),finalDamage:number('finalDamage')};});
  Object.assign(user,{name:f.elements.name.value.trim(),active:f.elements.active.checked,attacksLeft:Number(f.elements.attacksLeft.value),availability:parseAvailability(f.elements.availability.value),parties});
}
function raidProgress(){
  const damage={};for(const r of state.results)damage[r.bossId]=(damage[r.bossId]||0)+Number(r.damage||0);
  let currentRound=1;for(const round of [1,2,3]){const list=state.bosses.filter(b=>b.round===round);if(list.every(b=>(damage[b.id]||0)>=b.hp))currentRound=round+1;else break}
  return{damage,currentRound,bosses:state.bosses.filter(b=>b.round===currentRound).map(b=>({...b,remaining:b.hp==='infinite'?'infinite':Math.max(0,b.hp-(damage[b.id]||0)),clear:b.hp!=='infinite'&&(damage[b.id]||0)>=b.hp}))};
}
function bossOptions(currentOnly=false){const progress=raidProgress();const list=currentOnly?progress.bosses.filter(b=>!b.clear):state.bosses;return list.map(b=>`<option value="${b.id}">R${b.round===4?'최종':b.round} · ${escapeHTML(b.name)} · ${b.element}</option>`).join('')}
function renderLive(){}
function compactEntry(entry,type){const u=state.users.find(x=>x.id===entry.userId),p=u?.parties.find(x=>x.id===entry.partyId),b=state.bosses.find(x=>x.id===entry.bossId);return`<div class="compact-item"><span>${escapeHTML(entry.userName||u?.name||'삭제된 유저')} · ${escapeHTML(entry.partyName||p?.name||'삭제된 파티')} → ${escapeHTML(entry.bossName||b?.name||'삭제된 보스')}${entry.damage!=null?` · ${displayNumber(entry.damage)}`:''}</span>${type==='lock'?`<button data-remove-lock="${entry.id}">잠금 해제</button>`:'<small>완료 확정</small>'}</div>`}
function parsePlanTimeSlots(){
  const boxes=[...document.querySelectorAll('#plan-time-slots input[type="checkbox"]')];
  const selected=boxes.filter(input=>input.checked).map(input=>input.value);
  const values=selected.length?selected:['05:00-10:00','10:00-15:00','15:00-20:00','20:00-05:00'];
  return values.map(text=>{
    const [start,end]=text.split('-');
    return {label:text,start,end};
  });
}
function timeInSlot(date,slot){
  const [sh,sm]=slot.start.split(':').map(Number),[eh,em]=slot.end.split(':').map(Number);
  const minute=date.getHours()*60+date.getMinutes(),a=sh*60+sm,b=eh*60+em;
  return a===b||a<b?(minute>=a&&minute<b):(minute>=a||minute<b);
}
function alternativeCandidates(attack,slot){
  const boss=state.bosses.find(b=>b.id===attack.bossId);
  const user=state.users.find(u=>u.id===attack.userId);
  if(!boss||!user)return [];
  const completedUsed=new Set(state.results.filter(r=>r.userId===user.id).flatMap(r=>r.nikkes||[]));
  const plannedUsed=new Set((state.plan?.attacks||[]).filter(a=>a.userId===user.id&&a!==attack&&!planResultForAttack(a)).flatMap(a=>a.nikkes||[]));
  return (user.parties||[])
    .filter(p=>p.id!==attack.partyId&&p.element===boss.element)
    .filter(p=>!p.nikkes.some(n=>completedUsed.has(n)||plannedUsed.has(n)))
    .map(p=>({user,party:p,damage:partyDamageForBoss(p,boss)||0}))
    .filter(x=>x.damage>0)
    .sort((a,b)=>b.damage-a.damage)
    .slice(0,8);
}

function formatPlannerDamage(userId,element,damage,round=1){
  const power=level=>{
    const table=window.LEVEL_ATTACK_POWER||{};
    const key=Object.keys(table).map(Number).filter(k=>k<=Number(level)).sort((a,b)=>b-a)[0];
    return key==null?null:Number(table[key]);
  };
  const user=state.users.find(u=>u.id===userId),attackPower=power(user?.level);
  const values=state.users.flatMap(u=>{
    const atk=power(u.level);if(!atk)return [];
    return u.parties.filter(p=>p.element===element).map(p=>(round===4?(p.finalDamage??p.normalDamage):p.normalDamage)/atk).filter(v=>Number.isFinite(v)&&v>0);
  }).sort((a,b)=>a-b);
  const middle=Math.floor(values.length/2);
  const median=values.length?(values.length%2?values[middle]:(values[middle-1]+values[middle])/2):null;
  const percent=attackPower&&median?Math.round(damage/attackPower/median*100):null;
  return `${displayNumber(damage)}${percent==null?'':` <span class="damage-efficiency" title="레벨별 공격력으로 보정한 딜 · 같은 속성 중앙값 100%">(${percent}%)</span>`}`;
}
function planResultForAttack(attack){
  return state.results.find(r=>r.userId===attack.userId&&r.partyId===attack.partyId&&r.bossId===attack.bossId)||null;
}
function completedPlanAttacks(){
  const counts=new Map();
  return state.results.map(r=>{
    const user=state.users.find(u=>u.id===r.userId),party=user?.parties.find(p=>p.id===r.partyId),boss=state.bosses.find(b=>b.id===r.bossId);
    counts.set(r.userId,(counts.get(r.userId)||0)+1);
    return {
      start:r.planStart||r.at||state.settings?.startAt,
      timeLabel:'',isNow:false,
      userId:r.userId,userName:r.userName||user?.name||'삭제된 유저',
      partyId:r.partyId,partyName:r.partyName||party?.name||'삭제된 파티',
      nikkes:[...(r.nikkes||party?.nikkes||[])],bossId:r.bossId,bossName:r.bossName||boss?.name||'삭제된 보스',
      round:r.round||boss?.round||1,element:r.element||party?.element||boss?.element||'',
      damage:r.plannedDamage??r.damage,beforeHp:null,afterHp:null,overkill:0,
      attackNumber:r.attackNumber||counts.get(r.userId),completed:true,resultId:r.id
    };
  });
}
function planLockForAttack(attack){
  return (state.locks||[]).find(l=>l.userId===attack.userId&&l.partyId===attack.partyId&&l.bossId===attack.bossId)||null;
}
function renderPlan(plan,target=$('plan-list')){
  if(!plan?.length){target.className='plan-list empty-card';target.innerHTML='표시할 추천 공격이 없습니다.';return}
  target.className='plan-list';

  if(target!==$('plan-list')){
    target.innerHTML=plan.map(a=>{
      const idx=state.plan?.attacks?.indexOf(a)??-1;
      const attr=a.completed?`data-result-id="${escapeHTML(a.resultId)}"`:`data-plan-index="${idx}"`;
      return `<button class="plan-card plan-card-button${a.completed?' completed':''}" ${attr}><div><small>R${a.round===4?'최종':a.round} · ${escapeHTML(a.element)} · ${a.attackNumber}타${a.completed?' · 완료':''}</small><p>${escapeHTML(a.userName)} → ${escapeHTML(a.bossName)}</p></div><div><strong>${a.completed?displayNumber(planResultForAttack(a)?.damage??a.damage):formatPlannerDamage(a.userId,a.element,a.damage,a.round)}</strong></div></button>`;
    }).join('');
    return;
  }

  const baseDamage={};for(const r of state.results)baseDamage[r.bossId]=(baseDamage[r.bossId]||0)+Number(r.damage||0);
  const attackCard=a=>{
    const idx=state.plan?.attacks?.indexOf(a)??-1;
    const portraits=a.nikkes.map(n=>{const src=characterImage(n);return src?`<img src="${escapeHTML(src)}" alt="${escapeHTML(n)}" title="${escapeHTML(n)}">`:`<span title="${escapeHTML(n)}">${escapeHTML(n.slice(0,1))}</span>`;}).join('');
    const result=planResultForAttack(a);
    const attr=a.completed?`data-result-id="${escapeHTML(a.resultId)}"`:`data-plan-index="${idx}"`;
    return `<div class="raid-slot-stack">
      <button class="raid-slot-card${result?' completed':(planLockForAttack(a)?' locked':'')}" ${attr}>
        ${result?'':`<span class="raid-slot-actions"><span class="raid-slot-delete" data-delete-plan-index="${idx}" title="예정 공격 삭제" aria-label="예정 공격 삭제">×</span></span>`}
        <div class="raid-slot-top"><strong>${escapeHTML(a.userName)}</strong>${result?'<span class="raid-slot-done">완료</span>':''}</div>
        <div class="raid-slot-portraits">${portraits}</div>
        <small>${a.attackNumber}타${result?' · 실제 딜':''}</small>
        <b>${result?displayNumber(result.damage):formatPlannerDamage(a.userId,a.element,a.damage,a.round)}</b>
        ${result?`<em>예상 ${displayNumber(a.damage)}</em>`:''}
      </button>
    </div>`;
  };

  // Within each round/boss, keep completed attacks above scheduled attacks.
  // This makes the board read as history first, then the remaining plan.
  const bossOrder=new Map(state.bosses.map((b,i)=>[b.id,i]));
  const ordered=[...plan].sort((a,b)=>
    a.round-b.round||
    (bossOrder.get(a.bossId)??999)-(bossOrder.get(b.bossId)??999)||
    Number(!a.completed)-Number(!b.completed)||
    a.attackNumber-b.attackNumber||
    a.userName.localeCompare(b.userName)
  );
  const rounds=[...new Set(ordered.map(a=>a.round))].sort((a,b)=>a-b);
  target.innerHTML=rounds.map(round=>{
      const attacks=ordered.filter(a=>a.round===round);
      const bosses=state.bosses.filter(b=>b.round===round).sort((a,b)=>BOSS_DISPLAY_ORDER.indexOf(a.element)-BOSS_DISPLAY_ORDER.indexOf(b.element));
      const rows=Math.max(1,...bosses.map(b=>attacks.filter(a=>a.bossId===b.id).length));
      const cumulativeAttacks=ordered.filter(a=>a.round<=round);
      const remaining=bosses.map(b=>{
        if(b.hp==='infinite')return '∞';
        const planned=cumulativeAttacks.filter(a=>a.bossId===b.id&&!planResultForAttack(a)).reduce((s,a)=>s+a.damage,0);
        return displayNumber(Math.max(0,b.hp-(baseDamage[b.id]||0)-planned));
      });
      const overkill=bosses.map(b=>{
        if(b.hp==='infinite')return '0';
        const planned=cumulativeAttacks.filter(a=>a.bossId===b.id&&!planResultForAttack(a)).reduce((s,a)=>s+a.damage,0);
        return displayNumber(Math.max(0,(baseDamage[b.id]||0)+planned-b.hp));
      });
      const alternatives=bosses.map(b=>{
        const attack=attacks.find(a=>a.bossId===b.id);
        if(!attack||planResultForAttack(attack))return [];
        return alternativeCandidates(attack,null);
      });
      return `<div class="raid-board-wrap"><div class="raid-round-label">R${round===4?'최종':round}</div><div class="raid-board" style="--cols:${bosses.length}">
        <div class="raid-board-head"><span></span>${bosses.map(b=>`<strong>${escapeHTML(b.name)}<small>${escapeHTML(b.element)} · HP ${b.hp==='infinite'?'∞':displayNumber(b.hp)}</small></strong>`).join('')}</div>
        ${Array.from({length:rows+1},(_,row)=>`<div class="raid-board-row"><span class="raid-row-index">${row+1}</span>${bosses.map(b=>{
          const bossAttacks=attacks.filter(a=>a.bossId===b.id);
          const attack=bossAttacks[row];
          if(attack)return `<div class="raid-board-cell">${attackCard(attack)}</div>`;
          if(row===bossAttacks.length)return `<div class="raid-board-cell"><button type="button" class="raid-slot-card raid-slot-add-card" data-manual-add-boss="${escapeHTML(b.id)}" title="${row+1}번 공격 추가">＋</button></div>`;
          return '<div class="raid-board-cell"></div>';
        }).join('')}</div>`).join('')}
        <div class="raid-board-footer"><span>남은 HP</span>${remaining.map(v=>`<strong>${v}</strong>`).join('')}</div>
        <div class="raid-board-footer raid-board-overkill"><span>오버딜</span>${overkill.map(v=>`<strong>${v}</strong>`).join('')}</div>
      </div></div>`;
  }).join('');
}
function renderSchedule(){
  const plan=state.plan;
  const completed=completedPlanAttacks();
  if(!plan){$('plan-summary').innerHTML='';renderPlan(completed.length?completed:null);return}
  const s=plan.summary;
  $('plan-summary').innerHTML=[['예상 도달',s.reachedFinal?'최종보스':`Round ${s.reachedRound}`],[s.reachedFinal?'최종보스 딜':`R${s.reachedRound} 유효 딜`,s.targetDamage==null?'재계산 필요':displayNumber(s.targetDamage)],['공격 사용',`${s.attackCount}회`],['총 오버딜',displayNumber(s.totalOverkill)],['보스별 허용 오차',`±${displayNumber(s.damageTolerance??0)}`]].map(x=>`<div class="summary-card"><small>${x[0]}</small><strong>${x[1]}</strong></div>`).join('');
  const remainingPlanAttacks=plan.attacks.filter(a=>!planResultForAttack(a));
  try{renderPlan([...completed,...remainingPlanAttacks])}catch(error){$('plan-list').className='plan-list empty-card';$('plan-list').textContent=`시간표 표시 실패: ${error.message}`;throw error}
}
function renderSettings(){const f=$('raid-settings');Object.entries(state.settings).forEach(([k,v])=>{if(f.elements[k])f.elements[k].value=String(v)});$('planner-boss-body').innerHTML=state.bosses.map(b=>`<tr data-boss-id="${b.id}"><td>${b.round===4?'최종':b.round}</td><td><input name="bossName" value="${escapeHTML(b.name)}" required maxlength="80"></td><td><select name="bossElement">${ELEMENTS.map(e=>`<option${e===b.element?' selected':''}>${e}</option>`).join('')}</select></td><td><input name="bossHp" inputmode="numeric" value="${b.hp==='infinite'?'무한':displayNumber(b.hp)}" required></td></tr>`).join('')}
function renderAll(){renderLive();renderSchedule()}
async function solveRaid(state, progress = () => {}) {
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
    // The timetable is display/planning data, not a live reservation clock.
    // Availability 05:00-05:00 means all day. Build windows directly from
    // raid-relative clock minutes so early slots (05:00, 10:00, ...) are usable.
    const windows=[];
    const parse=v=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw Error(`${user.name}: 가능 시간 형식을 확인해 주세요.`);const [h,m]=v.split(':').map(Number);return h*60+m;};
    for(const w of user.availability||[]) {
      const start=parse(w.start), finish=parse(w.end);
      for(let day=0;day<=Math.ceil(horizon/1440);day++){
        let a=day*1440+start, b=day*1440+finish;
        if(finish<=start)b+=1440;
        // Convert absolute clock-of-day to offset from the raid start clock.
        const originClock=origin.getHours()*60+origin.getMinutes();
        a-=originClock;b-=originClock;
        const first=Math.max(0,a),last=Math.min(horizon-duration,b-duration);
        if(first<=last)windows.push([first,last]);
      }
    }
    return windows;
  }
  const candidates=[];
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
        candidates.push({user:u,party:p,boss:b,damage,windows});
      }
    }
  }
  // Fast browser planner: use the already-built greedy feasible schedule immediately.
  // The full CP-SAT model is intentionally skipped here because proving/improving
  // optimality can take minutes in a browser for a 32-member raid.
  progress('빠른 공격 계획 구성 중…');
  const damage=new Map(actual),chars=new Map([...used].map(([u,n])=>[u,new Set(n)])),attackCounts=new Map(),selected=[];
  const attackLimit=users.reduce((sum,u)=>sum+u.attacksLeft,0);

  function maxFutureAttacks(userId, extraUsed, need){
    if(need<=0)return 0;
    const pool=[...new Map(candidates.filter(c=>c.user.id===userId&&c.damage).map(c=>[c.party.id,c.party])).values()];
    let best=0;
    function dfs(index,usedSet,count){
      if(count>=need){best=need;return}
      if(count+(pool.length-index)<=best)return;
      for(let i=index;i<pool.length&&best<need;i++){
        const party=pool[i];
        if(party.nikkes.some(n=>usedSet.has(n)))continue;
        const next=new Set(usedSet);party.nikkes.forEach(n=>next.add(n));
        dfs(i+1,next,count+1);
      }
      if(count>best)best=count;
    }
    dfs(0,new Set(extraUsed),0);
    return best;
  }

  function maxDamageForBoss(user,boss,usedSet,slots){
    if(slots<=0)return 0;
    const pool=[...new Map(candidates.filter(c=>c.user.id===user.id&&c.boss.id===boss.id&&c.damage).map(c=>[c.party.id,c])).values()];
    let best=0;
    function dfs(index,usedNow,left,total){
      if(total>best)best=total;
      if(left<=0)return;
      for(let i=index;i<pool.length;i++){
        const c=pool[i];
        if(c.party.nikkes.some(n=>usedNow.has(n)))continue;
        const next=new Set(usedNow);c.party.nikkes.forEach(n=>next.add(n));
        dfs(i+1,next,left-1,total+c.damage);
      }
    }
    dfs(0,new Set(usedSet),slots,0);
    return best;
  }

  function canStillClearRound(round,trial){
    if(round===4)return true;
    const trialDamage=new Map(damage),trialChars=new Map([...chars].map(([id,set])=>[id,new Set(set)])),trialCounts=new Map(attackCounts);
    if(trial){
      add(trialDamage,trial.boss.id,trial.damage);
      add(trialCounts,trial.user.id,1);
      if(!trialChars.has(trial.user.id))trialChars.set(trial.user.id,new Set());
      trial.party.nikkes.forEach(n=>trialChars.get(trial.user.id).add(n));
    }
    for(const boss of normal.filter(b=>b.round===round)){
      const need=Math.max(0,boss.hp-(trialDamage.get(boss.id)||0));
      if(!need)continue;
      let possible=0;
      for(const user of users){
        const slots=Math.max(0,user.attacksLeft-(trialCounts.get(user.id)||0));
        if(!slots)continue;
        possible+=maxDamageForBoss(user,boss,trialChars.get(user.id)||new Set(),slots);
        if(possible>=need)break;
      }
      if(possible<need)return false;
    }
    return true;
  }

  function bossUrgency(round,boss){
    const need=boss.round===4?0:Math.max(0,boss.hp-(damage.get(boss.id)||0));
    if(!need)return -Infinity;
    let possible=0;
    for(const user of users){
      const slots=Math.max(0,user.attacksLeft-(attackCounts.get(user.id)||0));
      if(!slots)continue;
      possible+=maxDamageForBoss(user,boss,chars.get(user.id)||new Set(),slots);
    }
    // Higher means more urgent: little remaining capacity relative to HP needed.
    return need/Math.max(1,possible);
  }

  while(selected.length<attackLimit) {
    const round=[1,2,3].find(r=>normal.some(b=>b.round===r&&(damage.get(b.id)||0)<b.hp))||4;
    const urgentBosses=round===4?[]:normal.filter(b=>b.round===round&&(damage.get(b.id)||0)<b.hp).sort((a,b)=>{
      const ar=Math.max(0,a.hp-(damage.get(a.id)||0))/a.hp;
      const br=Math.max(0,b.hp-(damage.get(b.id)||0))/b.hp;
      if(br!==ar)return br-ar;
      return bossUrgency(round,b)-bossUrgency(round,a);
    });
    const urgentBossId=urgentBosses[0]?.id||null;
    let pick=null;
    for(const c of candidates) {
      const already=attackCounts.get(c.user.id)||0;
      if(c.boss.round!==round||!c.damage||already>=c.user.attacksLeft||c.party.nikkes.some(n=>chars.get(c.user.id)?.has(n)))continue;
      const hp=c.boss.round===4?Infinity:Math.max(0,c.boss.hp-(damage.get(c.boss.id)||0));if(!hp)continue;
      const times=c.windows.map(([a,b])=>a<=b?a:Infinity),minute=Math.min(...times);if(!Number.isFinite(minute))continue;

      const afterUsed=new Set(chars.get(c.user.id)||[]);c.party.nikkes.forEach(n=>afterUsed.add(n));
      const remainingNeed=c.user.attacksLeft-(already+1);
      const future=maxFutureAttacks(c.user.id,afterUsed,remainingNeed);
      const blocksAttack=future<remainingNeed;

      const over=c.boss.round===4?0:Math.max(0,c.damage-hp);
      const effective=c.boss.round===4?c.damage:Math.min(hp,c.damage);
      const kills=c.boss.round!==4&&c.damage>=hp;

      // First preserve the user's remaining attack rights. Then prefer immediate kills
      // with low overkill; otherwise maximize useful damage.
      const keepsRoundClearable=canStillClearRound(round,c);
      const urgentPenalty=c.boss.round===4?0:(c.boss.id===urgentBossId?0:1);
      const rank=c.boss.round===4
        ? [blocksAttack?1:0,0,0,0,-c.damage]
        : kills
          ? [urgentPenalty,keepsRoundClearable?0:1,blocksAttack?1:0,0,over]
          : [urgentPenalty,keepsRoundClearable?0:1,blocksAttack?1:0,1,-effective];

      const better=!pick||minute<pick.minute||minute===pick.minute&&(
        rank[0]<pick.rank[0]||
        rank[0]===pick.rank[0]&&rank[1]<pick.rank[1]||
        rank[0]===pick.rank[0]&&rank[1]===pick.rank[1]&&rank[2]<pick.rank[2]||
        rank[0]===pick.rank[0]&&rank[1]===pick.rank[1]&&rank[2]===pick.rank[2]&&rank[3]<pick.rank[3]||
        rank[0]===pick.rank[0]&&rank[1]===pick.rank[1]&&rank[2]===pick.rank[2]&&rank[3]===pick.rank[3]&&rank[4]<pick.rank[4]
      );
      if(better)pick={...c,minute,rank};
    }
    if(!pick)break;
    selected.push(pick);add(attackCounts,pick.user.id,1);add(damage,pick.boss.id,pick.damage);
    if(!chars.has(pick.user.id))chars.set(pick.user.id,new Set());pick.party.nikkes.forEach(n=>chars.get(pick.user.id).add(n));
  }
  const stage=[1,2,3].filter(r=>normal.filter(b=>b.round===r).every(b=>(damage.get(b.id)||0)>=b.hp)).length;
  const best={stage,selected};
  const allOptimal=false;
  progress('공격 순서와 시간 정리 중…');
  const remaining=new Map(bosses.map(b=>[b.id,b.round===4?'infinite':Math.max(0,b.hp-(actual.get(b.id)||0))])),counts=new Map();
  const pad=n=>String(n).padStart(2,'0'),iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const attacks=best.selected.sort((a,b)=>a.minute-b.minute||a.boss.round-b.boss.round||a.boss.name.localeCompare(b.boss.name)).map(c=>{
    const b=c.boss,before=remaining.get(b.id),after=before==='infinite'?'infinite':Math.max(0,before-c.damage),over=before==='infinite'?0:Math.max(0,c.damage-before),start=new Date(origin.getTime()+c.minute*60000);remaining.set(b.id,after);add(counts,c.user.id,1);
    return {start:iso(start),timeLabel:`${pad(start.getMonth()+1)}/${pad(start.getDate())} ${pad(start.getHours())}:${pad(start.getMinutes())}`,isNow:start<=new Date(now.getTime()+duration*60000),userId:c.user.id,userName:c.user.name,partyId:c.party.id,partyName:c.party.name,nikkes:c.party.nikkes,bossId:b.id,bossName:b.name,round:b.round,element:b.element,damage:c.damage,beforeHp:before,afterHp:after,overkill:over,attackNumber:(resultCount.get(c.user.id)||0)+counts.get(c.user.id)};
  });
  return {status:allOptimal?'OPTIMAL':'FEASIBLE',summary:{reachedFinal:best.stage===3,reachedRound:best.stage+1,attackCount:attacks.length,totalOverkill:attacks.reduce((s,a)=>s+a.overkill,0),finalDamage:attacks.filter(a=>a.round===4).reduce((s,a)=>s+a.damage,0)},attacks,diagnostics:{activeUsers:users.length,candidates:candidates.length,totalAttackLimit:attackLimit}};
}


function plannedUsageForUser(userId,excludeIndex=-1){
  const used=new Set(state.results.filter(r=>r.userId===userId).flatMap(r=>r.nikkes||[]));
  let count=state.results.filter(r=>r.userId===userId).length;
  (state.plan?.attacks||[]).forEach((a,i)=>{
    if(i===excludeIndex||a.userId!==userId||planResultForAttack(a))return;
    count++;(a.nikkes||[]).forEach(n=>used.add(n));
  });
  return {used,count};
}
function manualPartyCandidates(boss,excludeIndex=-1){
  const rows=[];
  for(const user of state.users.filter(u=>u.active)){
    const usage=plannedUsageForUser(user.id,excludeIndex);
    if(usage.count>=3)continue;
    const legal=(user.parties||[])
      .filter(p=>p.element===boss.element)
      .filter(p=>!p.nikkes.some(n=>usage.used.has(n)))
      .map(p=>({user,party:p,damage:partyDamageForBoss(p,boss)||0,blocked:false,reason:''}))
      .filter(x=>x.damage>0)
      .sort((a,b)=>b.damage-a.damage);
    rows.push(...legal);
  }
  return rows.sort((a,b)=>a.user.name.localeCompare(b.user.name)||b.damage-a.damage);
}

function recomputeManualPlanSummary(){
  if(!state.plan)return;
  const actual=new Map();for(const r of state.results)actual.set(r.bossId,(actual.get(r.bossId)||0)+Number(r.damage||0));
  const planned=new Map();
  for(const a of state.plan.attacks||[]){
    if(planResultForAttack(a))continue;
    planned.set(a.bossId,(planned.get(a.bossId)||0)+Number(a.damage||0));
  }
  let reached=1;
  for(const round of [1,2,3]){
    const clear=state.bosses.filter(b=>b.round===round).every(b=>(actual.get(b.id)||0)+(planned.get(b.id)||0)>=Number(b.hp||0));
    if(clear)reached=round+1;else break;
  }
  const finalBoss=state.bosses.find(b=>b.round===4);
  const finalDamage=finalBoss?(planned.get(finalBoss.id)||0):0;
  let overkill=0;
  for(const b of state.bosses.filter(b=>b.round!==4)){
    overkill+=Math.max(0,(actual.get(b.id)||0)+(planned.get(b.id)||0)-Number(b.hp||0));
  }
  state.plan.summary={...(state.plan.summary||{}),reachedFinal:reached===4,reachedRound:reached,attackCount:(state.plan.attacks||[]).length,totalOverkill:overkill,finalDamage,targetDamage:reached===4?finalDamage:state.bosses.filter(b=>b.round===reached).reduce((s,b)=>s+(planned.get(b.id)||0),0),optimization:{stage:'MANUAL',target:'MANUAL',waste:'MANUAL'}};
}
async function saveManualPlan(message){
  recomputeManualPlanSummary();renderAll();await saveShared(message);
}
function manualChoiceOptions(boss,excludeIndex=-1,currentUserId='',currentPartyId=''){
  return manualPartyCandidates(boss,excludeIndex).map(x=>{
    const selected=x.user.id===currentUserId&&x.party.id===currentPartyId;
    return `<option value="${escapeHTML(x.user.id)}|${escapeHTML(x.party.id)}" ${selected?'selected':''}>${escapeHTML(x.user.name)} · ${escapeHTML(x.party.name)} · ${displayNumber(x.damage)}</option>`;
  }).join('');
}
function parseDamageFilter(value){
  const text=String(value||'').replace(/,/g,'').trim();
  if(!text)return null;
  const n=Number(text);return Number.isFinite(n)&&n>=0?n:null;
}
function manualAddFilteredCandidates(boss){
  const root=$('manual-add-picker');if(!root)return [];
  const name=(root.querySelector('[name=userFilter]')?.value||'').trim().toLowerCase();
  const min=parseDamageFilter(root.querySelector('[name=minDamage]')?.value);
  const max=parseDamageFilter(root.querySelector('[name=maxDamage]')?.value);
  return manualPartyCandidates(boss).filter(x=>
    (!name||x.user.name.toLowerCase().includes(name))&&
    (min==null||x.damage>=min)&&
    (max==null||x.damage<=max)
  );
}
function renderManualAddPicker(bossId,preferredUserId=''){
  const root=$('manual-add-picker'),boss=state.bosses.find(b=>b.id===bossId);if(!root||!boss)return;
  const candidates=manualAddFilteredCandidates(boss);
  const grouped=new Map();
  for(const x of candidates){if(!grouped.has(x.user.id))grouped.set(x.user.id,{user:x.user,rows:[]});grouped.get(x.user.id).rows.push(x);}
  let current=root.dataset.userId||preferredUserId||'';
  if(current&&!grouped.has(current))current='';
  root.dataset.userId=current;
  const users=[...grouped.values()];
  root.querySelector('.manual-user-list').innerHTML=users.length?
    `<button type="button" class="manual-user-chip${current?'':' active'}" data-manual-user=""><strong>전체</strong><small>${candidates.length}개</small></button>`+
    users.map(g=>`<button type="button" class="manual-user-chip${g.user.id===current?' active':''}" data-manual-user="${escapeHTML(g.user.id)}"><strong>${escapeHTML(g.user.name)}</strong><small>${g.rows.length}개</small></button>`).join('')
    :'<p class="manual-empty">조건에 맞는 플레이어가 없습니다.</p>';
  const visible=current?(grouped.get(current)?.rows||[]):candidates;
  root.querySelector('.manual-squad-list').innerHTML=visible.length?visible.map(x=>{
    const portraits=x.party.nikkes.map(n=>{const src=characterImage(n);return src?`<img src="${escapeHTML(src)}" alt="${escapeHTML(n)}" title="${escapeHTML(n)}">`:`<span title="${escapeHTML(n)}">${escapeHTML(n.slice(0,1))}</span>`;}).join('');
    return `<button type="button" class="manual-squad-choice${root.dataset.choice===x.user.id+'|'+x.party.id?' selected':''}" data-manual-squad="${escapeHTML(x.user.id)}|${escapeHTML(x.party.id)}">
      <div class="manual-squad-head"><span><strong>${escapeHTML(x.user.name)}</strong><small>${escapeHTML(x.party.name)}</small></span><b>${displayNumber(x.damage)}</b></div>
      <div class="manual-squad-portraits">${portraits}</div>
    </button>`;
  }).join(''):'<p class="manual-empty">조건에 맞는 스쿼드가 없습니다.</p>';
  const hidden=root.closest('form')?.elements.choice;
  if(hidden&&!visible.some(x=>x.user.id+'|'+x.party.id===root.dataset.choice)){root.dataset.choice='';hidden.value='';}
  const submit=root.closest('form')?.querySelector('button[type="submit"]');if(submit)submit.disabled=!hidden?.value;
}
function openManualAdd(bossId){
  const boss=state.bosses.find(b=>b.id===bossId);if(!boss||!state.plan)return;
  $('attack-detail-title').textContent=`수동 공격 추가 · R${boss.round===4?'최종':boss.round} ${boss.name}`;
  $('attack-detail-body').innerHTML=`<form id="manual-plan-form" class="manual-plan-form" data-mode="add" data-boss-id="${escapeHTML(boss.id)}">
    <input type="hidden" name="choice" value="">
    <div id="manual-add-picker" class="manual-add-picker" data-boss-id="${escapeHTML(boss.id)}">
      <div class="manual-add-filters">
        <label>이름 검색<input name="userFilter" placeholder="플레이어 이름"></label>
        <label>최소 딜<input name="minDamage" inputmode="numeric" placeholder="제한 없음"></label>
        <label>최대 딜<input name="maxDamage" inputmode="numeric" placeholder="제한 없음"></label>
      </div>
      <p class="help">같은 속성의 사용 가능한 스쿼드만 표시됩니다. 완료·예정 공격에서 이미 사용한 니케가 포함된 스쿼드는 제외됩니다.</p>
      <div class="manual-add-browser">
        <div class="manual-user-list"></div>
        <div class="manual-squad-list"></div>
      </div>
    </div>
    <div class="manual-plan-actions"><button type="submit" class="primary" disabled>선택한 스쿼드 추가</button></div>
  </form>`;
  $('attack-actual-form').hidden=true;
  renderManualAddPicker(boss.id);
  $('attack-detail-dialog').showModal();
}

function usedNikkePortraits(names){
  const list=[...names];
  if(!list.length)return '<span class="no-used-nikke">없음</span>';
  return `<div class="used-nikke-portraits">${list.map(n=>{const src=characterImage(n);return src?`<figure><img src="${escapeHTML(src)}" alt="${escapeHTML(n)}" title="${escapeHTML(n)}"><figcaption>${escapeHTML(n)}</figcaption></figure>`:`<span title="${escapeHTML(n)}">${escapeHTML(n)}</span>`;}).join('')}</div>`;
}
function plannedPartyChoiceHTML(user,boss,currentPartyId,index){
  const completedUsed=new Set(state.results.filter(r=>r.userId===user.id).flatMap(r=>r.nikkes||[]));
  return (user.parties||[])
    .filter(p=>p.element===boss.element)
    .map(p=>{
      const overlap=p.nikkes.filter(n=>completedUsed.has(n));
      const blocked=overlap.length>0;
      const damage=partyDamageForBoss(p,boss)||0;
      const portraits=p.nikkes.map(n=>{const src=characterImage(n),bad=completedUsed.has(n);return src?`<span class="planned-party-portrait${bad?' used-nikke':''}"><img src="${escapeHTML(src)}" alt="${escapeHTML(n)}" title="${escapeHTML(n)}"></span>`:`<span class="planned-party-portrait${bad?' used-nikke':''}" title="${escapeHTML(n)}">${escapeHTML(n.slice(0,1))}</span>`;}).join('');
      return `<button type="button" class="planned-party-choice${p.id===currentPartyId?' selected':''}${blocked?' blocked':''}" data-planned-party="${escapeHTML(p.id)}" ${blocked?'disabled':''} title="${blocked?'이미 사용한 니케가 포함되어 있습니다':'이 파티로 변경'}">
        <div class="planned-party-portraits">${portraits}</div>
        <strong>${displayNumber(damage)}</strong>
        ${blocked?'<em>이미 사용한 니케가 포함되어 있습니다</em>':''}
      </button>`;
    }).join('');
}
function openAttackDetail(index){
  const attack=state.plan?.attacks?.[index];if(!attack)return;
  const user=state.users.find(u=>u.id===attack.userId),boss=state.bosses.find(b=>b.id===attack.bossId);if(!user||!boss)return;
  const used=new Set(state.results.filter(r=>r.userId===user.id).flatMap(r=>r.nikkes||[]));
  $('attack-detail-title').textContent=`${user.name} · R${attack.round===4?'최종':attack.round} ${attack.bossName}`;
  const locked=!!planLockForAttack(attack);
  $('attack-detail-body').innerHTML=`
    <button type="button" class="attack-detail-lock${locked?' active':''}" data-toggle-plan-lock="${index}" title="${locked?'락 해제':'재계산 고정'}">${locked?'🔒':'🔓'}</button>
    <div class="attack-detail-current"><strong>예정 공격</strong><p>${formatPlannerDamage(attack.userId,attack.element,attack.damage,attack.round)} · ${attack.attackNumber}타</p><div class="attack-detail-portraits">${attack.nikkes.map(n=>{const src=characterImage(n);return src?`<figure><img src="${escapeHTML(src)}" alt="${escapeHTML(n)}"><figcaption>${escapeHTML(n)}</figcaption></figure>`:`<span>${escapeHTML(n)}</span>`;}).join('')}</div></div>
    <form id="manual-plan-form" class="manual-plan-form" data-mode="edit" data-index="${index}" data-boss-id="${escapeHTML(boss.id)}" data-user-id="${escapeHTML(user.id)}">
      <input type="hidden" name="choice" value="${escapeHTML(user.id)}|${escapeHTML(attack.partyId)}">
      <strong>파티 변경</strong>
      <div class="planned-party-list">${plannedPartyChoiceHTML(user,boss,attack.partyId,index)}</div>
      <div class="manual-plan-actions"><button class="primary">계획 변경</button></div>
    </form>
    <div class="attack-detail-used"><strong>사용한 니케</strong>${usedNikkePortraits(used)}</div>`;
  const f=$('attack-actual-form');f.hidden=false;delete f.dataset.resultId;f.elements.attackIndex.value=String(index);f.elements.damage.value=displayNumber(attack.damage);
  f.querySelector('button').textContent='실제 결과 저장';
  $('attack-detail-dialog').showModal();
}
function partyDamageForBoss(party,boss){return boss?.round===4?(party.finalDamage??party.normalDamage):party.normalDamage}
function completedOtherUsedNikkes(userId,resultId){
  return new Set(state.results.filter(r=>r.userId===userId&&r.id!==resultId).flatMap(r=>r.nikkes||[]));
}
function partyChoiceHTML(user,boss,currentPartyId,resultId=''){
  const used=completedOtherUsedNikkes(user.id,resultId);
  return (user.parties||[]).filter(p=>p.element===boss.element).map(p=>{
    const overlap=p.nikkes.filter(n=>used.has(n));
    const blocked=overlap.length>0;
    const damage=partyDamageForBoss(p,boss)||0;
    const portraits=p.nikkes.map(n=>{const src=characterImage(n),usedNikke=used.has(n);return src?`<figure class="${usedNikke?'used-nikke':''}"><img src="${escapeHTML(src)}" alt="${escapeHTML(n)}"><figcaption>${escapeHTML(n)}</figcaption></figure>`:`<span class="${usedNikke?'used-nikke':''}">${escapeHTML(n)}</span>`;}).join('');
    return `<button type="button" class="party-choice${blocked?' blocked':''}${p.id===currentPartyId?' selected':''}" data-party-choice="${escapeHTML(p.id)}" ${blocked?'disabled':''} title="${blocked?`사용 완료 니케 중복: ${overlap.map(escapeHTML).join(' / ')}`:'이 조합으로 변경'}"><div><strong>${escapeHTML(p.name)}</strong><small>${displayNumber(damage)}</small></div><div class="party-choice-portraits">${portraits}</div>${blocked?`<em>사용 불가 · ${overlap.map(escapeHTML).join(' / ')}</em>`:''}</button>`;
  }).join('');
}
function openCompletedAttackDetail(resultId){
  const result=state.results.find(r=>r.id===resultId);if(!result)return;
  const attack=completedPlanAttacks().find(a=>a.resultId===resultId);if(!attack)return;
  const user=state.users.find(u=>u.id===attack.userId),boss=state.bosses.find(b=>b.id===attack.bossId);if(!user||!boss)return;
  const used=completedOtherUsedNikkes(attack.userId,resultId);
  $('attack-detail-title').textContent=`${attack.userName} · R${attack.round===4?'최종':attack.round} ${attack.bossName}`;
  $('attack-detail-body').innerHTML=`
    <div class="attack-detail-current"><strong>완료된 공격</strong><p>예상 ${displayNumber(result.plannedDamage??attack.damage)} · 실제 ${displayNumber(result.damage)} · ${attack.attackNumber}타</p></div>
    <div class="attack-party-choices"><strong>같은 속성 다른 조합</strong><p class="help">다른 완료 공격에서 이미 사용한 니케가 겹치면 선택할 수 없습니다.</p>${partyChoiceHTML(user,boss,result.partyId,resultId)}</div>
    <div class="attack-detail-used"><strong>사용한 니케</strong>${usedNikkePortraits(used)}</div>`;
  const f=$('attack-actual-form');f.dataset.resultId=resultId;f.dataset.partyId=result.partyId;f.elements.attackIndex.value='';f.elements.damage.value=displayNumber(result.damage);
  f.querySelector('button').textContent='변경 저장 후 재계산';
  $('attack-detail-dialog').showModal();
}
async function saveActualFromPlan(index,damage){
  const attack=state.plan?.attacks?.[index];if(!attack)throw new Error('계획 공격을 찾을 수 없습니다.');
  const user=state.users.find(u=>u.id===attack.userId),party=user?.parties.find(p=>p.id===attack.partyId),boss=state.bosses.find(b=>b.id===attack.bossId);
  if(!user||!party||!boss)throw new Error('공격 정보를 찾을 수 없습니다.');
  const existing=planResultForAttack(attack);
  if(existing){
    existing.damage=damage;existing.at=new Date().toISOString();
    await saveShared('완료된 공격의 실제 딜을 수정했습니다.');renderAll();return;
  }
  if(user.attacksLeft<=0)throw new Error('남은 공격권이 없습니다.');
  const progress=raidProgress();if(!progress.bosses.some(b=>b.id===boss.id&&!b.clear))throw new Error('현재 공격 가능한 보스가 아닙니다.');
  const used=new Set(state.results.filter(r=>r.userId===user.id).flatMap(r=>r.nikkes||[]));
  const overlap=party.nikkes.filter(n=>used.has(n));if(overlap.length)throw new Error(`이미 사용한 니케가 포함되어 있습니다: ${overlap.join(', ')}`);
  user.attacksLeft--;
  state.results.push({id:uid(),userId:user.id,userName:user.name,partyId:party.id,partyName:party.name,nikkes:[...party.nikkes],element:party.element,bossId:boss.id,bossName:boss.name,round:boss.round,damage,plannedDamage:attack.damage,planStart:attack.start,attackNumber:attack.attackNumber,at:new Date().toISOString()});
  state.locks=state.locks.filter(l=>!(l.userId===user.id&&l.partyId===party.id&&l.bossId===boss.id));
  await saveShared('실제 공격 결과를 저장했습니다. 완료 셀로 표시했으며 공격권·사용 니케에도 반영했습니다.');renderAll();
}

async function calculate(){
  if ($('calculate').disabled) return;
  const buttons=[$('calculate'),$('recalculate')];
  buttons.forEach(button=>{button.disabled=true;button.classList.add('is-calculating');button.dataset.label=button.textContent;button.textContent='CP-SAT 계산 중…';});
  const snapshot=JSON.stringify({...state,plan:null});
  const started=Date.now();
  let phase='CP-SAT 엔진 준비 중…';
  const updateStatus=()=>{$('planner-status').textContent=`[${Math.floor((Date.now()-started)/1000)}초] ${phase}`;};
  updateStatus();
  const ticker=setInterval(updateStatus,1000);
  let worker=null;
  try{
    const plan=await new Promise((resolve,reject)=>{
      worker=new Worker('./planner-cpsat-worker.js',{type:'module'});
      const timeout=setTimeout(()=>{worker?.terminate();reject(new Error('CP-SAT 계산 제한 시간을 초과했습니다.'));},45000);
      worker.onmessage=({data})=>{
        if(data.progress){phase=data.progress;updateStatus();return}
        clearTimeout(timeout);
        if(data.error)reject(new Error(data.error));
        else resolve(data.plan);
      };
      worker.onerror=event=>{
        clearTimeout(timeout);
        reject(new Error(event.message||'CP-SAT 계산기를 불러오지 못했습니다.'));
      };
      worker.postMessage(JSON.parse(snapshot));
    });
    if(snapshot!==JSON.stringify({...state,plan:null}))throw new Error('계산 중 입력이 변경됐습니다. 현재 입력으로 다시 계산해 주세요.');
    if(!plan?.attacks?.length){
      const d=plan?.diagnostics||{};
      throw new Error(`배치 가능한 공격이 0개입니다. 활성 유저 ${d.activeUsers??0}명 · 공격 후보 ${d.candidates??0}개`);
    }
    state.plan=plan;
    renderSchedule();
    renderLive();
    await saveShared(`CP-SAT 계산 완료 · ${plan.attacks.length}개 공격 · ${plan.summary.reachedFinal?'최종보스 딜':`R${plan.summary.reachedRound} 유효 딜`} ${displayNumber(plan.summary.targetDamage)} · 총 오버딜 ${displayNumber(plan.summary.totalOverkill)}`);
  }catch(error){
    $('planner-status').textContent=`계산 실패: ${error.message}`;
  }finally{
    clearInterval(ticker);
    worker?.terminate();
    buttons.forEach(button=>{button.disabled=false;button.classList.remove('is-calculating');button.textContent=button.dataset.label;});
  }
}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));document.querySelectorAll('.planner-view').forEach(v=>v.hidden=v.id!==`view-${button.dataset.view}`)}));
$('raid-settings')?.addEventListener('submit',async e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.target));if(new Date(values.startAt)>=new Date(values.endAt))return alert('종료 시각은 시작보다 늦어야 합니다.');const rows=[...$('planner-boss-body').querySelectorAll('tr')];try{state.bosses=rows.map((row,index)=>{const raw=row.querySelector('[name=bossHp]').value.trim();const final=index===rows.length-1;const hp=/^(무한|infinite|∞)$/i.test(raw)?'infinite':Number(raw.replace(/,/g,''));if((!final&&hp==='infinite')||(hp!=='infinite'&&(!Number.isSafeInteger(hp)||hp<=0)))throw new Error('일반 보스 HP는 0보다 큰 정수여야 합니다.');const prior=state.bosses.find(b=>b.id===row.dataset.bossId);return{...prior,name:row.querySelector('[name=bossName]').value.trim(),element:row.querySelector('[name=bossElement]').value,hp}});for(const round of [1,2,3])if(new Set(state.bosses.filter(b=>b.round===round).map(b=>b.element)).size!==5)throw new Error(`Round ${round}에는 5개 속성을 하나씩 선택해야 합니다.`)}catch(error){return alert(error.message)}state.settings={...values,attackMinutes:Number(values.attackMinutes),simultaneous:values.simultaneous==='true',finalElement:state.bosses.at(-1).element};state.plan=null;await saveShared('레이드와 보스 설정을 저장했습니다.');renderAll()});
$('calculate')?.addEventListener('click',calculate);
$('reset-plan')?.addEventListener('click',async()=>{
  if(!confirm('입력 데이터, 실제 공격 결과, 계산된 공격 계획을 모두 초기화할까요?'))return;
  localStorage.removeItem('union-planner-v2');
  state=parseUnionRaidSeed();
  ensurePlanningSettings();
  selectedUser=null;
  renderAll();
  try{await saveShared('전체 데이터를 초기화했습니다.');}
  catch(error){alert('공유 초기화 저장에 실패했습니다: '+error.message);}
});
function formatNumericInput(input){
  const digits=String(input.value||'').replace(/\D/g,'');
  input.value=digits?Number(digits).toLocaleString('en-US'):'';
}
document.addEventListener('input',e=>{
  if(e.target.matches('#attack-actual-form [name="damage"]')){formatNumericInput(e.target);return;}
  const input=e.target.closest('#manual-add-picker input');if(!input)return;
  const root=input.closest('#manual-add-picker');renderManualAddPicker(root.dataset.bossId,root.dataset.userId);
});
document.addEventListener('click',e=>{
  const plannedParty=e.target.closest('[data-planned-party]');
  if(plannedParty){
    const form=plannedParty.closest('#manual-plan-form'),userId=form?.dataset.userId;
    if(form&&userId){
      form.elements.choice.value=userId+'|'+plannedParty.dataset.plannedParty;
      form.querySelectorAll('[data-planned-party]').forEach(b=>b.classList.toggle('selected',b===plannedParty));
    }
    return;
  }
  const userButton=e.target.closest('[data-manual-user]');
  if(userButton){
    const root=userButton.closest('#manual-add-picker');root.dataset.userId=userButton.dataset.manualUser;root.dataset.choice='';
    const hidden=root.closest('form')?.elements.choice;if(hidden)hidden.value='';
    renderManualAddPicker(root.dataset.bossId,root.dataset.userId);return;
  }
  const squad=e.target.closest('[data-manual-squad]');
  if(squad){
    const root=squad.closest('#manual-add-picker'),form=root.closest('form');
    root.dataset.choice=squad.dataset.manualSquad;form.elements.choice.value=squad.dataset.manualSquad;
    root.querySelectorAll('[data-manual-squad]').forEach(b=>b.classList.toggle('selected',b===squad));
    form.querySelector('button[type="submit"]').disabled=false;return;
  }
});
document.addEventListener('submit',async e=>{
  const form=e.target.closest('#manual-plan-form');if(!form)return;
  e.preventDefault();
  try{
    const [userId,partyId]=String(form.elements.choice.value||'').split('|');
    const user=state.users.find(u=>u.id===userId),party=user?.parties.find(p=>p.id===partyId),boss=state.bosses.find(b=>b.id===form.dataset.bossId);
    if(!user||!party||!boss||party.element!==boss.element)throw new Error('선택한 공격 정보를 찾을 수 없습니다.');
    const exclude=form.dataset.mode==='edit'?Number(form.dataset.index):-1;
    const attack={start:state.settings?.startAt,timeLabel:'',isNow:false,userId:user.id,userName:user.name,partyId:party.id,partyName:party.name,nikkes:[...party.nikkes],bossId:boss.id,bossName:boss.name,round:boss.round,element:boss.element,damage:partyDamageForBoss(party,boss)||0,beforeHp:null,afterHp:null,overkill:0,attackNumber:1};
    if(form.dataset.mode==='edit'){
      const completedUsed=new Set(state.results.filter(r=>r.userId===user.id).flatMap(r=>r.nikkes||[]));
      const overlap=party.nikkes.filter(n=>completedUsed.has(n));
      if(overlap.length)throw new Error(`이미 사용한 니케가 포함되어 있습니다: ${overlap.join(', ')}`);
      state.plan.attacks[exclude]=attack;
      state.locks=state.locks.filter(l=>!(l.userId===user.id&&l.bossId===boss.id));
    }else{
      const candidate=manualPartyCandidates(boss,-1).find(x=>x.user.id===userId&&x.party.id===partyId);
      if(!candidate||candidate.blocked)throw new Error(candidate?.reason||'현재 사용할 수 없는 파티입니다.');
      state.plan.attacks.push(attack);
    }
    const counts=new Map();
    for(const a of state.plan.attacks){counts.set(a.userId,(counts.get(a.userId)||0)+1);a.attackNumber=state.results.filter(r=>r.userId===a.userId).length+counts.get(a.userId);}
    await saveManualPlan(form.dataset.mode==='edit'?'예정 공격을 변경했습니다.':'예정 공격을 수동 추가했습니다.');
    $('attack-detail-dialog').close();
  }catch(error){alert(error.message);}
});
document.addEventListener('click',e=>{
  const add=e.target.closest('[data-manual-add-boss]');if(add){openManualAdd(add.dataset.manualAddBoss);return}
  const lock=e.target.closest('[data-toggle-plan-lock]');if(lock){
    e.preventDefault();e.stopPropagation();
    const index=Number(lock.dataset.togglePlanLock),attack=state.plan?.attacks?.[index];
    if(attack&&!planResultForAttack(attack)){
      const existing=(state.locks||[]).find(l=>l.userId===attack.userId&&l.partyId===attack.partyId&&l.bossId===attack.bossId);
      if(existing)state.locks=state.locks.filter(l=>l!==existing);
      else state.locks.push({id:uid(),userId:attack.userId,partyId:attack.partyId,bossId:attack.bossId});
      saveShared(existing?'락을 해제했습니다.':'이 예정 공격을 재계산에서 고정했습니다.').then(()=>{renderAll();if($('attack-detail-dialog')?.open)openAttackDetail(index);}).catch(error=>alert(error.message));
    }
    return;
  }
  const del=e.target.closest('[data-delete-plan-index]');if(del){
    e.preventDefault();e.stopPropagation();
    const index=Number(del.dataset.deletePlanIndex),attack=state.plan?.attacks?.[index];
    if(attack&&!planResultForAttack(attack)){
      const ok=confirm(`${attack.userName} · ${attack.partyName} 예정 공격을 삭제할까요?\n삭제 후 다른 기기에도 바로 반영됩니다.`);
      if(ok){
        state.plan.attacks.splice(index,1);
        state.locks=state.locks.filter(l=>!(l.userId===attack.userId&&l.partyId===attack.partyId&&l.bossId===attack.bossId));
        saveManualPlan('예정 공격을 삭제했습니다.').then(()=>{if($('attack-detail-dialog')?.open)$('attack-detail-dialog').close();}).catch(error=>alert(error.message));
      }
    }
    return;
  }
  const choice=e.target.closest('[data-party-choice]');
  if(choice&&!choice.disabled){
    const f=$('attack-actual-form'),resultId=f.dataset.resultId;
    const result=state.results.find(r=>r.id===resultId),user=state.users.find(u=>u.id===result?.userId),boss=state.bosses.find(b=>b.id===result?.bossId),party=user?.parties.find(p=>p.id===choice.dataset.partyChoice);
    if(result&&party&&boss&&party.element===boss.element){
      f.dataset.partyId=party.id;
      f.elements.damage.value=displayNumber(partyDamageForBoss(party,boss)||0);
      $('attack-detail-body').querySelectorAll('[data-party-choice]').forEach(b=>b.classList.toggle('selected',b.dataset.partyChoice===party.id));
    }
    return;
  }
  const resultCard=e.target.closest('[data-result-id]');if(resultCard){openCompletedAttackDetail(resultCard.dataset.resultId);return}
  const card=e.target.closest('[data-plan-index]');if(card)openAttackDetail(Number(card.dataset.planIndex));
});
$('attack-detail-close')?.addEventListener('click',()=>{$('attack-actual-form').hidden=false;$('attack-detail-dialog').close();});
$('attack-actual-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.target,damage=Number(f.elements.damage.value.replace(/,/g,''));if(!Number.isSafeInteger(damage)||damage<0)return alert('실제 딜량은 0 이상의 정수여야 합니다.');try{
  if(f.dataset.resultId){
    const result=state.results.find(r=>r.id===f.dataset.resultId);if(!result)throw new Error('완료 공격을 찾을 수 없습니다.');
    const user=state.users.find(u=>u.id===result.userId),boss=state.bosses.find(b=>b.id===result.bossId),party=user?.parties.find(p=>p.id===f.dataset.partyId);
    if(!user||!boss||!party||party.element!==boss.element)throw new Error('선택한 조합이 현재 보스 속성과 맞지 않습니다.');
    const used=completedOtherUsedNikkes(user.id,result.id),overlap=party.nikkes.filter(n=>used.has(n));if(overlap.length)throw new Error(`이미 완료한 공격에서 사용한 니케가 포함되어 있습니다: ${overlap.join(', ')}`);
    result.partyId=party.id;result.partyName=party.name;result.nikkes=[...party.nikkes];result.element=party.element;result.plannedDamage=partyDamageForBoss(party,boss)||0;result.damage=damage;result.at=new Date().toISOString();
    state.plan=null;
    await saveShared('완료 공격의 조합과 실제 딜을 수정했습니다. 남은 계획을 다시 계산합니다.');
    renderAll();
    $('attack-detail-dialog').close();
    setTimeout(()=>calculate(),0);
  }else{
    await saveActualFromPlan(Number(f.elements.attackIndex.value),damage);$('attack-detail-dialog').close();
  }
}catch(error){alert(error.message);}});

let sharedPlannerVersion=0, sharedPlannerSyncTimer=null, sharedPlannerSyncing=false;
async function fetchSharedPlannerVersion(){
  const endpoint=window.UNION_SHARED_URL;if(!endpoint)return null;
  const response=await fetch(endpoint+`?action=planner-version&t=${Date.now()}`,{cache:'no-store'});
  const data=await response.json();if(!response.ok||data.error)throw new Error(data.error||`HTTP ${response.status}`);return Number(data.version)||0;
}
async function syncSharedPlanner(force=false){
  if(sharedPlannerSyncing)return;
  sharedPlannerSyncing=true;
  try{
    const version=await fetchSharedPlannerVersion();
    if(!force&&version===sharedPlannerVersion)return;
    const dialog=$('attack-detail-dialog'),dialogOpen=!!dialog?.open;
    const resultId=dialogOpen?$('attack-actual-form')?.dataset.resultId:null;
    const shared=await plannerStoreRequest('planner');
    if(shared.plannerState){
      state=expandPlannerState(shared.plannerState);
      sharedPlannerVersion=Number(shared.version)||version||sharedPlannerVersion;
      localSave();
      renderAll();
      if(dialogOpen&&resultId&&state.results.some(r=>r.id===resultId))openCompletedAttackDetail(resultId);
    }
  }catch{}
  finally{sharedPlannerSyncing=false;}
}
function scheduleSharedPlannerSync(){
  clearTimeout(sharedPlannerSyncTimer);
  const delay=document.hidden?4000:1000;
  sharedPlannerSyncTimer=setTimeout(async()=>{await syncSharedPlanner(false);scheduleSharedPlannerSync();},delay);
}
let transferredState = null;
try { if (window.name.startsWith('union-planner-state:')) { transferredState = validateState(JSON.parse(window.name.slice('union-planner-state:'.length))); window.name = ''; } } catch { window.name = ''; }
async function initializePlannerState(){
  try{
    if(transferredState)state=transferredState;
    else{
      const shared=await plannerStoreRequest('planner');
      sharedPlannerVersion=Number(shared.version)||0;
      state=shared.plannerState?expandPlannerState(shared.plannerState):validateState(JSON.parse(localStorage.getItem('union-planner-v2'))||parseUnionRaidSeed());
    }
  }catch{
    try{state=validateState(JSON.parse(localStorage.getItem('union-planner-v2'))||parseUnionRaidSeed())}catch{state=parseUnionRaidSeed()}
  }
  ensurePlanningSettings();selectedUser=null;localSave();renderAll();
  scheduleSharedPlannerSync();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncSharedPlanner(true);scheduleSharedPlannerSync();});
  if(new URLSearchParams(location.search).get('calculate')==='1'){history.replaceState(null,'',location.pathname);setTimeout(()=>$('calculate')?.click(),0)}
}
initializePlannerState();
(async function showBuild(){
  const badge=$('build-badge');if(!badge)return;
  try{
    const response=await fetch(`./build.txt?t=${Date.now()}`,{cache:'no-store'});
    if(!response.ok)throw new Error();
    const full=(await response.text()).trim(),sha=full.slice(0,7);
    if(!/^[0-9a-f]{7,40}$/i.test(full))throw new Error();
    badge.textContent=`build ${sha}`;
    badge.href=`https://github.com/mu0767/union/commit/${full}`;
  }catch{badge.textContent='build ?';}
})();
