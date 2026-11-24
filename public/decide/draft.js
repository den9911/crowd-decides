/** Local, editable, never a publication receipt. No secrets or request UUIDs are stored. */
export const draftKey='minute:poll-draft';
export const draftMaxAge=30*24*60*60*1000;
const fields=['title','options','slots','deadline'];
const modeValues=new Set(['single','multiple','meeting']);
/** Decode without mutating storage. Unsupported, expired and malformed drafts fail closed. */
export function decodeDraft(raw,now=Date.now()){
  if(raw===null)return null;
  if(typeof raw!=='string'||raw.length===0||raw.length>2500)throw new Error('Invalid local draft');
  const d=JSON.parse(raw);
  if(!d||typeof d!=='object'||Array.isArray(d)||d.version!==1||
     Object.keys(d).length!==8||!['version','updatedAt','mode','hideResultsUntilClose',...fields].every(k=>Object.hasOwn(d,k))||
     !Number.isSafeInteger(d.updatedAt)||d.updatedAt<=0||d.updatedAt>now+5*60*1000||
     now-d.updatedAt>draftMaxAge||!modeValues.has(d.mode)||
     typeof d.hideResultsUntilClose!=='boolean'||
     fields.some(key=>typeof d[key]!=='string')||
     d.title.length>160||d.options.length>485||d.slots.length>350||d.deadline.length>16) {
    throw new Error('Invalid local draft');
  }
  return d;
}
export function readDraft(store,now=Date.now()){
  return decodeDraft(store.getItem(draftKey),now);
}
/** Atomic localStorage setItem; do not delete a previous draft on quota/write failure. */
export function saveDraft(store,fieldsValue,now=Date.now()){
  const draft={version:1,updatedAt:now,...fieldsValue};
  const raw=JSON.stringify(draft);
  decodeDraft(raw,now);
  store.setItem(draftKey,raw);
  return draft;
}
export function clearDraft(store){
  store.removeItem(draftKey);
}
