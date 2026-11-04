import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { workflows, states, workflow, transition } from '../workflows/catalog.mjs';
import { serviceURL, requestBody, summarizeRun, skyvernClient, digest } from '../workflows/skyvern.mjs';
import { plan, dispatchOnce, reconcileJournal } from '../workflows/ledger.mjs';
const req = { url: 'https://example.com/', prompt: 'Extract the page title.', max_steps: 5, data_extraction_schema: { type: 'object' } };
const input = { actionId: 'read-2026-11-03', accountScope: 'customer-one', baseUrl: 'http://127.0.0.1:8000', request: req };
function temp(t) { const dir = mkdtempSync(join(tmpdir(), 'workflow-test-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
test('every mapped workflow has an owner gate, evidence, repair and exact source', () => {
  assert.equal(new Set(workflows.map(x => x.id)).size, 20);
  for (const w of workflows) { assert.ok(w.steps.length >= 3); for (const k of ['approval','evidence','repair','source','readiness']) assert.ok(w[k]); }
  assert.equal(workflow('browser-read').readiness, 'adapter'); assert.throws(() => workflow('missing'));
});
test('business outcomes cannot jump from queued or unknown to success', () => {
  for (const [from, targets] of Object.entries(states)) for (const to of targets) assert.ok(to in states, `${from} -> ${to}`);
  assert.throws(() => transition('queued', 'succeeded')); assert.throws(() => transition('outcome_unknown', 'dispatching'));
  assert.equal(transition('awaiting_verification', 'succeeded'), 'succeeded');
});
test('explicit self-hosted endpoint; reject cloud defaults and credential-bearing URLs', () => {
  for (const url of [undefined,'https://api.skyvern.com','https://api.openai.com','https://a.orgo.ai','https://api.x.ai','http://remote.example','https://user:pass@private.example','https://private.example?key=bad']) assert.throws(() => serviceURL(url));
  assert.equal(serviceURL('http://skyvern:8000'), 'http://skyvern:8000');
});
test('bounded task request rejects extra execution/provider overrides', () => {
  assert.equal(requestBody(req).engine, 'skyvern-1.0');
  for (const r of [{...req,engine:'openai-cua'},{...req,webhook_url:'https://x.example'},{...req,max_steps:21},{...req,url:'http://example.com'},{...req,url:'https://127.0.0.1'},{...req,url:'https://example.com:9443'}]) assert.throws(() => requestBody(r));
});
test('provider completion is not business success; unknown states fail closed', () => {
  assert.equal(summarizeRun({run_id:'tsk_abc',status:'completed'}).businessState,'awaiting_verification');
  assert.throws(() => summarizeRun({run_id:'tsk_abc',status:'maybe'}));
  assert.throws(() => summarizeRun({run_id:'../../escape',status:'running'}));
});
test('approval binds action, account, origin, payload and step budget', () => {
  const p = plan(input);
  for (const delta of [{actionId:'other'}, {accountScope:'other'}, {baseUrl:'http://127.0.0.1:8001'}, {request:{...req,max_steps:6}}]) assert.notEqual(plan({...input,...delta}).approvalHash,p.approvalHash);
  assert.equal(digest({b:2,a:1}),digest({a:1,b:2}));
});
test('concurrent duplicate submissions send one POST; receipts never contain prompts or keys', async t => {
  const directory = temp(t); let calls = 0;
  const client = {origin:input.baseUrl, start:async()=>{calls++; return {providerRunId:'tsk_once',businessState:'running'};}};
  const args = {...input, directory, client, approvalHash:plan(input).approvalHash};
  const results = await Promise.all([dispatchOnce(args),dispatchOnce(args)]);
  assert.equal(calls,1); assert.ok(results.some(r=>r.existingReservation));
  const path = join(directory,readdirSync(directory)[0],'receipt.json');
  assert.equal(readFileSync(path,'utf8').includes(req.prompt),false); assert.equal(statSync(path).mode & 0o777,0o600);
});
test('timeouts retain reservation and never silently resubmit', async t => {
  const directory = temp(t); let calls = 0;
  const args = {...input,directory,approvalHash:plan(input).approvalHash,client:{origin:input.baseUrl,start:async()=>{calls++;throw new Error('secret response body');}}};
  assert.equal((await dispatchOnce(args)).state,'outcome_unknown');
  assert.equal((await dispatchOnce(args)).existingReservation,true); assert.equal(calls,1);
  const saved = readFileSync(join(directory,readdirSync(directory)[0],'receipt.json'),'utf8'); assert.equal(saved.includes('secret response body'),false);
});
test('missing approval, conflicting input and partial reservation cannot dispatch', async t => {
  const directory = temp(t); let calls=0;
  const client = {origin:input.baseUrl,start:async()=>{calls++;return {providerRunId:'tsk_x',businessState:'running'};}};
  await assert.rejects(dispatchOnce({...input,directory,client,approvalHash:'bad'}), /APPROVAL_REQUIRED/);
  const p=plan(input); mkdirSync(join(directory,p.reservationKey));
  await assert.rejects(dispatchOnce({...input,directory,client,approvalHash:p.approvalHash}), /PARTIAL_RESERVATION/); assert.equal(calls,0);
});
test('GET cannot accept another run ID; malformed POST response is uncertain', async () => {
  const client=skyvernClient({baseUrl:input.baseUrl,apiKey:'local-secret',fetchImpl:async()=>Response.json({run_id:'tsk_other',status:'running'})});
  await assert.rejects(client.observe('tsk_expected'), /RUN_ID_MISMATCH/);
  const bad=skyvernClient({baseUrl:input.baseUrl,apiKey:'local-secret',fetchImpl:async()=>new Response('broken')});
  await assert.rejects(bad.start(req), e=>e.uncertain && !e.message.includes('broken'));
});
test('real HTTP fixture checks auth, exact routes and cancellation versus confirmation', async t => {
  const seen=[];
  const server=createServer(async (r,s)=>{const chunks=[];for await(const x of r)chunks.push(x);seen.push({method:r.method,path:r.url,key:r.headers['x-api-key'],body:Buffer.concat(chunks).toString()});s.setHeader('content-type','application/json');s.end(JSON.stringify({run_id:'tsk_http',status:r.method==='GET'?'completed':'running',output:{title:'Example'},screenshot_urls:['https://secret.example/?token=secret']}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const client=skyvernClient({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'local-secret'});
  assert.equal((await client.start(req)).providerRunId,'tsk_http');
  const result=await client.observe('tsk_http');assert.equal(result.businessState,'awaiting_verification');assert.equal(JSON.stringify(result).includes('token=secret'),false);
  assert.equal((await client.cancel('tsk_http')).businessState,'cancel_requested');
  assert.deepEqual(seen.map(x=>x.path),['/v1/run/tasks','/v1/runs/tsk_http','/v1/runs/tsk_http/cancel']);assert.ok(seen.every(x=>x.key==='local-secret'));
});
test('changed payload cannot reuse an action ID',async t=>{
  const directory=temp(t); const client={origin:input.baseUrl,start:async()=>({providerRunId:'tsk_a',businessState:'running'})};
  await dispatchOnce({...input,directory,client,approvalHash:plan(input).approvalHash});
  const changed={...input,request:{...req,prompt:'Changed'}};
  await assert.rejects(dispatchOnce({...changed,directory,client,approvalHash:plan(changed).approvalHash}),/ACTION_ID_CONFLICT/);
});
test('every source reference exists and rendered map is deterministic', async t => {
  const { existsSync } = await import('node:fs');
  const { renderWorkflowMap } = await import('../workflows/render.mjs');
  const root=new URL('../../',import.meta.url);
  for(const w of workflows)assert.ok(existsSync(new URL(w.source,root)),w.source);
  const target=join(temp(t),'map.html');
  renderWorkflowMap(target); renderWorkflowMap(target,true);
  assert.ok(readFileSync(target,'utf8').includes('DESIGN MAP'));
});

test('a file-journal action stuck outcome_unknown reconciles once and never reopens', async t => {
  const directory = temp(t);
  const client = { origin: input.baseUrl, start: async () => { throw new Error('lost response'); } };
  const args = { ...input, directory, client, approvalHash: plan(input).approvalHash };
  const stuck = await dispatchOnce(args);
  assert.equal(stuck.state, 'outcome_unknown');
  assert.deepEqual(await reconcileJournal({ ...args, providerRunId: 'tsk_found' }), { remoteId: 'tsk_found' });
  await assert.rejects(reconcileJournal({ ...args, providerRunId: 'tsk_found' }), /NOT_RECONCILABLE/);
  const receipt = JSON.parse(readFileSync(join(directory, readdirSync(directory)[0], 'receipt.json'), 'utf8'));
  assert.equal(receipt.providerRunId, 'tsk_found');
  assert.deepEqual(receipt.events.map(e => e.event), ['dispatch_reserved', 'reconciliation_required', 'reconciled']);
});
