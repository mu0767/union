import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import worker from './dist/server/index.js';

const sqlite = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql'))) sqlite.exec(readFileSync(`drizzle/${file}`,'utf8'));
const db = {prepare(sql) {
  const query = sqlite.prepare(sql);
  return {args:[],bind(...args){this.args=args;return this;},async first(){return query.get(...this.args);},async run(){const r=query.run(...this.args);return {meta:{changes:Number(r.changes)}};}};
}};
async function request(action, changes) {
  return worker.fetch(new Request(`https://union.test/api/shared-bosses?action=${action}`, changes ? {
    method:'POST',headers:{Origin:'https://union.test'},body:JSON.stringify({action,changes})
  } : {}), {DB:db});
}
const initial = await (await request('load')).json();
assert.equal(initial.version,0);
const changes=[];
for (const round of [1,2,3,4]) for (let index=0;index<initial.rounds[round].length;index++) {
  changes.push({round,index,field:'name',before:initial.rounds[round][index].name,value:`Client ${round}-${index}`});
  changes.push({round,index,field:'element',before:initial.rounds[round][index].element,value:initial.rounds[round][index].element==='철갑'?'수냉':'철갑'});
}
const responses = await Promise.all(changes.map(c=>request('save',[c])));
assert(responses.every(r=>r.status===200),'32 simultaneous independent changes must succeed');
const shared=await (await request('load')).json();
assert.equal(shared.version,32);
for(const c of changes) assert.equal(shared.rounds[c.round][c.index][c.field],c.value);
assert.equal((await (await request('save',[changes[0]])).json()).version,32);
assert.equal((await request('save',[{...changes[0],value:'stale overwrite'}])).status,409);
const batch=[{round:2,index:0,field:'hp',before:shared.rounds[2][0].hp,value:100},{...changes[0],value:'stale overwrite'}];
assert.equal((await request('save',batch)).status,409);
assert.equal((await (await request('load')).json()).rounds[2][0].hp,shared.rounds[2][0].hp);
const crossOrigin = await worker.fetch(new Request('https://union.test/api/shared-bosses',{method:'POST',headers:{Origin:'https://other.test'},body:'{}'}),{DB:db});
assert.equal(crossOrigin.status,403);
assert.equal((await (await request('version')).json()).version,32);
assert.equal((await worker.fetch(new Request('https://union.test/'),{DB:db})).status,200);
sqlite.close();
console.log('PASS: 32 concurrent writes, durable SQL state, field conflict, atomic batch, retry, origin check, version and page delivery');
