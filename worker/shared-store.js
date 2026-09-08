const elements = ['철갑','수냉','작열','전격','풍압'];
const validInteger = n => Number.isSafeInteger(n) && n >= 0;
export function validatePlanner(p) {
  if (!p || !p.settings || !Array.isArray(p.users) || p.users.length > 32 ||
      !Array.isArray(p.bosses) || p.bosses.length !== 16 || !Array.isArray(p.results) ||
      p.results.length > 96 || !Array.isArray(p.locks) || p.locks.length > 96 ||
      (p.plan !== null && (!p.plan || !Array.isArray(p.plan.attacks)))) throw new Error('계획 형식 오류');
  const ids = new Set();
  for (const u of p.users) {
    if (!u.id || ids.has(u.id) || typeof u.name !== 'string' || !validInteger(u.attacksLeft) || u.attacksLeft > 3 ||
        !Array.isArray(u.parties) || u.parties.length > 100 || !Array.isArray(u.availability)) throw new Error('멤버 형식 오류');
    ids.add(u.id);
    const partyIds = new Set();
    for (const party of u.parties) {
      if (!party.id || partyIds.has(party.id) || !elements.includes(party.element) ||
          !validInteger(party.normalDamage) || (party.finalDamage != null && !validInteger(party.finalDamage)) ||
          !Array.isArray(party.nikkes) || party.nikkes.length !== 5 || new Set(party.nikkes).size !== 5 ||
          party.nikkes.some(n => typeof n !== 'string' || !n)) throw new Error('파티 형식 오류');
      partyIds.add(party.id);
    }
  }
  const bossIds = new Set();
  for (const b of p.bosses) {
    if (!b.id || bossIds.has(b.id) || !elements.includes(b.element) || typeof b.name !== 'string' || !b.name.trim() ||
        ![1,2,3,4].includes(b.round) || (b.round === 4 ? b.hp !== 'infinite' : !validInteger(b.hp) || b.hp === 0)) throw new Error('보스 형식 오류');
    bossIds.add(b.id);
  }
  for (const round of [1,2,3,4]) {
    const bosses = p.bosses.filter(b => b.round === round);
    if (bosses.length !== (round === 4 ? 1 : 5) || new Set(bosses.map(b => b.element)).size !== bosses.length) throw new Error('라운드 형식 오류');
  }
  const resultIds = new Set(), used = new Map(), counts = new Map(), damage = new Map();
  const lockIds = new Set();
  for (const lock of p.locks) {
    const party = p.users.find(u => u.id === lock.userId)?.parties.find(p => p.id === lock.partyId);
    const boss = p.bosses.find(b => b.id === lock.bossId);
    if (!lock.id || lockIds.has(lock.id) || !party || !boss || party.element !== boss.element) throw new Error('공격 잠금 형식 오류');
    lockIds.add(lock.id);
  }
  for (const r of p.results) {
    const u = p.users.find(u => u.id === r.userId), b = p.bosses.find(b => b.id === r.bossId);
    const party = u?.parties.find(x => x.id === r.partyId);
    if (!r.id || resultIds.has(r.id) || !u || !b || !party || !validInteger(r.damage) ||
        r.element !== b.element || r.element !== party.element || !Array.isArray(r.nikkes) ||
        r.nikkes.length !== 5 || new Set(r.nikkes).size !== 5 || r.nikkes.some(n => !party.nikkes.includes(n))) throw new Error('공격 기록 형식 오류');
    const prior = used.get(u.id) || new Set();
    if (r.nikkes.some(n => prior.has(n))) throw new Error('이미 사용한 니케입니다.');
    if (p.bosses.some(x => x.round < b.round && (damage.get(x.id) || 0) < x.hp) ||
        (b.hp !== 'infinite' && (damage.get(b.id) || 0) >= b.hp)) throw new Error('공격할 수 없는 보스입니다.');
    r.nikkes.forEach(n => prior.add(n)); used.set(u.id, prior);
    counts.set(u.id, (counts.get(u.id) || 0) + 1);
    if (counts.get(u.id) + u.attacksLeft > 3) throw new Error('공격권 한도 초과');
    damage.set(b.id, (damage.get(b.id) || 0) + r.damage); resultIds.add(r.id);
  }
}
export function updateShared(store, key, value) {
  const next = structuredClone(store);
  if (key === 'raidText') {
    if (typeof value !== 'string' || value.length > 400000 || value.split(/\r?\n/)[0].split(',').length < 12) throw new Error('딜량 기록 형식 오류');
    const members = new Set(), parties = new Set();
    const rows = value.replace(/^\uFEFF/,'').trim().split(/\r?\n/).slice(1);
    if (!rows.length) throw new Error('딜량 기록이 없습니다.');
    for (const line of rows) {
      const row = line.split(','), [name,level,element,,deck] = row;
      const nikkes = row.slice(5,10).map(n => n.trim());
      const id = JSON.stringify([name,element,deck]);
      if (row.length < 12 || !name.trim() || !validInteger(Number(level)) || !elements.includes(element) ||
          !deck.trim() || nikkes.some(n => !n) || new Set(nikkes).size !== 5 || parties.has(id) ||
          (/^\d+$/.test(row[10]) && !validInteger(Number(row[10])))) throw new Error('딜량 기록 행 형식 오류');
      members.add(name);parties.add(id);
    }
    if (members.size > 32) throw new Error('최대 32명까지 등록할 수 있습니다.');
  } else if (key === 'multipliers') {
    if (!Array.isArray(value) || value.length !== 5 || value.some(n => !Number.isFinite(n) || n < 0 || n > 100)) throw new Error('배율은 0~100 범위입니다.');
  } else if (key === 'planner') {
    validatePlanner(value);
    for (const round of [1,2,3,4]) {
      // Match by the stable order supplied by the planner, preserving the board order by element when possible.
      const bosses = value.bosses.filter(b => b.round === round);
      next.rounds[round] = next.rounds[round].map((old, i) => {
        const b = bosses.find(b => b.id === `shared-r${round}-${i}`) || bosses.find(b => b.element === old.element) || bosses[i];
        const entry = {name:b.name, element:b.element, hp:b.hp};
        if (JSON.stringify(entry) !== JSON.stringify(old)) next.revisions[round][i]++;
        return entry;
      });
    }
  } else throw new Error('지원하지 않는 저장 항목');
  next[key] = value;
  if (key !== 'planner' && next.planner) {
    next.planner.plan = null;
    if (key === 'raidText') {
      const users = new Map();
      for (const line of value.replace(/^\uFEFF/,'').trim().split(/\r?\n/).slice(1)) {
        const [name,level,element,sourceElement,deck,...rest] = line.split(',');
        if (!name?.trim() || !elements.includes(element) || rest.length < 7 || !validInteger(Number(level))) throw new Error('딜량 기록 행 형식 오류');
        const old = next.planner.users.find(u => u.name === name);
        if (!users.has(name)) users.set(name, {...(old || {id:crypto.randomUUID(),active:true,attacksLeft:3,availability:[{start:'05:00',end:'05:00'}]}),name,level:Number(level),parties:[]});
        const partyName = `${element} 덱 ${deck}`;
        const party = old?.parties.find(p => p.name === partyName && p.element === element);
        const nikkes = rest.slice(0,5).map(n => n.trim());
        if (party && next.planner.results.some(r => r.partyId === party.id) && JSON.stringify(party.nikkes) !== JSON.stringify(nikkes)) throw new Error('사용한 파티의 니케를 바꿀 수 없습니다. 새 레이드에서는 먼저 전체 초기화해 주세요.');
        const raw = rest[5].trim();
        const baseDamage = /^\d+$/.test(raw) ? Number(raw) : 0;
        users.get(name).parties.push({id:party?.id || crypto.randomUUID(),name:partyName,element,sourceElement,nikkes,baseDamage,
          normalDamage:Math.round(baseDamage * next.multipliers[elements.indexOf(element)]),finalDamage:party?.finalDamage ?? null});
      }
      next.planner.users = [...users.values()];
    } else {
      for (const u of next.planner.users) for (const p of u.parties) {
        p.baseDamage ??= p.normalDamage / (store.multipliers?.[elements.indexOf(p.element)] || 1);
        p.normalDamage = Math.round(p.baseDamage * value[elements.indexOf(p.element)]);
      }
    }
    validatePlanner(next.planner);
  }
  next.version++;
  return next;
}
