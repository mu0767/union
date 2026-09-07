import { chromium } from './.sites-tools/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const server = createServer((req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://local').pathname);
  if (!path.startsWith(root + '/') && !path.startsWith(root + '\\')) return res.writeHead(403).end();
  try {
    const body = readFileSync(path);
    res.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm', '.css': 'text/css' }[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  const base = process.argv.includes('--live')
    ? 'https://mu0767.github.io/union'
    : `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${base}/planner.html`);
  await page.locator('#calculate').click();
  await page.waitForFunction(() => !document.querySelector('#calculate').disabled, {}, { timeout: 90000 });
  const status = await page.locator('#planner-status').innerText();
  assert(!status.includes('실패'), status);
  const plan = await page.evaluate(() => state.plan);
  assert(plan?.attacks.length > 0, status);
  assert(await page.locator('#plan-list [data-plan-index]').count() > 0);
  assert(await page.locator('#plan-list .damage-efficiency').count() > 0);
  await page.locator('#plan-list [data-plan-index]').first().click();
  assert(await page.locator('#attack-detail-body .damage-efficiency').count()>0);
  await page.locator('#attack-detail-close').click();
  const percentage=await page.evaluate(()=>{
    const previous=state;
    try{
      state={users:[{id:'a',level:301,parties:[{element:'전격',normalDamage:54135*98}]},{id:'b',level:321,parties:[{element:'전격',normalDamage:61453*102}]}]};
      return formatPlannerDamage('a','전격',54135*98);
    }finally{state=previous;}
  });
  assert(percentage.includes('(98%)'),'attack-power-normalized percentage');
  console.log('R2 electric:',plan.attacks.filter(a=>a.round===2&&a.element==='전격').map(a=>({user:a.userName,damage:a.damage,overkill:a.overkill})));
  console.log('PASS: calculate button and rendered attacks', plan.summary);
  const result = await page.evaluate(async () => {
    const { solveRaidCpSat } = await import('./planner-cpsat-engine.js');
    const elements = ['철갑', '수냉', '작열', '풍압', '전격'];
    const bosses = [1, 2, 3].flatMap(round => elements.map(element => ({ id: `${round}-${element}`, name: element, round, element, hp: 100 })));
    bosses.push({ id: 'final', name: 'Final', round: 4, element: '풍압', hp: 'infinite' });
    const users = elements.map(element => ({ id: element, name: element, active: true, attacksLeft: 3, parties: [0, 1, 2].map(i => ({ id: `${element}-${i}`, name: String(i), element, normalDamage: 100, nikkes: [0, 1, 2, 3, 4].map(n => `${element}-${i}-${n}`) })) }));
    users.push({ id: 'extra', name: 'Extra', active: true, attacksLeft: 1, parties: [{ id: 'f', name: 'F', element: '풍압', normalDamage: 100, finalDamage: 500, nikkes: ['a', 'b', 'c', 'd', 'e'] }] });
    return solveRaidCpSat({ users, bosses, results: [], locks: [], settings: { startAt: '2026-09-07T05:00', damageTolerance: 0 } });
  });
  assert.equal(result.summary.reachedFinal, true);
  assert.equal(result.summary.attackCount, 16);
  assert.equal(result.summary.totalOverkill, 0);
  assert.equal(result.summary.finalDamage, 500);
  console.log('PASS: all four optimization phases, known optimum', result.summary);
  const tolerancePlans=await page.evaluate(async()=>{
    const {solveRaidCpSat}=await import('./planner-cpsat-engine.js');
    const elements=['철갑','수냉','작열','풍압','전격'];
    const bosses=[1,2,3].flatMap(round=>elements.map(element=>({id:`${round}-${element}`,name:element,round,element,hp:100_000_000_000})));
    bosses.push({id:'final',name:'Final',round:4,element:'풍압',hp:'infinite'});
    const results=bosses.filter(b=>b.round!==4&&b.id!=='2-전격').map(b=>({userId:'done',bossId:b.id,damage:b.hp,nikkes:[]}));
    const user=(id,damage)=>({id,name:id,active:true,attacksLeft:1,parties:[{id,name:id,element:'전격',normalDamage:damage,nikkes:[0,1,2,3,4].map(n=>id+n)}]});
    const run=users=>solveRaidCpSat({users,bosses,results,locks:[],settings:{startAt:'2026-09-07T05:00'}});
    return [await run([user('excess',129_248_498_112),user('fit',99_000_000_000)]),await run([user('too-low',98_999_999_999)]),await run([user('within-upper',101_000_000_000),user('excess',129_248_498_112)])];
  });
  assert.equal(tolerancePlans[0].summary.reachedFinal,true);
  assert.deepEqual(tolerancePlans[0].attacks.map(a=>a.userId),['fit']);
  assert.equal(tolerancePlans[0].attacks[0].afterHp,1_000_000_000);
  assert.equal(tolerancePlans[1].summary.reachedFinal,false);
  assert.deepEqual(tolerancePlans[2].attacks.map(a=>a.userId),['within-upper']);
  assert.equal(tolerancePlans[2].summary.totalOverkill,1_000_000_000);
  console.log('PASS: replace 29.2B overkill, tolerate +/-1B, reject shortage beyond tolerance');
} finally {
  await browser?.close();
  await new Promise(r => server.close(r));
}
