/** Bounded Chat Completions SSE decoding. Tool calls are accumulated, never executed.
 * Provider comments, split UTF-8 and multiline data fields are supported. A complete
 * finish_reason AND [DONE] are required before a caller may accept a result.
 * Reference: https://openrouter.ai/docs/api_reference/streaming
 */
import { fail, InferenceError } from './errors.mjs';

async function* dataEvents(response, signal, limit) {
  if (!/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel().catch(() => {});
    fail('Provider did not return an event stream. Disable streaming explicitly for a JSON-only endpoint.', 'invalid_stream', 502);
  }
  const reader = response.body?.getReader();
  if (!reader) fail('Empty provider stream.', 'invalid_stream', 502);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', data = [], bytes = 0, afterCR = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) fail('Provider stream too large.', 'response_limit', 502);
      let text;
      try { text = decoder.decode(value, { stream: true }); }
      catch { fail('Invalid stream encoding.', 'invalid_stream', 502); }
      // SSE permits LF, CRLF and CR, including CRLF split between packets.
      for (const char of text) {
        if (afterCR && char === '\n') { afterCR = false; continue; }
        afterCR = false;
        if (char !== '\n' && char !== '\r') { buffer += char; continue; }
        afterCR = char === '\r';
        const line = buffer; buffer = '';
        if (line === '') {
          if (data.length) { const event = data.join('\n'); data = []; yield event; }
        } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        else if (line === 'data') data.push('');
        // Ignore comments and other SSE fields, never mistake them for JSON.
      }
    }
    try { decoder.decode(); } catch { fail('Incomplete stream encoding.', 'invalid_stream', 502); }
    fail('Provider stream ended before its completion marker.', 'incomplete_stream', 502);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof InferenceError) throw error;
    fail('Provider stream was interrupted. No result committed and no automatic retry.', 'incomplete_stream', 502);
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Yields text increments and then exactly one validated framing-level result.
 * The caller still must validate tool names, JSON arguments and action policy.
 */
export async function* completionDeltas(response, { signal, limit = 8 * 1024 * 1024 } = {}) {
  const calls = new Map(); let text = '', refusal = '', finish, model, usage;
  for await (const data of dataEvents(response, signal, limit)) {
    if (data === '[DONE]') {
      if (!finish) fail('Stream has no final completion status.', 'incomplete_stream', 502);
      const indexes = [...calls.keys()].sort((a, b) => a - b);
      if (indexes.some((n, i) => n !== i)) fail('Invalid tool-call ordering.', 'invalid_tool_call', 502);
      yield { result: { model, usage, choices: [{ finish_reason: finish, message: {
        role: 'assistant', content: text || null,
        ...(refusal ? { refusal } : {}),
        ...(calls.size ? { tool_calls: indexes.map(i => calls.get(i)) } : {}),
      } }] } };
      return;
    }
    let chunk;
    try { chunk = JSON.parse(data); } catch { fail('Malformed event in provider stream.', 'invalid_stream', 502); }
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) fail('Invalid provider stream event.', 'invalid_stream', 502);
    if (chunk.error) fail('Provider reported a mid-stream failure. No result committed.', 'provider_error', 502);
    if (chunk.model != null) { if (typeof chunk.model !== 'string') fail('Invalid stream model.', 'invalid_stream', 502); model = chunk.model; }
    if (chunk.usage != null) usage = chunk.usage;
    if (!Array.isArray(chunk.choices) || chunk.choices.length > 1) fail('Invalid stream choices.', 'invalid_stream', 502);
    if (!chunk.choices.length) continue; // A final usage-only event.
    const choice = chunk.choices[0];
    if (!choice || choice.index !== 0 || !choice.delta || typeof choice.delta !== 'object') fail('Invalid completion delta.', 'invalid_stream', 502);
    const delta = choice.delta;
    if (finish && (delta.content || delta.tool_calls?.length || delta.refusal || choice.finish_reason != null)) fail('Content after final completion status.', 'invalid_stream', 502);
    if (delta.role != null && delta.role !== 'assistant') fail('Invalid completion role.', 'invalid_stream', 502);
    if (delta.function_call != null) fail('Legacy function-call streaming is unsupported.', 'invalid_stream', 502);
    if (delta.refusal != null) {
      if (typeof delta.refusal !== 'string') fail('Invalid refusal.', 'invalid_stream', 502);
      refusal += delta.refusal;
    }
    if (delta.content != null) {
      if (typeof delta.content !== 'string') fail('Invalid text delta.', 'invalid_stream', 502);
      text += delta.content;
      if (delta.content) yield { text: delta.content };
    }
    if (delta.tool_calls != null) {
      if (!Array.isArray(delta.tool_calls)) fail('Invalid tool deltas.', 'invalid_tool_call', 502);
      for (const part of delta.tool_calls) {
        if (!part || !Number.isInteger(part.index) || part.index < 0 || part.index >= 64) fail('Invalid tool index.', 'invalid_tool_call', 502);
        const call = calls.get(part.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (part.type != null && part.type !== 'function') fail('Unsupported stream tool.', 'invalid_tool_call', 502);
        for (const [value, target, key] of [[part.id, call, 'id'], [part.function?.name, call.function, 'name'], [part.function?.arguments, call.function, 'arguments']]) {
          if (value == null) continue;
          if (typeof value !== 'string') fail('Invalid tool delta field.', 'invalid_tool_call', 502);
          target[key] += value;
        }
        calls.set(part.index, call);
      }
    }
    if (choice.finish_reason != null) {
      if (!['stop', 'tool_calls'].includes(choice.finish_reason)) fail('Incomplete or filtered completion; no tools accepted.', 'incomplete_completion', 502);
      finish = choice.finish_reason;
    }
  }
}
