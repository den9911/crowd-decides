import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createApp} from '../server/index.mjs';
async function fixture(t){const dataDir=await mkdtemp(join(tmpdir(),'poll-order-')),app=await createApp({dataDir,disableRateLimit:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));await rm(dataDir,{recursive:true,force:true});});return {db:app.db,async req(path,input,cookie){const r=await fetch(`http://127.0.0.1:${app.server.address().port}${path}`,{method:input?'POST':'GET',headers:{...(input?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(input?{body:JSON.stringify(input)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}};}
test('votes before close persist, votes after close are refused, and repeated Close does not rewrite',async t=>{
 const h=await fixture(t),made=await h.req('/api/polls',{title:'Last vote',options:['A','B']}),id=made.body.id,guest=await h.req('/api/config');assert.equal((await h.req('/api/poll/vote',{id,choice:1},guest.cookie)).status,200);assert.equal((await h.req('/api/poll/close',{id},made.cookie)).body.closed,true);
 h.db.exec("CREATE TRIGGER no_second_close BEFORE UPDATE OF closed ON polls BEGIN SELECT RAISE(ABORT,'unexpected duplicate write'); END");
 for(let i=0;i<4;i++)assert.equal((await h.req('/api/poll/close',{id},made.cookie)).status,200);
 const denied=await h.req('/api/poll/vote',{id,choice:0});assert.equal(denied.status,409);assert.equal(h.db.prepare("SELECT COUNT(*) n FROM votes WHERE scope='poll' AND target=?").get(id).n,1);
});
test('competing HTTP vote and Close requests follow committed order without a late accepted vote',async t=>{
 const h=await fixture(t);
 for(let i=0;i<12;i++){
  const made=await h.req('/api/polls',{title:'Race '+i,options:['A','B']}),id=made.body.id,guest=await h.req('/api/config');
  const calls=[()=>h.req('/api/poll/vote',{id,choice:0},guest.cookie),()=>h.req('/api/poll/close',{id},made.cookie)];
  const result=i%2?await Promise.all([calls[1](),calls[0]()]):await Promise.all([calls[0](),calls[1]()]);const vote=result[i%2?1:0];assert([200,409].includes(vote.status));
  const final=await h.req('/api/poll?id='+id,null,guest.cookie);assert.equal(final.body.closed,true);const n=h.db.prepare("SELECT COUNT(*) n FROM votes WHERE scope='poll' AND target=?").get(id).n;assert.equal(n,vote.status===200?1:0);
  assert.equal((await h.req('/api/poll/vote',{id,choice:1})).status,409);assert.equal(h.db.prepare("SELECT COUNT(*) n FROM votes WHERE scope='poll' AND target=?").get(id).n,n);
 }
});
test('repeated same-session votes keep the original choice and return an explicit conflict',async t=>{
 const h=await fixture(t),made=await h.req('/api/polls',{title:'Immutable choice',options:['A','B']}),id=made.body.id,guest=await h.req('/api/config');
 assert.equal((await h.req('/api/poll/vote',{id,choice:0},guest.cookie)).status,200);
 for(const choice of [0,1,0,1])assert.equal((await h.req('/api/poll/vote',{id,choice},guest.cookie)).status,409);
 const view=await h.req('/api/poll?id='+id,null,guest.cookie);assert.equal(view.body.choice,'0');assert.deepEqual(view.body.counts,[{choice:'0',count:1}]);assert.equal(h.db.prepare("SELECT COUNT(*) n FROM votes WHERE scope='poll' AND target=?").get(id).n,1);
});
