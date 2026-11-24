import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeDraft,readDraft,saveDraft,clearDraft,draftKey,draftMaxAge} from '../public/decide/draft.js';
import {decodePending,pollCreationPayload,meetingInput,parseUtcMinute} from '../public/decide/intent.js';
const NOW=Date.UTC(2026,10,25,10,0);
const content={title:'Meet?',options:'A\nB',slots:'2027-01-01T14:00\n2027-01-02T14:00',
 deadline:'2026-12-30T14:00',hideResultsUntilClose:true,mode:'meeting'};
function fakeStore(){
 const values=new Map();return {
  getItem:key=>values.get(key)??null,
  setItem:(key,val)=>values.set(key,val),
  removeItem:key=>values.delete(key),
  values
 };
}
test('editable draft persists across fake browser restart, but never contains publication UUIDs',()=>{
 const store=fakeStore(),saved=saveDraft(store,content,NOW);
 assert.equal(saved.version,1);assert.equal(saved.updatedAt,NOW);
 assert.deepEqual(readDraft(store,NOW+100),saved);
 assert.equal(store.values.size,1);
 assert.equal(JSON.stringify(saved).includes('requestId'),false);
 assert.equal(JSON.stringify(saved).includes('owner'),false);
 const pub=decodePending(JSON.stringify({
  version:3,title:'Meet?',options:[],slots:[Date.UTC(2027,0,1,14),Date.UTC(2027,0,2,14)],
  expiresAt:Date.UTC(2026,11,30,14),mode:'meeting',hideResultsUntilClose:true,
  requestId:'12345678-1234-4123-8123-123456789abc'
 }));
 assert.deepEqual(pollCreationPayload(pub).slots,pub.slots);
 assert.notDeepEqual(saved,pub);
 clearDraft(store);assert.equal(readDraft(store,NOW),null);
});
test('malformed, unsupported and expired drafts fail closed without silently deleting them',()=>{
 const store=fakeStore();
 assert.equal(readDraft(store,NOW),null);
 const saved=saveDraft(store,content,NOW);
 for(const mutated of [
  {...saved,version:2},{...saved,updatedAt:NOW-draftMaxAge-1},
  {...saved,updatedAt:NOW+600_000},{...saved,mode:'obsolete'},
  {...saved,requestId:'1234'}, {...saved,title:'x'.repeat(161)},
  {...saved,options:'x'.repeat(486)}, {...saved,slots:'x'.repeat(351)},
  {...saved,deadline:'2026-12-30T14:00Z'}, {...saved,hideResultsUntilClose:'true'},
  {...saved,options:undefined},{...saved,updatedAt:1.5}
 ]){
  store.setItem(draftKey,JSON.stringify(mutated));
  assert.throws(()=>readDraft(store,NOW));
  assert.notEqual(store.getItem(draftKey),null);
 }
 for(const broken of ['','{','null','[]',JSON.stringify(saved)+' '.repeat(2500)]){
  store.setItem(draftKey,broken);
  assert.throws(()=>readDraft(store,NOW));
 }
 clearDraft(store);assert.equal(readDraft(store,NOW),null);
});
test('quota and storage access failures retain the previously saved draft and never touch pending intent',()=>{
 const store=fakeStore(),previous=saveDraft(store,content,NOW);
 store.values.set('minute:pending-poll','immutable-intent');
 const quota={
  getItem:store.getItem,
  setItem:(key,val)=>{if(key===draftKey)throw new DOMException('Quota exceeded','QuotaExceededError');store.setItem(key,val);},
  removeItem:store.removeItem
 };
 assert.throws(()=>saveDraft(quota,{...content,title:'Changed'},NOW+100),/Quota/);
 assert.deepEqual(readDraft(store,NOW+100),previous);
 assert.equal(store.getItem('minute:pending-poll'),'immutable-intent');
 const denied={getItem:()=>{throw new DOMException('Blocked','SecurityError');}};
 assert.throws(()=>readDraft(denied,NOW),/Blocked/);
});
test('editable local meeting validation handles DST fold, sorted UTC, duplicates and expiry rules',()=>{
 const a=Date.UTC(2027,9,31,1,30),b=Date.UTC(2027,10,1,2,30);
 assert.equal(parseUtcMinute('2027-10-31T01:30'),a);
 const input='2027-11-01T02:30\n2027-10-31T01:30';
 const valid=meetingInput(input,Date.UTC(2027,9,30),Date.UTC(2027,9,29));
 assert.deepEqual(valid,{slots:[a,b],reason:null});
 assert.equal(meetingInput('2027-10-31T01:30\n2027-10-31T01:30',Date.UTC(2027,9,30),Date.UTC(2027,9,29)).reason,'duplicate');
 assert.equal(meetingInput('2027-02-29T02:00\n2027-10-31T01:30',Date.UTC(2027,9,30),Date.UTC(2027,9,29)).reason,'format');
 assert.equal(meetingInput('2027-10-31T01:30',Date.UTC(2027,9,30),Date.UTC(2027,9,29)).reason,'count');
 assert.equal(meetingInput(input,null,Date.UTC(2027,9,29)).reason,'deadline');
 assert.equal(meetingInput(input,a,Date.UTC(2027,9,29)).reason,'deadline');
 assert.equal(meetingInput(input,Date.UTC(2027,9,30),a).reason,'bounds');
});
