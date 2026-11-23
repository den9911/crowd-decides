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
test('pending decode preserves exact saved deadline including past expiry; unknown payload versions fail closed',()=>{
  const legacy={requestId:randomUUID(),title:'Where?',options:['A','B']};
  assert.deepEqual(pollCreationPayload(decodePending(JSON.stringify(legacy))),{...legacy,expiresAt:null});
  const saved={...legacy,version:1,expiresAt:Date.UTC(2020,0,1,12,0)};
  assert.deepEqual(decodePending(JSON.stringify(saved)),{...saved,version:2,hideResultsUntilClose:false,mode:'single'});
  const current={...saved,version:2,hideResultsUntilClose:true,mode:'multiple'};
  assert.deepEqual(decodePending(JSON.stringify(current)),current);
  assert.deepEqual(pollCreationPayload(current),{
    requestId:current.requestId,title:current.title,options:current.options,
    expiresAt:current.expiresAt,hideResultsUntilClose:true,mode:'multiple'
  });
  assert.deepEqual(pollCreationPayload(decodePending(JSON.stringify(saved))),{
    requestId:saved.requestId,title:saved.title,options:saved.options,expiresAt:saved.expiresAt
  });
  for(const value of [{...saved,version:2},{...saved,expiresAt:undefined},{...saved,expiresAt:'2020'},
      {...saved,hideResultsUntilClose:true},{...legacy,expiresAt:saved.expiresAt},
      {...current,mode:'invalid'},{...current,hideResultsUntilClose:'true'},
      {...current,expiresAt:undefined},null]){
    assert.throws(()=>decodePending(JSON.stringify(value)));
  }
});
