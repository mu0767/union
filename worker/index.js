import rounds from '../default-bosses.json';
import { mergeBossChanges_ } from './boss-merge.js';
import { updateShared, validatePlanner } from './shared-store.js';
const INITIAL_STORE = {rounds, revisions:Object.fromEntries(Object.entries(rounds).map(([r, bosses]) => [r,bosses.map(() => 0)])), raidText:null, multipliers:[1,1,1,1,1], planner:null};
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers:{'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}
});
async function readStore(db) {
  let row = await db.prepare('SELECT version, data FROM shared_bosses WHERE id = 1').first();
  if (!row) {
    await db.prepare('INSERT OR IGNORE INTO shared_bosses (id, version, data) VALUES (1, 0, ?)').bind(JSON.stringify(INITIAL_STORE)).run();
    row = await db.prepare('SELECT version, data FROM shared_bosses WHERE id = 1').first();
  }
  return {...JSON.parse(row.data), version:row.version};
}
async function saveField(db, field, value) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const current = await readStore(db);
    const next = JSON.parse(JSON.stringify(current));
    delete next.version;
    next[field] = value;
    const version = current.version + 1;
    const result = await db.prepare('UPDATE shared_bosses SET version = ?, data = ? WHERE id = 1 AND version = ?')
      .bind(version, JSON.stringify(next), current.version).run();
    if (result.meta.changes === 1) return {version, ...next};
    await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * Math.min(400, 20 * 2 ** attempt)));
  }
  throw new Error('다른 저장이 많습니다. 잠시 후 다시 저장해 주세요.');
}
async function saveChanges(db, changes) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const current = await readStore(db);
    const next = mergeBossChanges_(current, changes);
    if (next.planner && next.version !== current.version) {
      for (const change of changes) {
        const old = current.rounds[change.round][change.index];
        const b = next.planner.bosses.find(b => b.id === `shared-r${change.round}-${change.index}`) || next.planner.bosses.find(b => b.round === change.round && b.element === old.element);
        if (b) b[change.field] = change.value;
      }
      next.planner.plan = null;
      next.planner.settings.finalElement = next.planner.bosses.find(b => b.round === 4).element;
      validatePlanner(next.planner);
    }
    if (next.version === current.version) return next;
    const {version, ...data} = next;
    const result = await db.prepare('UPDATE shared_bosses SET version = ?, data = ? WHERE id = 1 AND version = ?')
      .bind(version, JSON.stringify(data), current.version).run();
    if (result.meta.changes === 1) return next;
    // A competing write won: reread and merge only the submitted fields.
    await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * Math.min(400, 20 * 2 ** attempt)));
  }
  throw new Error('다른 저장이 많습니다. 입력은 유지됩니다. 잠시 후 다시 저장해 주세요.');
}
async function handleApi(request, env) {
  if (!env.DB) return json({error:'공유 저장소 연결을 복구 중입니다.'}, 503);
  const url = new URL(request.url);
  if (request.method === 'GET') {
    if (url.searchParams.get('action') === 'version') {
      const row = await env.DB.prepare('SELECT version FROM shared_bosses WHERE id = 1').first();
      return json({version:row?.version ?? 0});
    }
    if (url.searchParams.get('action') === 'load') return json(await readStore(env.DB));
    if (url.searchParams.get('action') === 'planner') { const s=await readStore(env.DB); return json({version:s.version, plannerState:s.plannerState ?? s.planner ?? null}); }
    if (url.searchParams.get('action') === 'multipliers') { const s=await readStore(env.DB); return json({version:s.version, damageMultipliers:s.damageMultipliers ?? s.multipliers ?? [1,1,1,1,1]}); }
    return json({error:'지원하지 않는 요청'}, 400);
  }
  if (request.method !== 'POST') return json({error:'지원하지 않는 요청'}, 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({error:'다른 사이트에서 보낸 저장 요청입니다.'}, 403);
  const reader = request.body?.getReader();
  if (!reader) return json({error:'변경 내용이 없습니다.'}, 400);
  let length = 0, chunks = [];
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 16000) { await reader.cancel(); return json({error:'요청 크기 초과'}, 413); }
    chunks.push(value);
  }
  let body;
  try { body = JSON.parse(await new Blob(chunks).text()); }
  catch { return json({error:'요청 형식 오류'}, 400); }
  try {
    if (body?.action === 'save') return json(await saveChanges(env.DB, body.changes));
    if (body?.action === 'save-planner') {
      const s=body.plannerState;
      if(!s||s.v!==2||!Array.isArray(s.users)||s.users.length>32||!Array.isArray(s.bosses)||s.bosses.length!==16||!Array.isArray(s.results)||s.results.length>96) throw new Error('플래너 상태 형식 오류');
      if(s.plan!==null&&s.plan!==undefined&&(!Array.isArray(s.plan.attacks)||s.plan.attacks.length>96)) throw new Error('플래너 계획 형식 오류');
      return json(await saveField(env.DB,'plannerState',s));
    }
    if (body?.action === 'save-multipliers') {
      const m=body.damageMultipliers;
      if(!Array.isArray(m)||m.length!==5||!m.every(v=>Number.isFinite(v)&&v>=0&&v<=100)) throw new Error('딜량 배율 형식 오류');
      return json(await saveField(env.DB,'damageMultipliers',m));
    }
    return json({error:'지원하지 않는 요청'},400);
  } catch (error) { return json({error:error.message}, 409); }
}
async function handleState(request, env) {
  if (!env.DB) return json({error:'D1 연결이 필요합니다.'}, 503);
  if (request.method === 'GET') return json(await readStore(env.DB));
  if (request.method !== 'POST') return json({error:'지원하지 않는 요청'},405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({error:'다른 사이트의 요청입니다.'},403);
  const reader = request.body?.getReader();
  if (!reader) return json({error:'변경 내용이 없습니다.'},400);
  let length=0; const chunks=[];
  while (true) {
    const {value,done}=await reader.read(); if(done)break;
    length+=value.length;
    if(length>1500000){await reader.cancel();return json({error:'요청 크기 초과'},413);}
    chunks.push(value);
  }
  let body;
  try { body=JSON.parse(await new Blob(chunks).text()); }
  catch { return json({error:'JSON 형식 오류'},400); }
  if (!body || !Number.isSafeInteger(body.version) || typeof body.mutationId !== 'string' || !body.mutationId || body.mutationId.length > 100) return json({error:'저장 요청 형식 오류'},400);
  const current=await readStore(env.DB);
  if ((current.mutations || []).includes(body.mutationId)) return json(current);
  if (body.version !== current.version) return json({error:'다른 사용자가 먼저 저장했습니다. 최신 화면에서 다시 입력해 주세요.'},409);
  let next;
  try { next=updateShared(current,body.key,body.value); }
  catch(error){return json({error:error.message},400);}
  next.mutations=[...(current.mutations||[]).slice(-49),body.mutationId];
  const {version,...data}=next;
  const result=await env.DB.prepare('UPDATE shared_bosses SET version = ?, data = ? WHERE id = 1 AND version = ?')
    .bind(version,JSON.stringify(data),current.version).run();
  if(result.meta.changes!==1)return json({error:'다른 사용자가 먼저 저장했습니다. 최신 화면에서 다시 입력해 주세요.'},409);
  return json(next);
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/api/shared-bosses') return await handleApi(request, env);
      if (path === '/api/shared-state') return await handleState(request, env);
      if (path.startsWith('/api/')) return json({error:'없는 API입니다.'},404);
      return await env.ASSETS.fetch(request);
    } catch (error) {
      console.error('Shared store error', error);
      return json({error:'공유 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'},503);
    }
  }
};
