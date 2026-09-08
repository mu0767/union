export function mergeBossChanges_(store, changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 48) throw new Error('변경 목록 오류');
  const next = JSON.parse(JSON.stringify(store));
  const touched = new Set();
  const keys = new Set();
  for (const change of changes) {
    const {round, index, field, before, value} = change;
    if (!Number.isInteger(round) || round < 1 || round > 4 || !Number.isInteger(index) || index < 0 || !next.rounds[round][index] || !['name','element','hp'].includes(field)) throw new Error('변경 위치 오류');
    const key = `${round}:${index}:${field}`;
    if (keys.has(key)) throw new Error('중복 변경');
    keys.add(key);
    if (field === 'name' && (typeof value !== 'string' || !value.trim() || value.length > 80)) throw new Error('이름 형식 오류');
    if (field === 'element' && !['철갑','수냉','작열','전격','풍압'].includes(value)) throw new Error('속성 형식 오류');
    if (field === 'hp' && (round === 4 ? value !== 'infinite' : !Number.isSafeInteger(value) || value <= 0)) throw new Error('체력 형식 오류');
    const boss = next.rounds[round][index];
    // Identical retries are safe after a lost response.
    if (boss[field] === value) continue;
    if (boss[field] !== before) throw new Error(`${round}단계 ${index + 1}번 ${field}: 다른 사용자가 수정했습니다. 최신 값으로 입력을 되돌린 뒤 다시 수정해 주세요.`);
    boss[field] = value;
    touched.add(`${round}:${index}`);
  }
  touched.forEach(key => { const [round, index] = key.split(':'); next.revisions[round][index]++; });
  if (touched.size) next.version++;
  return next;
}
