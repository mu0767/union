// Build injects ASSETS, INITIAL_STORE and the shared mergeBossChanges_ validator.
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
async function saveChanges(db, changes) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const current = await readStore(db);
    const next = mergeBossChanges_(current, changes);
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
  if (body?.action !== 'save') return json({error:'지원하지 않는 요청'}, 400);
  try { return json(await saveChanges(env.DB, body.changes)); }
  catch (error) { return json({error:error.message}, 409); }
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/api/shared-bosses') return await handleApi(request, env);
      if (path.startsWith('/vendor/')) {
        const response=await env.ASSETS.fetch(request);
        const headers=new Headers(response.headers);
        headers.set('Cross-Origin-Resource-Policy','same-origin');
        return new Response(response.body,{status:response.status,headers});
      }
      if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405});
      const asset = ASSETS[path === '/' ? '/index.html' : path];
      if (!asset) return new Response('Not found', {status:404});
      const bytes = Uint8Array.from(atob(asset.data), c => c.charCodeAt(0));
      return new Response(request.method === 'HEAD' ? null : bytes, {headers:{
        'Content-Type':asset.type, 'Cache-Control':path.includes('/portraits/') ? 'public, max-age=86400' : 'no-cache',
        'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'same-origin',
        'Cross-Origin-Opener-Policy':'same-origin', 'Cross-Origin-Embedder-Policy':'require-corp'
      }});
    } catch (error) {
      console.error('Shared store error', error);
      return json({error:'공유 저장소에 연결하지 못했습니다. 입력을 유지하며 다시 시도해 주세요.'}, 503);
    }
  }
};
