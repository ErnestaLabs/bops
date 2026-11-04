/** Real Bops HTTP acceptance with a deterministic hosted-inference stand-in.
 * Exercises actual app routes and Docker execution, not mocked application modules.
 * No external model credentials. All resources belong exclusively to this test.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'bops-app-'));
const data = join(temp, 'configured-data');
const install = `acceptance-${randomBytes(8).toString('hex')}`;
const token = randomBytes(32).toString('hex');
const marker = `PRIVATE_TASK_${randomBytes(8).toString('hex')}`;
const delegationMarker = `PRIVATE_DELEGATION_${randomBytes(8).toString('hex')}`;
const triggerJoinMarker = `PRIVATE_TRIGGER_JOIN_${randomBytes(8).toString('hex')}`;
let delegateBotId, handoffIssued = false, triggerToolCalls = 0, triggerSubmissions = 0, triggerSubmission;
const browserMarker = `PRIVATE_BROWSER_${randomBytes(8).toString('hex')}`;
const chatMarker = `PRIVATE_CHAT_${randomBytes(8).toString('hex')}`;
const logdir = resolve(process.env.BOPS_ACCEPTANCE_LOG_DIR || join(root, '.scratch/app-acceptance'));
mkdirSync(logdir, { recursive: true });
let browser, serverProcess, log = '', received = 0, taskToolCalls = 0, verifiedOutput = false, compactRequests = 0;
const children = new Set();
const listen = s => new Promise((ok, bad) => { s.once('error', bad); s.listen(0, '127.0.0.1', ok); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
function jsonSchemaValue(s = {}) {
  if ('const' in s) return s.const;
  if (s.enum?.length) return s.enum[0];
  if (s.anyOf) return jsonSchemaValue(s.anyOf.find(x => x.type !== 'null') || s.anyOf[0]);
  const type = Array.isArray(s.type) ? s.type.find(x => x !== 'null') : s.type;
  if (type === 'object') return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, jsonSchemaValue(v)]));
  if (type === 'array') return [];
  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'null') return null;
  return 'acceptance';
}
const triggerServer = createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/api/v1/tasks/ernesta-approved-browser-workflow/trigger');
    assert.equal(req.headers.authorization, 'Bearer trigger-test-secret');
    const chunks = []; for await (const part of req) chunks.push(part);
    const body = JSON.parse(Buffer.concat(chunks));
    triggerSubmissions++; triggerSubmission = body;
    assert.match(body.options?.idempotencyKey ?? '', /^[a-f0-9]{64}$/);
    assert.equal(body.payload?.canonicalWorkflowId, 'submit-form');
    assert.equal(body.payload?.approval?.actionKey, body.options.idempotencyKey);
    assert.match(body.payload?.approval?.signature ?? '', /^[a-f0-9]{64}$/);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'run_trigger_acceptance' }));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
const provider = createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/chat/completions');
    const chunks = []; let size = 0;
    for await (const part of req) { size += part.length; assert.ok(size < 8 * 1024 * 1024); chunks.push(part); }
    const body = JSON.parse(Buffer.concat(chunks)); received++;
    assert.equal(body.model, 'acceptance-model'); assert.equal(body.previous_response_id, undefined);
    assert.equal(body.stream, false);
    const names = (body.tools || []).map(x => x.function?.name);
    let content = JSON.stringify(body.messages).includes(browserMarker) ? browserMarker : chatMarker, tool_calls;
    if (JSON.stringify(body.messages).includes(triggerJoinMarker) && names.includes('queue_workflow')) {
      const queued = body.messages.find(m => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('run_trigger_acceptance'));
      if (queued) {
        content = triggerJoinMarker;
      } else {
        assert.equal(++triggerToolCalls, 1, 'Chief must propose the Trigger workflow only once');
        tool_calls = [{ id: 'queue_workflow_acceptance', type: 'function', function: { name: 'queue_workflow', arguments: JSON.stringify({
          canonicalWorkflowId: 'submit-form',
          executorWorkflowId: 'acceptance-browser-flow',
          objectId: 'acceptance-form-42',
          operation: 'submit',
          parameters: { url: 'https://example.com/form', prompt: 'Submit the already reviewed acceptance form exactly once.' }
        }) } }];
        content = null;
      }
    } else if (body.messages[0]?.content?.includes?.('PRIVATE_CONTEXT_COMPACTION')) {
      compactRequests++;
      assert.equal(body.tools, undefined, 'Compaction must offer no executable tools');
      content = `The task wrote ${marker} into /workspace/private-acceptance.txt. Preserve this observed result; do not repeat the command. No external actions were authorized.`;
    } else if (names.includes('run_command')) {
      const output = body.messages.find(m => m.role === 'tool' && typeof m.content === 'string' && m.content.includes(marker));
      if (output) {
        assert.match(output.content, /exit code 0/); verifiedOutput = true; content = marker;
      } else {
        assert.ok(++taskToolCalls <= 3, 'Unexpected repeated task execution');
        tool_calls = [{ id: `command_${taskToolCalls}`, type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: `printf '${marker}' > /workspace/private-acceptance.txt && cat /workspace/private-acceptance.txt`, timeout_seconds: 10 }) } }];
        content = null;
      }
    } else if (delegateBotId && !handoffIssued && names.includes('hand_off') && JSON.stringify(body.messages).includes(delegationMarker)) {
      handoffIssued = true;
      tool_calls = [{ id: 'delegation_call', type: 'function', function: { name: 'hand_off', arguments: JSON.stringify({ bot_id: delegateBotId, title: 'Delegation acceptance', goal: 'Write the private acceptance marker file on your own computer.', say: 'The specialist will create the acceptance file.', where: 'cloud', then_on_mac: null }) } }];
      content = null;
    } else if (body.response_format?.json_schema) content = JSON.stringify(jsonSchemaValue(body.response_format.json_schema.schema));
    else if (body.response_format?.type === 'json_object') content = '{}';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: `mock_${received}`, model: 'acceptance-model', choices: [{ index: 0, finish_reason: tool_calls ? 'tool_calls' : 'stop', message: { role: 'assistant', content, ...(tool_calls ? { tool_calls } : {}) } }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } }));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
function launch(mode, env) {
  const child = spawn(process.execPath, ['private-runtime/start.mjs', mode], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', b => { const text = b.toString(); log += text; process.stdout.write(text); });
  child.once('exit', () => children.delete(child));
  return child;
}
function waitExit(child, timeout) {
  return new Promise((ok, bad) => {
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} bad(new Error('Application process timed out')); }, timeout);
    child.once('error', e => { clearTimeout(timer); bad(e); });
    child.once('exit', (code, signal) => { clearTimeout(timer); code === 0 ? ok() : bad(new Error(`Application ${code ?? signal}`)); });
  });
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 120 && child.exitCode === null; i++) await sleep(100);
  if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
}
try {
  await listen(triggerServer);
  const triggerEndpoint = `http://127.0.0.1:${triggerServer.address().port}`;
  await listen(provider);
  const endpoint = `http://127.0.0.1:${provider.address().port}/v1`;
  const portServer = createServer(); await listen(portServer); const port = portServer.address().port;
  await new Promise(r => portServer.close(r));
  const base = `http://127.0.0.1:${port}`;
  // Deliberately put the data directory only in the file: regression for load order.
  const envfile = join(temp, 'private.env');
  writeFileSync(envfile, `BOPS_PRIVATE_DATA_DIR=${data}\nBOPS_INFERENCE_BASE_URL=${endpoint}\nBOPS_INFERENCE_MODEL=acceptance-model\nBOPS_PRIVATE_INSTALL_ID=${install}\nBOPS_UI_TOKEN=${token}\nBOPS_PRIVATE_COMPUTER_ACTIONS=1\nBOPS_WORKER_NETWORK=none\nTRIGGER_API_URL=${triggerEndpoint}\nTRIGGER_SECRET_KEY=trigger-test-secret\nERNESTA_LEDGER_DATABASE_URL=postgresql://acceptance/ledger\nWORKFLOW_APPROVAL_KEY=${'a'.repeat(64)}\nSKYVERN_API_BASE_URL=http://127.0.0.1:8999\nSKYVERN_API_KEY=sky-test\nSKYVERN_ALLOWED_WORKFLOW_IDS=acceptance-browser-flow\n`, { mode: 0o600 });
  const env = { ...process.env, BOPS_PRIVATE_ENV_FILE: envfile, PORT: String(port), ELECTRON_SKIP_BINARY_DOWNLOAD: '1', NEXT_TELEMETRY_DISABLED: '1' };
  for (const k of ['BOPS_PRIVATE_DATA_DIR','BOPS_INFERENCE_BASE_URL','BOPS_INFERENCE_MODEL','BOPS_UI_TOKEN']) delete env[k];
  for (const k of ['ORGO_API_KEY','OPENAI_API_KEY','OPENAI_EXECUTOR_API_KEY','TYPESAFE_API_KEY','HONCHO_API_KEY','COMPOSIO_API_KEY','TREG_TOKEN','AGENTMAIL_API_KEY','AGENTPHONE_API_KEY','TAILSCALE_AUTH_KEY']) env[k] = '';
  // A real existing state file is a build-isolation canary, not new empty storage.
  mkdirSync(join(data, 'app'), { recursive: true });
  const stateFile = join(data, 'app', 'state.json');
  const existing = JSON.stringify({ owner: { name: 'Existing owner', about: 'Preserve during build' }, marker: 'build-must-not-touch' });
  writeFileSync(stateFile, existing, { mode: 0o600 });
  if (!process.argv.includes('--built')) await waitExit(launch('build', env), 600000);
  assert.equal(readFileSync(stateFile, 'utf8'), existing, 'Production build must leave existing customer state byte-for-byte unchanged');
  assert.equal(received, 0, 'Building must not contact inference');
  serverProcess = launch('start', env);
  const until = Date.now() + 120000;
  for (;;) {
    if (serverProcess.exitCode !== null) throw new Error('Server exited before readiness');
    try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) })).ok) break; } catch {}
    if (Date.now() > until) throw new Error('Application health timed out');
    await sleep(500);
  }
  assert.ok(existsSync(join(data, 'vault-key')), 'Environment-file data directory must be honored');
  assert.equal((await fetch(`${base}/api/state`)).status, 401, 'Unauthenticated API access must fail');
  const login = await fetch(`${base}/api/private-login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base }, body: new URLSearchParams({ token }) });
  assert.equal(login.status, 303, `Private login: ${await login.text()}`);
  const cookie = login.headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  const auth = { Cookie: cookie.split(';')[0] };
  const call = async (path, body) => {
    const r = await fetch(base + path, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers: { ...auth, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000) });
    const text = await r.text(); assert.equal(r.status, 200, `${path}: ${text.slice(0, 1000)}`); return JSON.parse(text);
  };
  assert.equal((await call('/api/auth/status')).needsSignIn, false);
  const first = (await call('/api/state')).state;
  assert.equal(first.bots.filter(b => b.isMain).length, 1);
  assert.equal(first.owner.name, 'Existing owner', 'Runtime must load the real data directory, not the build directory');
  const bot = first.bots.find(b => b.isMain);
  const chat = first.chats.find(c => c.kind === 'bot' && c.botIds.includes(bot.id));
  await call('/api/account'); await call('/api/config');
  const analytics = await call('/api/analytics');
  assert.deepEqual([analytics.on, analytics.share, analytics.locked], [false, false, true]);
  await call(`/api/chats/${encodeURIComponent(chat.id)}/messages`, { text: `Reply with this exact acceptance marker: ${chatMarker}` });
  let chatted = false;
  for (let i = 0; i < 80; i++) {
    const state = (await call('/api/state')).state;
    if (state.messages.some(m => m.role === 'bot' && m.text.includes(chatMarker))) { chatted = true; break; }
    await sleep(500);
  }
  assert.ok(chatted, 'Bops chat must return the configured provider reply');
  const task = await call('/api/sessions', { botId: bot.id, goal: 'Run the acceptance marker command on your own computer.', title: 'Private acceptance', model: 'acceptance-model', speed: 'default' });
  let finished;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const state = (await call('/api/state')).state;
    const session = state.sessions.find(s => s.id === task.id);
    if (session?.status === 'failed') throw new Error(`Actual Bops task failed: ${session.error}`);
    if (session?.status === 'done') { finished = session; break; }
    await sleep(1000);
  }
  assert.ok(finished, 'Bops task must complete'); assert.ok(verifiedOutput, 'Real Docker stdout must return through the model loop');
  assert.equal(finished.answer, marker);
  const image = await fetch(`${base}/api/screen?bot=${bot.id}&display=${finished.lastDisplay ?? 99}`, { headers: auth });
  assert.equal(image.status, 200, 'Existing screenshot route must use the Docker provider');
  assert.match(image.headers.get('content-type'), /image\//);
  assert.ok((await image.arrayBuffer()).byteLength > 100);
  // Check the actual generated file, not just the provider's assertion of success.
  const ids = execFileSync('docker', ['ps', '--filter', `label=ernesta.install=${install}`, '--format', '{{.Names}}'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  assert.equal(ids.length, 1);
  assert.equal(execFileSync('docker', ['exec', ids[0], 'cat', '/workspace/private-acceptance.txt'], { encoding: 'utf8' }), marker);
  // Exercise the actual Chief -> Bops approval -> self-hosted Trigger bridge.
  const triggerTask = await call('/api/sessions', { botId: bot.id, goal: `${triggerJoinMarker}: Queue the approved form workflow through the canonical workforce tool.`, title: 'Chief Trigger acceptance', model: 'acceptance-model', speed: 'default' });
  let approval;
  for (let i = 0; i < 120; i++) {
    const state = (await call('/api/state')).state;
    const s = state.sessions.find(x => x.id === triggerTask.id);
    if (s?.status === 'failed') throw new Error(`Chief Trigger task failed before approval: ${s.error}`);
    approval = state.appApprovals?.find(x => x.threadId === triggerTask.id && x.action?.startsWith('Queue '));
    if (approval) break;
    await sleep(500);
  }
  assert.ok(approval, 'Chief workflow call must pause in the real Bops approval system');
  assert.equal(triggerSubmissions, 0, 'No Trigger request may leave before owner approval');
  assert.match(approval.preview, /submit-form@1/);
  assert.match(approval.preview, /acceptance-browser-flow/);
  await call('/api/apps/approvals', { id: approval.id, reply: 'once' });
  let triggerFinished;
  for (let i = 0; i < 120; i++) {
    const state = (await call('/api/state')).state;
    const s = state.sessions.find(x => x.id === triggerTask.id);
    if (s?.status === 'failed') throw new Error(`Chief Trigger task failed after approval: ${s.error}`);
    if (s?.status === 'done') { triggerFinished = s; break; }
    await sleep(500);
  }
  assert.ok(triggerFinished, 'Approved Chief workflow task must finish');
  assert.equal(triggerFinished.answer, triggerJoinMarker);
  assert.equal(triggerSubmissions, 1, 'Owner approval must cause exactly one Trigger submission');
  assert.equal(triggerSubmission.options.idempotencyKey, triggerSubmission.payload.action.actionKey);
  assert.equal(triggerToolCalls, 1);
  // Exercise delegation through the real chat tool path, not a direct task POST.
  execFileSync('docker', ['exec', ids[0], 'sh', '-c', 'printf main-only > /workspace/main-only.txt']);
  const specialist = await call('/api/bots', { name: 'Acceptance specialist', role: 'File operations', ownComputer: true });
  delegateBotId = specialist.botId;
  assert.ok(delegateBotId); assert.equal(specialist.note, undefined);
  await call(`/api/chats/${encodeURIComponent(chat.id)}/messages`, { text: `${delegationMarker}: Hand the file task to Acceptance specialist on its own computer.` });
  const waitFor = async (check, label) => {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const state = (await call('/api/state')).state;
      const value = check(state); if (value) return value;
      await sleep(500);
    }
    throw new Error(`${label} timed out`);
  };
  const delegated = await waitFor(state => {
    const session = state.sessions.find(x => x.title === 'Delegation acceptance' && x.botId === delegateBotId);
    if (session?.status === 'failed') throw new Error(`Delegation failed: ${session.error}`);
    return session?.status === 'done' ? session : null;
  }, 'Delegation');
  assert.equal(handoffIssued, true); assert.equal(delegated.sentVia, bot.id); assert.equal(delegated.answer, marker);
  const teamState = (await call('/api/state')).state;
  const specialistComputer = teamState.bots.find(x => x.id === delegateBotId).computerId;
  assert.ok(specialistComputer); assert.notEqual(specialistComputer, ids[0]);
  assert.equal(execFileSync('docker', ['exec', specialistComputer, 'cat', '/workspace/private-acceptance.txt'], { encoding: 'utf8' }), marker);
  execFileSync('docker', ['exec', specialistComputer, 'test', '!', '-e', '/workspace/main-only.txt']);
  // The real timer must start this once-only routine, without a manual run request.
  const scheduled = await call('/api/routines', { botId: delegateBotId, title: 'Routine acceptance', goal: 'Write the private acceptance marker file.', run: 'task', where: 'cloud', schedule: { kind: 'once', at: Date.now() + 3000 } });
  const routineId = scheduled.routine.id;
  const ran = await waitFor(state => {
    const r = state.routines.find(x => x.id === routineId);
    if (r?.last?.status === 'failed') throw new Error(`Scheduled routine failed: ${r.last.error}`);
    return r?.last?.status === 'ok' ? r : null;
  }, 'Scheduled routine');
  assert.equal(ran.enabled, false, 'Once-only routine must not repeat');
  assert.ok((await call('/api/state')).state.sessions.some(x => x.routineId === routineId && x.status === 'done' && x.answer === marker));
  assert.equal(taskToolCalls, 3, 'Exactly the initial, delegated and scheduled tasks must execute');
  // Compact through the existing real task endpoint, then continue after restart.
  const beforeCompact = (await call('/api/state')).state.sessions.find(x => x.id === task.id).responseId;
  await call(`/api/sessions/${task.id}/compact`, {});
  const compacted = await waitFor(state => {
    const session = state.sessions.find(x => x.id === task.id);
    if (session?.steps.some(x => x.detail?.startsWith("Couldn't compact:"))) throw new Error('Application compaction failed');
    return session?.status === 'done' && session.responseId !== beforeCompact && session.steps.some(x => x.tool === 'compacted') ? session : null;
  }, 'Private task compaction');
  assert.ok(compactRequests > 0); assert.equal(taskToolCalls, 3, 'Compaction must not execute a task');
  const responseFile = join(data, 'responses', `${compacted.responseId}.json`);
  const savedCompaction = JSON.parse(readFileSync(responseFile, 'utf8'));
  assert.equal(savedCompaction.response.compaction.source_response_id, beforeCompact);
  assert.ok(existsSync(join(data, 'responses', savedCompaction.response.compaction.source_snapshot)));
  const ownerName = `Restart ${randomBytes(6).toString('hex')}`;
  await call('/api/owner', { name: ownerName, about: 'Written immediately before shutdown' });
  await stop(serverProcess);
  assert.equal(serverProcess.exitCode, 0, 'Shutdown must flush and exit cleanly without SIGKILL');
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).owner.name, ownerName);
  serverProcess = launch('start', env);
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch {}
    if (i > 60) throw new Error('Restart timed out');
    await sleep(500);
  }
  const restored = (await call('/api/state')).state;
  assert.equal(restored.owner.name, ownerName);
  assert.ok(restored.messages.some(m => m.role === 'bot' && m.text.includes(chatMarker)));
  assert.equal(restored.sessions.find(s => s.id === task.id)?.answer, marker);
  assert.equal(execFileSync('docker', ['exec', ids[0], 'cat', '/workspace/private-acceptance.txt'], { encoding: 'utf8' }), marker);
  assert.equal(restored.bots.find(x => x.id === delegateBotId)?.computerId, specialistComputer);
  assert.equal(restored.sessions.find(x => x.id === delegated.id)?.answer, marker);
  assert.equal(restored.routines.find(x => x.id === routineId)?.last?.status, 'ok');
  assert.equal(restored.sessions.find(x => x.id === task.id)?.responseId, compacted.responseId);
  await call(`/api/sessions/${task.id}/reply`, { text: 'Report the marker already written. Do not run the command again.' });
  await waitFor(state => {
    const session = state.sessions.find(x => x.id === task.id);
    if (session?.status === 'failed') throw new Error(`Post-compaction continuation failed: ${session.error}`);
    return session?.status === 'done' && session.responseId !== compacted.responseId && session.answer === marker;
  }, 'Post-compaction continuation');
  assert.equal(taskToolCalls, 3, 'Continuing compacted history must not replay the original tool call');
  let browserUI = false;
  if (process.env.BOPS_BROWSER_ACCEPTANCE === '1') {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], failedRoutes = [];
    page.on('response', r => { if (r.url().startsWith(base) && r.status() >= 500) failedRoutes.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Owner token').fill(token);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const composer = page.getByPlaceholder(/^Text /).first();
    await composer.waitFor({ state: 'visible', timeout: 45000 });
    await composer.fill(`Browser acceptance: reply with exactly ${browserMarker}`);
    const posted = page.waitForResponse(r => r.url().includes('/messages') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Send', exact: true }).first().click();
    assert.equal((await posted).status(), 200);
    await page.getByText(browserMarker, { exact: true }).first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => [...document.images].some(img => img.src.includes('/api/screen?') && img.complete && img.naturalWidth > 100), null, { timeout: 30000 });
    assert.deepEqual(failedRoutes, [], 'The browser must not encounter server-error routes');
    await page.screenshot({ path: join(logdir, 'private-app-browser.png'), fullPage: true });
    assert.deepEqual(errors, [], 'The real browser must not have uncaught JavaScript errors');
    await browser.close(); browser = undefined; browserUI = true;
  }
  await stop(serverProcess);
  const evidence = { passed: true, productionBuild: true, chiefToTriggerApproval: true, triggerSubmissions, existingStatePreservedDuringBuild: true, privateLogin: true, chat: true, task: true, realDockerOutput: true, realDockerFile: true, existingScreenRoute: true, cleanShutdown: true, restartPersistence: true, specialistDelegation: true, separateWorkerVolumes: true, scheduledRoutine: true, teamRestartPersistence: true, taskCompaction: true, compactedContextSurvivesRestart: true, noToolReplayAfterCompaction: true, telemetryDisabled: true, browserReplyAndDesktop: browserUI, browserUI, providerRequests: received, providerType: 'local deterministic test server, not a live hosted model' };
  writeFileSync(join(logdir, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close();
  for (const child of [...children]) await stop(child);
  provider.closeAllConnections(); await new Promise(r => provider.close(r));
  triggerServer.closeAllConnections(); await new Promise(r => triggerServer.close(r));
  writeFileSync(join(logdir, 'app.log'), log);
  // Delete only freshly-created, uniquely labelled test containers and their test volumes.
  try {
    const ids = execFileSync('docker', ['ps','-a','--filter',`label=ernesta.install=${install}`,'--format','{{.Names}}'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    for (const id of ids) {
      assert.match(id, /^ernesta-[a-f0-9]{24}$/);
      execFileSync('docker', ['rm','-f',id]);
      execFileSync('docker', ['volume','rm',`${id}-work`,`${id}-home`]);
    }
  } catch (e) { console.error('Acceptance cleanup:', e.message); }
  rmSync(temp, { recursive: true, force: true });
}
