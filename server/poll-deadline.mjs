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
export function creationFingerprint(title,options,expiresAt,hideResultsUntilClose=false,mode='single'){
 // Preserve every persisted single-choice hash, including optional deadline/visibility.
 const fields=mode==='multiple'?[title,options,expiresAt,!!hideResultsUntilClose,'multiple:v1']:
  hideResultsUntilClose?[title,options,expiresAt,true]:
  expiresAt===null?[title,options]:[title,options,expiresAt];
 return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

/** Canonical UTC meeting times; never infer offsets or rely on option text. */
export function meetingSlotsValue(value){
 if(!Array.isArray(value)||value.length<2||value.length>6||
    value.some(ms=>!Number.isSafeInteger(ms)||ms<=0||ms>MAX_DATE)){
  throw new HttpError(400,'Укажите от 2 до 6 корректных моментов UTC.');
 }
 const slots=[...value].sort((a,b)=>a-b);
 if(new Set(slots).size!==slots.length)throw new HttpError(400,'Моменты встречи должны различаться.');
 return slots;
}
/** Validate only on first creation; an idempotent replay survives expired slots. */
export function validateMeetingSlots(slots,expiresAt,now){
 if(expiresAt===null||expiresAt>=slots[0]||slots.some(ms=>ms<=now||ms-now>MAX_DEADLINE_SPAN)){
  throw new HttpError(400,'Дедлайн выбора должен быть раньше первой встречи; слоты — в пределах 365 дней.');
 }
}
export function meetingFingerprint(title,slots,expiresAt,hideResultsUntilClose=false){
 return createHash('sha256').update(JSON.stringify(['meeting:v1',title,slots,expiresAt,!!hideResultsUntilClose])).digest('hex');
}
