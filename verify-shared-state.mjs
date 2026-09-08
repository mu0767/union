import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const bundle = await build({entryPoints:['worker/index.js'],bundle:true,format:'esm',platform:'browser',write:false});
const {default:worker} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const schema = await readFile('worker/schema.sql','utf8');
function database() {
  const db = new DatabaseSync(':memory:'); db.exec(schema);
  return {prepare(sql) {
    const stmt = db.prepare(sql); let values=[];
    const query = {bind(...args){values=args;return query;},async first(){return stmt.get(...values);},
      async run(){return {meta:{changes:stmt.run(...values).changes}};}};
    return query;
  }};
}
function client(DB) {
  return async (body, path='/api/shared-state') => {
    const response = await worker.fetch(new Request(`https://union.test${path}`,body ? {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
    } : {}),{DB});
    return {status:response.status, data:await response.json()};
  };
}
function seed(store) {
  const elements=['철갑','수냉','작열','전격','풍압'];
  return {settings:{},users:['a','b'].map(id=>({id,name:id,active:true,attacksLeft:3,availability:[],
    parties:elements.map((element,i)=>({id:id+i,name:`${element} 덱 1`,element,normalDamage:100,baseDamage:100,finalDamage:null,nikkes:[1,2,3,4,5].map(n=>id+i+n)}))})),
    bosses:Object.entries(store.rounds).flatMap(([round,bosses])=>bosses.map((b,i)=>({...b,id:`shared-r${round}-${i}`,round:Number(round)}))),results:[],locks:[],plan:null};
}
const mutation=(store,key,value,id=crypto.randomUUID())=>({version:store.version,key,value,mutationId:id});
function complete(p,userId='a') {
  const next=structuredClone(p),u=next.users.find(u=>u.id===userId),party=u.parties[0],b=next.bosses[0];
  u.attacksLeft--;next.results.push({id:crypto.randomUUID(),userId,partyId:party.id,bossId:b.id,element:b.element,nikkes:party.nikkes,damage:100});next.plan=null;
  return next;
}
test('two clients cannot overwrite completed attacks; retry is idempotent', async()=>{
  const call=client(database());let store=(await call()).data;
  store=(await call(mutation(store,'planner',seed(store)))).data;
  const first=mutation(store,'planner',complete(store.planner));
  const second=mutation(store,'planner',complete(store.planner,'b'));
  const replies=await Promise.all([call(first),call(second)]);
  assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
  const winner=replies[0].status===200?first:second;
  assert.equal((await call(winner)).status,200);
  store=(await call()).data;
  assert.equal(store.planner.results.length,1);
  assert.equal(store.planner.users.reduce((n,u)=>n+u.attacksLeft,0),5);
  const other=store.planner.results[0].userId==='a'?'b':'a';
  const saved=await call(mutation(store,'planner',complete(store.planner,other)));
  assert.equal(saved.status,200);assert.equal(saved.data.planner.results.length,2);
});
test('reject duplicate Nikkes, attack overflow, and attacks in unopened rounds',async()=>{
  const call=client(database());let store=(await call()).data;
  store=(await call(mutation(store,'planner',seed(store)))).data;
  const p=complete(complete(store.planner));
  assert.equal((await call(mutation(store,'planner',p))).status,400);
  const future=complete(store.planner);future.results[0].bossId=future.bosses[5].id;
  assert.equal((await call(mutation(store,'planner',future))).status,400);
  const overflow=complete(store.planner);overflow.users[0].attacksLeft=3;
  assert.equal((await call(mutation(store,'planner',overflow))).status,400);
  assert.equal((await call()).data.version,store.version);
});
test('multipliers and imported records update planner inputs and invalidate old plans',async()=>{
  const call=client(database());let store=(await call()).data;
  const p=seed(store);p.plan={attacks:[]};store=(await call(mutation(store,'planner',p))).data;
  store=(await call(mutation(store,'multipliers',[2,1,1,1,1]))).data;
  assert.equal(store.planner.users[0].parties[0].normalDamage,200);assert.equal(store.planner.plan,null);
  const party=store.planner.users[0].parties[0];
  const text=`name,level,boss,element,deck,n1,n2,n3,n4,n5,damage,note\na,700,철갑,철갑,1,${party.nikkes.join(',')},150,`;
  const saved=await call(mutation(store,'raidText',text));assert.equal(saved.status,200);
  assert.equal(saved.data.planner.users[0].parties[0].id,party.id);
  assert.equal(saved.data.planner.users[0].parties[0].normalDamage,300);
});
test('boss edits and planner settings use the same shared version',async()=>{
  const call=client(database());let store=(await call()).data;
  store=(await call(mutation(store,'planner',seed(store)))).data;
  const old=store.rounds[1][0].hp;
  const saved=await call({action:'save',changes:[{round:1,index:0,field:'hp',before:old,value:old+100}]},'/api/shared-bosses');
  assert.equal(saved.status,200);assert.equal(saved.data.planner.bosses[0].hp,old+100);
  assert.equal((await call(mutation(store,'planner',store.planner))).status,409);
  const planner=structuredClone(saved.data.planner);planner.bosses[0].hp+=200;
  const latest=await call(mutation(saved.data,'planner',planner));
  assert.equal(latest.status,200);assert.equal(latest.data.rounds[1][0].hp,old+300);
});
test('bad imports are rejected before the first planner is initialized',async()=>{
  const call=client(database()),store=(await call()).data;
  const invalid='name,level,boss,element,deck,n1,n2,n3,n4,n5,damage,note\na,700,철갑,철갑,1,x,x,x,x,x,150,';
  assert.equal((await call(mutation(store,'raidText',invalid))).status,400);
  assert.equal((await call()).data.raidText,null);
});
