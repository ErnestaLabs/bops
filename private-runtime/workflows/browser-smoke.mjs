/** Visual scaffold acceptance. Starts only a loopback preview, never customer services. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const port = 4319, base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath,['private-runtime/workflows/preview.mjs'],{env:{...process.env,WORKFORCE_PREVIEW_PORT:String(port)},stdio:'ignore'});
const out = '.scratch/workforce-map'; mkdirSync(out,{recursive:true});
let browser;
try {
  for (let n=0;;n++) {
    try { if ((await fetch(base,{signal:AbortSignal.timeout(1000)})).ok) break; } catch {}
    if (n>50) throw new Error('Preview startup failed'); await new Promise(r=>setTimeout(r,100));
  }
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1500,height:1100}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  await page.locator('.flow-link').last().waitFor();
  assert.equal(await page.locator('.flow-link').count(),32);
  for (let i=0;i<32;i++) {
    await page.locator('.flow-link').nth(i).click();
    assert.ok(await page.locator('.node').count() >= 7);
    await page.locator('.node').last().click();
    assert.ok((await page.locator('#step-detail').textContent()).includes('Persist outcome'));
  }
  await page.locator('#search').fill('Submit an approved form'); await page.locator('.flow-link').click();
  await page.locator('#advance').click(); await page.locator('#advance').click();
  assert.match(await page.locator('#run-state').textContent(),/AWAITING APPROVAL/);
  await page.locator('#approve').click(); await page.locator('#advance').click();
  await page.locator('#fault').selectOption('dispatch_uncertain'); await page.locator('#inject').click();
  assert.match(await page.locator('#run-state').textContent(),/OUTCOME UNKNOWN/);
  assert.equal(await page.locator('#retry').isEnabled(),false);
  await page.locator('#reconcile-not').click();
  assert.match(await page.locator('#run-state').textContent(),/AWAITING APPROVAL/);
  await page.locator('#reset').click(); await page.locator('#search').fill('');
  await page.locator('#refresh').click(); await page.waitForTimeout(100);
  assert.match(await page.locator('#live-status').textContent(),/No live status is inferred/);
  await page.screenshot({path:`${out}/desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
  await page.screenshot({path:`${out}/mobile.png`,fullPage:true});
  assert.deepEqual(errors,[]);
  const result = {passed:true,workflowCards:32,allStepInspectors:true,approvalGate:true,uncertainWriteBlocksRetry:true,reapprovalAfterReconciliation:true,noFakeLiveStatus:true,mobileNoOverflow:true,uncaughtBrowserErrors:errors,mode:'rehearsal-only'};
  writeFileSync(`${out}/result.json`,JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
} finally { await browser?.close(); child.kill('SIGTERM'); }
