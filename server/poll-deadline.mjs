import {createHash} from 'node:crypto';
import {HttpError} from './validation.mjs';
export const MAX_DEADLINE_SPAN=365*24*60*60*1000;
const MAX_DATE=8_640_000_000_000_000;
/** Optional UTC milliseconds; no client locale/date parsing in the authority boundary. */
export function deadlineValue(value){
 if(value===undefined||value===null)return null;
 if(!Number.isSafeInteger(value)||value<=0||value>MAX_DATE)throw new HttpError(400,'Дедлайн должен быть целым временем UTC в миллисекундах.');
 return value;
}
export function validateNewDeadline(value,now){
 if(value!==null&&(value<=now||value-now>MAX_DEADLINE_SPAN))throw new HttpError(400,'Дедлайн должен быть в будущем, не позднее чем через 365 дней.');
}
export function deadlineReached(value,now){return value!==null&&now>=value;}
export function creationFingerprint(title,options,expiresAt){
 // Preserve pre-deadline receipt hashes for omitted/null deadlines.
 return createHash('sha256').update(JSON.stringify(expiresAt===null?[title,options]:[title,options,expiresAt])).digest('hex');
}
