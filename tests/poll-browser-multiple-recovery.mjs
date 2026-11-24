import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';

test('multi-select lost ACK, reload, cookie loss, zoom and long text in real Chromium',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'multi-browser-'));
 const app=await createApp({dataDir,disableRateLimit:true,appId:'decide'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+app.server.address().port;
 const browser=await chromium.launch();
 t.after(async()=>{await browser.close();await new Promise(resolve=>app.server.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 const context=await browser.newContext({viewport:{width:320,height:760},locale:'ru-RU',reducedMotion:'reduce'});
 try{
  await context.addInitScript(()=>localStorage.setItem('minute:preferences',JSON.stringify({language:'ru',theme:'system'})));
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/decide/');await page.locator('#create-poll').waitFor();
  await page.locator('input[name="title"]').fill('Длинный вопрос о голосовании');
  await page.locator('input[name="mode"][value="multiple"]').check();
  await page.locator('textarea[name="options"]').fill('Семьдесят два символа подробного описания первого варианта ответа\nДругой очень длинный вариант, который должен переноситься на узком экране');
  await page.locator('#create-poll button[type="submit"]').click();
  await page.waitForURL(url=>url.searchParams.has('poll'));
  const id=new URL(page.url()).searchParams.get('poll');
  await page.locator('#multi-vote').waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'),'ru');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true,'320px');
  await page.locator('#multi-vote input[name="choices"]').first().check();
  await page.locator('#multi-vote input[name="choices"]').last().check();
  let intercepted=false;
  await page.route('**/api/poll/vote',async route=>{
   const committed=await route.fetch();
   assert.equal(committed.status(),200);
   intercepted=true;
   await route.abort('failed');
  });
  await page.locator('#multi-vote button[type="submit"]').click();
  await page.locator('#multi-vote').waitFor({state:'detached'});
  assert.equal(intercepted,true);
  await page.unroute('**/api/poll/vote');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM poll_multi_ballots WHERE poll_id=?').get(id).n,1);
  await page.reload();await page.locator('.result-line').first().waitFor();
  const own=await(await context.request.get(origin+'/api/poll?id='+id)).json();
  assert.deepEqual(own.choice,[0,1]);assert.equal(own.ballotCount,1);
  assert.deepEqual(own.counts,[{choice:'0',count:1},{choice:'1',count:1}]);
  await page.evaluate(()=>{document.documentElement.style.zoom='1.25';});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true,'zoom no overflow');
  const foreign=await browser.newContext({viewport:{width:320,height:760}});
  try{
   const newTab=await foreign.newPage();
   await newTab.goto(origin+'/decide/?poll='+encodeURIComponent(id));
   await newTab.locator('#multi-vote').waitFor();
   const stranger=await(await foreign.request.get(origin+'/api/poll?id='+id)).json();
   assert.equal(stranger.choice,null);
   assert.equal(stranger.isOwner,false);
   assert.equal(stranger.ballotCount,1);
  }finally{await foreign.close();}
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
