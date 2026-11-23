import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';

async function fixture(t){
  const dataDir=await mkdtemp(join(tmpdir(),'poll-multiple-'));
  let app,origin;
  async function stop(){if(app){await new Promise(resolve=>app.server.close(resolve));app=null;}}
  t.after(async()=>{await stop();await rm(dataDir,{recursive:true,force:true});});
  return {
    get db(){return app.db;},
    async restart(){
      await stop();app=await createApp({dataDir,disableRateLimit:true});
      await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
      origin='http://127.0.0.1:'+app.server.address().port;
    },
    async request(path,input,cookie){
      const response=await fetch(origin+path,{
        method:input?'POST':'GET',
        headers:{...(input?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
        ...(input?{body:JSON.stringify(input)}:{})
      });
      return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
    }
  };
}
const original={title:'Pick several',options:['A','B','C']};

test('multiple ballots are transactional, unique per voter, and preserve accurate totals after restart',async t=>{
  const h=await fixture(t);await h.restart();
  const requestId=randomUUID(),input={...original,mode:'multiple',requestId};
  const made=await h.request('/api/polls',input);
  assert.equal(made.status,201);
  const id=made.body.id;
  assert.equal((await h.request('/api/poll?id='+id)).body.mode,'multiple');
  const wrong=await h.request('/api/poll/vote',{id,choice:0});
  assert.equal(wrong.status,400);
  for(const choices of [[],[0,0],[3],[-1],[0.5],['1'],[0,1,2,3]]){
    assert.equal((await h.request('/api/poll/vote',{id,choices})).status,400);
  }
  assert.equal(h.db.prepare('SELECT count(*) n FROM poll_multi_ballots').get().n,0);
  const first=await h.request('/api/poll/vote',{id,choices:[2,0]});
  assert.equal(first.status,200);
  assert.deepEqual(first.body.choice,[0,2]);
  assert.equal(first.body.ballotCount,1);
  assert.deepEqual(first.body.counts,[{choice:'0',count:1},{choice:'2',count:1}]);
  assert.equal((await h.request('/api/poll/vote',{id,choices:[1]},first.cookie)).body.code,'POLL_ALREADY_VOTED');
  const second=await h.request('/api/poll/vote',{id,choices:[0,1]});
  assert.equal(second.status,200);
  assert.equal(second.body.ballotCount,2);
  assert.deepEqual(second.body.counts,[{choice:'0',count:2},{choice:'1',count:1},{choice:'2',count:1}]);
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM votes WHERE scope='poll'").get().n,0);
  await h.restart();
  const view=await h.request('/api/poll?id='+id,null,first.cookie);
  assert.equal(view.body.ballotCount,2);
  assert.deepEqual(view.body.choice,[0,2]);
  assert.deepEqual(view.body.counts,second.body.counts);
  assert.equal((await h.request('/api/polls',input,made.cookie)).status,200);
  assert.equal((await h.request('/api/polls',{...input,mode:'single'},made.cookie)).body.code,'POLL_REQUEST_CONFLICT');
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM polls').get().n,1);
});

test('hidden multiple poll never leaks counts or ballot total before owner close',async t=>{
  const h=await fixture(t);await h.restart();
  const owner=await h.request('/api/polls',{...original,mode:'multiple',hideResultsUntilClose:true});
  assert.equal(owner.status,201);
  const id=owner.body.id;
  const voter=await h.request('/api/poll/vote',{id,choices:[1,0]});
  assert.equal(voter.status,200);
  assert.equal(voter.body.resultsVisible,false);
  assert.equal(voter.body.counts,null);
  assert.equal(voter.body.ballotCount,null);
  assert.deepEqual(voter.body.choice,[0,1]);
  for(const cookie of [owner.cookie,voter.cookie,undefined]){
    const view=await h.request('/api/poll?id='+id,null,cookie);
    assert.equal(view.body.counts,null);
    assert.equal(view.body.ballotCount,null);
    assert.equal(view.body.resultsVisible,false);
  }
  const denied=await h.request('/api/poll/close',{id},voter.cookie);
  assert.equal(denied.status,403);
  const closed=await h.request('/api/poll/close',{id},owner.cookie);
  assert.equal(closed.body.closed,true);
  assert.equal(closed.body.ballotCount,1);
  assert.deepEqual(closed.body.counts,[{choice:'0',count:1},{choice:'1',count:1}]);
  assert.equal((await h.request('/api/poll/vote',{id,choices:[2]})).body.code,'POLL_CLOSED');
});

test('legacy single poll has unchanged fingerprint and rejects multi-specific votes',async t=>{
  const h=await fixture(t);await h.restart();
  const requestId=randomUUID(),input={...original,requestId};
  const made=await h.request('/api/polls',input);
  assert.equal(made.status,201);
  const expected=createHash('sha256').update(JSON.stringify([input.title,input.options])).digest('hex');
  assert.equal(h.db.prepare('SELECT request_hash FROM polls WHERE id=?').get(made.body.id).request_hash,expected);
  assert.equal(h.db.prepare('SELECT vote_mode FROM polls WHERE id=?').get(made.body.id).vote_mode,'single');
  const invalid=await h.request('/api/poll/vote',{id:made.body.id,choices:[0,1]});
  assert.equal(invalid.status,400);
  const valid=await h.request('/api/poll/vote',{id:made.body.id,choice:1});
  assert.equal(valid.status,200);
  assert.equal(valid.body.mode,undefined);
  assert.equal(valid.body.choice,'1');
  assert.deepEqual(valid.body.counts,[{choice:'1',count:1}]);
  assert.equal((await h.request('/api/polls',{...input,mode:'single'},made.cookie)).status,200);
  assert.throws(()=>h.db.exec("UPDATE polls SET vote_mode='other'"),/CHECK constraint/);
});
