import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setup } from '../setup.mjs';
const root = resolve(import.meta.dirname, '../..');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bops-setup-'));
  mkdirSync(join(dir, 'private-runtime'));
  writeFileSync(join(dir, 'private-runtime/private.env.example'), readFileSync(join(root, 'private-runtime/private.env.example')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('default launch/build/setup entrypoints select private mode, with explicit upstream aliases', () => {
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'))).scripts;
  for (const [name, command] of Object.entries({ setup: 'node private-runtime/setup.mjs', build: 'node private-runtime/start.mjs build', start: 'node private-runtime/start.mjs start', dev: 'node private-runtime/start.mjs dev' })) assert.equal(scripts[name], command);
  assert.equal(scripts['upstream:start'], 'next start'); assert.equal(scripts.fast, 'npm run build && npm start');
});
test('private setup creates a mode-600 template, with escaped persistent path and no key', t => {
  const dir = fixture(t); const home = join(dir, 'home with spaces');
  const result = setup({ env: {}, root: dir, home });
  assert.equal(result.created, true); assert.equal(result.destination, join(dir, '.env.private'));
  assert.equal(statSync(result.destination).mode & 0o777, 0o600);
  const text = readFileSync(result.destination, 'utf8');
  assert.ok(text.includes(`BOPS_PRIVATE_DATA_DIR=${JSON.stringify(join(home, '.local/share/ernesta-bops'))}`));
  assert.match(text, /BOPS_INFERENCE_API_KEY=\n/);
});
test('setup never overwrites existing customer credentials or changes their mode', t => {
  const dir = fixture(t), path = join(dir, '.env.private');
  writeFileSync(path, 'BOPS_INFERENCE_API_KEY=keep-my-secret\n', { mode: 0o640 });
  const before = readFileSync(path), mode = statSync(path).mode;
  const result = setup({ env: {}, root: dir });
  assert.equal(result.created, false); assert.deepEqual(readFileSync(path), before); assert.equal(statSync(path).mode, mode);
  assert.ok(!JSON.stringify(result).includes('keep-my-secret'));
});
test('setup honors explicit destination and rejects links/directories without following them', t => {
  const dir = fixture(t), file = join(dir, 'operator.env');
  assert.equal(setup({ env: { BOPS_PRIVATE_ENV_FILE: file }, root: dir }).destination, file);
  const alias = join(dir, 'linked.env'); symlinkSync(file, alias);
  assert.throws(() => setup({ env: { BOPS_PRIVATE_ENV_FILE: alias }, root: dir }));
  assert.throws(() => setup({ env: { BOPS_PRIVATE_ENV_FILE: dir }, root: dir }));
});
test('actual setup CLI keeps existing file contents out of its output', t => {
  const dir = fixture(t), file = join(dir, 'operator.env');
  const secret = 'do-not-print-this-synthetic-secret'; writeFileSync(file, secret, { mode: 0o600 });
  const text = execFileSync(process.execPath, [join(root, 'private-runtime/setup.mjs')], { cwd: dir, env: { ...process.env, BOPS_PRIVATE_ENV_FILE: file }, encoding: 'utf8' });
  assert.match(text, /kept unchanged/); assert.ok(!text.includes(secret)); assert.equal(readFileSync(file, 'utf8'), secret);
});
