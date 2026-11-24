import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';

test('real Chromium at 320px: EN/RU, themes, lost create ACK, multi-select and hidden totals',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'decide-browser-'));
  const app=await createApp({dataDir,disableRateLimit:true,appId:'decide'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{
    await browser.close();
    await new Promise(resolve=>app.server.close(resolve));
    await rm(dataDir,{recursive:true,force:true});
  });
  for(const [lang,theme] of [['en','dark'],['ru','light'],['en','system']]){
    const context=await browser.newContext({
      locale:lang==='en'?'en-US':'ru-RU',
      viewport:{width:320,height:800},colorScheme:'dark',reducedMotion:'reduce'
    });
    try{
      await context.addInitScript(({language,theme})=>{
        localStorage.setItem('minute:preferences',JSON.stringify({language,theme}));
      },{language:lang,theme});
      const page=await context.newPage();
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'/decide/');
      await page.locator('#create-poll').waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'),lang);
      assert.equal(await page.locator('html').getAttribute('data-theme'),theme==='system'?'dark':theme);
      assert.equal(await page.locator('input[name="mode"]:checked').inputValue(),'single');
      assert.equal(await page.locator('input[name="hideResultsUntilClose"]').isChecked(),false);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'no horizontal overflow at 320px');
      await page.locator('input[name="title"]').fill('Board game '+lang+' '+theme);
      await page.locator('textarea[name="options"]').fill('Alpha\nBeta\nGamma');
      await page.locator('input[name="hideResultsUntilClose"]').check();
      await page.locator('input[name="mode"][value="multiple"]').check();
      await page.locator('input[name="mode"][value="multiple"]').focus();
      assert.equal(await page.evaluate(()=>document.activeElement?.value),'multiple');

      // Allow the server to commit but drop the response, preserving the exact intent on reload.
      let dropped=false;
      await page.route('**/api/polls',async route=>{
        await route.fetch();
        dropped=true;
        await route.abort('failed');
      });
      await page.locator('#create-poll button[type="submit"]').click();
      await page.waitForFunction(()=>document.querySelector('#poll-feedback')!==null);
      assert.equal(dropped,true);
      const original=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('minute:pending-poll')));
      assert.equal(original.version,3);
      assert.equal(original.hideResultsUntilClose,true);
      assert.equal(original.mode,'multiple');
      await page.unroute('**/api/polls');
      await page.reload();
      await page.locator('#create-poll').waitFor();
      assert.equal(await page.locator('input[name="hideResultsUntilClose"]').isChecked(),true);
      assert.equal(await page.locator('input[name="mode"][value="multiple"]').isChecked(),true);
      assert.equal(await page.locator('input[name="hideResultsUntilClose"]').isDisabled(),true);
      await page.locator('#create-poll button[type="submit"]').click();
      await page.waitForURL(url=>url.searchParams.has('poll'));
      const id=new URL(page.url()).searchParams.get('poll');
      assert.equal(app.db.prepare('SELECT COUNT(*) n FROM polls WHERE id=?').get(id).n,1);
      assert.equal(app.db.prepare('SELECT COUNT(*) n FROM polls WHERE request_id=?').get(original.requestId).n,1);
      await page.locator('#multi-vote').waitFor();
      await page.locator('#multi-vote input[name="choices"]').nth(0).check();
      await page.locator('#multi-vote input[name="choices"]').nth(2).check();
      await page.locator('#multi-vote button[type="submit"]').click();
      await page.locator('#poll-results-hidden').waitFor();
      const hidden=await context.request.get(base+'/api/poll?id='+id);
      const hiddenData=await hidden.json();
      assert.equal(hiddenData.resultsVisible,false);
      assert.equal(hiddenData.counts,null);
      assert.equal(hiddenData.ballotCount,null);
      assert.deepEqual(hiddenData.choice,[0,2]);
      await page.locator('#close').click();
      await page.locator('.result-line').first().waitFor();
      const revealed=await (await context.request.get(base+'/api/poll?id='+id)).json();
      assert.equal(revealed.resultsVisible,true);
      assert.equal(revealed.ballotCount,1);
      assert.deepEqual(revealed.counts,[{choice:'0',count:1},{choice:'2',count:1}]);
      assert.deepEqual(errors,[]);
    }finally{await context.close();}
  }
});
