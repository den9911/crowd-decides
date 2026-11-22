import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';

async function fixture(t){
  const dataDir=await mkdtemp(join(tmpdir(),'poll-visibility-'));
  let app,base,now=1_900_000_000_000;
  async function stop(){if(app){await new Promise(r=>app.server.close(r));app=null;}}
  t.after(async()=>{await stop();await rm(dataDir,{recursive:true,force:true});});
  return {
    get db(){return app.db;},get now(){return now;},set now(value){now=value;},
    async start(){
      await stop();app=await createApp({dataDir,disableRateLimit:true,pollNow:()=>now});
      await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;
    },
    async request(path,input,cookie){
      const response=await fetch(base+path,{method:input?'POST':'GET',headers:{...(input?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(input?{body:JSON.stringify(input)}:{})});
      return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],cache:response.headers.get('cache-control')};
    }
  };
}
const draft={title:'Where?',options:['A','B']};
function expectHidden(reply,choice){
  assert.equal(reply.status,200);assert.equal(reply.body.closed,false);
  assert.equal(reply.body.resultsVisible,false);assert.equal(reply.body.counts,null);
  assert.equal(reply.body.choice,choice);assert.equal(reply.cache,'no-store');
  assert.deepEqual(Object.keys(reply.body).sort(),['choice','closed','counts','expiresAt','id','isOwner','options','resultsVisible','serverNow','title']);
}
test('no aggregates in open hidden poll GET/vote, for owner, voter or stranger; owner Close reveals the stored counts',async t=>{
  const h=await fixture(t);await h.start();
  const owner=await h.request('/api/polls',{...draft,hideResultsUntilClose:true});
  assert.equal(owner.status,201);
  const id=owner.body.id,path='/api/poll?id='+id;
  // Assert absence of an aggregate read, not just omission from the JSON.
  const original=h.db.prepare.bind(h.db);
  let aggregates=0;
  h.db.prepare=sql=>{if(/COUNT\(\*\).*GROUP BY choice/.test(sql))aggregates++;return original(sql);};
  const guest=await h.request('/api/poll/vote',{id,choice:1});
  expectHidden(guest,'1');expectHidden(await h.request(path,null,owner.cookie),null);
  expectHidden(await h.request(path,null,guest.cookie),'1');expectHidden(await h.request(path),null);
  const refused=await h.request('/api/poll/close',{id},guest.cookie);
  assert.equal(refused.status,403);assert.deepEqual(Object.keys(refused.body).sort(),['code','error']);
  assert.deepEqual((await h.request('/api/poll/template?id='+id,null,owner.cookie)).body,draft);
  assert.equal(aggregates,0);
  const closed=await h.request('/api/poll/close',{id},owner.cookie);
  assert.equal(closed.body.closed,true);assert.equal(closed.body.resultsVisible,true);
  assert.deepEqual(closed.body.counts,[{choice:'1',count:1}]);
  assert.deepEqual((await h.request(path)).body.counts,closed.body.counts);
  assert(aggregates>0);
});
test('hidden timed poll reveals only the valid earlier vote at the deadline, including after restart',async t=>{
  const h=await fixture(t);await h.start();
  const expiresAt=h.now+60000,input={...draft,expiresAt,hideResultsUntilClose:true,requestId:randomUUID()};
  const owner=await h.request('/api/polls',input),id=owner.body.id,path='/api/poll?id='+id;
  h.now=expiresAt-1;
  expectHidden(await h.request('/api/poll/vote',{id,choice:0}),'0');
  await h.start();expectHidden(await h.request(path),null);
  h.now=expiresAt;
  const rejected=await h.request('/api/poll/vote',{id,choice:1});
  assert.equal(rejected.status,409);assert.equal(rejected.body.code,'POLL_CLOSED');
  assert.equal((await h.request(path)).body.resultsVisible,true);
  assert.deepEqual((await h.request(path)).body.counts,[{choice:'0',count:1}]);
  assert.equal((await h.request('/api/polls',input,owner.cookie)).status,200);
  const changed=await h.request('/api/polls',{...input,hideResultsUntilClose:false},owner.cookie);
  assert.equal(changed.status,409);assert.equal(changed.body.code,'POLL_REQUEST_CONFLICT');
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM polls').get().n,1);
});
test('visibility defaults to legacy behavior and preserves timed and untimed receipt hashes',async t=>{
  const h=await fixture(t);await h.start();
  for(const value of [0,1,null,'false',[],{}]){
    assert.equal((await h.request('/api/polls',{...draft,hideResultsUntilClose:value})).status,400);
  }
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM polls').get().n,0);
  for(const expiresAt of [undefined,h.now+60000]){
    const input={...draft,expiresAt,requestId:randomUUID()},made=await h.request('/api/polls',input);
    const fields=expiresAt===undefined?[draft.title,draft.options]:[draft.title,draft.options,expiresAt];
    assert.equal(h.db.prepare('SELECT request_hash FROM polls WHERE id=?').get(made.body.id).request_hash,
      createHash('sha256').update(JSON.stringify(fields)).digest('hex'));
    assert.equal((await h.request('/api/polls',{...input,hideResultsUntilClose:false},made.cookie)).status,200);
    const vote=await h.request('/api/poll/vote',{id:made.body.id,choice:1});
    assert.equal(vote.body.resultsVisible,true);assert.deepEqual(vote.body.counts,[{choice:'1',count:1}]);
  }
  assert.throws(()=>h.db.exec('UPDATE polls SET hide_results_until_close=2'),/CHECK constraint/);
});
