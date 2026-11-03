/** Narrow self-hosted Skyvern REST adapter. No SDK/cloud default, retries or raw-response logging.
 * Inspected API source: Skyvern 9ba3f1db5b52400146dd71955763a994086dd8f1.
 */
import { createHash } from 'node:crypto';
export class WorkflowError extends Error {
  constructor(code, uncertain = false) { super(code); this.code = code; this.uncertain = uncertain; }
}
const deny = ['skyvern.com','openai.com','orgo.ai','bops.bot','x.ai'];
export function serviceURL(value) {
  let u; try { u = new URL(value); } catch { throw new WorkflowError('INVALID_SERVICE_URL'); }
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new WorkflowError('INVALID_SERVICE_URL');
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (deny.some(d => h === d || h.endsWith(`.${d}`))) throw new WorkflowError('HOSTED_VENDOR_BLOCKED');
  if (u.protocol === 'http:' && !['localhost','127.0.0.1','[::1]','skyvern'].includes(h)) throw new WorkflowError('HTTPS_REQUIRED');
  return u.origin;
}
const text = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
export function requestBody(value) {
  const allowed = ['url','prompt','title','max_steps','data_extraction_schema'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new WorkflowError('INVALID_TASK_FIELDS');
  if (!text(value.prompt, 12000)) throw new WorkflowError('INVALID_PROMPT');
  let url; try { url = new URL(value.url); } catch { throw new WorkflowError('INVALID_TARGET_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new WorkflowError('INVALID_TARGET_URL');
  const h = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!h.includes('.') || h === 'localhost' || /^[\d.]+$/.test(h) || h.includes(':') || deny.some(d => h === d || h.endsWith(`.${d}`))) throw new WorkflowError('INVALID_TARGET_URL');
  // This validates the START URL only, not future navigation. Network enforcement is separate.
  const max = value.max_steps ?? 10;
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new WorkflowError('STEP_BUDGET_EXCEEDED');
  if (value.title !== undefined && !text(value.title, 120)) throw new WorkflowError('INVALID_TITLE');
  const schema = value.data_extraction_schema;
  if (schema !== undefined && (!schema || typeof schema !== 'object' || Array.isArray(schema) || JSON.stringify(schema).length > 20000)) throw new WorkflowError('INVALID_SCHEMA');
  return { url: url.href, prompt: value.prompt, title: value.title || 'Ernesta approved browser task', max_steps: max,
    engine: 'skyvern-1.0', proxy_location: 'NONE', ...(schema ? { data_extraction_schema: schema } : {}) };
}
export function digest(value) {
  const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
const known = ['created','queued','running','timed_out','failed','terminated','completed','canceled'];
const idPattern = /^(tsk|wr)_[A-Za-z0-9_-]{1,160}$/;
export function runID(id) { if (typeof id !== 'string' || !idPattern.test(id)) throw new WorkflowError('INVALID_RUN_ID'); return id; }
export function summarizeRun(value) {
  if (!value || typeof value !== 'object') throw new WorkflowError('INVALID_PROVIDER_RESPONSE');
  const id = runID(value.run_id);
  if (!known.includes(value.status)) throw new WorkflowError('UNKNOWN_PROVIDER_STATE');
  const businessState = value.status === 'completed' ? 'awaiting_verification'
    : ['failed','terminated','timed_out'].includes(value.status) ? 'needs_review'
    : value.status === 'canceled' ? 'canceled_needs_reconciliation' : 'running';
  return { providerRunId: id, providerState: value.status, businessState,
    stepCount: Number.isSafeInteger(value.step_count) && value.step_count >= 0 ? value.step_count : null,
    screenshotCount: Array.isArray(value.screenshot_urls) ? value.screenshot_urls.length : 0,
    hasRecording: typeof value.recording_url === 'string' && value.recording_url.length > 0,
    hasOutput: value.output !== undefined && value.output !== null };
}
export function skyvernClient({ baseUrl, apiKey, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const origin = serviceURL(baseUrl);
  if (!text(apiKey, 4096) || /[\r\n]/.test(apiKey)) throw new WorkflowError('MISSING_API_KEY');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new WorkflowError('INVALID_TIMEOUT');
  async function request(method, path, payload) {
    const mutation = method !== 'GET';
    try {
      const response = await fetchImpl(origin + path, { method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
      // Even HTTP failure can be ambiguous after a mutating request. No automatic resend.
      if (!response.ok) { await response.body?.cancel(); throw new WorkflowError(`SKYVERN_HTTP_${response.status}`, mutation); }
      const reader = response.body?.getReader();
      if (!reader) throw new WorkflowError('EMPTY_RESPONSE', mutation);
      const chunks = []; let bytes = 0;
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength;
        if (bytes > 1048576) { await reader.cancel(); throw new WorkflowError('RESPONSE_TOO_LARGE', mutation); } chunks.push(value); }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (e) { if (e instanceof WorkflowError) throw e; throw new WorkflowError('SKYVERN_TRANSPORT_OR_RESPONSE_ERROR', mutation); }
  }
  return {
    origin,
    async start(value) {
      const body = requestBody(value);
      try { return summarizeRun(await request('POST', '/v1/run/tasks', body)); }
      catch (e) { if (e instanceof WorkflowError) e.uncertain = true; throw e; }
    },
    async observe(id) { id = runID(id); const report = summarizeRun(await request('GET', `/v1/runs/${id}`)); if (report.providerRunId !== id) throw new WorkflowError('RUN_ID_MISMATCH'); return report; },
    async cancel(id) { id = runID(id); await request('POST', `/v1/runs/${id}/cancel`, {}); return { providerRunId: id, businessState: 'cancel_requested' }; },
  };
}
