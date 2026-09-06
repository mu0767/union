/* Sheet row: A1 = global version, B1 = existing {rounds,revisions} JSON.
 * Writes merge field patches under a script lock; no client state overwrite.
 * Keep this internal sheet API-owned (no manual cell edits).
 */
// User-provided test spreadsheet. Script Properties can override it later.
const DEFAULT_SPREADSHEET_ID = '1BP1KR6qOReb8xihExZV16k5AW-4x8JA3ARN9qG6RhFU';
function spreadsheetId_() {
  return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || DEFAULT_SPREADSHEET_ID;
}
function sheet_() {
  const sheet = SpreadsheetApp.openById(spreadsheetId_()).getSheetByName('UnionBosses');
  if (!sheet) throw new Error('setup 함수를 먼저 실행해 주세요.');
  return sheet;
}
function readStore_() {
  const row = sheet_().getRange(1, 1, 1, 2).getValues()[0];
  const store = JSON.parse(row[1]);
  store.version = row[0];
  return store;
}
function setup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const book = SpreadsheetApp.openById(spreadsheetId_());
    if (book.getSheetByName('UnionBosses')) throw new Error('기존 UnionBosses 시트를 보존합니다.');
    const rounds = JSON.parse(HtmlService.createHtmlOutputFromFile('Defaults').getContent());
    const revisions = {};
    Object.keys(rounds).forEach(round => revisions[round] = rounds[round].map(() => 0));
    book.insertSheet('UnionBosses').getRange(1, 1, 1, 2).setValues([[0, JSON.stringify({rounds, revisions})]]);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}
// Run from the editor after setup; reads only and does not change shared data.
function checkConnection() {
  const store = readStore_();
  if (!Number.isSafeInteger(store.version) || store.version < 0) throw new Error('version 형식 오류');
  for (const round of [1,2,3,4]) {
    const count = round === 4 ? 1 : 5;
    if (!Array.isArray(store.rounds[round]) || store.rounds[round].length !== count ||
        !Array.isArray(store.revisions[round]) || store.revisions[round].length !== count) throw new Error('저장 구조 오류');
  }
  const result = {ok:true, version:store.version, bosses:16};
  console.log(JSON.stringify(result));
  return result;
}
function mergeBossChanges_(store, changes) {
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
function bossApi(request) {
  try {
    if (request.action === 'version') return {version:sheet_().getRange(1,1).getValue()};
    if (request.action === 'load') return readStore_();
    if (request.action !== 'save') throw new Error('지원하지 않는 요청');
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) throw new Error('다른 저장을 처리 중입니다. 잠시 후 다시 저장해 주세요.');
    try {
      const store = readStore_();
      const next = mergeBossChanges_(store, request.changes);
      if (next.version !== store.version) {
        const {version, ...data} = next;
        sheet_().getRange(1,1,1,2).setValues([[version, JSON.stringify(data)]]);
        SpreadsheetApp.flush();
      }
      return next;
    } finally { lock.releaseLock(); }
  } catch (error) { return {error:error.message}; }
}
function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function doGet(e) {
  if (e && e.parameter.action) return json_(bossApi({action:e.parameter.action}));
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('UNION · 유니온 레이드').addMetaTag('viewport','width=device-width, initial-scale=1');
}
function doPost(e) {
  try {
    if (!e.postData || e.postData.contents.length > 16000) throw new Error('요청 크기 오류');
    return json_(bossApi(JSON.parse(e.postData.contents)));
  } catch (error) { return json_({error:error.message}); }
}
