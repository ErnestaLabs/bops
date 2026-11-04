/** Real HTTP canvas checks; local design only, no provider or production access. */
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:4319',out='.scratch/workforce-map';mkdirSync(out,{recursive:true});
const child=spawn(process.execPath,['private-runtime/workflows/preview.mjs'],{env:{...process.env,WORKFORCE_PREVIEW_PORT:'4319'},stdio:'ignore'});
let browser;
try{
 for(let i=0;;i++){try{if((await fetch(base,{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}if(i>50)throw new Error('Preview failed');await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1560,height:960},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.locator('[data-node="n0"]').waitFor();assert.equal(await page.locator('.flow-link').count(),32);
 const ids=await page.locator('.flow-link').evaluateAll(ns=>ns.map(n=>n.dataset.flow));
 for(const id of ids){await page.locator(`[data-flow="${id}"]`).click();assert.ok(await page.locator('.node').count()>=9);assert.ok(await page.locator('.edge-line').count()>=9);await page.locator('[data-node="n0"]').click();assert.equal(await page.locator('#inspector').isVisible(),true);await page.locator('#close').click();}
 await page.locator('[data-flow="send-approved"]').click();
 await page.locator('#path').selectOption('timeout');assert.equal(await page.locator('[data-node="unknown"]').evaluate(n=>n.classList.contains('dim')),false);
 await page.locator('#next').click();assert.equal(await page.locator('.node.current').count(),1);
 await page.locator('#path').selectOption('all');
 const before=await page.evaluate(()=>workflowCanvas.getCamera().k);await page.locator('#plus').click();assert.ok(await page.evaluate(()=>workflowCanvas.getCamera().k)>before);await page.locator('#fit').click();
 const position=await page.evaluate(()=>workflowCanvas.getGraph().nodes[0].x),box=await page.locator('[data-node="n0"]').boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2+20,{steps:8});await page.mouse.up();assert.ok(await page.evaluate(()=>workflowCanvas.getGraph().nodes[0].x)>position+10);
 await page.locator('#exceptions').uncheck();assert.equal(await page.locator('.edge.exception').count(),0);await page.locator('#exceptions').check();
 const download=page.waitForEvent('download');await page.locator('#export').click();const exported=await download;await exported.saveAs(`${out}/send-workflow.svg`);assert.match(readFileSync(`${out}/send-workflow.svg`,'utf8'),/edge-line/);
 await page.locator('#system').click();assert.equal(await page.locator('[data-node="browser"]').count(),1);await page.screenshot({path:`${out}/system.png`,fullPage:true});
 await page.locator('[data-node="browser"]').dblclick();assert.match(await page.locator('#title').textContent(),/Submit an approved form/);
 await page.locator('[data-flow="send-approved"]').click();await page.locator('#fit').click();await page.screenshot({path:`${out}/desktop.png`,fullPage:true});
 await page.locator('#info').click();await page.locator('#refresh-live').click();await page.waitForTimeout(200);assert.match(await page.locator('#inspector-body').textContent(),/No live execution is inferred/);await page.locator('#close').click();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${out}/mobile.png`,fullPage:true});
 execFileSync(process.execPath,['private-runtime/workflows/export-map.mjs',`${out}/workforce-control-map.html`]);
 await page.goto(pathToFileURL(resolve(`${out}/workforce-control-map.html`)).href);await page.locator('[data-node="n0"]').waitFor();assert.equal(await page.locator('.flow-link').count(),32);
 assert.deepEqual(errors,[]);
 const result={passed:true,workflowDiagrams:32,connectedEdges:true,stepInspection:true,routeTracing:true,zoom:true,nodeDragging:true,exceptionToggle:true,svgExport:true,systemMap:true,mobileNoOverflow:true,portableHtml:true,mode:'design-only',uncaughtBrowserErrors:errors};writeFileSync(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();child.kill('SIGTERM');}
