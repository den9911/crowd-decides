import test from 'node:test';import assert from 'node:assert/strict';import {fork} from 'node:child_process';import {once} from 'node:events';import {connect} from 'node:net';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'poll-wire-')),children=[];t.after(async()=>{for(const c of children)if(c.exitCode===null&&c.signalCode===null){c.kill('SIGKILL');await once(c,'exit');}await rm(dir,{recursive:true,force:true});});return {dir,start(phase='serve'){
 const c=fork(fileURLToPath(new URL('./helpers/poll-process.mjs',import.meta.url)),[dir,phase],{stdio:['ignore','pipe','pipe','ipc']});children.push(c);let out='';c.stderr.on('data',b=>out+=b);const queue=[],waiting=[];c.on('message',m=>{const i=waiting.findIndex(w=>w.type===m.type);if(i<0)queue.push(m);else waiting.splice(i,1)[0].done(m);});c.next=type=>new Promise((resolve,reject)=>{const i=queue.findIndex(m=>m.type===type);if(i>=0)return resolve(queue.splice(i,1)[0]);const timer=setTimeout(()=>reject(Error('timeout '+type+' '+out)),10000);waiting.push({type,done:m=>{clearTimeout(timer);resolve(m);}});});return c;
}};}
async function kill(c){const done=once(c,'exit');c.kill('SIGKILL');await done;}
async function request(port,path,input,cookie){const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:input?'POST':'GET',headers:{...(input?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(input?{body:JSON.stringify(input)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function socket(port){const s=connect(port,'127.0.0.1');s.on('error',()=>{});await once(s,'connect');return s;}
test('lost close response after commit survives process death without transferring ownership',async t=>{
 const h=await fixture(t),c=h.start('lose-close-response'),{port}=await c.next('ready');const made=await request(port,'/api/polls',{title:'Keep owner',options:['A','B']}),key=await readFile(join(h.dir,'session-key'));const s=await socket(port);t.after(()=>s.destroy());const payload=JSON.stringify({id:made.body.id});s.write(`POST /api/poll/close HTTP/1.1\r\nHost: localhost\r\nCookie: ${made.cookie}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);await c.next('committed');s.destroy();await kill(c);
 const again=h.start(),ready=await again.next('ready');assert.deepEqual(await readFile(join(h.dir,'session-key')),key);const view=await request(ready.port,'/api/poll?id='+made.body.id,null,made.cookie);assert.equal(view.body.closed,true);assert.equal(view.body.isOwner,true);assert.equal((await request(ready.port,'/api/poll/close',{id:made.body.id})).status,403);assert.equal((await request(ready.port,'/api/poll/close',{id:made.body.id},made.cookie)).body.closed,true);
});
test('32 incomplete owner requests release transport resources and do not close the poll',async t=>{
 const h=await fixture(t),c=h.start(),{port}=await c.next('ready'),made=await request(port,'/api/polls',{title:'Still open',options:['A','B']});
 c.send('stats');const baseline=await c.next('stats');
 for(let i=0;i<32;i++){const s=await socket(port);s.write(`POST /api/poll/close HTTP/1.1\r\nHost: localhost\r\nCookie: ${made.cookie}\r\nContent-Type: application/json\r\nContent-Length: 999\r\n\r\n{\"id\":`);await new Promise(r=>s.write('',r));s.destroy();}
 let stats;for(let i=0;i<30;i++){c.send('stats');stats=await c.next('stats');if(stats.connections<=2)break;await new Promise(r=>setTimeout(r,20));}assert(stats.connections<=2,JSON.stringify(stats));if(baseline.fd!==null)assert(stats.fd<=baseline.fd+5,JSON.stringify({baseline,stats}));
 const view=await request(port,'/api/poll?id='+made.body.id,null,made.cookie);assert.equal(view.body.closed,false);assert.equal(view.body.isOwner,true);assert.equal((await request(port,'/api/poll/close',{id:made.body.id},made.cookie)).body.closed,true);
});

test('refused close write leaves state and owner intact; restart still permits the owner',async t=>{
 const h=await fixture(t),c=h.start('fail-close'),{port}=await c.next('ready'),made=await request(port,'/api/polls',{title:'Retain state',options:['A','B']});
 const failed=await request(port,'/api/poll/close',{id:made.body.id},made.cookie);assert.equal(failed.status,500);assert(!JSON.stringify(failed.body).includes('write refused'));
 const view=await request(port,'/api/poll?id='+made.body.id,null,made.cookie);assert.equal(view.body.closed,false);assert.equal(view.body.isOwner,true);
 c.send('allow-close');await c.next('allowed');await kill(c);const again=h.start(),ready=await again.next('ready');assert.equal((await request(ready.port,'/api/poll/close',{id:made.body.id},made.cookie)).body.closed,true);
});
