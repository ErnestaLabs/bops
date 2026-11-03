/** Real Docker/Chromium web acceptance. The only external page contacted is the
 * explicitly allowlisted https://example.com fixture. No model or service key.
 * A fresh Compose project owns every resource this script creates or removes.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dockerComputer } from './computer.mjs';
import { proxyTopology, WORKER_PROXY } from './egress/client.mjs';
const project = `egress-test-${randomBytes(8).toString('hex')}`;
const network = `${project}-workers`;
const root = resolve(import.meta.dirname, '..');
const env = { ...process.env, BOPS_EGRESS_NETWORK: network, BOPS_EGRESS_ALLOW_HOSTS: 'example.com',
  BOPS_WORKER_NETWORK: network, BOPS_WORKER_PROXY: WORKER_PROXY, BOPS_PRIVATE_INSTALL_ID: project };
const docker = args => execFileSync('docker', args, { cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
const compose = args => docker(['compose', '-p', project, '-f', 'private-runtime/egress/compose.yaml', ...args]);
const runtime = dockerComputer({ env });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id, started = false;
try {
  // Set started before invocation so a partially failed start is cleaned up too.
  started = true; compose(['up', '-d', '--build', '--wait', '--wait-timeout', '60']);
  const topology = await proxyTopology(env, docker);
  const c = await runtime.api.create('Approved website acceptance'); id = c.id;
  const deadline = Date.now() + 120000;
  while ((await runtime.api.computer(id)).status !== 'running') {
    if (Date.now() > deadline) throw new Error('Web worker did not become healthy');
    await sleep(500);
  }
  const shell = async command => runtime.api.bash(id, command, 30);
  const page = await shell('curl -fsS --max-time 20 https://example.com');
  assert.equal(page.exit_code, 0, 'Approved HTTPS page must be reachable through the proxy');
  assert.match(page.output, /Example Domain/);
  const denied = await shell("curl -sS --max-time 10 -o /dev/null -w '%{http_code}' http://example.org");
  assert.equal(denied.output.trim(), '403', 'An unapproved hostname must be denied');
  const metadata = await shell("curl -sS --max-time 10 -o /dev/null -w '%{http_code}' http://169.254.169.254/latest/meta-data");
  assert.equal(metadata.output.trim(), '403', 'Cloud metadata must be denied');
  const [publicAddress] = await resolve4('example.com');
  assert.match(publicAddress, /^[0-9.]+$/);
  const bypass = await shell(`curl -fsS --noproxy '*' --resolve example.com:443:${publicAddress} --max-time 5 https://example.com`);
  assert.notEqual(bypass.exit_code, 0, 'Unset/ignored proxy variables must not enable direct internet traffic');
  const dns = await shell(`node -e "const d=require('node:dns');d.setServers(['127.0.0.11']);const t=setTimeout(()=>process.exit(0),3000);d.resolve4('example.com',(e)=>{clearTimeout(t);process.exit(e?0:1)})"`);
  assert.equal(dns.exit_code, 0, 'Worker DNS must not forward public names through the embedded resolver');
  const configuration = JSON.parse(docker(['inspect', id]))[0];
  assert.deepEqual(Object.keys(configuration.NetworkSettings.Networks), [network]);
  assert.deepEqual(configuration.HostConfig.Dns, ['127.0.0.1']);
  assert.equal(configuration.HostConfig.CapDrop.includes('ALL'), true);
  await runtime.api.key(id, 'screen-99', 'ctrl+l');
  await runtime.api.type(id, 'screen-99', 'https://example.com');
  await runtime.api.key(id, 'screen-99', 'Return');
  let navigated = false;
  for (let i = 0; i < 80; i++) {
    const tabs = await shell('curl -fsS --max-time 3 http://127.0.0.1:9299/json/list');
    if (tabs.exit_code === 0 && JSON.parse(tabs.output).some(p => p.title === 'Example Domain' && p.url.startsWith('https://example.com'))) { navigated = true; break; }
    await sleep(500);
  }
  assert.ok(navigated, 'The existing visible Chromium must use the configured self-hosted proxy');
  const dir = resolve(root, '.scratch/app-acceptance'); mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'private-web-browser.png'), Buffer.from(await runtime.api.screenshot(id, 'screen-99', 1, 'png')));
  // Losing the proxy must fail closed, not switch to unrestricted connectivity.
  docker(['stop', topology.proxyId]);
  const unavailable = await shell('curl -fsS --max-time 5 https://example.com');
  assert.notEqual(unavailable.exit_code, 0, 'No direct fallback is allowed if the proxy stops');
  const evidence = { passed: true, publicPage: 'https://example.com', realBrowser: true, exactHostAllowlist: true,
    metadataDenied: true, directInternetBypassDenied: true, workerPublicDNSDenied: true, proxyFailureClosed: true, modelRequests: 0 };
  writeFileSync(resolve(dir, 'egress-result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  if (id) { await runtime.api.remove(id); docker(['volume', 'rm', `${id}-work`, `${id}-home`]); }
  if (started) compose(['down', '--remove-orphans']);
}
