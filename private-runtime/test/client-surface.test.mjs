import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationClient } from '../client-surface.mjs';
test('application client permits harmless optional feature detection', () => {
  const client = applicationClient({env:{}});
  assert.equal(client.then, undefined);
  assert.equal(client.onPrivateClient, undefined);
  assert.equal(client['response.output_item.added'], undefined);
  assert.equal(client[Symbol.asyncIterator], undefined);
  assert.doesNotThrow(() => client.onPrivateClient?.());
});
test('unsupported services fail at invocation without requesting credentials', () => {
  let calls = 0;
  const c = applicationClient({env:{}, fetchImpl:async()=>{calls++;throw Error('must not fetch');}});
  for (const action of [()=>c.beta.agents.sessions.create(),()=>c.live.create(),()=>c.images.generate(),()=>c.audio.transcriptions.create(),()=>c.responses.stream()])
    assert.throws(action,{code:'unsupported_capability',status:501});
  assert.equal(calls,0);
});
test('application facade preserves real response objects, tool results and buffered events', async()=>{
  let sent;
  const c=applicationClient({env:{BOPS_INFERENCE_BASE_URL:'http://127.0.0.1:7000/v1',BOPS_INFERENCE_MODEL:'test'},fetchImpl:async(url,o)=>{sent=JSON.parse(o.body);return Response.json({choices:[{finish_reason:'stop',message:{content:'works'}}]});}});
  const r=await c.responses.create({input:[{role:'user',content:[{type:'input_text',text:'hi'}]}],tools:[{type:'web_search'}],parallel_tool_calls:false,store:false});
  assert.equal(r.output[0].type,'message');assert.equal(r.output_text,'works');assert.equal(sent.messages.at(-1).content[0].text,'hi');
  const stream=await c.responses.create({input:'hi',stream:true,store:false});
  const events=[];for await(const e of stream)events.push(e.type);
  assert.ok(events.includes('response.output_item.added'));assert.equal(events.at(-1),'response.completed');
});
