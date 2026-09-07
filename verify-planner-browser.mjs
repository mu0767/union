import {chromium} from './.sites-tools/node_modules/playwright-core/index.mjs';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd();
const live=process.argv.includes('--live');
const server=live?null:createServer((req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);
  if(!path.startsWith(root+'\\')&&!path.startsWith(root+'/')){res.writeHead(403).end();return;}
  if(!existsSync(path)){res.writeHead(404).end();return;}
  const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm','.webp':'image/webp'}[extname(path)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime,'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});res.end(readFileSync(path));
});
if(server)await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=live?'https://union-raid-records.mu0767.chatgpt.site':`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox','--disable-gpu']});
function validate(plan,state) {
  assert(plan?.attacks.length>0,'calculation must produce attacks');
  const used=new Map(),counts=new Map(),remaining=new Map(state.bosses.map(b=>[b.id,b.hp]));
  const endByRound=new Map();let globalEnd=0;const userEnd=new Map();
  for(const r of state.results){if(remaining.get(r.bossId)!=='infinite')remaining.set(r.bossId,Math.max(0,remaining.get(r.bossId)-r.damage));if(!used.has(r.userId))used.set(r.userId,new Set());r.nikkes.forEach(n=>used.get(r.userId).add(n));}
  for(const attack of plan.attacks) {
    const user=state.users.find(u=>u.id===attack.userId),party=user.parties.find(p=>p.id===attack.partyId),boss=state.bosses.find(b=>b.id===attack.bossId);
    assert.equal(party.element,boss.element);assert.equal(attack.damage,boss.round===4?(party.finalDamage??party.normalDamage):party.normalDamage);
    counts.set(user.id,(counts.get(user.id)||0)+1);assert(counts.get(user.id)<=user.attacksLeft);
    if(!used.has(user.id))used.set(user.id,new Set());
    for(const n of party.nikkes){assert(!used.get(user.id).has(n),'no repeated character');used.get(user.id).add(n);}
    const start=+new Date(attack.start),finish=start+state.settings.attackMinutes*60000;
    assert(start>=+new Date(state.settings.now)&&finish<=+new Date(state.settings.endAt));
    assert(start>=(userEnd.get(user.id)||0));userEnd.set(user.id,finish);
    if(!state.settings.simultaneous){assert(start>=globalEnd);globalEnd=finish;}
    if(boss.round>1){for(const b of state.bosses.filter(b=>b.round===boss.round-1))assert.equal(remaining.get(b.id),0,'previous round cleared');assert(start>=(endByRound.get(boss.round-1)||0));}
    endByRound.set(boss.round,Math.max(endByRound.get(boss.round)||0,finish));
    if(boss.hp!=='infinite')remaining.set(boss.id,Math.max(0,remaining.get(boss.id)-attack.damage));
  }
}
try {
  const page=await browser.newPage();
  page.on('pageerror',e=>console.log('PAGE ERROR:',e.message));
  page.on('console',msg=>{if(msg.type()==='error'||msg.text().startsWith('CP-SAT'))console.log('CONSOLE:',msg.text().slice(0,400));});
  await page.goto(base+'/planner.html',{waitUntil:'domcontentloaded'});
  console.log('Page loaded. Isolated:',await page.evaluate(()=>crossOriginIsolated));
  const seed=await page.evaluate(()=>JSON.parse(JSON.stringify(state)));
  await page.evaluate(()=>{window.beats=0;window.beatTimer=setInterval(()=>window.beats++,50);});
  await page.locator('[data-view="theory"]').click();
  await page.locator('#calculate').click();
  await page.waitForFunction(()=>!document.querySelector('#calculate').disabled,{},{timeout:90000});
  const status=await page.locator('#planner-status').innerText();console.log('Calculation:',status);
  const plan=await page.evaluate(()=>state.plan);validate(plan,seed);
  assert(await page.locator('#plan-list .plan-card').count()>0);
  assert(await page.evaluate(()=>window.beats)>10,'UI should remain responsive');
  console.log('PASS: actual calculate button, rendered plan, UI responsiveness, character/attack/time/round constraints',plan.summary);
  await page.locator('[data-view="live"]').click();
  await page.locator('#recalculate').click();
  await page.waitForFunction(()=>!document.querySelector('#recalculate').disabled,{},{timeout:90000});
  assert(!(await page.locator('#planner-status').innerText()).includes('실패'));
  validate(await page.evaluate(()=>state.plan),seed);
  console.log('PASS: actual remaining-plan recalculation button');
  const fixture=await page.evaluate(()=>{
    const elements=['철갑','수냉','작열','풍압','전격'],bosses=[];
    for(const round of [1,2,3])for(const element of elements)bosses.push({id:`r${round}-${element}`,round,name:element,element,hp:100});
    bosses.push({id:'final',round:4,name:'Final',element:'풍압',hp:'infinite'});
    const users=elements.map(element=>({id:element,name:element,active:true,attacksLeft:3,availability:[{start:'05:00',end:'05:00'}],parties:[0,1,2].map(i=>({id:`${element}-${i}`,name:`party ${i}`,element,nikkes:[0,1,2,3,4].map(n=>`${element}-${i}-${n}`),normalDamage:100,finalDamage:120}))}));
    users.push({id:'finisher',name:'Finisher',active:true,attacksLeft:1,availability:[{start:'05:00',end:'05:00'}],parties:[{id:'fin',name:'Final party',element:'풍압',nikkes:['f0','f1','f2','f3','f4'],normalDamage:200,finalDamage:500}]});
    return {settings:{startAt:'2026-09-07T05:00',endAt:'2026-09-08T05:00',now:'2026-09-07T05:00',attackMinutes:10,simultaneous:false,finalElement:'풍압'},users,bosses,results:[],locks:[],plan:null};
  });
  async function calculateFixture(input) {
    await page.evaluate(input=>{state=input;selectedUser=state.users[0]?.id;renderAll();},input);
    await page.locator('[data-view="theory"]').click();await page.locator('#calculate').click();
    await page.waitForFunction(()=>!document.querySelector('#calculate').disabled,{},{timeout:90000});
    return page.evaluate(()=>({plan:state.plan,status:document.querySelector('#planner-status').textContent}));
  }
  let result=await calculateFixture(fixture);validate(result.plan,fixture);
  assert.equal(result.plan.summary.finalDamage,500);assert.equal(result.plan.summary.attackCount,16);assert(['OPTIMAL','FEASIBLE'].includes(result.plan.status));
  console.log('PASS: known optimum, 3 disjoint parties retained, final damage 500');
  const locked=structuredClone(fixture);locked.locks=[{id:'l',userId:'철갑',partyId:'철갑-0',bossId:'r1-철갑'}];
  result=await calculateFixture(locked);validate(result.plan,locked);assert(result.plan.attacks.some(a=>a.userId==='철갑'&&a.partyId==='철갑-0'&&a.bossId==='r1-철갑'));
  console.log('PASS: required locked attack');
  const completed=structuredClone(fixture),first=result.plan.attacks[0];completed.results=[{...first,at:first.start}];completed.users.find(u=>u.id===first.userId).attacksLeft--;
  result=await calculateFixture(completed);validate(result.plan,completed);assert.equal(result.plan.attacks.length,15);
  console.log('PASS: completed attack, used characters and remaining HP');
  const windows=structuredClone(fixture);windows.settings.simultaneous=true;windows.users.forEach(u=>u.availability=[{start:'20:00',end:'21:00'}]);
  result=await calculateFixture(windows);validate(result.plan,windows);assert(result.plan.attacks.every(a=>a.start>='2026-09-07T20:00'&&a.start<='2026-09-07T20:50'));
  console.log('PASS: availability windows and simultaneous attacks');
  const impossible=structuredClone(locked);impossible.users[0].attacksLeft=0;
  result=await calculateFixture(impossible);assert.equal(result.plan,null);assert(result.status.includes('잠긴 공격이 불가능'));
  console.log('PASS: impossible lock shows error and restores buttons');
  assert.deepEqual(await page.evaluate(()=>parseAvailability('05:15-08:30, 20:10-23:50')),[{start:'05:15',end:'08:30'},{start:'20:10',end:'23:50'}]);
  console.log('PASS: availability form preserves hours and minutes');
} finally {await browser.close();if(server)await new Promise(r=>server.close(r));}
