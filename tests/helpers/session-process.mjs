// Filesystem fault injection is confined to this child process, never the server.
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
const [dataDir,phase]=process.argv.slice(2);
// An unresolved promise alone does not keep a child alive at the crash checkpoint.
const pause=async checkpoint=>{process.channel.ref();process.send({checkpoint});await new Promise(()=>{});};
const originalOpen=fs.open,originalLink=fs.link;
let liveHandles=0;
if(phase==='partial-write'||phase==='write-failure'){
 fs.open=async(...args)=>{
  const handle=await originalOpen(...args);
  if(!String(args[0]).endsWith('.tmp'))return handle;
  liveHandles++;
  return new Proxy(handle,{get(target,name){
   if(name==='writeFile'&&phase==='partial-write')return async value=>{await target.writeFile(value.slice(0,8));await pause(phase);};
   if(name==='sync'&&phase==='write-failure')return async()=>{throw Object.assign(new Error('private-path-and-secret-must-not-escape'),{code:'ENOSPC'});};
   if(name==='close')return async()=>{try{return await target.close();}finally{liveHandles--;}};
   const value=Reflect.get(target,name,target);return typeof value==='function'?value.bind(target):value;
  }});
 };
}
if(phase==='before-link'||phase==='after-link')fs.link=async(...args)=>{
 if(phase==='before-link')await pause(phase);
 await originalLink(...args);
 if(phase==='after-link')await pause(phase);
};
syncBuiltinESMExports();
const {loadSessionKey}=await import('../../server/session-key.mjs');
if(phase==='write-failure'){
 const errors=[];let baseline=null,final=null;
 if(process.platform==='linux')baseline=(await fs.readdir('/proc/self/fd')).length;
 for(let i=0;i<32;i++){
  try{await loadSessionKey(dataDir);throw Error('fault did not activate');}
  catch(error){if(error.code!=='SESSION_KEY_UNAVAILABLE')throw error;errors.push(error.message);}
  if(liveHandles!==0||(await fs.readdir(dataDir)).length!==0)throw Error('temporary resource leaked');
 }
 if(process.platform==='linux')final=(await fs.readdir('/proc/self/fd')).length;
 fs.open=originalOpen;syncBuiltinESMExports();
 process.send({checkpoint:'failures',errors,baseline,final,liveHandles});
}
if(['partial-write','before-link','after-link'].includes(phase))await loadSessionKey(dataDir);
const {createApp}=await import('../../server/index.mjs');
const app=await createApp({dataDir,disableRateLimit:true});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
process.send({checkpoint:'ready',port:app.server.address().port});
process.on('message',async message=>{
 if(message==='stop'){await new Promise(r=>{app.server.close(r);app.server.closeAllConnections();});process.disconnect();}
});
