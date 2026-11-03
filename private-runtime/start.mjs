/** Authenticated loopback deployment; expose through an owner-controlled SSH tunnel. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { endpoint } from './inference.mjs';
import { renderWorkflowMap } from './workflows/render.mjs';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Load operator configuration before resolving storage or creating any files.
if (process.env.BOPS_PRIVATE_ENV_FILE) process.loadEnvFile(resolve(process.env.BOPS_PRIVATE_ENV_FILE));
const mode = process.argv[2] || 'start';
if (!['start', 'dev', 'build'].includes(mode)) throw new Error('Use start, dev or build.');
// Static operating map; generated only during build/dev, never from customer data.
if (mode !== 'start') renderWorkflowMap();
// Next imports routes in multiple build workers. They must never read or migrate
// an existing customer's state, vault, browser profiles or conversation history.
const buildDir = mode === 'build' ? mkdtempSync(join(tmpdir(), 'bops-private-build-')) : null;
if (buildDir) process.once('exit', () => rmSync(buildDir, { recursive: true, force: true }));
const dir = buildDir || resolve(process.env.BOPS_PRIVATE_DATA_DIR || join(root, '.data/private-runtime'));
mkdirSync(dir, { recursive: true, mode: 0o700 });
const secret = (name, bytes) => {
  const path = join(dir, name);
  try { return readFileSync(path, 'utf8').trim(); }
  catch (e) { if (e.code !== 'ENOENT') throw e; const value = randomBytes(bytes).toString('hex'); writeFileSync(path, value, { flag: 'wx', mode: 0o600 }); return value; }
};
// Read operator configuration without ever printing credentials.
endpoint(process.env.BOPS_INFERENCE_BASE_URL);
if (!process.env.BOPS_INFERENCE_MODEL?.trim()) throw new Error('Set BOPS_INFERENCE_MODEL.');
if (!process.env.BOPS_INFERENCE_API_KEY?.trim() && !['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.BOPS_INFERENCE_BASE_URL).hostname)) throw new Error('Set BOPS_INFERENCE_API_KEY.');
const env = { ...process.env,
  BOPS_PRIVATE_RUNTIME: '1', BOPS_SELF_HOSTED: '1', BOPS_PRIVATE_AUTH: 'loopback',
  BOPS_PRIVATE_BUILD: mode === 'build' ? '1' : '0', NEXT_MANUAL_SIG_HANDLE: '1',
  BOPS_PRIVATE_DATA_DIR: dir, BOPS_PRIVATE_INSTALL_ID: process.env.BOPS_PRIVATE_INSTALL_ID || secret('install-id', 16),
  BOPS_UI_TOKEN: !buildDir && process.env.BOPS_UI_TOKEN || secret('ui-token', 32),
  BOPS_VAULT_KEY: !buildDir && process.env.BOPS_VAULT_KEY || secret('vault-key', 32),
  BOPS_COMPUTER_TOOL: '1', BOPS_SPEED: 'standard', BOPS_TELEMETRY: '0',
  DO_NOT_TRACK: '1', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_BOPS_BRAINS: '0',
  BOPS_RESPONSES_WS: '0', BOPS_WEBRTC: '0', BOPS_SCREEN_STREAM: '0',
  // Empty strings also stop Next's dotenv loader from restoring legacy credentials.
  OPENAI_API_KEY: '', OPENAI_EXECUTOR_API_KEY: '', ORGO_API_KEY: '',
  BOPS_DATABASE_URL: '', BOPS_CLOUD_URL: '', BOPS_PUBLIC_HOST: '',
  BOPS_RUNNER: '0', TAILSCALE_AUTH_KEY: '',
};
const policy = pathToFileURL(join(root, 'private-runtime/network-policy.mjs')).href;
const args = mode === 'build'
  ? ['--import', policy, join(root, 'node_modules/next/dist/bin/next'), 'build']
  : ['--import', policy, join(root, 'private-runtime/server.mjs'), ...(mode === 'dev' ? ['--dev'] : [])];
env.NODE_ENV = mode === 'dev' ? 'development' : 'production';
if (buildDir) console.log('Private build: isolated temporary storage; customer data is not loaded.');
else {
  console.log(`Private ${mode}: no Orgo/OpenAI services. Login at http://127.0.0.1:${Number(process.env.PORT) || 3210}/api/private-login`);
  console.log(process.env.BOPS_UI_TOKEN ? 'Owner login token supplied by the operator environment (never share it in chat).' : `Owner login token file: ${join(dir, 'ui-token')} (never share it in chat)`);
}
const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
