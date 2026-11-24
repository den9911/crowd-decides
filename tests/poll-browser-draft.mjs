import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';

test('editable draft survives reload, remains local, and never overwrites a copy template without explicit restore',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'poll-draft-browser-'));
 const app=await createApp({dataDir,disableRateLimit:true,appId:'decide'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+app.server.address().port;
 const browser=await chromium.launch();
 t.after(async()=>{await browser.close();await new Promise(resolve=>app.server.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 const ctx=await browser.newContext({viewport:{width:320,height:800},locale:'ru-RU',reducedMotion:'reduce'});
 try{
  await ctx.addInitScript(()=>localStorage.setItem('minute:preferences',JSON.stringify({theme:'system',language:'ru'})));
  const page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const day=86400000,now=Date.now(),minute=60000;
  const slotA=Math.ceil((now+4*day)/minute)*minute,slotB=Math.ceil((now+5*day)/minute)*minute,expires=Math.ceil((now+day)/minute)*minute;
  const utc=ms=>new Date(ms).toISOString().slice(0,16);
  await page.goto(origin+'/decide/');await page.locator('#create-poll').waitFor();
  await page.locator('input[name="title"]').fill('Локальная встреча');
  await page.locator('input[name="mode"][value="meeting"]').check();
  await page.locator('textarea[name="slots"]').fill([utc(slotA),utc(slotB)].join('\n'));
  await page.locator('input[name="deadline"]').fill(utc(expires));
  await page.locator('input[name="hideResultsUntilClose"]').check();
  await page.locator('#save-poll-draft').click();
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM polls').get().n,0,'saving is not publishing');
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('minute:poll-draft')));
  assert.equal(stored.version,1);
  assert.equal(stored.title,'Локальная встреча');
  assert.equal(stored.mode,'meeting');
  assert.equal(stored.hideResultsUntilClose,true);
  assert.equal(JSON.stringify(stored).includes('requestId'),false);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('minute:pending-poll')),null);
  await page.reload();await page.locator('#create-poll').waitFor();
  assert.equal(await page.locator('input[name="title"]').inputValue(),'');
  assert.equal(await page.locator('#restore-poll-draft').isEnabled(),true);
  await page.locator('#restore-poll-draft').click();
  assert.equal(await page.locator('input[name="title"]').inputValue(),'Локальная встреча');
  assert.equal(await page.locator('input[name="mode"][value="meeting"]').isChecked(),true);
  assert.equal(await page.locator('textarea[name="slots"]').inputValue(),[utc(slotA),utc(slotB)].join('\n'));
  assert.equal(await page.locator('input[name="deadline"]').inputValue(),utc(expires));
  assert.equal(await page.locator('input[name="hideResultsUntilClose"]').isChecked(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM polls').get().n,0,'restoring is not publishing');

  // Invalid saved state must never be silently overwritten; only explicit deletion may unblock saving.
  await page.evaluate(()=>localStorage.setItem('minute:poll-draft','{invalid-json'));
  await page.reload();await page.locator('#create-poll').waitFor();
  assert.equal(await page.locator('#save-poll-draft').isDisabled(),true);
  assert.equal(await page.locator('#restore-poll-draft').isDisabled(),true);
  await page.locator('#delete-poll-draft').click();
  assert.equal(await page.locator('#save-poll-draft').isEnabled(),true);
  assert.equal(await page.evaluate(()=>localStorage.getItem('minute:poll-draft')),null);
  await page.locator('input[name="title"]').fill('Сохранённый отдельно');
  await page.locator('textarea[name="options"]').fill('Первый\nВторой');
  await page.locator('#save-poll-draft').click();
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM polls').get().n,0);

  // Opening an owner-only copy always prefers the requested template until user explicitly restores the draft.
  const response=await ctx.request.post(origin+'/api/polls',{data:{title:'Original template',options:['A','B']}});
  assert.equal(response.status(),201);
  const id=(await response.json()).id;
  await page.goto(origin+'/decide/?copy='+id);
  await page.locator('#create-poll').waitFor();
  assert.equal(await page.locator('input[name="title"]').inputValue(),'Original template');
  assert.equal(await page.locator('#restore-poll-draft').isEnabled(),true);
  await page.locator('#restore-poll-draft').click();
  assert.equal(await page.locator('input[name="title"]').inputValue(),'Сохранённый отдельно');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM polls').get().n,1,'restoring is not another POST');
  await page.locator('#delete-poll-draft').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('minute:poll-draft')),null);
  assert.equal(await page.locator('input[name="title"]').inputValue(),'Сохранённый отдельно','delete leaves editable form intact');
  assert.deepEqual(errors,[]);
 }finally{await ctx.close();}
});
