import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';

async function fixture(t){
 const dataDir=await mkdtemp(join(tmpdir(),'multi-recovery-'));
 let app,origin;
 async function stop(){if(app){await new Promise(resolve=>app.server.close(resolve));app=null;}}
 t.after(async()=>{await stop();await rm(dataDir,{recursive:true,force:true});});
 return {dataDir,get db(){return app.db;},stop,
  async restart(){await stop();app=await createApp({dataDir,disableRateLimit:true});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+app.server.address().port;},
  async request(path,input,cookie){
   const response=await fetch(origin+path,{method:input?'POST':'GET',headers:{...(input?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(input?{body:JSON.stringify(input)}:{})});
   return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
 };
}
const draft={title:'Multi retry',options:['A','B','C'],mode:'multiple'};
test('multi vote unknown ACK is reconciled by GET; another cookie cannot see a private choice',async t=>{
 const h=await fixture(t);await h.restart();
 const owner=await h.request('/api/polls',{...draft,requestId:randomUUID(),hideResultsUntilClose:true}),id=owner.body.id;
 const voter=await h.request('/api/poll/vote',{id,choices:[2,0]});
 // Deliberately ignore the success body, as with a lost transport ACK.
 const saved=await h.request('/api/poll?id='+id,null,voter.cookie);
 assert.equal(saved.body.resultsVisible,false);assert.equal(saved.body.counts,null);
 assert.deepEqual(saved.body.choice,[0,2]);
 const guest=await h.request('/api/poll?id='+id);
 assert.equal(guest.body.choice,null);assert.equal(guest.body.isOwner,false);assert.equal(guest.body.ballotCount,null);
 assert.equal((await h.request('/api/poll/vote',{id,choices:[1]},voter.cookie)).body.code,'POLL_ALREADY_VOTED');
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM poll_multi_ballots WHERE poll_id=?').get(id).n,1);
 await h.restart();
 assert.deepEqual((await h.request('/api/poll?id='+id,null,voter.cookie)).body.choice,[0,2]);
 assert.equal((await h.request('/api/poll?id='+id)).body.choice,null);
 const closed=await h.request('/api/poll/close',{id},owner.cookie);
 assert.equal(closed.status,200);assert.equal(closed.body.ballotCount,1);
 assert.deepEqual(closed.body.counts,[{choice:'0',count:1},{choice:'2',count:1}]);
});
test('malformed multi payloads do not write a vote; injected failure releases transaction for next voter',async t=>{
 const h=await fixture(t);await h.restart();
 const made=await h.request('/api/polls',draft),id=made.body.id;
 for(const choices of [[],[0,0],[-1],[3],[0.1],['1'],[null],Array(7).fill(0),{},false]){
  assert.equal((await h.request('/api/poll/vote',{id,choices})).status,400);
 }
 for(const input of [{choice:1},{choices:[0],slot:0},{slot:0}]){
  assert.equal((await h.request('/api/poll/vote',{id,...input})).status,400);
 }
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM poll_multi_ballots').get().n,0);
 h.db.exec("CREATE TRIGGER reject_multi BEFORE INSERT ON poll_multi_ballots BEGIN SELECT RAISE(ABORT,'rejected multi'); END");
 const old=console.error;console.error=()=>{};
 try{assert.equal((await h.request('/api/poll/vote',{id,choices:[0,1]})).status,500);}finally{console.error=old;}
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM poll_multi_ballots').get().n,0);
 h.db.exec('DROP TRIGGER reject_multi');
 const accepted=await h.request('/api/poll/vote',{id,choices:[1,0]});
 assert.equal(accepted.status,200);assert.deepEqual(accepted.body.choice,[0,1]);
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM poll_multi_ballots').get().n,1);
});
test('backup and restore preserve both old single and new multi votes and original owner cookie',async t=>{
 const h=await fixture(t);await h.restart();
 const one=await h.request('/api/polls',{title:'Single',options:['Yes','No']});
 const multi=await h.request('/api/polls',draft);
 const singleVote=await h.request('/api/poll/vote',{id:one.body.id,choice:1});
 const multiVote=await h.request('/api/poll/vote',{id:multi.body.id,choices:[0,2]});
 assert.equal(singleVote.status,200);assert.equal(multiVote.status,200);
 h.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
 await h.stop();
 const backup=await mkdtemp(join(tmpdir(),'multi-restore-'));
 t.after(()=>rm(backup,{recursive:true,force:true}));
 await copyFile(join(h.dataDir,'minute.sqlite'),join(backup,'minute.sqlite'));
 await copyFile(join(h.dataDir,'session-key'),join(backup,'session-key'));
 const app=await createApp({dataDir:backup,disableRateLimit:true});
 t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+app.server.address().port;
 const read=async(id,cookie)=>await(await fetch(origin+'/api/poll?id='+id,{headers:cookie?{cookie}:{}})).json();
 const classic=await read(one.body.id,singleVote.cookie);
 assert.equal(classic.choice,'1');assert.equal(classic.mode,undefined);
 assert.deepEqual(classic.counts,[{choice:'1',count:1}]);
 const renewed=await read(multi.body.id,multiVote.cookie);
 assert.equal(renewed.mode,'multiple');assert.deepEqual(renewed.choice,[0,2]);
 assert.deepEqual(renewed.counts,[{choice:'0',count:1},{choice:'2',count:1}]);
 assert.equal((await read(multi.body.id,multi.cookie)).isOwner,true);
});
