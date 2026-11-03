import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { privateClient } from '../inference.mjs';
import { compactMessages } from '../compaction.mjs';
const answer = text => Response.json({ model: 'test', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
function fixture(t, fetchImpl) {
  const dir = mkdtempSync(join(tmpdir(), 'bops-compact-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { BOPS_INFERENCE_BASE_URL: 'http://127.0.0.1:1234/v1', BOPS_INFERENCE_MODEL: 'test', BOPS_PRIVATE_DATA_DIR: dir };
  return { dir, client: privateClient({ env, fetchImpl }) };
}
test('explicit compaction preserves originals, archives source and continues on reduced local history', async t => {
  const sent = [];
  const { client, dir } = fixture(t, async (_url, options) => {
    const b = JSON.parse(options.body); sent.push(b);
    return answer(b.messages[0]?.content.includes?.('PRIVATE_CONTEXT_COMPACTION') ? 'The owner requested preserving marker KEEP_ME; no external action is authorized.' : 'Reply');
  });
  const first = await client.responses.create({ input: 'KEEP_ME ' + 'old detail '.repeat(3000) });
  const file = join(dir, 'responses', `${first.id}.json`), original = readFileSync(file);
  const compact = await client.responses.create({ previous_response_id: first.id, input: [{ type: 'compaction_trigger' }], tools: [{ type: 'function', name: 'dangerous' }] });
  assert.equal(compact.output[0].type, 'compaction'); assert.equal(compact.compaction.lossy, true); assert.equal(compact.compaction.batches, 2);
  assert.equal(compact.usage.total_tokens, 10); assert.deepEqual(readFileSync(file), original);
  const source = join(dir, 'responses', compact.compaction.source_snapshot);
  assert.equal(statSync(source).mode & 0o777, 0o600);
  assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'), compact.compaction.source_sha256);
  for (const b of sent.slice(1)) { assert.equal(b.tools, undefined); assert.equal(b.stream, false); }
  await client.responses.create({ previous_response_id: compact.id, input: 'Continue without sending anything.' });
  const latest = sent.at(-1); assert.match(latest.messages[0].content, /untrusted data/); assert.match(latest.messages[0].content, /KEEP_ME/);
  assert.ok(JSON.stringify(latest).length < original.length / 2);
  await client.responses.delete(compact.id); assert.ok(!readdirSync(join(dir, 'responses')).includes(compact.compaction.source_snapshot));
});
test('pending tool calls cannot be compacted or silently forgotten', async t => {
  let calls = 0;
  const { client } = fixture(t, async () => { calls++; return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read', arguments: '{}' } }] } }] }); });
  const prior = await client.responses.create({ input: 'read', tools: [{ type: 'function', name: 'read' }] });
  await assert.rejects(client.responses.create({ previous_response_id: prior.id, input: [{ type: 'compaction_trigger' }] }), { code: 'unsettled_tools' });
  assert.equal(calls, 1);
});
test('settled tool outputs are retained in the source snapshot and pairs stay intact', async t => {
  let count = 0;
  const { client, dir } = fixture(t, async () => count++ === 0 ? Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read', arguments: '{}' } }] } }] }) : answer('Summary of the initial request.'));
  const prior = await client.responses.create({ input: 'read', tools: [{ type: 'function', name: 'read' }] });
  const result = await client.responses.create({ previous_response_id: prior.id, input: [{ type: 'function_call_output', call_id: 'c1', output: 'Observed result ORIGINAL_OUTPUT' }, { type: 'compaction_trigger' }] });
  const saved = JSON.parse(readFileSync(join(dir, 'responses', `${result.id}.json`)));
  assert.deepEqual(saved.messages.slice(1).map(m => m.role), ['assistant', 'tool']);
  const source = JSON.parse(readFileSync(join(dir, 'responses', result.compaction.source_snapshot)));
  assert.equal(source.messages.at(-1).content, 'Observed result ORIGINAL_OUTPUT');
});
test('summary failure preserves old state and creates no new response or snapshot', async t => {
  let count = 0;
  const { client, dir } = fixture(t, async () => count++ === 0 ? answer('First') : new Response('SECRET', { status: 503 }));
  const prior = await client.responses.create({ input: 'original' });
  const before = readdirSync(join(dir, 'responses'));
  await assert.rejects(client.responses.create({ previous_response_id: prior.id, input: [{ type: 'compaction_trigger' }] }), { code: 'provider_error' });
  assert.deepEqual(readdirSync(join(dir, 'responses')), before);
  assert.equal((await client.responses.retrieve(prior.id)).output_text, 'First');
});
test('invalid trigger positions, duplicates, streaming and store:false fail before inference', async t => {
  let count = 0;
  const { client } = fixture(t, async () => { count++; return answer('Done'); });
  const prior = await client.responses.create({ input: 'hi' });
  for (const request of [
    { input: [{ type: 'compaction_trigger' }, { role: 'user', content: 'after' }] },
    { input: [{ type: 'compaction_trigger' }, { type: 'compaction_trigger' }] },
    { input: [{ type: 'compaction_trigger' }], stream: true },
    { input: [{ type: 'compaction_trigger' }], store: false },
  ]) await assert.rejects(client.responses.create({ previous_response_id: prior.id, ...request }), { code: 'invalid_compaction' });
  assert.equal(count, 1);
});
test('summarized images are labeled omitted rather than invented or sent as base64 text', async () => {
  let received;
  const result = await compactMessages([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,DO_NOT_SUMMARIZE_BASE64' } }] }], async input => { received = input; return 'Image requires re-observation.'; });
  assert.ok(!received.includes('DO_NOT_SUMMARIZE_BASE64')); assert.match(received, /Image omitted/);
  assert.match(result.messages[0].content, /screenshots.*omitted/);
});
test('compaction rejects empty/oversized summaries and unbounded batches without truncating source', async () => {
  for (const summary of ['', 'x'.repeat(24001)]) await assert.rejects(compactMessages([{ role: 'user', content: 'source' }], async () => summary), { code: 'invalid_summary' });
  let calls = 0;
  await assert.rejects(compactMessages([{ role: 'user', content: 'x'.repeat(24000 * 65) }], async () => { calls++; return 'summary'; }), { code: 'compaction_limit' });
  assert.equal(calls, 0);
});
test('summary output cannot request executable tools', async t => {
  let count = 0;
  const { client, dir } = fixture(t, async () => count++ === 0 ? answer('First') : Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'bad', type: 'function', function: { name: 'exec', arguments: '{}' } }] } }] }));
  const prior = await client.responses.create({ input: 'test' });
  await assert.rejects(client.responses.create({ previous_response_id: prior.id, input: [{ type: 'compaction_trigger' }] }), { code: 'invalid_tool_call' });
  assert.equal(readdirSync(join(dir, 'responses')).length, 1);
});
test('cancellation after provider response cannot replace context', async t => {
  const abort = new AbortController(); let count = 0;
  const { client, dir } = fixture(t, async () => { if (count++) abort.abort(new Error('Stopped by owner')); return answer('Summary'); });
  const prior = await client.responses.create({ input: 'original' });
  await assert.rejects(client.responses.create({ previous_response_id: prior.id, input: [{ type: 'compaction_trigger' }] }, { signal: abort.signal }), /Stopped by owner/);
  assert.equal(readdirSync(join(dir, 'responses')).length, 1);
});
