'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = __dirname;
const elements = ['철갑', '수냉', '작열', '전격', '풍압'];
function validBoss(b) {
  return b && typeof b.name === 'string' && b.name.trim().length > 0 && b.name.length <= 80 &&
    elements.includes(b.element) && (b.hp === 'infinite' || (Number.isSafeInteger(b.hp) && b.hp > 0));
}
function createServer(options = {}) {
  const directory = options.directory || process.env.DATA_DIR || path.join(ROOT, '.server');
  fs.mkdirSync(directory, { recursive: true });
  const dataFile = path.join(directory, 'bosses.json');
  const plannerFile = path.join(directory, 'planner.json');
  let password = options.password || process.env.ADMIN_PASSWORD;
  if (!password) {
    const keyFile = path.join(directory, 'admin-key.txt');
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(24).toString('hex'), { mode: 0o600 });
    password = fs.readFileSync(keyFile, 'utf8').trim();
  }
  const digest = value => crypto.createHash('sha256').update(value).digest();
  const passwordDigest = digest(password);
  function readStore() {
    if (fs.existsSync(dataFile)) return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const rounds = JSON.parse(fs.readFileSync(path.join(ROOT, 'default-bosses.json'), 'utf8'));
    const revisions = {};
    for (const round of Object.keys(rounds)) revisions[round] = rounds[round].map(() => 0);
    return { rounds, revisions };
  }
  // Fail visibly on corrupt storage instead of silently replacing existing records.
  readStore();
  const failures = new Map();
  function authenticated(req) {
    const supplied = (req.headers.authorization || '').replace(/^Bearer /, '');
    return crypto.timingSafeEqual(digest(supplied), passwordDigest);
  }
  function writeAtomic(file, value) {
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, file);
  }
  async function readJsonBody(req, res, json, max = 5 * 1024 * 1024) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) { json(415, { error:'JSON 형식이 필요합니다.' }); return null; }
    const chunks=[]; let size=0;
    for await (const chunk of req) { size+=chunk.length; if(size>max){json(413,{error:'입력 내용이 너무 큽니다.'});return null;} chunks.push(chunk); }
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{json(400,{error:'입력 형식을 확인해 주세요.'});return null;}
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    const pathname = new URL(req.url, 'http://localhost').pathname;
    try {
      if (pathname === '/api/bosses' && req.method === 'GET') return json(200, readStore());
      if (pathname === '/api/planner' && req.method === 'GET') {
        return json(200, fs.existsSync(plannerFile) ? JSON.parse(fs.readFileSync(plannerFile,'utf8')) : {state:null,revision:0});
      }
      if (pathname === '/api/planner' && req.method === 'PUT') {
        if (!authenticated(req)) return json(401,{error:'관리자 비밀번호를 확인해 주세요.'});
        const body=await readJsonBody(req,res,json); if(!body)return;
        const current=fs.existsSync(plannerFile)?JSON.parse(fs.readFileSync(plannerFile,'utf8')):{state:null,revision:0};
        if(!body.state || !Array.isArray(body.state.users) || body.state.users.length>32 || !Array.isArray(body.state.results) || !Array.isArray(body.state.locks))return json(400,{error:'운영 데이터 형식이 올바르지 않습니다.'});
        if(body.revision!==current.revision)return json(409,{error:'다른 관리자가 먼저 저장했습니다. 최신 데이터를 불러오세요.'});
        const next={state:body.state,revision:current.revision+1};writeAtomic(plannerFile,next);return json(200,next);
      }
      if (pathname === '/api/solve' && req.method === 'POST') return json(501,{error:'OR-Tools 최적화 서버로 실행해야 합니다.'});
      const match = /^\/api\/bosses\/([1-4])\/([0-4])$/.exec(pathname);
      if (match && req.method === 'PUT') {
        const ip = req.socket.remoteAddress;
        const now = Date.now();
        for (const [key, entry] of failures) if (entry.until < now) failures.delete(key);
        const failure = failures.get(ip);
        if (failure && failure.count >= 10) return json(429, { error: '인증 시도가 많습니다. 1분 후 다시 시도해 주세요.' });
        if (!authenticated(req)) {
          failures.set(ip, { count: (failure ? failure.count : 0) + 1, until: failure ? failure.until : now + 60000 });
          return json(401, { error: '관리자 비밀번호를 확인해 주세요.' });
        }
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(415, { error: 'JSON 형식이 필요합니다.' });
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 4096) { json(413, { error: '입력 내용이 너무 큽니다.' }); return; } chunks.push(chunk); }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(400, { error: '입력 형식을 확인해 주세요.' }); }
        if (!validBoss(body.boss) || !Number.isSafeInteger(body.revision) || body.revision < 0) return json(400, { error: '이름·속성·체력 형식을 확인해 주세요.' });
        const store = readStore(); const round = match[1]; const index = Number(match[2]);
        if (!store.rounds[round][index]) return json(404, { error: '보스가 없습니다.' });
        if (store.revisions[round][index] !== body.revision) return json(409, { error: '다른 관리자가 먼저 수정했습니다. 최신 정보 불러오기 후 다시 수정해 주세요.' });
        store.rounds[round][index] = { name: body.boss.name.trim(), element: body.boss.element, hp: body.boss.hp };
        store.revisions[round][index]++;
        writeAtomic(dataFile, store);
        failures.delete(ip);
        return json(200, store);
      }
      if (pathname.startsWith('/api/')) return json(404, { error: '지원하지 않는 요청입니다.' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(405, { error: '지원하지 않는 요청입니다.' });
      const files = new Set(['/index.html', '/styles.css', '/app.js', '/characters.js', '/data.js', '/planner.html', '/planner.css', '/planner.js']);
      const resource = pathname === '/' ? '/index.html' : pathname;
      if (!files.has(resource) && !/^\/assets\/portraits\/nikke-\d{2}\.webp$/.test(resource)) return json(404, { error: '파일이 없습니다.' });
      const file = path.join(ROOT, resource.slice(1));
      if (!fs.existsSync(file)) return json(404, { error: '파일이 없습니다.' });
      const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.webp':'image/webp' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    } catch (error) { console.error('Request failed:', error.message); if (!res.headersSent) json(500, { error: '서버 저장에 실패했습니다. 다시 시도해 주세요.' }); else res.end(); }
  });
  server.requestTimeout = 15000;
  return server;
}
if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '127.0.0.1';
  createServer().listen(port, host, () => {
    console.log(`Union server: http://${host}:${port}`);
    if (!process.env.ADMIN_PASSWORD) console.log('Admin password is in DATA_DIR/admin-key.txt (default: .server/admin-key.txt).');
  });
}
module.exports = { createServer };
