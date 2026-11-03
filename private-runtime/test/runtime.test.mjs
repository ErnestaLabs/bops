import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateClient, endpoint, inputMessages } from '../inference.mjs';
import { dockerComputer, workerId, displayOf } from '../computer.mjs';
import { assertDestination } from '../network-policy.mjs';
import * as vault from '../vault.mjs';
const answer = (content = 'Done', tools) => Response.json({ model: 'test-model', choices: [{ finish_reason: tools ? 'tool_calls' : 'stop', message: { content, ...(tools ? { tool_calls: tools } : {}) } }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } });
const tool = (name = 'read_file', args = '{}', id = 'c1') => ({ id, type: 'function', function: { name, arguments: args } });
const functionTool = { type: 'function', name: 'read_file', parameters: { type: 'object', properties: {} } };
const body = { input: 'Hello', tools: [functionTool] };
function fixture(t, fetchImpl = async () => answer()) {
  const dir = mkdtempSync(join(tmpdir(), 'ernesta-tests-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { BOPS_INFERENCE_BASE_URL: 'https://provider.example/v1', BOPS_INFERENCE_MODEL: 'test-model', BOPS_INFERENCE_API_KEY: 'test-only', BOPS_PRIVATE_DATA_DIR: dir };
  return { env, dir, client: privateClient({ env, fetchImpl }) };
}
test('client construction is lazy, with no credential required', () => assert.ok(privateClient({ env: {} })));
test('missing endpoint cannot select a default', async t => { const { client, env } = fixture(t); delete env.BOPS_INFERENCE_BASE_URL; await assert.rejects(client.responses.create(body), { code: 'provider_not_configured' }); });
test('endpoint validation and vendor blocks', () => {
  for (const url of ['http://remote.example/v1', 'https://api.openai.com/v1', 'https://orgo.ai', 'https://api.x.ai', 'https://a:b@example.com', 'https://provider.example?key=secret', 'https://provider.example/#fragment']) assert.throws(() => endpoint(url));
  assert.equal(endpoint('http://[::1]:8000/v1/'), 'http://[::1]:8000/v1');
});
test('remote endpoint requires credentials', async t => { const { client, env } = fixture(t); delete env.BOPS_INFERENCE_API_KEY; await assert.rejects(client.responses.create(body), { code: 'key_not_configured' }); });
test('OpenAI and xAI model selections are rejected', async t => { const { client, env } = fixture(t); for (const model of ['openai/gpt-x', 'gpt-x', 'o3', 'x-ai/grok-4', 'grok-4']) { env.BOPS_INFERENCE_MODEL = model; await assert.rejects(client.responses.create(body), { code: 'model_not_configured' }); } });
test('wire uses only configured Chat Completions without SDK fields', async t => {
  let got;
  const { client } = fixture(t, async (url, opts) => { got = { url, opts, body: JSON.parse(opts.body) }; return answer(); });
  const r = await client.responses.create({ ...body, model: 'gpt-upstream', reasoning: { effort: 'high' }, service_tier: 'fast' });
  assert.equal(got.url, 'https://provider.example/v1/chat/completions'); assert.equal(got.body.model, 'test-model'); assert.equal(got.opts.redirect, 'error');
  assert.equal(got.body.reasoning, undefined); assert.equal(got.body.service_tier, undefined); assert.equal(r.output_text, 'Done'); assert.equal(r.usage.total_tokens, 10);
});
test('history and tool outputs are kept locally across turns', async t => {
  const seen = []; let n = 0;
  const { client, dir } = fixture(t, async (_, opts) => { seen.push(JSON.parse(opts.body)); return n++ ? answer('Read it') : answer(null, [tool()]); });
  const r = await client.responses.create(body);
  const second = await client.responses.create({ ...body, previous_response_id: r.id, input: [{ type: 'function_call_output', call_id: 'c1', output: 'file contents' }] });
  assert.equal(second.output_text, 'Read it'); assert.deepEqual(seen[1].messages.map(m => m.role), ['user', 'assistant', 'tool']);
  assert.equal(seen[1].previous_response_id, undefined);
  const saved = join(dir, 'responses', `${r.id}.json`); assert.equal(statSync(saved).mode & 0o777, 0o600); assert.equal((await client.responses.retrieve(r.id)).id, r.id);
  await client.responses.delete(r.id); await assert.rejects(client.responses.retrieve(r.id), { code: 'context_missing' });
});
test('store false writes no local history', async t => { const { client, dir } = fixture(t); await client.responses.create({ ...body, store: false }); assert.deepEqual(readdirSync(dir), []); });
test('legacy response IDs never fetch remote histories', async t => { const { client } = fixture(t); await assert.rejects(client.responses.create({ ...body, previous_response_id: 'resp_legacy' }), { code: 'legacy_response' }); });
test('model native web-search is explicitly not advertised', async t => { let sent; const { client } = fixture(t, async (_, opts) => { sent = JSON.parse(opts.body); return answer(); }); await client.responses.create({ input: 'Research', tools: [{ type: 'web_search' }] }); assert.equal(sent.tools, undefined); assert.match(sent.messages[0].content, /unavailable/); });
test('structured output schema is translated', async t => { let sent; const { client } = fixture(t, async (_, opts) => { sent = JSON.parse(opts.body); return answer('{}'); }); await client.responses.create({ input: 'JSON', text: { format: { type: 'json_schema', name: 'result', schema: { type: 'object' } } } }); assert.equal(sent.response_format.json_schema.name, 'result'); });
test('unknown tools are rejected before execution', async t => { const { client } = fixture(t, async () => answer(null, [tool('delete_all')])); await assert.rejects(client.responses.create(body), { code: 'invalid_tool_call' }); });
test('malformed and duplicate tool calls are rejected', async t => { for (const calls of [[tool('read_file', '{')], [tool(), tool()]]) { const { client } = fixture(t, async () => answer(null, calls)); await assert.rejects(client.responses.create(body), { code: 'invalid_tool_call' }); } });
test('truncated completions are not executed', async t => { const { client } = fixture(t, async () => Response.json({ choices: [{ finish_reason: 'length', message: { tool_calls: [tool()] } }] })); await assert.rejects(client.responses.create(body), { code: 'incomplete_completion' }); });
test('provider errors reveal no response body and never fall back', async t => { let calls = 0; const { client } = fixture(t, async () => { calls++; return new Response('SECRET', { status: 503 }); }); await assert.rejects(client.responses.create(body), e => e.status === 503 && !e.message.includes('SECRET')); assert.equal(calls, 1); });
test('cancelled requests do not reach inference', async t => { let calls = 0; const { client } = fixture(t, async () => { calls++; return answer(); }); const ac = new AbortController(); ac.abort(); await assert.rejects(client.responses.create(body, { signal: ac.signal })); assert.equal(calls, 0); });
test('buffered event adapter delivers text and final response', async t => { const { client, env } = fixture(t); env.BOPS_INFERENCE_STREAM = '0'; const events = []; for await (const e of await client.responses.create({ ...body, stream: true })) events.push(e); assert.equal(events[0].type, 'response.created'); assert.equal(events.at(-1).type, 'response.completed'); assert.equal(events.filter(e => e.type === 'response.output_text.delta').map(e => e.delta).join(''), 'Done'); });
test('computer input requires explicit owner policy', async t => { const { client, env } = fixture(t, async () => answer(null, [tool('bops_computer', JSON.stringify({ action: { type: 'click', x: 5, y: 10 } }))])); await assert.rejects(client.responses.create({ input: 'click', tools: [{ type: 'computer' }] }), { code: 'computer_input_not_authorized' }); env.BOPS_PRIVATE_COMPUTER_ACTIONS = '1'; const r = await client.responses.create({ input: 'click', tools: [{ type: 'computer' }] }); assert.equal(r.output[0].type, 'computer_call'); });
test('screenshot observations follow all tool results', () => { const messages = inputMessages([{ type: 'computer_call_output', call_id: 'c1', output: { type: 'computer_screenshot', image_url: 'data:image/png;base64,AA==' } }, { type: 'function_call_output', call_id: 'c2', output: 'ok' }]); assert.deepEqual(messages.map(m => m.role), ['tool','tool','user']); });
test('unsupported Agents and realtime surfaces fail closed', t => { const { client } = fixture(t); assert.throws(() => client.beta, { code: 'unsupported_capability' }); assert.throws(() => client.live, { code: 'unsupported_capability' }); });
test('compaction without stored private history fails explicitly', async t => { const { client } = fixture(t); await assert.rejects(client.responses.create({ input: [{ type: 'compaction_trigger' }] }), { code: 'invalid_compaction' }); });
test('worker and display identifiers reject injection', () => { for (const id of ['../x','--name','ernesta-x','']) assert.throws(() => workerId(id)); assert.equal(displayOf('screen-99'),99); for (const d of ['99;id',1,103]) assert.throws(() => displayOf(d)); });
const worker = 'ernesta-' + 'a'.repeat(24);
function dockerFixture({ foreign = false } = {}) {
  const calls = [];
  const env = { BOPS_PRIVATE_INSTALL_ID: 'test-install' };
  const exec = async (args, opts) => {
    calls.push({ args, opts });
    if (args[0] === 'inspect') return JSON.stringify([{ Config: { Labels: { 'ernesta.install': foreign ? 'someone-else' : 'test-install', 'ernesta.managed': 'true' } }, State: { Running: true }, HostConfig: { Memory: 4 * 1024 ** 3, NanoCpus: 2e9 } }]);
    if (args[0] === 'run') return 'container-id';
    return 'ok';
  };
  return { runtime: dockerComputer({ env, exec }), calls, env };
}
test('Docker create has caps, resource limits, no secrets or socket mounts', async () => { const { runtime, calls } = dockerFixture(); await runtime.api.create('Sales'); const args = calls[0].args; assert.ok(args.includes('--cap-drop')); assert.ok(args.includes('ALL')); assert.ok(args.includes('no-new-privileges')); assert.ok(args.includes('--memory')); assert.equal(args[args.indexOf('--network')+1], 'none'); assert.ok(!args.some(a => a.includes('docker.sock') || a === '--privileged' || a === '-e')); });
test('Docker rejects host networking', async () => { const { runtime, env } = dockerFixture(); env.BOPS_WORKER_NETWORK = 'host'; await assert.rejects(runtime.api.create('Sales'), { code: 'invalid_configuration' }); });
test('foreign computer cannot be deleted or execute commands', async () => { const { runtime, calls } = dockerFixture({ foreign: true }); await assert.rejects(runtime.api.remove(worker), { code: 'foreign_computer' }); await assert.rejects(runtime.api.type(worker,'screen-99','hello'), { code: 'foreign_computer' }); assert.ok(calls.every(c => c.args[0] === 'inspect')); });
test('delete checks ownership and preserves data volumes', async () => { const { runtime, calls } = dockerFixture(); await runtime.api.remove(worker); assert.deepEqual(calls[1].args, ['rm','-f',worker]); });
test('shell is executed inside the worker with a bounded deadline', async () => { const { runtime, calls } = dockerFixture(); await runtime.api.bash(worker,'printf hello',5); assert.deepEqual(calls[1].args, ['exec', worker,'timeout','-k','2s','5s','/bin/bash','-lc','printf hello']); });
test('typed text is passed as an argument, not host shell code', async () => { const { runtime, calls } = dockerFixture(); await runtime.api.type(worker, 'screen-99', '$(touch /host)'); assert.equal(calls[1].args.at(-1), '$(touch /host)'); assert.ok(!calls[1].args.includes('sh')); });
test('invalid coordinates and hotkeys are rejected', async () => { const { runtime } = dockerFixture(); await assert.rejects(runtime.api.click(worker,'screen-99',-1,0)); await assert.rejects(runtime.api.key(worker,'screen-99','--shell')); });
test('unsupported live streams are not reported as successful', async () => { const { runtime } = dockerFixture(); await assert.rejects(runtime.api.streamInfo(worker), { code: 'unsupported_capability' }); });
test('vendor egress policy blocks exact hosts and subdomains, not lookalikes', () => { for (const value of ['https://api.openai.com/v1','https://a.orgo.ai','https://api.x.ai', { hostname: 'api.openai.com' }]) assert.throws(() => assertDestination(value)); assert.doesNotThrow(() => assertDestination('https://openai.com.example.org')); assert.doesNotThrow(() => assertDestination('https://integrate.api.nvidia.com/v1')); });
test('Linux vault encrypts, replaces, detects wrong key and deletes', async t => {
  const { dir } = fixture(t); const old = { ...process.env };
  process.env.BOPS_PRIVATE_DATA_DIR = dir; process.env.BOPS_VAULT_KEY = 'a'.repeat(64);
  t.after(() => { for (const k of ['BOPS_PRIVATE_DATA_DIR','BOPS_VAULT_KEY']) if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; });
  await vault.setSecret('owner:crm', 'secret-value'); assert.equal(await vault.getSecret('owner:crm'),'secret-value');
  const f = join(dir,'vault',readdirSync(join(dir,'vault'))[0]); assert.ok(!readFileSync(f,'utf8').includes('secret-value')); assert.equal(statSync(f).mode & 0o777,0o600);
  await vault.setSecret('owner:crm','new-value'); assert.equal(await vault.getSecret('owner:crm'),'new-value');
  process.env.BOPS_VAULT_KEY = 'b'.repeat(64); await assert.rejects(vault.getSecret('owner:crm'), /authentication failed/);
  process.env.BOPS_VAULT_KEY = 'a'.repeat(64); await vault.deleteSecret('owner:crm'); assert.equal(await vault.getSecret('owner:crm'),null);
});
