import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';import {createApp} from '../server/index.mjs';
async function fixture(t){const dataDir=await mkdtemp(join(tmpdir(),'poll-retry-'));let app,port;async function stop(){if(app){await new Promise(r=>app.server.close(r));app=null;}}t.after(async()=>{await stop();await rm(dataDir,{recursive:true,force:true});});return {get db(){return app.db;},async start(){await stop();app=await createApp({dataDir,disableRateLimit:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));port=app.server.address().port;},async request(input,cookie){const res=await fetch(`http://127.0.0.1:${port}/api/polls`,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(input)});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}};}
test('same creation intent survives concurrent retries and restart without duplicating a poll',async t=>{
 const h=await fixture(t);await h.start();const input={requestId:randomUUID(),title:'One poll',options:['Yes','No']};const first=await h.request(input);assert.equal(first.status,201);
 for(const repeat of await Promise.all(Array.from({length:12},()=>h.request(input,first.cookie)))){assert.equal(repeat.status,200);assert.deepEqual(repeat.body,first.body);}
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM polls').get().n,1);await h.start();assert.deepEqual((await h.request(input,first.cookie)).body,first.body);
 const other=await h.request({...input,title:'Different'},first.cookie);assert.equal(other.status,409);assert.equal(other.body.code,'POLL_REQUEST_CONFLICT');assert.equal(h.db.prepare('SELECT title FROM polls').get().title,'One poll');
 const stranger=await h.request(input);assert.equal(stranger.status,403);assert.equal(stranger.body.code,'OWNER_SESSION_REQUIRED');assert(!JSON.stringify(stranger.body).includes(first.body.id));assert.equal(h.db.prepare('SELECT COUNT(*) n FROM polls').get().n,1);
});
test('bounded request IDs, legacy clients and rollback preserve existing contracts',async t=>{
 const h=await fixture(t);await h.start();const input={title:'Original',options:['A','B']};for(const requestId of ['',7,{},'x'.repeat(10000),'../../key'])assert.equal((await h.request({...input,requestId})).status,400);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM polls').get().n,0);
 const legacy=await h.request(input);assert.equal(legacy.status,201);assert.equal((await h.request(input,legacy.cookie)).status,201);
 h.db.exec("CREATE TRIGGER reject_test_poll BEFORE INSERT ON polls WHEN NEW.title='Fail write' BEGIN SELECT RAISE(ABORT,'injected test failure'); END");
 const requestId=randomUUID(),old=console.error;console.error=()=>{};try{assert.equal((await h.request({...input,title:'Fail write',requestId},legacy.cookie)).status,500);}finally{console.error=old;}
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM polls WHERE request_id=?').get(requestId).n,0);h.db.exec('DROP TRIGGER reject_test_poll');assert.equal((await h.request({...input,title:'Fail write',requestId},legacy.cookie)).status,201);
});
test('legacy poll migration preserves the original row and is safe to reopen',async t=>{
 const {DatabaseSync}=await import('node:sqlite'),{writeFile}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'poll-migrate-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const old=new DatabaseSync(join(dir,'minute.sqlite'));old.exec("CREATE TABLE polls(id TEXT PRIMARY KEY,title TEXT NOT NULL,options TEXT NOT NULL,owner TEXT NOT NULL,created INTEGER NOT NULL); INSERT INTO polls VALUES('legacy','Original','[\"A\",\"B\"]','old-owner',123)");old.close();await writeFile(join(dir,'session-key'),'a'.repeat(64));
 for(let i=0;i<2;i++){const app=await createApp({dataDir:dir});assert.deepEqual({...app.db.prepare('SELECT * FROM polls').get()},{id:'legacy',title:'Original',options:'["A","B"]',owner:'old-owner',created:123,closed:0,request_id:null,request_hash:null,expires_at:null,hide_results_until_close:0,vote_mode:'single'});app.db.close();}
});

test('a rejected creation leaves no receipt across restart, then one valid retry succeeds',async t=>{
 const h=await fixture(t);await h.start();const session=await h.request({title:'Existing',options:['A','B']});const input={requestId:randomUUID(),title:'Deferred',options:['A','B']};
 h.db.exec("CREATE TRIGGER block_creation BEFORE INSERT ON polls WHEN NEW.title='Deferred' BEGIN SELECT RAISE(ABORT,'creation write refused'); END");
 const old=console.error;console.error=()=>{};try{assert.equal((await h.request(input,session.cookie)).status,500);}finally{console.error=old;}
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM polls WHERE request_id=?').get(input.requestId).n,0);h.db.exec('DROP TRIGGER block_creation');await h.start();
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM polls WHERE request_id=?').get(input.requestId).n,0);const success=await h.request(input,session.cookie);assert.equal(success.status,201);assert.deepEqual((await h.request(input,session.cookie)).body,success.body);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM polls').get().n,2);
});
