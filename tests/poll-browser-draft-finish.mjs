import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';

test('draft actions retain disabled and focus states, corrupted/quota data fail safely, and owner clears draft after publishing',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'draft-finish-'));
 const app=await createApp({dataDir,disableRateLimit:true,appId:'decide'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 const browser=await chromium.launch();
 t.after(async()=>{await browser.close();await new Promise(resolve=>app.server.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 const ctx=await browser.newContext({viewport:{width:320,height:800},locale:'ru-RU',reducedMotion:'reduce',colorScheme:'dark'});
 try{
  await ctx.addInitScript(()=>localStorage.setItem('minute:preferences',JSON.stringify({language:'ru',theme:'system'})));
  const page=await ctx.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/decide/');
  await page.locator('#create-poll').waitFor();
  assert.equal(await page.locator('#delete-poll-draft').isDisabled(),true);
  await page.locator('input[name="title"]').fill('Черновик с длинным описанием для проверки узкой мобильной ширины');
  await page.locator('textarea[name="options"]').fill('Первый длинный вариант для решения\nВторой длинный вариант для решения');
  await page.locator('#save-poll-draft').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#restore-poll-draft').isEnabled(),true);
  assert.equal(await page.locator('#delete-poll-draft').isEnabled(),true);
  const original=await page.evaluate(()=>localStorage.getItem('minute:poll-draft'));
  assert.ok(original);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('minute:pending-poll')),null);
  // Storage denial on overwrite does not delete the last good snapshot or publish the poll.
  await page.evaluate(()=>{
    const setter=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(key==='minute:poll-draft')throw new DOMException('Quota exceeded','QuotaExceededError');
      return setter.call(this,key,value);
    };
  });
  await page.locator('input[name="title"]').fill('Не сохранится из-за квоты');
  await page.locator('#save-poll-draft').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('minute:poll-draft')),original);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM polls').get().n,0);
  await page.reload();await page.locator('#create-poll').waitFor();
  assert.equal(await page.locator('input[name="title"]').inputValue(),'');
  await page.locator('#restore-poll-draft').click();
  assert.match(await page.locator('input[name="title"]').inputValue(),/^Черновик с длинным/);
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('name')),'title');
  // A second tab may corrupt storage after initial read; clicking Restore must fail closed.
  await page.evaluate(()=>localStorage.setItem('minute:poll-draft','{corrupt'));
  await page.locator('#restore-poll-draft').click();
  assert.equal(await page.locator('#restore-poll-draft').isDisabled(),true);
  assert.equal(await page.locator('#save-poll-draft').isDisabled(),true);
  assert.equal(await page.locator('#delete-poll-draft').isEnabled(),true);
  await page.locator('#delete-poll-draft').click();
  assert.equal(await page.locator('#delete-poll-draft').isDisabled(),true);
  assert.equal(await page.locator('#save-poll-draft').isEnabled(),true);
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'save-poll-draft');
  assert.equal(await page.evaluate(()=>localStorage.getItem('minute:poll-draft')),null);
  // Explicit new draft, published via the app. No draft gets deleted automatically.
  await page.locator('input[name="title"]').fill('Окончательное решение');
  await page.locator('textarea[name="options"]').fill('Первый\nВторой');
  await page.locator('#save-poll-draft').click();
  await page.locator('#create-poll button[type="submit"]').click();
  await page.waitForURL(url=>url.searchParams.has('poll'));
  const id=new URL(page.url()).searchParams.get('poll');
  await page.locator('#clear-published-draft').waitFor();
  assert.ok(await page.evaluate(()=>localStorage.getItem('minute:poll-draft')));
  const before=await (await ctx.request.get(base+'/api/poll?id='+id)).json();
  assert.equal(before.isOwner,true);
  await page.locator('#clear-published-draft').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>localStorage.getItem('minute:poll-draft')),null);
  assert.equal(await page.locator('#clear-published-draft').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'published-draft-status');
  assert.match(await page.locator('#published-draft-status').innerText(),/голоса не изменились/);
  const after=await (await ctx.request.get(base+'/api/poll?id='+id)).json();
  assert.deepEqual(after.options,before.options);
  assert.deepEqual(after.counts,before.counts);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM polls').get().n,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);
  assert.deepEqual(errors,[]);
 }finally{await ctx.close();}
});
