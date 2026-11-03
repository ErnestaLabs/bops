import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { privateClient } from '../inference.mjs';
import { completionDeltas } from '../stream.mjs';
const encoder = new TextEncoder();
const chunk = (delta = {}, finish_reason = null) => ({ choices: [{ index: 0, delta, finish_reason }] });
const event = value => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`;
function response(text, size = 17, onCancel = () => {}) {
  const bytes = encoder.encode(text); let at = 0;
  return new Response(new ReadableStream({
    pull(c) { if (at === bytes.length) return c.close(); c.enqueue(bytes.slice(at, at + size)); at = Math.min(at + size, bytes.length); },
    cancel: onCancel,
  }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}
function fixture(t, fetchImpl) {
  const dir = mkdtempSync(join(tmpdir(), 'bops-stream-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { BOPS_INFERENCE_BASE_URL: 'http://127.0.0.1:1234/v1', BOPS_INFERENCE_MODEL: 'test', BOPS_PRIVATE_DATA_DIR: dir };
  return { env, dir, client: privateClient({ env, fetchImpl }) };
}
const collect = async stream => { const out = []; for await (const x of stream) out.push(x); return out; };

test('SSE handles byte-split UTF-8, comments, multiline data, CRLF and usage-only final chunks', async () => {
  const text = ': keepalive\r\n\r\n' + 'event: message\r\ndata: {"choices":\r\ndata: [{"index":0,"delta":{"content":"Ciao 🌍"},"finish_reason":null}]}\r\n\r\n' + event(chunk({}, 'stop')).replaceAll('\n', '\r') + event({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }) + event('[DONE]');
  const got = await collect(completionDeltas(response(text, 1)));
  assert.equal(got[0].text, 'Ciao 🌍');
  assert.equal(got.at(-1).result.usage.total_tokens, 3);
});
test('actual stream request sends true and releases text before provider completion', async t => {
  let control, sent;
  const stream = new ReadableStream({ start(c) { control = c; } });
  const { client, dir } = fixture(t, async (_url, options) => { sent = JSON.parse(options.body); return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }); });
  const iterator = await client.responses.create({ input: 'hello', stream: true });
  assert.equal(sent.stream, true); assert.equal(sent.stream_options.include_usage, true);
  const created = await iterator.next(); const id = created.value.response.id;
  control.enqueue(encoder.encode(event(chunk({ content: 'First' }))));
  assert.equal((await iterator.next()).value.type, 'response.output_item.added');
  assert.equal((await iterator.next()).value.type, 'response.content_part.added');
  const first = await iterator.next(); assert.equal(first.value.delta, 'First');
  assert.deepEqual(readdirSync(dir), [], 'No incomplete response may be persisted');
  control.enqueue(encoder.encode(event(chunk({ content: ' second' }, 'stop')) + event('[DONE]')));
  const rest = await collect(iterator);
  assert.equal(rest.at(-1).response.id, id);
  assert.equal(rest.at(-1).response.output_text, 'First second');
  assert.equal((await client.responses.retrieve(id)).output_text, 'First second');
  const all = [created.value, first.value, ...rest];
  assert.ok(all.every(x => Number.isInteger(x.sequence_number)));
});
test('fragmented tool calls are emitted only after complete JSON and terminal framing', async t => {
  let control;
  const stream = new ReadableStream({ start(c) { control = c; } });
  const { client, dir } = fixture(t, async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
  const iterator = await client.responses.create({ input: 'read', stream: true, tools: [{ type: 'function', name: 'read_file' }] });
  await iterator.next();
  control.enqueue(encoder.encode(event(chunk({ tool_calls: [{ index: 0, id: 'call1', type: 'function', function: { name: 'read_', arguments: '{"path":' } }] }))));
  let yielded = false; const next = iterator.next().then(x => { yielded = true; return x; });
  await new Promise(r => setImmediate(r)); assert.equal(yielded, false); assert.deepEqual(readdirSync(dir), []);
  control.enqueue(encoder.encode(event(chunk({ tool_calls: [{ index: 0, function: { name: 'file', arguments: '"/tmp/a"}' } }] }, 'tool_calls')) + event('[DONE]')));
  const item = (await next).value.item; assert.equal(item.name, 'read_file'); assert.equal(JSON.parse(item.arguments).path, '/tmp/a');
  const rest = await collect(iterator); assert.equal(rest.at(-1).type, 'response.completed');
});
test('unknown, duplicate and malformed streamed calls fail before exposing any tool item', async t => {
  for (const parts of [
    [{ index: 0, id: 'x', function: { name: 'delete_everything', arguments: '{}' } }],
    [{ index: 0, id: 'x', function: { name: 'read_file', arguments: '{' } }],
    [{ index: 0, id: 'x', function: { name: 'read_file', arguments: '{}' } }, { index: 1, id: 'x', function: { name: 'read_file', arguments: '{}' } }],
  ]) {
    const { client, dir } = fixture(t, async () => response(event(chunk({ tool_calls: parts }, 'tool_calls')) + event('[DONE]')));
    const emitted = [];
    await assert.rejects(async () => { for await (const x of await client.responses.create({ stream: true, input: 'test', tools: [{ type: 'function', name: 'read_file' }] })) emitted.push(x); }, { code: 'invalid_tool_call' });
    assert.ok(!emitted.some(x => x.item?.type === 'function_call')); assert.deepEqual(readdirSync(dir), []);
  }
});
test('mid-stream provider failures are redacted, do not persist and never retry', async t => {
  let calls = 0;
  const { client, dir } = fixture(t, async () => { calls++; return response(event(chunk({ content: 'Provisional' })) + event({ error: { message: 'SECRET body' } })); });
  const emitted = [];
  await assert.rejects(async () => { for await (const x of await client.responses.create({ stream: true, input: 'test' })) emitted.push(x); }, e => e.code === 'provider_error' && !e.message.includes('SECRET'));
  assert.ok(emitted.some(x => x.delta === 'Provisional')); assert.ok(!emitted.some(x => x.type === 'response.completed'));
  assert.deepEqual(readdirSync(dir), []); assert.equal(calls, 1);
});
test('EOF, missing finish marker, length limits, invalid JSON and excess bytes fail closed', async () => {
  for (const [text, code, limit] of [
    [event(chunk({ content: 'partial' }, 'stop')), 'incomplete_stream'],
    [event(chunk({ content: 'partial' })) + event('[DONE]'), 'incomplete_stream'],
    [event(chunk({ content: 'partial' }, 'length')) + event('[DONE]'), 'incomplete_completion'],
    [event('{broken'), 'invalid_stream'],
    [event(chunk({ content: 'x'.repeat(200) })), 'response_limit', 32],
  ]) await assert.rejects(collect(completionDeltas(response(text), { limit })), { code });
});
test('refusal does not commit a partial streamed response', async t => {
  const { client, dir } = fixture(t, async () => response(event(chunk({ refusal: 'declined' }, 'stop')) + event('[DONE]')));
  await assert.rejects(collect(await client.responses.create({ stream: true, input: 'test' })), { code: 'provider_refusal' });
  assert.deepEqual(readdirSync(dir), []);
});
test('consumer abandonment cancels the body and stores nothing', async t => {
  let cancelled = false;
  const { client, dir } = fixture(t, async () => response(event(chunk({ content: 'part' })), 1, () => { cancelled = true; }));
  const stream = await client.responses.create({ stream: true, input: 'test' });
  await stream.next(); await stream.return();
  assert.equal(cancelled, true); assert.deepEqual(readdirSync(dir), []);
});
test('abort while waiting for provider bytes wakes the reader and does not persist', async t => {
  const controller = new AbortController(); let cancelled = false;
  const { client, dir } = fixture(t, async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const stream = await client.responses.create({ stream: true, input: 'test' }, { signal: controller.signal });
  await stream.next(); const next = stream.next();
  controller.abort(new Error('owner stopped'));
  await assert.rejects(next, /owner stopped/); assert.equal(cancelled, true); assert.deepEqual(readdirSync(dir), []);
});
test('stream request to a JSON-only endpoint fails explicitly instead of retrying', async t => {
  let calls = 0;
  const { client } = fixture(t, async () => { calls++; return Response.json({ choices: [] }); });
  await assert.rejects(collect(await client.responses.create({ input: 'test', stream: true })), { code: 'invalid_stream' });
  assert.equal(calls, 1);
});
test('real HTTP response yields a token while the server is still holding the final chunk', async t => {
  let release;
  const gate = new Promise(r => { release = r; });
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain synthetic request */ }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders();
    res.write(event(chunk({ content: 'visible-before-finish' })));
    await gate;
    res.end(event(chunk({}, 'stop')) + event('[DONE]'));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { release(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const { client, env } = fixture(t, fetch);
  env.BOPS_INFERENCE_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  const stream = await client.responses.create({ stream: true, input: 'Synthetic probe', store: false });
  let text;
  for await (const x of stream) {
    if (x.type === 'response.output_text.delta') { text = x.delta; release(); }
  }
  assert.equal(text, 'visible-before-finish');
});
