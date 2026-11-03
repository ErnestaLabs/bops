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

test('stream and vision checks require explicit live consent, with no provider requests', async t => {
  const options = setup(t); let requests = 0;
  for (const extra of [{ stream: true }, { vision: true }]) {
    const result = await preflight({ ...options, ...extra, fetchImpl: async () => { requests++; throw new Error('must not call'); } });
    assert.equal(result.ok, false); assert.equal(result.liveProviderTestRequested, false);
  }
  assert.equal(requests, 0);
});
function textOrTool(body) {
  const marker = body.messages[0].content.match(/[a-f0-9]{16}/)[0];
  return Response.json({ choices: [{ finish_reason: body.tools ? 'tool_calls' : 'stop', message: body.tools ? { role: 'assistant', content: null, tool_calls: [{ id: 'probe', type: 'function', function: { name: 'echo_marker', arguments: JSON.stringify({ marker }) } }] } : { role: 'assistant', content: marker } }] });
}
test('live SSE probe uses real streaming framing and does not store history', async t => {
  const options = setup(t); let requests = 0;
  options.env.BOPS_PRIVATE_DATA_DIR = join(options.root, 'private-data-must-not-exist');
  const fetchImpl = async (_url, request) => {
    requests++; const body = JSON.parse(request.body);
    if (!body.stream) return textOrTool(body);
    const marker = body.messages[0].content.match(/[a-f0-9]{16}/)[0];
    const text = 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: marker }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
    return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const result = await preflight({ ...options, live: true, stream: true, fetchImpl });
  assert.equal(result.ok, true); assert.equal(requests, 3);
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(options.env.BOPS_PRIVATE_DATA_DIR), false);
});
test('buffered configuration cannot pass a live SSE probe', async t => {
  const options = setup(t); options.env.BOPS_INFERENCE_STREAM = '0'; let requests = 0;
  const result = await preflight({ ...options, live: true, stream: true, fetchImpl: async (_url, request) => { requests++; return textOrTool(JSON.parse(request.body)); } });
  assert.equal(result.ok, false); assert.equal(requests, 2);
  assert.equal(result.checks.find(x => x.name === 'live provider stream').ok, false);
});
test('vision probe checks actual randomized image cells and never sends customer data', async t => {
  const options = setup(t); let requests = 0;
  const { inflateSync } = await import('node:zlib');
  const expectedRGB = { '255,0,0': 'red', '0,170,0': 'green', '0,0,255': 'blue', '255,255,0': 'yellow', '0,0,0': 'black', '255,255,255': 'white' };
  const fetchImpl = async (_url, request) => {
    requests++; const body = JSON.parse(request.body);
    if (!Array.isArray(body.messages[0].content)) return textOrTool(body);
    assert.equal(body.tools, undefined);
    const parts = body.messages[0].content;
    assert.match(parts[1].image_url.url, /^data:image\/png;base64,/);
    const png = Buffer.from(parts[1].image_url.url.split(',')[1], 'base64');
    assert.equal(png.toString().includes(options.env.BOPS_INFERENCE_API_KEY), false);
    const size = png.readUInt32BE(33); // Single IDAT after IHDR.
    assert.equal(png.subarray(37, 41).toString(), 'IDAT');
    const pixels = inflateSync(png.subarray(41, 41 + size));
    const colors = [0, 1, 2, 3, 4, 5].map(i => {
      const x = (i % 3) * 120 + 60, y = Math.floor(i / 3) * 120 + 60;
      const at = y * (360 * 3 + 1) + 1 + x * 3;
      return expectedRGB[[...pixels.subarray(at, at + 3)].join(',')];
    });
    assert.equal(new Set(colors).size, 6);
    // The expected order exists only in pixels, not in the question text.
    assert.ok(!parts[0].text.includes(JSON.stringify(colors)));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(colors) } }] });
  };
  const result = await preflight({ ...options, live: true, vision: true, fetchImpl });
  assert.equal(result.ok, true); assert.equal(requests, 3);
});
test('provider accepts an image but answers incorrectly: vision readiness fails', async t => {
  const options = setup(t);
  const result = await preflight({ ...options, live: true, vision: true, fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body);
    return Array.isArray(body.messages[0].content) ? Response.json({ choices: [{ finish_reason: 'stop', message: { content: '["wrong"]' } }] }) : textOrTool(body);
  } });
  assert.equal(result.ok, false); assert.equal(result.checks.find(x => x.name === 'live provider vision').ok, false);
});
test('optional probe failures remain separate and do not reveal provider bodies', async t => {
  const options = setup(t);
  const result = await preflight({ ...options, live: true, stream: true, vision: true, fetchImpl: async () => new Response('SECRET_PROVIDER_DETAILS', { status: 503 }) });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes('SECRET_PROVIDER_DETAILS'), false);
  assert.equal(result.checks.filter(x => x.name.startsWith('live provider') && !x.ok).length, 3);
});
