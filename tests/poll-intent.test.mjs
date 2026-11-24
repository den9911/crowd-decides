import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decodePending,parseUtcMinute,pollCreationPayload } from '../public/decide/intent.js';

test('UTC input maps to a single instant even in a local DST fold; malformed input is not treated as no deadline',()=>{
  assert.equal(parseUtcMinute('2027-10-31T01:30'),Date.UTC(2027,9,31,1,30));
  assert.equal(parseUtcMinute(''),null);
  for(const value of ['2027-02-29T12:00','2028-04-31T10:00','2027-01-01T24:00','2027-01-01T00:00Z']){
    assert(Number.isNaN(parseUtcMinute(value)));
  }
});
test('pending v1/v2 decode to v3 without changing the original HTTP receipt fingerprint',()=>{
 const legacy={requestId:randomUUID(),title:'Where?',options:['A','B']};
 assert.deepEqual(pollCreationPayload(decodePending(JSON.stringify(legacy))),{...legacy,expiresAt:null});
 const saved={...legacy,version:1,expiresAt:Date.UTC(2020,0,1,12,0)};
 assert.deepEqual(decodePending(JSON.stringify(saved)),{...saved,version:3,hideResultsUntilClose:false,mode:'single',slots:null});
 const old={...legacy,version:2,expiresAt:saved.expiresAt,hideResultsUntilClose:true,mode:'multiple'};
 assert.deepEqual(decodePending(JSON.stringify(old)),{...old,version:3,slots:null});
 assert.deepEqual(pollCreationPayload(decodePending(JSON.stringify(old))),{
  requestId:old.requestId,title:old.title,options:old.options,expiresAt:old.expiresAt,
  hideResultsUntilClose:true,mode:'multiple'
 });
 assert.deepEqual(pollCreationPayload(decodePending(JSON.stringify(saved))),{
  requestId:saved.requestId,title:saved.title,options:saved.options,expiresAt:saved.expiresAt
 });
 for(const value of [{...saved,version:4},{...saved,expiresAt:undefined},{...saved,expiresAt:'2020'},
     {...saved,hideResultsUntilClose:true},{...legacy,expiresAt:saved.expiresAt},
     {...old,mode:'invalid'},{...old,hideResultsUntilClose:'true'},
     {...old,slots:[]},{...old,expiresAt:undefined},null]){
  assert.throws(()=>decodePending(JSON.stringify(value)));
 }
});
test('meeting pending v3 pins sorted UTC instants and rejects bad or ambiguous slots',()=>{
 const dates=[Date.UTC(2027,10,1,9,0),Date.UTC(2027,10,2,10,0)];
 const pending={version:3,requestId:randomUUID(),title:'Meet?',options:[],slots:dates,
  expiresAt:Date.UTC(2027,9,28),hideResultsUntilClose:true,mode:'meeting'};
 assert.deepEqual(decodePending(JSON.stringify(pending)),pending);
 assert.deepEqual(pollCreationPayload(pending),{
  requestId:pending.requestId,title:pending.title,slots:dates,expiresAt:pending.expiresAt,
  hideResultsUntilClose:true,mode:'meeting'
 });
 for(const bad of [{...pending,slots:[dates[0]]},{...pending,slots:[...dates].reverse()},
   {...pending,slots:[dates[0],dates[0]]},{...pending,slots:[dates[0],'2027-11-02']},
   {...pending,slots:[...dates,Infinity]},{...pending,options:['A','B']},
   {...pending,expiresAt:null},{...pending,mode:'single'},
   {...pending,hideResultsUntilClose:'false'}]){
  assert.throws(()=>decodePending(JSON.stringify(bad)));
 }
});
