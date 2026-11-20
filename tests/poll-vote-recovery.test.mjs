import test from 'node:test';import assert from 'node:assert/strict';import {fork} from 'node:child_process';import {once} from 'node:events';import {connect} from 'node:net';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
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

test('lost vote response survives a hard restart; close retains that last committed vote',async t=>{
 const h=await fixture(t),first=h.start('lose-vote-response'),{port}=await first.next('ready'),made=await req(port,'/api/polls',{title:'Last committed vote',options:['A','B']}),guest=await req(port,'/api/config');const key=await readFile(join(h.dir,'session-key')),body=JSON.stringify({id:made.body.id,choice:1}),s=await socket(port);t.after(()=>s.destroy());
 s.write(`POST /api/poll/vote HTTP/1.1\r\nHost: localhost\r\nCookie: ${guest.cookie}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);await first.next('committed');s.destroy();await kill(first);
 const again=h.start(),ready=await again.next('ready');assert.deepEqual(await readFile(join(h.dir,'session-key')),key);const view=await req(ready.port,'/api/poll?id='+made.body.id,null,guest.cookie);assert.equal(view.body.choice,'1');assert.deepEqual(view.body.counts,[{choice:'1',count:1}]);
 const repeat=await req(ready.port,'/api/poll/vote',{id:made.body.id,choice:0},guest.cookie);assert.equal(repeat.status,409);assert.equal(repeat.body.code,'POLL_ALREADY_VOTED');assert.equal((await req(ready.port,'/api/poll/close',{id:made.body.id},made.cookie)).body.closed,true);
 const late=await req(ready.port,'/api/poll/vote',{id:made.body.id,choice:0});assert.equal(late.status,409);assert.equal(late.body.code,'POLL_CLOSED');assert.deepEqual((await req(ready.port,'/api/poll?id='+made.body.id)).body.counts,[{choice:'1',count:1}]);
});
test('32 incomplete vote bodies release sockets and descriptors without recording a vote',async t=>{
 const h=await fixture(t),c=h.start(),{port}=await c.next('ready'),made=await req(port,'/api/polls',{title:'No partial vote',options:['A','B']}),guest=await req(port,'/api/config');c.send('stats');const baseline=await c.next('stats');
 for(let i=0;i<32;i++){const s=await socket(port);s.write(`POST /api/poll/vote HTTP/1.1\r\nHost: localhost\r\nCookie: ${guest.cookie}\r\nContent-Type: application/json\r\nContent-Length: 999\r\n\r\n{\"id\":`);await new Promise(r=>s.write('',r));s.destroy();}
 let stats;for(let i=0;i<50;i++){c.send('stats');stats=await c.next('stats');if(stats.connections<=2)break;await new Promise(r=>setTimeout(r,20));}assert(stats.connections<=2);if(baseline.fd!==null)assert(stats.fd<=baseline.fd+5);
 const before=await req(port,'/api/poll?id='+made.body.id,null,guest.cookie);assert.equal(before.body.choice,null);assert.deepEqual(before.body.counts,[]);assert.equal((await req(port,'/api/poll/vote',{id:made.body.id,choice:0},guest.cookie)).status,200);assert.equal((await req(port,'/api/poll/close',{id:made.body.id},made.cookie)).status,200);
});
test('refused vote writes leave no result before or after restart',async t=>{
 const h=await fixture(t),first=h.start('fail-vote'),{port}=await first.next('ready'),made=await req(port,'/api/polls',{title:'Rollback vote',options:['A','B']}),guest=await req(port,'/api/config');const failed=await req(port,'/api/poll/vote',{id:made.body.id,choice:0},guest.cookie);assert.equal(failed.status,500);assert(!JSON.stringify(failed.body).includes('vote write refused'));
 const before=await req(port,'/api/poll?id='+made.body.id,null,guest.cookie);assert.equal(before.body.choice,null);assert.deepEqual(before.body.counts,[]);first.send('allow-vote');await first.next('allowed');await kill(first);
 const again=h.start(),ready=await again.next('ready'),after=await req(ready.port,'/api/poll?id='+made.body.id,null,guest.cookie);assert.equal(after.body.choice,null);assert.deepEqual(after.body.counts,[]);assert.equal(after.body.closed,false);assert.equal((await req(ready.port,'/api/poll/vote',{id:made.body.id,choice:1},guest.cookie)).status,200);
});
