import test from 'node:test';
import assert from 'node:assert/strict';
import {fork,spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,readFile,writeFile,readdir,stat,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkStartup} from '../server/startup.mjs';
const helper=fileURLToPath(new URL('./helpers/session-process.mjs',import.meta.url));
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'poll-crash-')),children=[];
 t.after(async()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}await rm(dir,{recursive:true,force:true});});
 function start(phase){
  const child=fork(helper,[dir,phase],{stdio:['ignore','pipe','pipe','ipc']});children.push(child);
  child.output='';child.stdout.on('data',b=>child.output+=b);child.stderr.on('data',b=>child.output+=b);
  const messages=[],waiters=[];
  child.on('message',message=>{const i=waiters.findIndex(w=>w.name===message.checkpoint);if(i>=0){const [w]=waiters.splice(i,1);w.resolve(message);}else messages.push(message);});
  child.on('exit',()=>{for(const w of waiters.splice(0))w.reject(Error('child exited: '+child.output));});
  child.next=name=>new Promise((resolve,reject)=>{
   const i=messages.findIndex(m=>m.checkpoint===name);if(i>=0)return resolve(messages.splice(i,1)[0]);
   const timer=setTimeout(()=>reject(Error('checkpoint timeout: '+name+' '+child.output)),10000);
   waiters.push({name,resolve:m=>{clearTimeout(timer);resolve(m);},reject:e=>{clearTimeout(timer);reject(e);}});
  });return child;
 }
 return {dir,start};
}
async function stop(child,hard=false){assert.equal(child.exitCode,null,'child must still be alive before intentional shutdown');assert.equal(child.signalCode,null);const exited=once(child,'exit');if(hard)child.kill('SIGKILL');else child.send('stop');await exited;}
async function request(port,path,input,cookie){const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:input?'POST':'GET',headers:{...(input?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},...(input?{body:JSON.stringify(input)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
for(const phase of ['partial-write','before-link','after-link'])test(`hard process death at ${phase} never publishes a partial key`,{timeout:20000},async t=>{
 const h=await fixture(t),first=h.start(phase);await first.next(phase);
 const staged=(await readdir(h.dir)).filter(f=>f.endsWith('.tmp'));assert.equal(staged.length,1);
 const bytes=(await stat(join(h.dir,staged[0]))).size;assert.equal(bytes,phase==='partial-write'?8:64);
 let published=null;
 if(phase==='after-link'){published=await readFile(join(h.dir,'session-key'),'utf8');assert.match(published,/^[a-f0-9]{64}$/);}
 else await assert.rejects(stat(join(h.dir,'session-key')),e=>e.code==='ENOENT');
 await stop(first,true);
 // A killed initializer can leave its private staging file; it is never adopted as a key.
 const second=h.start('serve'),ready=await second.next('ready');
 const key=await readFile(join(h.dir,'session-key'),'utf8');assert.match(key,/^[a-f0-9]{64}$/);if(published)assert.equal(key,published);
 const made=await request(ready.port,'/api/polls',{title:'After crash',options:['A','B']});assert.equal(made.status,201);
 await stop(second,true);
 const third=h.start('serve'),again=await third.next('ready');
 assert.equal(await readFile(join(h.dir,'session-key'),'utf8'),key);
 const view=await request(again.port,'/api/poll?id='+made.body.id,null,made.cookie);assert.equal(view.body.isOwner,true);assert.equal(view.body.title,'After crash');
 assert.equal((await request(again.port,'/api/poll/close',{id:made.body.id},made.cookie)).status,200);
 await stop(third);
});
test('32 real temporary write failures close handles, remove staging and allow a valid startup',async t=>{
 const h=await fixture(t),child=h.start('write-failure'),result=await child.next('failures');
 assert.equal(result.errors.length,32);assert.equal(result.liveHandles,0);
 for(const error of result.errors){assert.match(error,/SESSION_KEY_UNAVAILABLE/);assert(!error.includes('private-path-and-secret'));assert(!error.includes(h.dir));}
 if(result.baseline!==null)assert(result.final<=result.baseline+4,JSON.stringify(result));
 const ready=await child.next('ready');assert.equal((await request(ready.port,'/api/polls',{title:'Recovered',options:['A','B']})).status,201);await stop(child);
 assert.deepEqual((await readdir(h.dir)).filter(f=>f.endsWith('.tmp')),[]);
});
test('read-only diagnostics and the real CLI fail closed without secret disclosure or key generation',async t=>{
 const h=await fixture(t);assert.equal((await checkStartup({dataDir:h.dir,port:0,env:{}})).sessionKey,'fresh');assert.deepEqual(await readdir(h.dir),[]);
 await writeFile(join(h.dir,'session-key'),'private-secret-fixture');
 await assert.rejects(checkStartup({dataDir:h.dir,port:0,env:{}}),e=>e.code==='SESSION_KEY_UNAVAILABLE'&&!e.message.includes('private-secret-fixture'));
 const cli=spawn(process.execPath,[fileURLToPath(new URL('../server/index.mjs',import.meta.url)),'--check','--port','0'],{env:{...process.env,DATA_DIR:h.dir}});let out='';cli.stdout.on('data',b=>out+=b);cli.stderr.on('data',b=>out+=b);const [code]=await once(cli,'exit');assert.equal(code,1);assert.match(out,/SESSION_KEY_UNAVAILABLE/);assert.match(out,/Восстановите/);assert(!out.includes('private-secret-fixture'));assert(!out.includes(h.dir));
 assert.equal(await readFile(join(h.dir,'session-key'),'utf8'),'private-secret-fixture');await assert.rejects(stat(join(h.dir,'minute.sqlite')),e=>e.code==='ENOENT');
 await unlink(join(h.dir,'session-key'));await writeFile(join(h.dir,'minute.sqlite'),'db unchanged');
 await assert.rejects(checkStartup({dataDir:h.dir,port:0,env:{}}),/restore the original key/);assert.equal(await readFile(join(h.dir,'minute.sqlite'),'utf8'),'db unchanged');
});
