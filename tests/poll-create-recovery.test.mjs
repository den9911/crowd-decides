import test from 'node:test';import assert from 'node:assert/strict';import {fork} from 'node:child_process';import {once} from 'node:events';import {connect} from 'node:net';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'poll-create-wire-')),children=[];
 t.after(async()=>{for(const c of children)if(c.exitCode===null&&c.signalCode===null){c.kill('SIGKILL');await once(c,'exit');}await rm(dir,{recursive:true,force:true});});
 return {dir,start(phase='serve'){
  const c=fork(fileURLToPath(new URL('./helpers/poll-process.mjs',import.meta.url)),[dir,phase],{stdio:['ignore','pipe','pipe','ipc']});children.push(c);let output='';c.stderr.on('data',b=>output+=b);const messages=[],waiting=[];
  c.on('message',m=>{const i=waiting.findIndex(w=>w.type===m.type);if(i>=0)waiting.splice(i,1)[0].done(m);else messages.push(m);});
  c.next=type=>new Promise((resolve,reject)=>{const i=messages.findIndex(m=>m.type===type);if(i>=0)return resolve(messages.splice(i,1)[0]);const timer=setTimeout(()=>reject(Error('checkpoint timeout '+type+' '+output)),10000);waiting.push({type,done:m=>{clearTimeout(timer);resolve(m);}});});return c;
 }};
}
async function kill(c){const ended=once(c,'exit');c.kill('SIGKILL');await ended;}
async function req(port,path,input,cookie){const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:input?'POST':'GET',headers:{...(input?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(input?{body:JSON.stringify(input)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function socket(port){const s=connect(port,'127.0.0.1');s.on('error',()=>{});await once(s,'connect');return s;}
test('creation committed without a response replays after hard restart without a second row',async t=>{
 const h=await fixture(t),first=h.start('lose-create-response'),{port}=await first.next('ready');const session=await req(port,'/api/config'),key=await readFile(join(h.dir,'session-key'));const input={requestId:randomUUID(),title:'Survive crash',options:['A','B'],expiresAt:Date.now()+600000,hideResultsUntilClose:true},body=JSON.stringify(input),s=await socket(port);t.after(()=>s.destroy());
 s.write(`POST /api/polls HTTP/1.1\r\nHost: localhost\r\nCookie: ${session.cookie}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);await first.next('committed');s.destroy();await kill(first);
 const again=h.start(),ready=await again.next('ready');assert.deepEqual(await readFile(join(h.dir,'session-key')),key);
 const replay=await req(ready.port,'/api/polls',input,session.cookie);assert.equal(replay.status,200);
 for(let i=0;i<5;i++)assert.deepEqual((await req(ready.port,'/api/polls',input,session.cookie)).body,replay.body);
 const restored=(await req(ready.port,'/api/poll?id='+replay.body.id,null,session.cookie)).body;assert.equal(restored.isOwner,true);assert.equal(restored.expiresAt,input.expiresAt);assert.equal(restored.counts,null);assert.equal(restored.resultsVisible,false);
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(join(h.dir,'minute.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) n FROM polls').get().n,1);assert.equal(db.prepare('SELECT request_id FROM polls').get().request_id,input.requestId);}finally{db.close();}
});
test('32 interrupted creations release sockets and descriptors; no receipt exists before a complete body',async t=>{
 const h=await fixture(t),c=h.start(),{port}=await c.next('ready'),session=await req(port,'/api/config');c.send('stats');const baseline=await c.next('stats');const input={requestId:randomUUID(),title:'Complete later',options:['A','B']};
 for(let i=0;i<32;i++){const s=await socket(port);s.write(`POST /api/polls HTTP/1.1\r\nHost: localhost\r\nCookie: ${session.cookie}\r\nContent-Type: application/json\r\nContent-Length: 999\r\n\r\n{\"requestId\":`);await new Promise(r=>s.write('',r));s.destroy();}
 let stats;for(let i=0;i<50;i++){c.send('stats');stats=await c.next('stats');if(stats.connections<=2)break;await new Promise(r=>setTimeout(r,20));}assert(stats.connections<=2);if(baseline.fd!==null)assert(stats.fd<=baseline.fd+5);
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(join(h.dir,'minute.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) n FROM polls').get().n,0);}finally{db.close();}
 assert.equal((await req(port,'/api/polls',input,session.cookie)).status,201);assert.equal((await req(port,'/api/polls',input,session.cookie)).status,200);
});
