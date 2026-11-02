/** Customer-owned Docker computer provider. Host execution is limited to Docker argv.
 * Model-generated commands run ONLY inside labelled containers, never on the host.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const ID = /^ernesta-[a-f0-9]{24}$/;
const DISPLAYS = [99, 100, 101, 102];
export class ComputerError extends Error {
  constructor(message, code = 'computer_error', status = 500) { super(message); this.name = 'ComputerError'; this.code = code; this.status = status; }
}
const fail = (message, code, status) => { throw new ComputerError(message, code, status); };
export function workerId(value) { if (typeof value !== 'string' || !ID.test(value)) fail('Invalid private computer ID.', 'invalid_computer', 400); return value; }
export function displayOf(value) { const n = Number(String(value).replace(/^screen-/, '').replace(/^:/, '')); if (!DISPLAYS.includes(n)) fail('Invalid screen.', 'invalid_screen', 400); return n; }
function number(value, fallback, min, max, name) { const n = value === undefined || value === '' ? fallback : Number(value); if (!Number.isFinite(n) || n < min || n > max) fail(`Invalid ${name}.`, 'invalid_configuration', 503); return n; }
function run(args, { timeout = 30000, signal, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout, signal, maxBuffer: 12 * 1024 * 1024, encoding: binary ? 'buffer' : 'utf8' }, (error, stdout, stderr) => {
      if (error) { error.stdout = stdout; error.stderr = stderr; return reject(error); }
      resolve(stdout);
    });
  });
}
export function dockerComputer({ env = process.env, exec = run } = {}) {
  const install = () => {
    const v = env.BOPS_PRIVATE_INSTALL_ID;
    if (!v || !/^[a-z0-9][a-z0-9-]{7,63}$/.test(v)) fail('Set a stable BOPS_PRIVATE_INSTALL_ID (8-64 lowercase letters/digits/hyphens).', 'invalid_configuration', 503);
    return v;
  };
  const label = () => `ernesta.install=${install()}`;
  const made = new Set(); let changes = 0;
  async function inspect(id) {
    workerId(id);
    let j;
    try { j = JSON.parse(String(await exec(['inspect', '--type', 'container', id])))[0]; }
    catch (e) { if (String(e.stderr ?? '').includes('No such')) fail('Private computer not found.', 'computer_not_found', 404); throw e; }
    if (j?.Config?.Labels?.['ernesta.install'] !== install() || j.Config.Labels['ernesta.managed'] !== 'true') fail('This deployment does not own that computer.', 'foreign_computer', 403);
    return j;
  }
  async function inside(id, args, options = {}) { await inspect(id); return exec(['exec', id, ...args], options); }
  const screenRows = text => JSON.parse(String(text)).map(n => ({ id: `screen-${n}`, display: `:${n}`, width: 1280, height: 960, default: n === 99, vnc_port: null, ws_port: null }));
  const api = {
    async create(name, { wsId = 'main', ram } = {}) {
      const image = env.BOPS_WORKER_IMAGE || 'ernesta-bops-worker:private';
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image)) fail('Invalid worker image.', 'invalid_configuration', 503);
      const network = env.BOPS_WORKER_NETWORK || 'none';
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(network) || ['host', 'container'].includes(network)) fail('Host/shared-container networking is forbidden.', 'invalid_configuration', 503);
      const cpus = number(env.BOPS_WORKER_CPUS, 2, 0.5, 16, 'CPU limit');
      const memory = number(env.BOPS_WORKER_MEMORY_GB ?? ram, 4, 1, 64, 'memory limit');
      const id = `ernesta-${randomBytes(12).toString('hex')}`;
      await exec(['run', '-d', '--name', id, '--label', 'ernesta.managed=true', '--label', label(), '--label', `ernesta.workspace=${String(wsId).slice(0, 100)}`, '--label', `ernesta.name=${String(name).slice(0, 100)}`,
        '--network', network, '--cpus', String(cpus), '--memory', `${memory}g`, '--memory-swap', `${memory}g`, '--pids-limit', '512', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--init', '--shm-size', '512m',
        '--mount', `type=volume,src=${id}-work,dst=/workspace`, '--mount', `type=volume,src=${id}-home,dst=/root`, image], { timeout: 180000 });
      made.add(id); changes++;
      return { id, name: String(name), status: 'starting' };
    },
    async computer(id) { const j = await inspect(id); return { id, name: j.Config.Labels['ernesta.name'] || id, status: j.State.Running ? (j.State.Health && j.State.Health.Status !== 'healthy' ? 'starting' : 'running') : 'suspended', cpu: (j.HostConfig.NanoCpus || 0) / 1e9, ram: (j.HostConfig.Memory || 0) / 1024 ** 3, os: 'linux' }; },
    async bopsComputers() {
      const ids = String(await exec(['ps', '-a', '--filter', 'label=ernesta.managed=true', '--filter', `label=${label()}`, '--format', '{{.Names}}'])).trim().split('\n').filter(Boolean);
      return Promise.all(ids.map(async id => { const c = await api.computer(id); return { id: c.id, name: c.name }; }));
    },
    async remove(id) { await inspect(id); await exec(['rm', '-f', id]); made.delete(id); changes++; /* Named data volumes deliberately survive. */ },
    async resume(id) { await inspect(id); await exec(['start', id]); return { waking: true }; },
    async bash(id, command, timeout = 60, { signal } = {}) {
      if (typeof command !== 'string' || command.length > 262144) fail('Invalid worker command.', 'invalid_command', 400);
      const seconds = Math.ceil(number(timeout, 60, 1, 300, 'command timeout'));
      try { return { output: String(await inside(id, ['timeout', '-k', '2s', `${seconds}s`, '/bin/bash', '-lc', command], { timeout: (seconds + 10) * 1000, signal })), exit_code: 0 }; }
      catch (e) {
        if (signal?.aborted) throw signal.reason;
        if (typeof e.code === 'number') return { output: `${e.stdout ?? ''}${e.stderr ?? ''}`, exit_code: e.code };
        // Connection loss is not a command failure: it may have run. Never auto-retry.
        throw new ComputerError('Worker command outcome unknown; check before repeating.', 'command_outcome_unknown', 502);
      }
    },
    async screens(id) { return screenRows(await inside(id, ['python3', '/opt/private/display.py', 'list'])); },
    async createScreen(id) { const n = Number(String(await inside(id, ['python3', '/opt/private/display.py', 'create'])).trim()); displayOf(n); return screenRows(JSON.stringify([n]))[0]; },
    async destroyScreen(id, screen) { const n = displayOf(screen); if (n === 99) fail('The main screen cannot be removed.', 'main_screen', 409); await inside(id, ['python3', '/opt/private/display.py', 'remove', String(n)]); },
    async screenshot(id, screen, scale = 0.75, format = 'jpeg', { signal } = {}) {
      const n = displayOf(screen), s = number(scale, 0.75, 0.1, 1, 'screenshot scale');
      if (!['jpeg', 'png'].includes(format)) fail('Invalid screenshot format.', 'invalid_format', 400);
      const bytes = await inside(id, ['python3', '/opt/private/display.py', 'screenshot', String(n), String(s), format], { timeout: 20000, signal, binary: true });
      return new Uint8Array(bytes);
    },
    async click(id, screen, x, y, double = false) {
      const n = displayOf(screen); for (const [v, max] of [[x, 1279], [y, 959]]) if (!Number.isFinite(v) || v < 0 || v > max) fail('Coordinates outside screen.', 'invalid_coordinates', 400);
      await inside(id, ['env', `DISPLAY=:${n}`, 'xdotool', 'mousemove', '--sync', String(Math.round(x)), String(Math.round(y)), 'click', '--repeat', double ? '2' : '1', '--delay', '100', '1']);
    },
    async type(id, screen, text) { if (typeof text !== 'string' || text.length > 65536) fail('Invalid typed text.', 'invalid_text', 400); await inside(id, ['env', `DISPLAY=:${displayOf(screen)}`, 'xdotool', 'type', '--clearmodifiers', '--', text]); },
    async key(id, screen, key) { if (typeof key !== 'string' || !/^[a-zA-Z0-9_+ -]{1,100}$/.test(key) || key.startsWith('-')) fail('Invalid key.', 'invalid_key', 400); await inside(id, ['env', `DISPLAY=:${displayOf(screen)}`, 'xdotool', 'key', '--clearmodifiers', '--', key]); },
    async growDisk(id) { await inspect(id); /* Docker volumes use host capacity; no paid disk-resize API. */ },
    async webrtc(id) { await inspect(id); return false; },
    async streamInfo(id) { await inspect(id); fail('Private live VNC transport is not configured; use screenshot view.', 'unsupported_capability', 501); },
    async screenShrunk(id) { await inspect(id); fail('Private screens have a fixed resolution.', 'unsupported_capability', 501); },
    async fork(id) { await inspect(id); fail('Memory forks are unsupported. Provision a fresh computer.', 'NOT_FORKABLE', 409); },
    async clone(id) { await inspect(id); fail('Cloning browser credentials is not enabled. Provision a fresh computer.', 'unsupported_capability', 501); },
  };
  return { api, inspect, madeByThisServer: id => made.has(id), madeReady: id => made.delete(id), computerChanges: () => changes };
}
