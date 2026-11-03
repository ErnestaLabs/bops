/** Actual built Bops route and Chromium UI acceptance. Synthetic config, no customer actions. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '../..');
const data = mkdtempSync(join(tmpdir(), 'bops-map-'));
const logs = join(root, '.scratch/app-acceptance');
mkdirSync(logs, { recursive: true });
const token = randomBytes(32).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const listen = server => new Promise((ok, bad) => { server.once('error', bad); server.listen(0, '127.0.0.1', ok); });
let requests = 0, child, browser, output = '';
const provider = createServer((_req, res) => { requests++; res.writeHead(500); res.end('The design map needs no inference.'); });
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 120 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
  if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} throw new Error('Map acceptance server did not shut down cleanly'); }
}
try {
  await listen(provider);
  const reserve = createServer(); await listen(reserve); const port = reserve.address().port;
  await new Promise(r => reserve.close(r));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, BOPS_PRIVATE_ENV_FILE: '', BOPS_PRIVATE_DATA_DIR: data,
    BOPS_INFERENCE_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, BOPS_INFERENCE_MODEL: 'map-test',
    BOPS_INFERENCE_API_KEY: '', BOPS_UI_TOKEN: token, PORT: String(port), BOPS_WORKER_NETWORK: 'none' };
  for (const key of ['ORGO_API_KEY','OPENAI_API_KEY','OPENAI_EXECUTOR_API_KEY','TYPESAFE_API_KEY','HONCHO_API_KEY','COMPOSIO_API_KEY','TREG_TOKEN','AGENTMAIL_API_KEY','AGENTPHONE_API_KEY','TAILSCALE_AUTH_KEY']) env[key] = '';
  child = spawn(process.execPath, ['private-runtime/start.mjs', 'start'], { cwd: root, env, detached: true, stdio: ['ignore','pipe','pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output += bytes.toString(); });
  for (let i = 0; ; i++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Map server exited');
    try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch {}
    if (i > 120) throw new Error('Map server readiness timed out');
    await sleep(500);
  }
  const denied = await fetch(`${base}/workflows.html`, { redirect: 'manual' });
  assert.equal(denied.status, 303);
  assert.equal(denied.headers.get('location'), '/api/private-login');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const login = await context.request.post(`${base}/api/private-login`, { maxRedirects: 0,
    headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' }, data: new URLSearchParams({ token }).toString() });
  assert.equal(login.status(), 303);
  const page = await context.newPage(); const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(base + '/')) external.push(new URL(request.url()).origin); });
  const response = await page.goto(`${base}/workflows.html`, { waitUntil: 'load' });
  assert.equal(response.status(), 200);
  await page.getByText('DESIGN MAP · NOT LIVE TELEMETRY', { exact: true }).waitFor();
  assert.equal(await page.locator('#nav button').count(), 20);
  await page.locator('#search').fill('invoice'); assert.equal(await page.locator('#nav button').count(), 1);
  await page.locator('#nav button').click(); assert.equal(await page.locator('#title').textContent(), 'Invoice intake and review');
  await page.locator('#search').fill(''); await page.locator('#group').selectOption('Recovery');
  assert.equal(await page.locator('#nav button').count(), 3);
  await page.locator('#group').selectOption('');
  await page.locator('#uncertain').click();
  assert.ok((await page.locator('#events').textContent()).includes('Automatic resubmission refused'));
  await page.locator('#clear').click();
  await page.getByRole('button', { name: 'Website observation', exact: false }).click();
  await page.screenshot({ path: join(logs, 'workflow-control-map.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.equal(requests, 0);
  await browser.close(); browser = undefined;
  await stop(); assert.equal(child.exitCode, 0);
  const result = { passed: true, actualBuiltApplication: true, ownerAuthenticationRequired: true,
    authenticatedMapRoute: true, workflows: 20, searchAndFilters: true, failureSimulation: true,
    mobileNoOverflow: true, inferenceRequests: requests, externalBrowserRequests: external.length, cleanShutdown: true };
  writeFileSync(join(logs, 'workflow-map-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  try { await browser?.close(); await stop(); }
  finally { provider.closeAllConnections(); await new Promise(r => provider.close(r)); writeFileSync(join(logs, 'workflow-map.log'), output); rmSync(data, { recursive: true, force: true }); }
}
