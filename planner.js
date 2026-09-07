'use strict';
const $ = id => document.getElementById(id);
const ELEMENTS = ['철갑','수냉','작열','풍압','전격'];
const SEED_ELEMENTS = ['철갑','수냉','작열','전격','풍압'];
const displayNumber = value => Number(value || 0).toLocaleString('ko-KR');
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const characters = [...(window.NIKKE_CHARACTERS || [])].sort((a,b) => b.name.length-a.name.length);
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
async function saveShared(message='') { localSave(message); }
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
function populateLiveForms(){
  for(const form of [$('result-form'),$('lock-form')]){const current=form.elements.user.value;form.elements.user.innerHTML=state.users.filter(u=>u.active&&u.attacksLeft>0).map(u=>`<option value="${u.id}">${escapeHTML(u.name)}</option>`).join('');if([...form.elements.user.options].some(o=>o.value===current))form.elements.user.value=current;form.elements.boss.innerHTML=bossOptions(form.id==='result-form');updatePartySelect(form);}
}
function updatePartySelect(form){const user=state.users.find(u=>u.id===form.elements.user.value);const used=new Set(state.results.filter(r=>r.userId===user?.id).flatMap(r=>r.nikkes||user?.parties.find(p=>p.id===r.partyId)?.nikkes||[]));form.elements.party.innerHTML=(user?.parties||[]).filter(p=>!p.nikkes.some(n=>used.has(n))).map(p=>`<option value="${p.id}">${escapeHTML(p.name)} · ${p.element}</option>`).join('')}
function renderLive(){
  populateLiveForms();
  const progress=raidProgress();$('current-bosses').innerHTML=`<div class="summary-card"><small>현재 진행</small><strong>${progress.currentRound===4?'최종보스':`Round ${progress.currentRound}`}</strong></div>`+progress.bosses.map(b=>`<div class="summary-card"><small>${escapeHTML(b.name)} · ${b.element}</small><strong>${b.remaining==='infinite'?'∞':displayNumber(b.remaining)}</strong></div>`).join('');
  $('lock-list').innerHTML=state.locks.length?state.locks.map(l=>compactEntry(l,'lock')).join(''):'<div class="empty-card">잠긴 공격이 없습니다.</div>';
  $('result-list').innerHTML=state.results.length?state.results.map(r=>compactEntry(r,'result')).join(''):'<div class="empty-card">완료된 공격이 없습니다.</div>';
  renderPlan(state.plan?.attacks?.filter(a=>a.isNow),$('now-list'));
}
function compactEntry(entry,type){const u=state.users.find(x=>x.id===entry.userId),p=u?.parties.find(x=>x.id===entry.partyId),b=state.bosses.find(x=>x.id===entry.bossId);return`<div class="compact-item"><span>${escapeHTML(entry.userName||u?.name||'삭제된 유저')} · ${escapeHTML(entry.partyName||p?.name||'삭제된 파티')} → ${escapeHTML(entry.bossName||b?.name||'삭제된 보스')}${entry.damage!=null?` · ${displayNumber(entry.damage)}`:''}</span>${type==='lock'?`<button data-remove-lock="${entry.id}">잠금 해제</button>`:'<small>완료 확정</small>'}</div>`}
function renderPlan(plan,target=$('plan-list'),group=target===$('plan-list')?$('plan-group').value:null){
  if(!plan?.length){target.className='plan-list empty-card';target.innerHTML='표시할 추천 공격이 없습니다.';return}target.className='plan-list';
  const bucket=a=>{if(group==='boss')return `R${a.round===4?'최종':a.round} · ${a.bossName}`;if(group==='user')return a.userName;if(group==='time'){const date=new Date(a.start),relative=(date.getHours()-5+24)%24,start=(Math.floor(relative/3)*3+5)%24,end=(start+3)%24;return `${String(start).padStart(2,'0')}:00~${String(end).padStart(2,'0')}:00`}return''};
  const groups=new Map();for(const attack of plan){const key=bucket(attack);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(attack)}
  target.innerHTML=[...groups].map(([label,attacks])=>`${label?`<h3 class="plan-group-title">${escapeHTML(label)}</h3>`:''}${attacks.map(a=>`<article class="plan-card"><strong>${escapeHTML(a.timeLabel||a.start||'시간 미정')}</strong><div><small>R${a.round===4?'최종':a.round} · ${escapeHTML(a.element)} · ${a.attackNumber}타</small><p>${escapeHTML(a.userName)} → ${escapeHTML(a.bossName)}</p><small>${escapeHTML(a.partyName)} · ${a.nikkes.map(escapeHTML).join(' / ')}</small></div><div><strong>${displayNumber(a.damage)}</strong><small>${a.beforeHp==='infinite'?'∞':displayNumber(a.beforeHp)} → ${a.afterHp==='infinite'?'∞':displayNumber(a.afterHp)} · 오버 ${displayNumber(a.overkill)}</small></div></article>`).join('')}`).join('')}
function renderTheory(){const plan=state.plan;if(!plan){$('plan-summary').innerHTML='';renderPlan(null);return}const s=plan.summary;$('plan-summary').innerHTML=[['예상 도달',s.reachedFinal?'최종보스':`Round ${s.reachedRound}`],['공격 사용',`${s.attackCount}회`],['총 오버딜',displayNumber(s.totalOverkill)],['최종보스 딜',displayNumber(s.finalDamage)]].map(x=>`<div class="summary-card"><small>${x[0]}</small><strong>${x[1]}</strong></div>`).join('');renderPlan(plan.attacks)}
function renderSettings(){const f=$('raid-settings');Object.entries(state.settings).forEach(([k,v])=>{if(f.elements[k])f.elements[k].value=String(v)});$('planner-boss-body').innerHTML=state.bosses.map(b=>`<tr data-boss-id="${b.id}"><td>${b.round===4?'최종':b.round}</td><td><input name="bossName" value="${escapeHTML(b.name)}" required maxlength="80"></td><td><select name="bossElement">${ELEMENTS.map(e=>`<option${e===b.element?' selected':''}>${e}</option>`).join('')}</select></td><td><input name="bossHp" inputmode="numeric" value="${b.hp==='infinite'?'무한':displayNumber(b.hp)}" required></td></tr>`).join('')}
function renderAll(){renderMembers();renderLive();renderTheory()}
async function calculate(){
  if ($('calculate').disabled) return;
  if(!state.settings.attackMinutes||state.settings.simultaneous==null||state.settings.simultaneous===''){$('planner-status').textContent='계산에 필요한 운영 기본값을 준비하지 못했습니다. 새로고침 후 다시 시도해 주세요.';return}
  const buttons=[$('calculate'),$('recalculate')];
  buttons.forEach(button=>{button.disabled=true;button.classList.add('is-calculating');button.dataset.label=button.textContent;button.textContent='계산 중…';});
  $('planner-status').textContent='남은 레이드 전체를 최적화하는 중…';
  try {
    const snapshot=JSON.stringify({...state,plan:null});
    const started=Date.now();
    let phase='계산기 로딩 중…';
    const updateStatus=()=>{$('planner-status').textContent=`[${Math.floor((Date.now()-started)/1000)}초] ${phase}`;};
    updateStatus();
    const ticker=setInterval(updateStatus,1000);
    const {solveRaid}=await import('./planner-solver.js');
    phase='빠른 공격 계획 구성 중…';updateStatus();
    const plan=await solveRaid(JSON.parse(snapshot),message=>{phase=message;updateStatus();});
    clearInterval(ticker);
    if(snapshot!==JSON.stringify({...state,plan:null}))throw new Error('계산 중 입력이 변경됐습니다. 현재 입력으로 다시 계산해 주세요.');
    state.plan=plan;localSave(plan.status==='OPTIMAL'?'최적 계획 계산 완료 · 결과를 확인하세요.':'공격 계획 계산 완료 · 제한 시간 내 찾은 최선의 계획입니다.');renderTheory();renderLive();
  }
  catch(error){$('planner-status').textContent=`계산 실패: ${error.message}`;}
  finally{buttons.forEach(button=>{button.disabled=false;button.classList.remove('is-calculating');button.textContent=button.dataset.label;});}
}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));document.querySelectorAll('.planner-view').forEach(v=>v.hidden=v.id!==`view-${button.dataset.view}`)}));
$('member-list').addEventListener('click',e=>{const b=e.target.closest('[data-user]');if(b){selectedUser=b.dataset.user;renderMembers()}});
$('add-member').addEventListener('click',()=>{if(state.users.length>=32)return alert('참가자는 최대 32명입니다.');const user={id:uid(),name:'새 참가자',level:null,active:true,attacksLeft:3,availability:[],parties:[]};state.users.push(user);selectedUser=user.id;renderMembers()});
$('remove-member').addEventListener('click',()=>{if(state.results.some(r=>r.userId===selectedUser))return alert('완료된 공격이 있는 참가자는 삭제할 수 없습니다.');state.users=state.users.filter(u=>u.id!==selectedUser);state.locks=state.locks.filter(l=>l.userId!==selectedUser);selectedUser=state.users[0]?.id||null;localSave('참가자를 저장했습니다.');renderAll()});
$('add-party').addEventListener('click',()=>{try{readMemberForm()}catch(e){return alert(e.message)}const u=state.users.find(x=>x.id===selectedUser);u.parties.push({id:uid(),name:`파티 ${u.parties.length+1}`,element:'철갑',nikkes:['','','','',''],normalDamage:0,finalDamage:null});renderMemberEditor()});
$('party-body').addEventListener('click',e=>{const b=e.target.closest('[data-remove-party]');if(b)b.closest('tr').remove()});
$('member-editor').addEventListener('submit',e=>{e.preventDefault();try{readMemberForm();localSave('변경 내용을 저장했습니다.');renderAll()}catch(error){$('planner-status').textContent=error.message}});
for(const id of ['result-form','lock-form'])$(id).elements.user.addEventListener('change',e=>updatePartySelect(e.target.form));
$('result-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.target,damage=Number(f.elements.damage.value.replace(/,/g,''));if(!Number.isSafeInteger(damage)||damage<0)return alert('실제 딜을 정수로 입력해 주세요.');const user=state.users.find(u=>u.id===f.elements.user.value);if(!user||user.attacksLeft<=0)return alert('남은 공격권이 없습니다.');const party=user.parties.find(p=>p.id===f.elements.party.value);const boss=state.bosses.find(b=>b.id===f.elements.boss.value);const progress=raidProgress();if(!progress.bosses.some(b=>b.id===boss?.id&&!b.clear))return alert('현재 열린 라운드의 남은 보스만 공격할 수 있습니다.');if(!party||!boss||party.element!==boss.element)return alert('파티와 보스의 속성이 맞지 않습니다.');const used=new Set(state.results.filter(r=>r.userId===user.id).flatMap(r=>r.nikkes||user.parties.find(p=>p.id===r.partyId)?.nikkes||[]));const overlap=party.nikkes.filter(n=>used.has(n));if(overlap.length)return alert(`이미 사용한 니케가 포함되어 있습니다: ${overlap.join(', ')}`);user.attacksLeft--;state.results.push({id:uid(),userId:user.id,userName:user.name,partyId:party.id,partyName:party.name,nikkes:[...party.nikkes],element:party.element,bossId:boss.id,bossName:boss.name,round:boss.round,damage,at:new Date().toISOString()});state.locks=state.locks.filter(l=>!(l.userId===user.id&&l.partyId===party.id&&l.bossId===boss.id));state.plan=null;await saveShared('실제 결과와 공격권·사용 니케·보스 HP를 저장했습니다. 재계산 버튼을 누르면 새 계획을 만듭니다.');f.elements.damage.value='';renderAll()});
$('lock-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.target;state.locks.push({id:uid(),userId:f.elements.user.value,partyId:f.elements.party.value,bossId:f.elements.boss.value});state.plan=null;await saveShared('공격을 잠갔습니다. 재계산 때 필수 제약으로 반영됩니다.');renderAll()});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-remove-lock]');if(b){state.locks=state.locks.filter(x=>x.id!==b.dataset.removeLock);state.plan=null;await saveShared('공격 잠금을 해제했습니다.');renderAll()}});
$('raid-settings').addEventListener('submit',async e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.target));if(new Date(values.startAt)>=new Date(values.endAt))return alert('종료 시각은 시작보다 늦어야 합니다.');const rows=[...$('planner-boss-body').querySelectorAll('tr')];try{state.bosses=rows.map((row,index)=>{const raw=row.querySelector('[name=bossHp]').value.trim();const final=index===rows.length-1;const hp=/^(무한|infinite|∞)$/i.test(raw)?'infinite':Number(raw.replace(/,/g,''));if((!final&&hp==='infinite')||(hp!=='infinite'&&(!Number.isSafeInteger(hp)||hp<=0)))throw new Error('일반 보스 HP는 0보다 큰 정수여야 합니다.');const prior=state.bosses.find(b=>b.id===row.dataset.bossId);return{...prior,name:row.querySelector('[name=bossName]').value.trim(),element:row.querySelector('[name=bossElement]').value,hp}});for(const round of [1,2,3])if(new Set(state.bosses.filter(b=>b.round===round).map(b=>b.element)).size!==5)throw new Error(`Round ${round}에는 5개 속성을 하나씩 선택해야 합니다.`)}catch(error){return alert(error.message)}state.settings={...values,attackMinutes:Number(values.attackMinutes),simultaneous:values.simultaneous==='true',finalElement:state.bosses.at(-1).element};state.plan=null;await saveShared('레이드와 보스 설정을 저장했습니다.');renderAll()});
$('calculate').addEventListener('click',calculate);$('recalculate').addEventListener('click',calculate);$('plan-group').addEventListener('change',renderTheory);
let transferredState = null;
try { if (window.name.startsWith('union-planner-state:')) { transferredState = validateState(JSON.parse(window.name.slice('union-planner-state:'.length))); window.name = ''; } } catch { window.name = ''; }
try{state=transferredState||validateState(JSON.parse(localStorage.getItem('union-planner-v2'))||parseUnionRaidSeed())}catch{state=parseUnionRaidSeed()}ensurePlanningSettings();selectedUser=state.users[0]?.id||null;renderAll();
if(new URLSearchParams(location.search).get('calculate')==='1'){history.replaceState(null,'',location.pathname);setTimeout(calculate,0)}

(async function showBuild(){
  const badge=$('build-badge');if(!badge)return;
  try{
    const response=await fetch('https://api.github.com/repos/mu0767/union/commits/main',{cache:'no-store'});
    if(!response.ok)throw new Error();
    const commit=await response.json(),sha=String(commit.sha||'').slice(0,7);
    if(!sha)throw new Error();
    badge.textContent=`build ${sha}`;
    badge.href=`https://github.com/mu0767/union/commit/${commit.sha}`;
  }catch{badge.textContent='build ?';}
})();
