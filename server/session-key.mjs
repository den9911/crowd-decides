import {randomBytes,randomUUID} from 'node:crypto';
import {open,link,unlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
export class SessionKeyError extends Error {
 constructor(){
  super('SESSION_KEY_UNAVAILABLE: Session key is missing, invalid or inaccessible; restore the original key with the database and check directory permissions. Existing keys are never replaced. / Восстановите исходный ключ вместе с базой и проверьте права каталога.');
  this.name='SessionKeyError';this.code='SESSION_KEY_UNAVAILABLE';
 }
}
const failure=()=>new SessionKeyError();
async function readKey(path){
 let handle;
 try{
  handle=await open(path,'r');const info=await handle.stat();
  if(!info.isFile()||info.size!==64)throw failure();
  const bytes=Buffer.alloc(65);const {bytesRead}=await handle.read(bytes,0,65,0);
  if(bytesRead!==64)throw failure();const value=bytes.subarray(0,64).toString('utf8');
  if(!/^[a-f0-9]{64}$/.test(value))throw failure();return value;
 }finally{await handle?.close();}
}
function validateManaged(managed){
 if(typeof managed!=='string'||Buffer.byteLength(managed)<32||Buffer.byteLength(managed)>128)throw failure();
 return managed;
}
async function existingKey(dataDir){
 const target=join(dataDir,'session-key');
 try{return await readKey(target);}catch(error){if(error.code!=='ENOENT')throw error;}
 let existingDatabase=false;
 try{await stat(join(dataDir,'minute.sqlite'));existingDatabase=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(existingDatabase){try{return await readKey(target);}catch{throw failure();}}
 return null;
}
/** Read-only startup diagnosis; never generates, repairs or prints a key. */
export async function inspectSessionKey(dataDir){
 try{return await existingKey(dataDir)===null?'fresh':'persisted';}catch{throw failure();}
}
/** Publish a fully written key without replacing a competing initializer's key. */
export async function loadSessionKey(dataDir,managed){
 try{
 if(managed!==undefined)return validateManaged(managed);
 const existing=await existingKey(dataDir);if(existing!==null)return existing;
 const target=join(dataDir,'session-key');
 const temporary=join(dataDir,`.session-key-${randomUUID()}.tmp`);let handle;
 try{
  handle=await open(temporary,'wx',0o600);await handle.writeFile(randomBytes(32).toString('hex'));await handle.sync();await handle.close();handle=null;
  try{await link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;}
  return await readKey(target);
 }finally{
  try{await handle?.close();}finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 }
 }catch{throw failure();}
}
