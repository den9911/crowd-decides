import test from 'node:test';import assert from 'node:assert/strict';import {fork} from 'node:child_process';import {once} from 'node:events';import {connect} from 'node:net';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';import {fileURLToPath} from 'node:url';
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


test('real template GET interruption and restart leave source state unchanged; later copy starts fresh',async t=>{
 const h=await fixture(t),first=h.start('lose-template-response'),{port}=await first.next('ready'),made=await req(port,'/api/polls',{title:'Source template',options:['A','B']});await req(port,'/api/poll/vote',{id:made.body.id,choice:1},made.cookie);await req(port,'/api/poll/close',{id:made.body.id},made.cookie);
 const s=await socket(port);t.after(()=>s.destroy());s.write(`GET /api/poll/template?id=${made.body.id} HTTP/1.1\r\nHost: localhost\r\nCookie: ${made.cookie}\r\n\r\n`);await first.next('template-ready');s.destroy();await kill(first);
 const again=h.start(),ready=await again.next('ready'),source=await req(ready.port,'/api/poll?id='+made.body.id,null,made.cookie);assert.equal(source.body.closed,true);assert.deepEqual(source.body.counts,[{choice:'1',count:1}]);const template=await req(ready.port,'/api/poll/template?id='+made.body.id,null,made.cookie);assert.deepEqual(template.body,{title:'Source template',options:['A','B']});
 const requestId=randomUUID();again.send('fail-create');await again.next('create-blocked');const failure=await req(ready.port,'/api/polls',{...template.body,requestId},made.cookie);assert.equal(failure.status,500);again.send('allow-create');await again.next('allowed');await kill(again);
 const final=h.start(),third=await final.next('ready'),child=await req(third.port,'/api/polls',{...template.body,requestId},made.cookie);assert.equal(child.status,201);assert.equal((await req(third.port,'/api/polls',{...template.body,requestId},made.cookie)).status,200);const view=await req(third.port,'/api/poll?id='+child.body.id);assert.equal(view.body.closed,false);assert.deepEqual(view.body.counts,[]);assert.deepEqual((await req(third.port,'/api/poll?id='+made.body.id,null,made.cookie)).body.counts,[{choice:'1',count:1}]);
});
test('32 canceled template reads release connections/fds without publishing any child',async t=>{
 const h=await fixture(t),first=h.start('lose-template-response'),{port}=await first.next('ready'),made=await req(port,'/api/polls',{title:'Repeated GET',options:['A','B']});first.send('stats');const before=await first.next('stats');
 for(let i=0;i<32;i++){const s=await socket(port);s.write(`GET /api/poll/template?id=${made.body.id} HTTP/1.1\r\nHost: localhost\r\nCookie: ${made.cookie}\r\n\r\n`);await first.next('template-ready');s.destroy();}
 let stats;for(let i=0;i<50;i++){first.send('stats');stats=await first.next('stats');if(stats.connections<=2)break;await new Promise(r=>setTimeout(r,20));}assert(stats.connections<=2);if(before.fd!==null)assert(stats.fd<=before.fd+5);await kill(first);
 const next=h.start(),ready=await next.next('ready'),template=await req(ready.port,'/api/poll/template?id='+made.body.id,null,made.cookie);assert.equal(template.status,200);const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(join(h.dir,'minute.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) n FROM polls').get().n,1);}finally{db.close();}
});
