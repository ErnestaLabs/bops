import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preflight } from '../doctor.mjs';
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'bops-doctor-'));
  mkdirSync(join(root, 'node_modules/next/dist/bin'), { recursive: true });
  writeFileSync(join(root, 'node_modules/next/dist/bin/next'), 'fixture');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { BOPS_INFERENCE_BASE_URL: 'https://model.example/v1', BOPS_INFERENCE_MODEL: 'test-model', BOPS_INFERENCE_API_KEY: 'secret-never-output' };
  const exec = (_binary, args) => args[0] === 'info' ? 'linux\n' : args[0] === 'network' ? '[{"Driver":"bridge","Internal":false}]' : '[]';
  return { root, env, exec };
}
test('offline preflight validates configuration without contacting inference or revealing keys', async t => {
  const options = setup(t);
  const result = await preflight({ ...options, fetchImpl: () => { throw new Error('Network must not be used'); } });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes(options.env.BOPS_INFERENCE_API_KEY), false);
});
test('web readiness cannot pass with offline or host networking', async t => {
  const options = setup(t);
  assert.equal((await preflight({ ...options, requireWeb: true })).ok, false);
  options.env.BOPS_WORKER_NETWORK = 'host';
  assert.equal((await preflight(options)).ok, false);
  options.env.BOPS_WORKER_NETWORK = 'customer-egress';
  assert.equal((await preflight({ ...options, requireWeb: true })).ok, true);
});
test('missing Docker and a blocked model are reported without raw error details', async t => {
  const options = setup(t);
  options.env.BOPS_INFERENCE_MODEL = 'gpt-forbidden';
  const result = await preflight({ ...options, exec: () => { throw new Error(options.env.BOPS_INFERENCE_API_KEY); } });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(options.env.BOPS_INFERENCE_API_KEY), false);
});
test('live preflight tests text and a harmless tool call without persisting or executing tools', async t => {
  const options = setup(t); let count = 0;
  const fetchImpl = async (_url, req) => {
    count++;
    const body = JSON.parse(req.body);
    const marker = body.messages[0].content.match(/[a-f0-9]{16}/)[0];
    const message = body.tools ? { role: 'assistant', content: null, tool_calls: [{ id: 'probe', type: 'function', function: { name: 'echo_marker', arguments: JSON.stringify({ marker }) } }] } : { role: 'assistant', content: marker };
    return Response.json({ choices: [{ finish_reason: body.tools ? 'tool_calls' : 'stop', message }] });
  };
  const result = await preflight({ ...options, live: true, fetchImpl });
  assert.equal(count, 2); assert.equal(result.ok, true);
});
