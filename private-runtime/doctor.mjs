/** Operator preflight. --live makes two small inference requests and may incur
 * provider charges. --stream and --vision each add one opt-in request.
 * It uses synthetic data, executes no returned tool and stores
 * no conversation. Keys and provider response bodies are never printed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, accessSync, constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { privateClient } from './inference.mjs';
import { visionProbe } from './probes.mjs';
import { proxyTopology } from './egress/client.mjs';

export async function preflight({ env = process.env, exec = execFileSync, fetchImpl = fetch, live = false, requireWeb = false, stream = false, vision = false, root = resolve(import.meta.dirname, '..') } = {}) {
  const checks = [];
  if ((stream || vision) && !live) return { ok: false, liveProviderTestRequested: false, checks: [{ name: 'explicit live consent', ok: false, detail: '--stream and --vision require --live; no provider request was made.' }] };
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const run = args => exec('docker', args, { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
  let client;
  try { client = privateClient({ env, fetchImpl }); void client.baseURL; add('provider configuration', true, 'Explicit endpoint, compatible model identifier and required credential are present.'); }
  catch (e) { add('provider configuration', false, e.code || 'invalid_configuration'); }
  try {
    const platform = run(['info', '--format', '{{.OSType}}']).trim();
    add('Docker', platform === 'linux', platform === 'linux' ? 'Linux Docker daemon is reachable.' : 'Linux containers are required.');
  } catch { add('Docker', false, 'Docker is missing, stopped or inaccessible to this user.'); }
  try { run(['image', 'inspect', env.BOPS_WORKER_IMAGE || 'ernesta-bops-worker:private']); add('worker image', true, 'Customer-owned worker image is installed.'); }
  catch { add('worker image', false, 'Build private-runtime/worker/Dockerfile before launching.'); }
  const network = env.BOPS_WORKER_NETWORK || 'none';
  if (env.BOPS_WORKER_PROXY) {
    try { await proxyTopology(env, run); add('worker network', true, 'Healthy self-hosted proxy on an isolated internal network. Exact-host policy applies; external reachability is not yet verified.'); }
    catch { add('worker network', false, 'Private egress topology is invalid or its proxy is not healthy. No worker was provisioned.'); }
  } else if (network === 'none') add('worker network', !requireWeb, 'Workers are offline. Web tasks require an owner-approved egress-controlled Docker network.');
  else if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(network) || ['host', 'container'].includes(network)) add('worker network', false, 'Host/shared-container networking is forbidden.');
  else {
    try {
      const info = JSON.parse(run(['network', 'inspect', network]))[0];
      const allowed = info && info.Driver !== 'host' && info.Driver !== 'null';
      add('worker network', !!allowed && !(requireWeb && info.Internal), info?.Internal ? 'Internal-only network; internet access is not available.' : 'Network exists. This does not certify its firewall or internet connectivity.');
    } catch { add('worker network', false, 'Configured Docker network is missing or inaccessible.'); }
  }
  const port = Number(env.PORT || 3210);
  add('port configuration', Number.isInteger(port) && port >= 1024 && port <= 65535, 'Private listener binds to loopback only.');
  try {
    let path = resolve(env.BOPS_PRIVATE_DATA_DIR || `${root}/.data/private-runtime`);
    while (!existsSync(path) && dirname(path) !== path) path = dirname(path);
    accessSync(path, constants.W_OK);
    add('data directory', true, 'Existing directory or parent is writable; no data was modified.');
  } catch { add('data directory', false, 'Customer data directory is not writable.'); }
  add('application dependencies', existsSync(`${root}/node_modules/next/dist/bin/next`), 'Run npm ci on the customer server.');
  if (live && checks.find(c => c.name === 'provider configuration')?.ok) {
    const marker = randomBytes(8).toString('hex');
    try {
      const text = await client.responses.create({ input: `Reply with exactly ${marker}`, store: false, max_output_tokens: 128 }, { timeout: 45000 });
      add('live provider text', text.output_text.trim() === marker, 'Synthetic text response checked; no customer data or conversation history sent.');
      const result = await client.responses.create({ input: `Call echo_marker with marker ${marker}. Do not write a message.`, store: false, max_output_tokens: 256,
        tools: [{ type: 'function', name: 'echo_marker', description: 'Return the given test marker; no external action.', parameters: { type: 'object', properties: { marker: { type: 'string' } }, required: ['marker'], additionalProperties: false } }],
        tool_choice: { type: 'function', name: 'echo_marker' } }, { timeout: 45000 });
      const calls = result.output.filter(x => x.type === 'function_call');
      add('live provider tools', calls.length === 1 && calls[0].name === 'echo_marker' && JSON.parse(calls[0].arguments).marker === marker, 'Tool-call contract checked. No tool was executed. Vision is not tested.');
    } catch (e) { add('live provider', false, e.code || 'live_check_failed'); }
  }
  if (live && stream && checks.find(c => c.name === 'provider configuration')?.ok) {
    if (env.BOPS_INFERENCE_STREAM === '0') add('live provider stream', false, 'Streaming is explicitly disabled. Buffered output cannot certify SSE support.');
    else try {
      const marker = randomBytes(8).toString('hex'); let text = '', final, deltas = 0;
      const events = await client.responses.create({ input: `Reply with exactly ${marker}`, store: false, stream: true, max_output_tokens: 128 }, { timeout: 45000 });
      for await (const event of events) {
        if (event.type === 'response.output_text.delta') { text += event.delta; deltas++; }
        if (event.type === 'response.completed') final = event.response;
      }
      add('live provider stream', deltas > 0 && text.trim() === marker && final?.output_text.trim() === marker, 'SSE text and terminal framing checked. This is not a latency benchmark; no response was persisted.');
    } catch (e) { add('live provider stream', false, e.code || 'stream_check_failed'); }
  }
  if (live && vision && checks.find(c => c.name === 'provider configuration')?.ok) {
    try {
      const probe = visionProbe();
      const result = await client.responses.create({ input: probe.input, store: false, max_output_tokens: 256 }, { timeout: 45000 });
      let observed;
      try { observed = JSON.parse(result.output_text.trim()); } catch { /* Mismatched output fails the probe without printing it. */ }
      add('live provider vision', Array.isArray(observed) && JSON.stringify(observed) === JSON.stringify(probe.expected), 'Randomized synthetic color-grid recognition checked. No desktop/customer image sent. Passing does not certify reliable computer operation.');
    } catch (e) { add('live provider vision', false, e.code || 'vision_check_failed'); }
  }
  return { ok: checks.every(c => c.ok), liveProviderTestRequested: live, streamProbeRequested: stream, visionProbeRequested: vision, checks };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const allowed = new Set(['--live', '--stream', '--vision', '--require-web']);
    if (process.argv.slice(2).some(arg => !allowed.has(arg))) throw new Error('Unknown preflight option.');
    if (process.env.BOPS_PRIVATE_ENV_FILE) process.loadEnvFile(resolve(process.env.BOPS_PRIVATE_ENV_FILE));
    const report = await preflight({ live: process.argv.includes('--live'), requireWeb: process.argv.includes('--require-web'), stream: process.argv.includes('--stream'), vision: process.argv.includes('--vision') });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch { console.error('Preflight failed. Check the environment file path, permissions and options (--live, --stream, --vision, --require-web). No secrets were printed.'); process.exitCode = 1; }
}
