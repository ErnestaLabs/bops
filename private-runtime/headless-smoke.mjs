/** Restart acceptance with no browser and no state polling after restart.
 * A scheduled reminder must be executed by server startup, not a UI request.
 * Uses temporary state and synthetic inference; never uses customer credentials.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const data = mkdtempSync(join(tmpdir(), 'bops-headless-'));
const logdir = join(root, '.scratch/app-acceptance');
mkdirSync(logdir, { recursive: true });
const token = randomBytes(32).toString('hex');
const marker = `HEADLESS_${randomBytes(8).toString('hex')}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const listen = s => new Promise((ok, bad) => { s.once('error', bad); s.listen(0, '127.0.0.1', ok); });
let inferenceRequests = 0, child, log = '';
const provider = createServer((_req, res) => { inferenceRequests++; res.writeHead(500); res.end('A reminder needs no inference.'); });
async function stop() {
  if (!child || child.exitCode !== null) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 120 && child.exitCode === null; i++) await sleep(100);
  if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} throw new Error('Headless server did not drain cleanly'); }
  assert.equal(child.exitCode, 0);
}
try {
  await listen(provider);
  const portServer = createServer(); await listen(portServer); const port = portServer.address().port;
  await new Promise(r => portServer.close(r));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, BOPS_PRIVATE_ENV_FILE: '', BOPS_PRIVATE_DATA_DIR: data, BOPS_INFERENCE_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, BOPS_INFERENCE_MODEL: 'acceptance-model', BOPS_INFERENCE_API_KEY: '', BOPS_UI_TOKEN: token, PORT: String(port), BOPS_WORKER_NETWORK: 'none' };
  for (const k of ['ORGO_API_KEY','OPENAI_API_KEY','OPENAI_EXECUTOR_API_KEY','TYPESAFE_API_KEY','HONCHO_API_KEY','COMPOSIO_API_KEY','TREG_TOKEN','AGENTMAIL_API_KEY','AGENTPHONE_API_KEY','TAILSCALE_AUTH_KEY']) env[k] = '';
  const start = async () => {
    child = spawn(process.execPath, ['private-runtime/start.mjs', 'start'], { cwd: root, env, detached: true, stdio: ['ignore','pipe','pipe'] });
    for (const pipe of [child.stdout, child.stderr]) pipe.on('data', b => { log += b.toString(); });
    for (let i = 0; ; i++) {
      if (child.exitCode !== null) throw new Error('Headless server exited before readiness');
      // This health response is at the native socket boundary; it never loads Next routes.
      try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) return; } catch {}
      if (i > 120) throw new Error('Headless server did not become ready');
      await sleep(500);
    }
  };
  const api = async (path, body) => {
    const response = await fetch(base + path, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers: { 'x-bops-window': token, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, path); return response.json();
  };
  await start();
  const state = (await api('/api/state')).state;
  const main = state.bots.find(b => b.isMain);
  const made = await api('/api/routines', { botId: main.id, title: 'Headless restart reminder', goal: 'Deliver the synthetic restart marker.', reminder: marker, schedule: { kind: 'once', at: Date.now() + 10000 } });
  const id = made.routine.id;
  await stop();
  const file = join(data, 'app/state.json');
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).routines.some(r => r.id === id && !r.last), 'Unrun routine must be saved before restart');
  await start();
  // NO HTTP/API request from here until shutdown. Observe persistence on disk only.
  let completed;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'Server must stay up unattended');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    const r = saved.routines.find(x => x.id === id);
    if (r?.last?.status === 'failed') throw new Error(`Headless reminder failed: ${r.last.error}`);
    if (r?.last?.status === 'ok') { completed = saved; break; }
    await sleep(250);
  }
  assert.ok(completed, 'Scheduled reminder must run after restart without a browser or state/API polling');
  assert.ok(completed.messages.some(m => m.text.includes(marker)), 'Reminder must be delivered into the persisted chat');
  assert.equal(completed.routines.find(r => r.id === id).enabled, false, 'Once-only reminder must finish');
  assert.equal(inferenceRequests, 0, 'A reminder must not invoke inference');
  await stop();
  const evidence = { passed: true, browserOpened: false, stateRequestsAfterRestart: 0, scheduledReminderDelivered: true, inferenceRequests, cleanShutdown: true };
  writeFileSync(join(logdir, 'headless-result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  try { await stop(); } finally {
    provider.closeAllConnections(); await new Promise(r => provider.close(r));
    writeFileSync(join(logdir, 'headless.log'), log);
    rmSync(data, { recursive: true, force: true });
  }
}
