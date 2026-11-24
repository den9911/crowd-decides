import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,copyFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';
const BASE=Date.UTC(2026,10,24,12,0),DAY=86400000;
const slots=[BASE+3*DAY,BASE+5*DAY,BASE+7*DAY],expiresAt=BASE+DAY;
const draft={title:'Choose a date',mode:'meeting',slots,expiresAt};

async function fixture(t){
 const dataDir=await mkdtemp(join(tmpdir(),'meeting-poll-'));let app,base,now=BASE;
 async function stop(){if(app){await new Promise(resolve=>app.server.close(resolve));app=null;}}
 t.after(async()=>{await stop();await rm(dataDir,{recursive:true,force:true});});
 return {dataDir,get db(){return app.db;},get now(){return now;},set now(ms){now=ms;},stop,
  async start(){await stop();app=await createApp({dataDir,disableRateLimit:true,pollNow:()=>now});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;},
  async request(path,input,cookie){
   const response=await fetch(base+path,{method:input?'POST':'GET',headers:{...(input?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(input?{body:JSON.stringify(input)}:{})});
   return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],cache:response.headers.get('cache-control')};
  }
 };
}
test('typed UTC meeting slots, one vote per session and additive isolated storage',async t=>{
 const h=await fixture(t);await h.start();const made=await h.request('/api/polls',draft);
 assert.equal(made.status,201);const id=made.body.id;
 const row={...h.db.prepare('SELECT vote_mode,poll_kind,options,expires_at FROM polls WHERE id=?').get(id)};
 assert.deepEqual(row,{vote_mode:'single',poll_kind:'meeting',options:'[]',expires_at:expiresAt});
 assert.deepEqual(h.db.prepare('SELECT starts_at FROM poll_meeting_slots WHERE poll_id=? ORDER BY position').all(id).map(x=>x.starts_at),slots);
 const view=await h.request('/api/poll?id='+id);
 assert.equal(view.body.mode,'meeting');assert.deepEqual(view.body.slots,slots);assert.deepEqual(view.body.options,[]);
 assert.equal(view.body.choice,null);assert.equal(view.body.resultsVisible,true);
 for(const input of [{choice:1},{choices:[1]},{slot:3},{slot:-1},{slot:'1'},{slot:1.5},{slot:null}]){
  assert.equal((await h.request('/api/poll/vote',{id,...input})).status,400);
 }
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM poll_meeting_votes').get().n,0);
 const first=await h.request('/api/poll/vote',{id,slot:2});
 assert.equal(first.status,200);assert.equal(first.body.choice,'2');
 assert.deepEqual(first.body.counts,[{choice:'2',count:1}]);
 assert.equal((await h.request('/api/poll/vote',{id,slot:0},first.cookie)).body.code,'POLL_ALREADY_VOTED');
 const second=await h.request('/api/poll/vote',{id,slot:0});
 assert.equal(second.status,200);
 assert.deepEqual(second.body.counts,[{choice:'0',count:1},{choice:'2',count:1}]);
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM poll_meeting_votes').get().n,2);
 assert.equal(h.db.prepare("SELECT COUNT(*) n FROM votes WHERE scope='poll'").get().n,0);
 await h.start();
 assert.deepEqual((await h.request('/api/poll?id='+id,null,first.cookie)).body.slots,slots);
 assert.equal((await h.request('/api/poll?id='+id,null,first.cookie)).body.choice,'2');
 assert.equal((await h.request('/api/poll?id='+id)).body.choice,null);
 assert.equal((await h.request('/api/poll/template?id='+id,null,made.cookie)).status,400);
 assert.equal((await h.request('/api/poll/close',{id},first.cookie)).status,403);
 const closed=await h.request('/api/poll/close',{id},made.cookie);
 assert.equal(closed.body.closed,true);
 assert.equal((await h.request('/api/poll/vote',{id,slot:1})).body.code,'POLL_CLOSED');
});
test('invalid meeting windows never publish rows; sorted slots and old fingerprints are stable',async t=>{
 const h=await fixture(t);await h.start();
 const bad=[
  {...draft,slots:[slots[0]]},{...draft,slots:[slots[0],slots[0]]},{...draft,slots:[slots[0],NaN]},
  {...draft,slots:[slots[0],1.5]},{...draft,slots:['2026-11-28T12:00Z',slots[1]]},
  {...draft,slots:[BASE-1,slots[1]]},{...draft,slots:[slots[0],BASE+366*DAY]},
  {...draft,expiresAt:null},{...draft,expiresAt:slots[0]},{...draft,expiresAt:slots[0]+1000},
  {...draft,expiresAt:BASE-1},{...draft,options:['a','b']},
  {title:'invalid',mode:'single',options:['a','b'],slots},
  {...draft,mode:'unknown'}
 ];
 for(const input of bad)assert.equal((await h.request('/api/polls',{...input,requestId:randomUUID()})).status,400);
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM polls').get().n,0);
 const input={...draft,slots:[slots[2],slots[0],slots[1]],requestId:randomUUID(),hideResultsUntilClose:true};
 const made=await h.request('/api/polls',input);assert.equal(made.status,201);
 assert.deepEqual((await h.request('/api/poll?id='+made.body.id)).body.slots,slots);
 const replay=await h.request('/api/polls',{...input,slots},made.cookie);
 assert.equal(replay.status,200);assert.equal(replay.body.id,made.body.id);
 const changed=await h.request('/api/polls',{...input,slots:[slots[0],slots[1]]},made.cookie);
 assert.equal(changed.status,409);assert.equal(changed.body.code,'POLL_REQUEST_CONFLICT');
 const single={title:'Legacy hash',options:['Yes','No'],requestId:randomUUID()};
 const classic=await h.request('/api/polls',single);
 const expected=createHash('sha256').update(JSON.stringify([single.title,single.options])).digest('hex');
 assert.equal(h.db.prepare('SELECT request_hash FROM polls WHERE id=?').get(classic.body.id).request_hash,expected);
 assert.equal((await h.request('/api/polls',single,classic.cookie)).status,200);
 assert.throws(()=>h.db.exec("UPDATE polls SET poll_kind='invalid'"),/CHECK constraint/);
});
test('hidden meeting votes have no aggregates until deadline, and replay remains stable afterward',async t=>{
 const h=await fixture(t);await h.start();
 const input={...draft,hideResultsUntilClose:true,requestId:randomUUID()};
 const made=await h.request('/api/polls',input),id=made.body.id;
 const voter=await h.request('/api/poll/vote',{id,slot:1});
 assert.equal(voter.status,200);assert.equal(voter.body.counts,null);assert.equal(voter.body.resultsVisible,false);
 for(const cookie of [made.cookie,voter.cookie,undefined]){
  const view=await h.request('/api/poll?id='+id,null,cookie);
  assert.equal(view.body.counts,null);assert.equal(view.body.cache,undefined);
  assert.equal(view.cache,'no-store');
  assert.deepEqual(view.body.slots,slots);
 }
 h.now=expiresAt;
 assert.equal((await h.request('/api/poll?id='+id)).body.closed,true);
 assert.deepEqual((await h.request('/api/poll?id='+id)).body.counts,[{choice:'1',count:1}]);
 assert.equal((await h.request('/api/poll/vote',{id,slot:0})).body.code,'POLL_CLOSED');
 await h.start();
 assert.equal((await h.request('/api/polls',input,made.cookie)).status,200);
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM polls').get().n,1);
});
test('an interrupted meeting vote rolls back, and stopped SQLite/key backup restores exact poll',async t=>{
 const h=await fixture(t);await h.start();
 const made=await h.request('/api/polls',{...draft,requestId:randomUUID()}),id=made.body.id;
 h.db.exec("CREATE TRIGGER refuse_meeting BEFORE INSERT ON poll_meeting_votes BEGIN SELECT RAISE(ABORT,'refused'); END");
 const old=console.error;console.error=()=>{};
 try{assert.equal((await h.request('/api/poll/vote',{id,slot:0})).status,500);}finally{console.error=old;}
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM poll_meeting_votes').get().n,0);
 h.db.exec('DROP TRIGGER refuse_meeting');
 assert.equal((await h.request('/api/poll/vote',{id,slot:0})).status,200);
 h.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
 await h.stop();
 const backupDir=await mkdtemp(join(tmpdir(),'meeting-restore-'));
 t.after(()=>rm(backupDir,{recursive:true,force:true}));
 await copyFile(join(h.dataDir,'minute.sqlite'),join(backupDir,'minute.sqlite'));
 await copyFile(join(h.dataDir,'session-key'),join(backupDir,'session-key'));
 const restored=await createApp({dataDir:backupDir,disableRateLimit:true,pollNow:()=>BASE});
 t.after(async()=>{await new Promise(resolve=>restored.server.close(resolve));});
 await new Promise(resolve=>restored.server.listen(0,'127.0.0.1',resolve));
 const response=await fetch('http://127.0.0.1:'+restored.server.address().port+'/api/poll?id='+id);
 const view=await response.json();
 assert.deepEqual(view.slots,slots);
 assert.deepEqual(view.counts,[{choice:'0',count:1}]);
 assert.equal(restored.db.prepare('SELECT COUNT(*) n FROM poll_meeting_votes WHERE poll_id=?').get(id).n,1);
});

test('DST fallback two distinct UTC instants and server-authoritative expiry never produce a late ballot',async t=>{
 const h=await fixture(t);
 h.now=Date.UTC(2027,9,29,12);
 await h.start();
 // Both instants appear as 02:30 in Madrid but are one hour apart in UTC.
 const first=Date.UTC(2027,9,31,0,30),second=Date.UTC(2027,9,31,1,30);
 const until=Date.UTC(2027,9,30,9);
 const created=await h.request('/api/polls',{title:'DST weekend',mode:'meeting',
   slots:[second,first],expiresAt:until,hideResultsUntilClose:true,requestId:randomUUID()});
 assert.equal(created.status,201);const id=created.body.id;
 const before=await h.request('/api/poll?id='+id);
 assert.deepEqual(before.body.slots,[first,second]);assert.equal(before.body.counts,null);
 h.now=until-1;
 const vote=await h.request('/api/poll/vote',{id,slot:1});
 assert.equal(vote.status,200);assert.equal(vote.body.choice,'1');assert.equal(vote.body.counts,null);
 h.now=until;
 const refused=await h.request('/api/poll/vote',{id,slot:0});
 assert.equal(refused.status,409);assert.equal(refused.body.code,'POLL_CLOSED');
 assert.equal(h.db.prepare('SELECT closed FROM polls WHERE id=?').get(id).closed,1);
 const result=await h.request('/api/poll?id='+id);
 assert.deepEqual(result.body.counts,[{choice:'1',count:1}]);
 h.now=until-60000; // a clock rollback cannot resurrect a persisted close.
 assert.equal((await h.request('/api/poll/vote',{id,slot:0})).body.code,'POLL_CLOSED');
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM poll_meeting_votes WHERE poll_id=?').get(id).n,1);
});
