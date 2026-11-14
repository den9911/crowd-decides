import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';
test('lost, unrelated and forged sessions get a fixed explanation; retries never grant access or alter the poll',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'poll-access-')),app=await createApp({dataDir,disableRateLimit:true});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));await rm(dataDir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 async function request(path,input,cookie){const res=await fetch(base+path,{method:input?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(input?{'Content-Type':'application/json'}:{})},...(input?{body:JSON.stringify(input)}:{})});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
 const made=await request('/api/polls',{title:'Original private wording',options:['Yes','No']}),id=made.body.id,original=app.db.prepare('SELECT * FROM polls WHERE id=?').get(id);
 const lost=await request('/api/poll?id='+id);assert.equal(lost.body.isOwner,false);assert.equal(lost.body.closed,false);
 const forged=made.cookie.slice(0,made.cookie.lastIndexOf('.')+1)+'0'.repeat(64);
 for(const cookie of [undefined,lost.cookie,forged])for(let repeat=0;repeat<3;repeat++){
  const close=await request('/api/poll/close',{id,owner:original.owner,isOwner:true},cookie),copy=await request('/api/poll/template?id='+id,null,cookie);
  for(const result of [close,copy]){
   assert.equal(result.status,403);assert.equal(result.body.code,'OWNER_SESSION_REQUIRED');
   assert.deepEqual(Object.keys(result.body).sort(),['code','error']);
   assert(!JSON.stringify(result.body).includes(original.owner));assert(!JSON.stringify(result.body).includes(original.title));
  }
 }
 assert.deepEqual(app.db.prepare('SELECT * FROM polls WHERE id=?').get(id),original);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM polls').get().n,1);
 const vote=await request('/api/poll/vote',{id,choice:0},lost.cookie);assert.equal(vote.status,200);assert.equal(vote.body.choice,'0');assert.equal(vote.body.isOwner,false);
 const owner=await request('/api/poll?id='+id,null,made.cookie);assert.equal(owner.body.isOwner,true);
 assert.equal((await request('/api/poll/close',{id},made.cookie)).body.closed,true);
});
