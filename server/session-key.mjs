import {randomBytes,randomUUID} from 'node:crypto';
import {open,link,unlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
const failure=()=>new Error('Session key is missing or invalid; restore the original key with the database. No replacement was generated.');
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
/** Publish a fully written key without replacing a competing initializer's key. */
export async function loadSessionKey(dataDir,managed){
 if(managed!==undefined){
  if(typeof managed!=='string'||Buffer.byteLength(managed)<32||Buffer.byteLength(managed)>128)throw failure();
  return managed; // Explicit managed mode: operator must supply the same secret on every start.
 }
 const target=join(dataDir,'session-key');
 try{return await readKey(target);}catch(error){if(error.code!=='ENOENT')throw error;}
 let existingDatabase=false;
 try{await stat(join(dataDir,'minute.sqlite'));existingDatabase=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(existingDatabase){try{return await readKey(target);}catch{throw failure();}}
 const temporary=join(dataDir,`.session-key-${randomUUID()}.tmp`);let handle;
 try{
  handle=await open(temporary,'wx',0o600);await handle.writeFile(randomBytes(32).toString('hex'));await handle.sync();await handle.close();handle=null;
  try{await link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;}
  return await readKey(target);
 }finally{await handle?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
