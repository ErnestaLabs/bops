/** Real Docker acceptance test. No hosted inference or paid credentials. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dockerComputer } from './computer.mjs';
const runtime = dockerComputer({ env: { ...process.env, BOPS_PRIVATE_INSTALL_ID: `smoke-${randomBytes(8).toString('hex')}`, BOPS_WORKER_NETWORK: 'none' } });
let id;
try {
  const c = await runtime.api.create('Docker acceptance'); id = c.id;
  const deadline = Date.now() + 120000;
  while ((await runtime.api.computer(id)).status !== 'running') {
    if (Date.now() > deadline) throw new Error('Worker did not become healthy');
    await new Promise(r => setTimeout(r, 1000));
  }
  assert.equal((await runtime.api.screens(id)).length, 4);
  const shell = await runtime.api.bash(id, 'printf private-runtime-ok', 5);
  assert.equal(shell.exit_code, 0); assert.equal(shell.output, 'private-runtime-ok');
  const agentDesktop = await runtime.api.bash(id, 'agent-desktop version', 10);
  assert.equal(agentDesktop.exit_code, 0); assert.match(agentDesktop.output, /1\.1\.0/);
  const html = Buffer.from('<!doctype html><title>Ernesta Docker acceptance</title><h1>Private worker test</h1>').toString('base64');
  const setup = await runtime.api.bash(id, `mkdir -p /workspace/acceptance; echo ${html} | base64 -d > /workspace/acceptance/index.html; cd /workspace/acceptance; nohup python3 -m http.server 8800 --bind 127.0.0.1 >/tmp/acceptance-http.log 2>&1 </dev/null &`, 10);
  assert.equal(setup.exit_code, 0);
  await runtime.api.key(id, 'screen-99', 'ctrl+l');
  await runtime.api.type(id, 'screen-99', 'http://127.0.0.1:8800');
  await runtime.api.key(id, 'screen-99', 'Return');
  let navigated = false;
  for (let i = 0; i < 40; i++) {
    const r = await runtime.api.bash(id, 'curl -fsS http://127.0.0.1:9299/json/list', 5);
    if (r.exit_code === 0 && JSON.parse(r.output).some(p => p.title === 'Ernesta Docker acceptance')) { navigated = true; break; }
    await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(navigated, 'Keyboard input must navigate the same visible Chromium');
  const png = Buffer.from(await runtime.api.screenshot(id, 'screen-99', 1, 'png'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1280); assert.equal(png.readUInt32BE(20), 960);
  console.log(JSON.stringify({ passed: true, screens: 4, shell: true, agentDesktop: '1.1.0', keyboardNavigation: true, screenshot: [1280,960] }));
} finally {
  if (id) {
    await runtime.api.remove(id);
    // These are exclusively this test's freshly-created volumes, not customer data.
    execFileSync('docker', ['volume', 'rm', `${id}-work`, `${id}-home`], { stdio: 'inherit' });
  }
}
