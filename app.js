'use strict';
function parseUnionRaid(text) {
  const rows = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(line => line.split(','));
  const header = rows.shift() || [];
  if (header.length < 12) throw new Error('union_raid.txt 헤더를 확인해 주세요.');
  const byName = new Map();
  for (const row of rows) {
    if (row.length < 12) throw new Error('각 행은 지휘관, 싱크로, 보스, 속성, 덱, 니케 5명, 딜량, 비고 순서여야 합니다.');
    const [name, levelText, bossElement, partyElement, deck, ...rest] = row;
    const stageIndex = raidElements.indexOf(bossElement.trim());
    const nikkes = rest.slice(0, 5).map(value => value.trim());
    const damageText = (rest[5] || '').replace(/,/g, '').trim();
    const note = (rest[6] || '').trim();
    const level = Number(levelText);
    if (!name.trim() || stageIndex < 0 || !Number.isSafeInteger(level)) throw new Error(`잘못된 행: ${row.join(',')}`);
    if (!byName.has(name)) byName.set(name, {name:name.trim(), level, stageSquads:Array.from({length:5}, () => [])});
    const damage = /^\d+$/.test(damageText) && Number.isSafeInteger(Number(damageText)) ? Number(damageText) : null;
    byName.get(name).stageSquads[stageIndex].push({team:nikkes.join(''), nikkes, damage, note, deck:deck.trim(), partyElement:partyElement.trim()});
  }
  const people = [...byName.values()].map(person => ({...person, stages:person.stageSquads.map(squads => ({squads, total:squads.reduce((sum, squad) => sum + (squad.damage || 0), 0)}))}));
  if (!people.length) throw new Error('기록이 없습니다.');
  return people;
}
function parseDeal(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const people = [];
  let i = 0;
  while (i < lines.length) {
    const name = lines[i++];
    const levelMatch = /^싱크로\s+(\d+)$/.exec(lines[i++] || '');
    if (!levelMatch) throw new Error(`${name}: 싱크로 레벨을 확인해 주세요.`);
    const person = { name, level: Number(levelMatch[1]), stages: [] };
    for (let stage = 1; stage <= 5; stage++) {
      if (lines[i++] !== String(stage)) throw new Error(`${name}: ${stage}번 기록이 필요합니다.`);
      const squads = [];
      for (let squad = 0; squad < 3; squad++) {
        const team = lines[i++];
        const raw = lines[i++] || '';
        if (team && /^미보유(?:\s|$)/.test(raw)) { squads.push({ team, damage: null, note: raw }); continue; }
        if (!team || !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw)) throw new Error(`${name} ${stage}번: 편성 또는 딜량 형식이 올바르지 않습니다.`);
        const damage = Number(raw.replace(/,/g, ''));
        if (!Number.isSafeInteger(damage)) throw new Error('딜량이 지원 범위를 초과했습니다.');
        squads.push({ team, damage });
      }
      const total = squads.reduce((sum, s) => sum + s.damage, 0);
      if (!Number.isSafeInteger(total)) throw new Error('합계가 지원 범위를 초과했습니다.');
      person.stages.push({ squads, total });
    }
    people.push(person);
  }
  if (!people.length) throw new Error('파일에 기록이 없습니다.');
  return people;
}
const $ = id => document.getElementById(id);
const format = value => value === null ? '미보유' : value.toLocaleString('ko-KR');
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let people = [];
let selectedStage = 'all';
// 유니온 레이드 1단계: 원본 번호 순서에 대응하는 속성.
const raidElements = ['철갑', '수냉', '작열', '전격', '풍압'];
let damageMultipliers = raidElements.map(() => 1);
const scaledDamage = (value, stageIndex) => value === null ? null : Math.round(value * damageMultipliers[stageIndex]);
const scaledTotal = (stage, stageIndex) => stage.squads.reduce((sum, squad) => sum + (scaledDamage(squad.damage, stageIndex) || 0), 0);
const raidLabel = index => raidRounds[1][index].element;
const raidRounds = {
  1: [
    { name: '레이턴스', element: '철갑', hp: 99856279200 },
    { name: '툼스톤', element: '수냉', hp: 99856279200 },
    { name: '모더니아', element: '작열', hp: 150841813600 },
    { name: '리빌드 빅 토르소', element: '전격', hp: 99856279200 },
    { name: '애니힐리오', element: '풍압', hp: 150841813600 }
  ],
  2: [
    { name: '레이턴스', element: '철갑', hp: 149784418800 },
    { name: '툼스톤', element: '수냉', hp: 149784418800 },
    { name: '모더니아', element: '작열', hp: 226262720400 },
    { name: '리빌드 빅 토르소', element: '전격', hp: 149784418800 },
    { name: '애니힐리오', element: '풍압', hp: 226262720400 }
  ],
  3: [
    { name: '레이턴스', element: '철갑', hp: 292455295750 },
    { name: '툼스톤', element: '수냉', hp: 292455295750 },
    { name: '모더니아', element: '작열', hp: 349230901500 },
    { name: '리빌드 빅 토르소', element: '전격', hp: 292455295750 },
    { name: '애니힐리오', element: '풍압', hp: 349230901500 }
  ],
  4: [
    { name: '애니힐리오', element: '풍압', hp: Infinity }
  ]
};
let selectedRound = 1;
let serverReady = false;
let bossRevisions = {};
let bossDirty = false;
let savingBoss = false;
let loadingBoss = false;
let remoteVersion = null;
let pollFailures = 0;
const bossDrafts = new Map();
const focusedBossValues = new WeakMap();
const wireHp = hp => hp === Infinity ? 'infinite' : hp;
function patchBossViews() {
  const stages = selectedStage === 'all' ? [0,1,2,3,4] : [Number(selectedStage)-1];
  stages.forEach((stage, index) => {
    const cell = $('table-head').querySelectorAll('th')[index + 1];
    if (cell) {
      const html = `${escapeHTML(raidRounds[1][stage].name)}<br><span>${raidLabel(stage)} / 딜량</span>`;
      if (cell.innerHTML !== html) cell.innerHTML = html;
    }
  });
  document.querySelectorAll('[data-stage]').forEach(button => {
    if (button.dataset.stage !== 'all') button.textContent = raidLabel(Number(button.dataset.stage)-1);
  });
  document.querySelectorAll('[data-multiplier]').forEach((input, index) => {
    input.parentNode.firstChild.textContent = `${raidRounds[1][index].name} · ${raidElements[index]}`;
  });
  $('detail-body').querySelectorAll('.detail-stage h3').forEach((heading, index) => {
    heading.textContent = `${raidRounds[1][index].name} · ${raidLabel(index)} · ×${damageMultipliers[index]}`;
    heading.nextElementSibling.textContent = `보스 체력 ${format(raidRounds[1][index].hp)}`;
  });
  $('boss-list').querySelectorAll('[data-boss]').forEach(card => {
    const index = Number(card.dataset.boss);
    for (const [field, name] of [['name','bossName'], ['element','element'], ['hp','hp']]) {
      const input = card.querySelector(`[name="${name}"]`);
      const draft = bossDrafts.get(`${selectedRound}:${index}:${field}`);
      const value = draft ? draft.text : field === 'hp' ? format(raidRounds[selectedRound][index][field]) : raidRounds[selectedRound][index][field];
      if (input && input.value !== value && document.activeElement !== input) input.value = value;
    }
  });
}
function applyServerStore(store) {
  const next = {};
  for (const round of [1,2,3,4]) {
    if (!Array.isArray(store.rounds?.[round]) || store.rounds[round].length !== raidRounds[round].length) throw new Error('공유 데이터 형식 오류');
    next[round] = store.rounds[round].map(b => {
      if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 80 || !raidElements.includes(b.element) || !(b.hp === 'infinite' || (Number.isSafeInteger(b.hp) && b.hp > 0))) throw new Error('공유 데이터 형식 오류');
      return {...b, hp:b.hp === 'infinite' ? Infinity : b.hp};
    });
    if (!Array.isArray(store.revisions?.[round]) || store.revisions[round].length !== next[round].length || !store.revisions[round].every(v => Number.isSafeInteger(v) && v >= 0)) throw new Error('공유 revision 오류');
  }
  if (!Number.isSafeInteger(store.version) || store.version < 0) throw new Error('공유 version 오류');
  Object.assign(raidRounds, next);
  bossRevisions = store.revisions;
  remoteVersion = store.version;
  patchBossViews();
}
async function loadSharedBosses(manual = false) {
  if (loadingBoss || savingBoss) return;
  loadingBoss = true;
  try {
    const version = await window.BossRepository.checkVersion();
    if (version !== remoteVersion) applyServerStore(await window.BossRepository.load());
    serverReady = true;
    pollFailures = 0;
    if (manual || !bossDirty) $('server-status').textContent = bossDirty ? '최신 정보 반영 · 작성 중인 입력은 유지됩니다.' : '공유 연결됨 · 변경사항 자동 반영 중';
  } catch (error) {
    pollFailures++;
    $('server-status').textContent = `공유 연결 실패: ${error.message} · 입력을 유지하며 재연결합니다.`;
  } finally { loadingBoss = false; }
}
function renderRound(round) {
  selectedRound = round;
  bossDirty = bossDrafts.size > 0;
  const bosses = raidRounds[round];
  const fixedFinalHp = round === 4;
  $('boss-list').innerHTML = bosses.map((boss,index) => `<article class="boss-card" data-boss="${index}"><label>보스 이름<input name="bossName" aria-label="보스 이름" required maxlength="80" value="${escapeHTML(boss.name)}"></label><label>속성<select name="element" aria-label="보스 속성">${raidElements.map(element => `<option${boss.element === element ? ' selected' : ''}>${element}</option>`).join('')}</select></label>${fixedFinalHp ? '<label>보스 체력<strong class="fixed-infinite">∞ 무한</strong></label>' : `<label>보스 체력<input name="hp" aria-label="보스 체력" inputmode="numeric" value="${format(boss.hp)}" required placeholder="예: 99,856,279,200"></label>`}</article>`).join('');
  document.querySelectorAll('[data-round]').forEach(button => {
    const active = Number(button.dataset.round) === round;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function rememberBossInput(event) {
  const card = event.target.closest('[data-boss]');
  if (!card) return;
  const field = {bossName:'name', element:'element', hp:'hp'}[event.target.name];
  if (!field) return;
  const index = Number(card.dataset.boss);
  const key = `${selectedRound}:${index}:${field}`;
  const previous = bossDrafts.get(key);
  bossDrafts.set(key, {round:selectedRound, index, field, before:previous ? previous.before : focusedBossValues.has(event.target) ? focusedBossValues.get(event.target) : wireHp(raidRounds[selectedRound][index][field]), text:event.target.value});
  bossDirty = true;
  $('server-status').textContent = '변경 내용을 저장해 주세요.';
}
$('boss-list').addEventListener('input', rememberBossInput);
$('boss-list').addEventListener('change', rememberBossInput);
$('boss-list').addEventListener('focusin', event => {
  const field = {bossName:'name', element:'element', hp:'hp'}[event.target.name];
  const card = event.target.closest('[data-boss]');
  if (field && card) focusedBossValues.set(event.target, wireHp(raidRounds[selectedRound][Number(card.dataset.boss)][field]));
});
$('boss-list').addEventListener('focusout', () => setTimeout(patchBossViews, 0));
$('save-bosses').addEventListener('click', async () => {
  if (savingBoss) return;
  if (loadingBoss) { $('server-status').textContent = '최신 정보 확인 중입니다. 잠시 후 저장해 주세요.'; return; }
  if (!serverReady) { $('server-status').textContent = '공유 연결 후 저장할 수 있습니다.'; return; }
  const submitted = [...bossDrafts.entries()].filter(([,d]) => d.round === selectedRound);
  const changes = [];
  for (const [, draft] of submitted) {
    const value = draft.field === 'hp' ? Number(draft.text.replace(/,/g, '')) : draft.text.trim();
    if ((draft.field === 'hp' && (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(draft.text.trim()) || !Number.isSafeInteger(value) || value <= 0)) || (draft.field === 'name' && (!value || value.length > 80))) {
      $('server-status').textContent = '이름과 0보다 큰 정수 체력을 입력해 주세요.'; return;
    }
    if (value !== draft.before) changes.push({round:draft.round, index:draft.index, field:draft.field, before:draft.before, value});
  }
  if (!changes.length) {
    submitted.forEach(([key]) => bossDrafts.delete(key)); bossDirty = bossDrafts.size > 0; patchBossViews();
    $('server-status').textContent = '저장할 변경사항이 없습니다.'; return;
  }
  savingBoss = true;
  $('save-bosses').disabled = true;
  $('server-status').textContent = '공유 저장 중…';
  try {
    const store = await window.BossRepository.save(changes);
    submitted.forEach(([key, draft]) => {
      if (bossDrafts.get(key) === draft) bossDrafts.delete(key);
      else if (bossDrafts.has(key)) bossDrafts.get(key).before = store.rounds[draft.round][draft.index][draft.field];
      if (draft.round === selectedRound) {
        const name = {name:'bossName', element:'element', hp:'hp'}[draft.field];
        const input = $('boss-list').querySelector(`[data-boss="${draft.index}"] [name="${name}"]`);
        if (input) focusedBossValues.set(input, store.rounds[draft.round][draft.index][draft.field]);
      }
    });
    bossDirty = bossDrafts.size > 0;
    applyServerStore(store);
    $('server-status').textContent = bossDirty ? '저장 완료 · 추가 입력은 아직 저장되지 않았습니다.' : '공유 저장 완료';
  } catch (error) {
    $('server-status').textContent = `저장 실패: ${error.message} · 입력은 유지됩니다.`;
  } finally { savingBoss = false; $('save-bosses').disabled = false; }
});
$('reload-bosses').addEventListener('click', () => loadSharedBosses(true));
$('discard-bosses').addEventListener('click', () => {
  if (savingBoss) return;
  for (const [key, draft] of bossDrafts) if (draft.round === selectedRound) bossDrafts.delete(key);
  bossDirty = bossDrafts.size > 0;
  patchBossViews();
  loadSharedBosses(true);
});
function selectPage(page) {
  const isRecords = page === 'records';
  $('round-records').hidden = !isRecords;
  $('boss-panel').hidden = isRecords;
  document.querySelector('.import-button').hidden = !isRecords;
  document.title = `UNION · ${isRecords ? '딜량 기록' : '보스 정보'}`;
  document.querySelector('.subtitle').textContent = isRecords ? '1단계 · 속성별 지휘관 딜량과 편성을 한눈에.' : '1~4단계 보스의 속성과 체력을 확인하세요.';
  document.querySelectorAll('[data-page]').forEach(button => {
    const active = button.dataset.page === page;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => {
  const page = button.dataset.page;
  selectPage(page);
  history.replaceState(null, '', page === 'bosses' ? '#bosses' : location.pathname);
}));
document.querySelectorAll('[data-round]').forEach(button => button.addEventListener('click', () => (renderRound(Number(button.dataset.round)), patchBossViews())));
renderRound(1);
function renderMultipliers() {
  $('multiplier-fields').innerHTML = raidElements.map((element, index) => `<label>${escapeHTML(raidRounds[1][index].name)} · ${element}<input type="number" min="0" max="100" step="0.1" inputmode="decimal" data-multiplier="${index}" value="${damageMultipliers[index]}" aria-label="${element} 딜량 배수"></label>`).join('');
}
$('multipliers-toggle').addEventListener('click', () => {
  const panel = $('damage-multipliers');
  panel.hidden = !panel.hidden;
  $('multipliers-toggle').setAttribute('aria-expanded', String(!panel.hidden));
});
$('multiplier-fields').addEventListener('input', event => {
  const input = event.target.closest('[data-multiplier]');
  if (!input) return;
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < 0) return;
  damageMultipliers[Number(input.dataset.multiplier)] = value;
  render();
});
$('multipliers-reset').addEventListener('click', () => { damageMultipliers = raidElements.map(() => 1); renderMultipliers(); render(); });
renderMultipliers();
selectPage(location.hash === '#bosses' ? 'bosses' : 'records');
window.addEventListener('hashchange', () => selectPage(location.hash === '#bosses' ? 'bosses' : 'records'));
document.querySelectorAll('[data-stage]').forEach(button => {
  if (button.dataset.stage !== 'all') button.textContent = raidLabel(Number(button.dataset.stage) - 1);
});
const characters = [...(window.NIKKE_CHARACTERS || [])].sort((a,b) => b.name.length - a.name.length);
function splitTeam(team) {
  const compact = value => value.replace(/\s/g, '');
  function match(rest, members) {
    if (!rest) return members.length === 5 ? members : null;
    if (members.length >= 5) return null;
    for (const character of characters) {
      const name = compact(character.name);
      if (rest.startsWith(name)) {
        const result = match(rest.slice(name.length), [...members, character]);
        if (result) return result;
      }
    }
    return null;
  }
  return match(compact(team), []);
}
function renderTeam(team, note = '') {
  const members = splitTeam(team);
  if (!members) return `<p class="unknown-team">${escapeHTML(team)}</p>`;
  return `<div class="character-grid">${members.map(character => {
    const missing = note.includes(character.name);
    return `<figure class="character${missing ? ' missing' : ''}"><div class="portrait"><img src="${escapeHTML(character.image)}" alt="${escapeHTML(character.name)}" loading="lazy" decoding="async">${missing ? '<span class="missing-badge">미보유</span>' : ''}</div><figcaption>${escapeHTML(character.name)}</figcaption></figure>`;
  }).join('')}</div>`;
}
function renderLineups() {
  const teams = [...new Set(people.flatMap(p => p.stages.flatMap(stage => stage.squads.map(s => s.team))))];
  $('lineups').innerHTML = teams.map((team,i) => `<article class="lineup"><h3>편성 ${i+1}</h3>${renderTeam(team)}</article>`).join('');
}
function visiblePeople() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const rows = people.map((p, index) => ({ ...p, index })).filter(p => p.name.toLocaleLowerCase().includes(query));
  const score = p => selectedStage === 'all' ? p.stages.reduce((sum, s, i) => sum + scaledTotal(s, i), 0) : scaledTotal(p.stages[Number(selectedStage) - 1], Number(selectedStage) - 1);
  if ($('sort').value === 'damage') rows.sort((a,b) => score(b) - score(a));
  if ($('sort').value === 'level') rows.sort((a,b) => b.level - a.level);
  if ($('sort').value === 'name') rows.sort((a,b) => a.name.localeCompare(b.name, 'ko'));
  return rows;
}
function render() {
  const stages = selectedStage === 'all' ? [0,1,2,3,4] : [Number(selectedStage)-1];
  const rows = visiblePeople();
  $('count').textContent = `${rows.length}명`;
  $('table-head').innerHTML = `<tr><th scope="col">지휘관 / 싱크로</th>${stages.map(i => `<th scope="col">${escapeHTML(raidRounds[1][i].name)}<br><span>${raidLabel(i)} / 딜량</span></th>`).join('')}</tr>`;
  $('table-body').innerHTML = rows.map(p => `<tr><td><button class="commander" data-person="${p.index}" aria-label="${escapeHTML(p.name)} 편성 상세"><span class="person-index">${String(p.index+1).padStart(2,'0')}</span>${escapeHTML(p.name)}</button><span class="level">Lv. ${p.level}</span></td>${stages.map(i => `<td>${p.stages[i].squads.map((s,j) => `<button class="damage-line squad-trigger" data-squad="${p.index}:${i}:${j}" aria-label="${escapeHTML(p.name)} 덱 ${escapeHTML(s.deck || String(j+1))} 구성 보기"><span>${escapeHTML(s.deck || String(j+1))}</span>${format(scaledDamage(s.damage, i))}</button>`).join('')}</td>`).join('')}</tr>`).join('');
  $('empty').hidden = rows.length > 0;
}
function renderStats() {
  renderLineups();
  const average = Math.round(people.reduce((sum,p) => sum+p.level,0)/people.length);
  const maximum = Math.max(...people.map(p => p.level));
  const stats = [['등록 지휘관',format(people.length),'명','함께하는 유니온 멤버'],['평균 싱크로',format(average),'Lv.','전체 지휘관 레벨 기준'],['최고 싱크로',format(maximum),'Lv.',people.filter(p => p.level === maximum).map(p => p.name).join(' · ')],['전체 편성 기록',format(people.length*15),'개','지휘관 × 5개 번호 × 3개 편성']];
  $('stats').innerHTML = stats.map(s => `<div class="stat"><span class="stat-label">${s[0]}</span><strong>${s[1]}<em>${s[2]}</em></strong><small>${escapeHTML(s[3])}</small></div>`).join('');
}
function showDetail(index) {
  const p = people[index];
  $('detail-title').textContent = `${p.name} · 싱크로 ${p.level} · 레이드 1단계`;
  $('detail-body').innerHTML = p.stages.map((stage,i) => `<section class="detail-stage"><h3>${escapeHTML(raidRounds[1][i].name)} · ${raidLabel(i)} · ×${damageMultipliers[i]}</h3><p class="boss-detail-hp">보스 체력 ${format(raidRounds[1][i].hp)}</p>${stage.squads.map((s,j) => `<div class="squad"><div class="squad-members"><small>덱 ${escapeHTML(s.deck || String(j+1))}</small>${renderTeam(s.team, s.note)}${s.note ? `<p>${escapeHTML(s.note)}</p>` : ''}</div><strong>${format(scaledDamage(s.damage, i))}</strong></div>`).join('')}<p class="detail-total">합계 ${format(scaledTotal(stage, i))}</p></section>`).join('');
  $('detail').showModal();
}
function showSquad(personIndex, stageIndex, squadIndex) {
  const person = people[personIndex];
  const squad = person?.stages[stageIndex]?.squads[squadIndex];
  if (!squad) return;
  const nikkes = squad.nikkes?.length ? squad.nikkes : (splitTeam(squad.team) || []).map(character => character.name);
  $('detail-title').textContent = `${person.name} · ${raidLabel(stageIndex)} · 덱 ${squad.deck || squadIndex + 1}`;
  $('detail-body').innerHTML = `<section class="detail-stage"><p class="boss-detail-hp">딜량 ${format(scaledDamage(squad.damage, stageIndex))}</p><div class="squad-character-list">${nikkes.map(name => { const character = characters.find(item => item.name === name); return `<article>${character ? `<img src="${escapeHTML(character.image)}" alt="${escapeHTML(name)}" loading="lazy" decoding="async">` : '<span class="portrait-placeholder">N</span>'}<strong>${escapeHTML(name)}</strong></article>`; }).join('')}</div>${squad.note ? `<p class="squad-note">${escapeHTML(squad.note)}</p>` : ''}</section>`;
  $('detail').showModal();
}
document.querySelectorAll('[data-stage]').forEach(button => button.addEventListener('click', () => {
  selectedStage = button.dataset.stage;
  document.querySelectorAll('[data-stage]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  render();
}));
$('search').addEventListener('input', render);
$('sort').addEventListener('change', render);
$('table-body').addEventListener('click', event => { const squad = event.target.closest('[data-squad]'); if (squad) { const [person,stage,index] = squad.dataset.squad.split(':').map(Number); showSquad(person,stage,index); return; } const button = event.target.closest('[data-person]'); if (button) showDetail(Number(button.dataset.person)); });
$('close').addEventListener('click', () => $('detail').close());
$('detail').addEventListener('click', event => { if (event.target === $('detail')) { const r = $('detail').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('detail').close(); } });
$('file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const raw = await file.text();
    const nextPeople = parseUnionRaid(raw);
    people = nextPeople;
    localStorage.setItem('union-raid-text', raw);
    $('search').value = '';
    render();
    $('source').textContent = `SOURCE · ${file.name}`;
    $('message').textContent = `${file.name}: ${people.length}명의 기록을 불러왔습니다. 이 파일은 현재 화면에만 적용됩니다.`;
  } catch (error) { $('message').textContent = `불러오기 실패: ${error.message} 기존 기록은 유지됩니다.`; }
  $('message').hidden = false;
  event.target.value = '';
});
try { people = parseUnionRaid(localStorage.getItem('union-raid-text') || window.UNION_RAID_TEXT); render(); }
catch (error) { $('message').textContent = `기록을 읽지 못했습니다: ${error.message}`; $('message').hidden = false; }
loadSharedBosses();
async function pollSharedBosses() {
  if (!document.hidden) await loadSharedBosses();
  setTimeout(pollSharedBosses, Math.min(30000, (3000 + Math.random() * 2000) * 2 ** Math.min(pollFailures, 3)));
}
setTimeout(pollSharedBosses, 3000 + Math.random() * 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadSharedBosses(); });
