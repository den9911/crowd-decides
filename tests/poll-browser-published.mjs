import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';

test('published options remain immutable; only owner can create a separate editable copy, keyboard-first at 320px',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'published-policy-'));
 const app=await createApp({dataDir,disableRateLimit:true,appId:'decide'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 const browser=await chromium.launch();
 t.after(async()=>{await browser.close();await new Promise(resolve=>app.server.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 for(const [language,theme] of [['en','dark'],['ru','light'],['en','system']]){
  const context=await browser.newContext({locale:language==='en'?'en-US':'ru-RU',viewport:{width:320,height:780},colorScheme:'dark',reducedMotion:'reduce'});
  try{
   await context.addInitScript(({language,theme})=>localStorage.setItem('minute:preferences',JSON.stringify({language,theme})),{language,theme});
   const title='A very long published question '+language+' '+theme+' about choosing together and not modifying already collected votes';
   const options=['First extremely long option with several words and details for narrow screens',
                  'Second option describing a long alternative without changing old votes'];
   const created=await context.request.post(base+'/api/polls',{data:{title,options}});
   assert.equal(created.status(),201);
   const id=(await created.json()).id;
   const voted=await context.request.post(base+'/api/poll/vote',{data:{id,choice:0}});
   assert.equal(voted.status(),200);
   const page=await context.newPage();
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(base+'/decide/?poll='+id);
   await page.locator('#published-edit-policy').waitFor();
   assert.equal(await page.locator('html').getAttribute('lang'),language);
   assert.equal(await page.locator('#copy-poll').count(),1);
   assert.ok((await page.locator('#published-edit-help').innerText()).length>20);
   assert.ok((await page.locator('#published-copy-help').innerText()).length>20);
   assert.equal((await page.locator('#copy-poll').getAttribute('aria-describedby')),'published-edit-help published-copy-help');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true,'320px overflow');
   await page.evaluate(()=>{document.documentElement.style.zoom='1.25';});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true,'zoom overflow');
   await page.locator('#copy-poll').focus();
   await page.keyboard.press('Enter');
   await page.locator('#create-poll').waitFor();
   assert.equal(await page.locator('input[name="title"]').inputValue(),title);
   assert.equal(await page.locator('textarea[name="options"]').inputValue(),options.join('\n'));
   assert.equal(await page.locator('#before-publish-help').isVisible(),true);
   assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('name')),'title');
   assert.equal(app.db.prepare('SELECT COUNT(*) n FROM polls WHERE id=?').get(id).n,1);
   const original=await (await context.request.get(base+'/api/poll?id='+id)).json();
   assert.deepEqual(original.counts,[{choice:'0',count:1}]);
   await page.locator('#create-poll button[type="submit"]').click();
   await page.waitForURL(url=>url.searchParams.has('poll'));
   const newId=new URL(page.url()).searchParams.get('poll');
   assert.notEqual(newId,id);
   const clone=await (await context.request.get(base+'/api/poll?id='+newId)).json();
   assert.deepEqual(clone.options,options);
   assert.deepEqual(clone.counts,[]);
   assert.equal(clone.closed,false);
   assert.deepEqual((await (await context.request.get(base+'/api/poll?id='+id)).json()).counts,[{choice:'0',count:1}]);
   const stranger=await browser.newContext({viewport:{width:320,height:780},locale:language==='en'?'en-US':'ru-RU'});
   try{
    const visitor=await stranger.newPage();
    await visitor.goto(base+'/decide/?poll='+id);await visitor.locator('#published-edit-policy').waitFor();
    assert.equal(await visitor.locator('#copy-poll').count(),0);
    assert.equal(await visitor.locator('#published-copy-help').isVisible(),true);
    assert.equal(await visitor.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);
    await visitor.goto(base+'/decide/?copy='+id);
    await visitor.locator('#ownership-notice').waitFor();
    assert.equal(await visitor.locator('#create-poll').count(),0);
    assert.equal(await visitor.locator('#copy-poll').count(),0);
    assert.equal(await visitor.evaluate(()=>document.activeElement?.classList.contains('poll-title')),true);
   }finally{await stranger.close();}
   const close=await context.request.post(base+'/api/poll/close',{data:{id}});
   assert.equal(close.status(),200);
   await page.goto(base+'/decide/?poll='+id);
   await page.locator('#published-edit-policy').waitFor();
   assert.equal(await page.locator('#copy-poll').count(),1,'closed owner can still copy to a new poll');
   assert.equal(await page.locator('#poll-closed-notice').isVisible(),true);
   assert.equal(await page.locator('.poll-option,#multi-vote').count(),0);
   const closedGuest=await browser.newContext({viewport:{width:320,height:780},locale:language==='en'?'en-US':'ru-RU'});
   try{const guest=await closedGuest.newPage();await guest.goto(base+'/decide/?poll='+id);await guest.locator('#poll-closed-notice').waitFor();assert.equal(await guest.locator('.poll-option,#multi-vote,#copy-poll,#close').count(),0);await guest.locator('#refresh').focus();await guest.keyboard.press('Enter');await guest.locator('#poll-closed-notice').waitFor();assert.equal(await guest.evaluate(()=>document.activeElement?.classList.contains('poll-title')),true);await guest.route('**/api/poll?id=*',route=>route.abort());await guest.locator('#refresh').click();await guest.locator('#retry-poll').waitFor();assert.equal(await guest.locator('.poll-option,#multi-vote').count(),0);await guest.unroute('**/api/poll?id=*');await guest.locator('#retry-poll').click();await guest.locator('#poll-closed-notice').waitFor();}finally{await closedGuest.close();}
   assert.deepEqual((await (await context.request.get(base+'/api/poll?id='+id)).json()).counts,[{choice:'0',count:1}]);
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 }
});
