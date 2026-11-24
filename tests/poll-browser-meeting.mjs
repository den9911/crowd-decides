import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';

test('meeting date UI publishes typed UTC slots, renders local time and protects hidden counts in Chromium',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'meeting-browser-'));
 const app=await createApp({dataDir,disableRateLimit:true,appId:'decide'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+app.server.address().port;
 const browser=await chromium.launch();
 t.after(async()=>{await browser.close();await new Promise(resolve=>app.server.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 const DAY=86400000;
 const now=Date.now(),minute=60000;
 const slots=[Math.ceil((now+4*DAY)/minute)*minute,Math.ceil((now+6*DAY)/minute)*minute];
 const deadline=Math.ceil((now+DAY)/minute)*minute;
 const utc=ms=>new Date(ms).toISOString().slice(0,16);
 for(const [language,timeZoneId,theme] of [['en','Europe/Madrid','dark'],['ru','Asia/Seoul','light']]){
  const context=await browser.newContext({viewport:{width:320,height:780},locale:language==='en'?'en-US':'ru-RU',timeZoneId,colorScheme:'dark',reducedMotion:'reduce'});
  try{
   await context.addInitScript(({language,theme})=>localStorage.setItem('minute:preferences',JSON.stringify({language,theme})),{language,theme});
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/decide/');
   await page.locator('#create-poll').waitFor();
   await page.locator('input[name="title"]').fill('Meeting across timezones');
   await page.locator('input[name="mode"][value="meeting"]').check();
   assert.equal(await page.locator('textarea[name="options"]').isVisible(),false);
   assert.equal(await page.locator('textarea[name="slots"]').isVisible(),true);
   await page.locator('textarea[name="slots"]').fill(slots.map(utc).join('\n'));
   await page.locator('input[name="deadline"]').fill(utc(deadline));
   await page.locator('input[name="hideResultsUntilClose"]').check();
   assert.equal(await page.locator('#meeting-slots-preview').isVisible(),true);
   assert.equal((await page.locator('#meeting-slots-preview').innerText()).length>10,true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'320px layout');
   await page.locator('#create-poll button[type="submit"]').click();
   await page.waitForURL(url=>url.searchParams.has('poll'));
   const id=new URL(page.url()).searchParams.get('poll');
   const created=app.db.prepare('SELECT poll_kind,options FROM polls WHERE id=?').get(id);
   assert.deepEqual(created,{poll_kind:'meeting',options:'[]'});
   const before=await(await context.request.get(origin+'/api/poll?id='+id)).json();
   assert.equal(before.mode,'meeting');assert.deepEqual(before.slots,slots);
   assert.equal(before.counts,null);assert.equal(before.resultsVisible,false);
   await page.locator('.poll-option').last().waitFor();
   assert.equal(await page.locator('.poll-option').count(),2);
   await page.locator('.poll-option').last().click();
   await page.locator('#poll-results-hidden').waitFor();
   const voted=await(await context.request.get(origin+'/api/poll?id='+id)).json();
   assert.equal(voted.choice,'1');assert.equal(voted.counts,null);
   assert.equal(app.db.prepare('SELECT COUNT(*) n FROM poll_meeting_votes WHERE poll_id=?').get(id).n,1);
   await page.locator('#close').click();
   await page.locator('.result-line').first().waitFor();
   const finished=await(await context.request.get(origin+'/api/poll?id='+id)).json();
   assert.equal(finished.resultsVisible,true);assert.deepEqual(finished.counts,[{choice:'1',count:1}]);
   assert.equal(await page.locator('.poll-option').count(),0);
   assert.deepEqual(errors,[]);
  } finally{await context.close();}
 }
});
