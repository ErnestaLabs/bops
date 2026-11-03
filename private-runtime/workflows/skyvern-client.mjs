/** Explicit self-hosted Skyvern API adapter. No Cloud default, no POST retry. */
import { WorkflowError, canonical, digest, verifyApproval } from './contracts.mjs';
const BLOCKED = ['skyvern.com','orgo.ai','openai.com','x.ai'];
export function selfHostedEndpoint(value) {
  let url; try { url = new URL(value); } catch { throw new WorkflowError('self_hosted_endpoint_required'); }
  const host = url.hostname.toLowerCase();
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || BLOCKED.some(d => host === d || host.endsWith(`.${d}`))) throw new WorkflowError('self_hosted_endpoint_required');
  if (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]','skyvern','trigger-webapp'].includes(host)) throw new WorkflowError('https_required_for_remote_control');
  return url.href.replace(/\/+$/, '');
}
function id(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new WorkflowError('invalid_remote_id'); return value; }
function rejectSecrets(value, depth = 0) {
  if (depth > 16) throw new WorkflowError('parameters_too_deep');
  if (!value || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value)) {
    if (/(password|secret|authorization|api.?key|access.?token|cookie)/i.test(key)) throw new WorkflowError('use_credential_references');
    rejectSecrets(v, depth + 1);
  }
}
export function browserRequest({ workflowId, parameters = {}, actionKey }, allowedWorkflowIds) {
  id(workflowId);
  if (!Array.isArray(allowedWorkflowIds) || !allowedWorkflowIds.includes(workflowId)) throw new WorkflowError('workflow_not_approved');
  if (!/^[a-f\d]{64}$/.test(actionKey)) throw new WorkflowError('invalid_action_key');
  if (!parameters || Object.getPrototypeOf(parameters) !== Object.prototype) throw new WorkflowError('parameters_must_be_object');
  rejectSecrets(parameters); const raw = canonical(parameters);
  if (Buffer.byteLength(raw) > 65536) throw new WorkflowError('parameters_too_large');
  return { workflow_id: workflowId, parameters, ai_fallback: false, max_elapsed_time_minutes: 10, run_metadata: { ernesta_action_key: actionKey } };
}
export function normalizeRun(data, expectedId) {
  const runId = id(data.run_id ?? data.workflow_run_id);
  if (expectedId && runId !== expectedId) throw new WorkflowError('remote_identity_mismatch');
  const states = { created:'QUEUED', queued:'QUEUED', running:'RUNNING', paused:'WAITING_APPROVAL', completed:'VERIFYING', failed:'OUTCOME_UNKNOWN', terminated:'OUTCOME_UNKNOWN', canceled:'CANCELLED', timed_out:'OUTCOME_UNKNOWN' };
  if (!Object.hasOwn(states, data.status)) throw new WorkflowError('unknown_remote_status');
  // A remote "completed" is NOT independent proof of a business outcome.
  return { remoteId: runId, remoteStatus: data.status, businessState: states[data.status], businessVerified: false, cancellationUndo: false };
}
export function skyvernClient({ baseURL, apiKey, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const base = selfHostedEndpoint(baseURL);
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new WorkflowError('skyvern_api_key_required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new WorkflowError('invalid_timeout');
  async function request(path, body) {
    const isPost = body !== undefined;
    try {
      const response = await fetchImpl(base + path, { method: isPost ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { 'x-api-key': apiKey, 'Content-Type':'application/json' }, ...(isPost ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) { await response.body?.cancel(); throw new WorkflowError(isPost ? 'submission_outcome_unknown' : 'remote_read_failed'); }
      const reader = response.body?.getReader(); if (!reader) throw new WorkflowError('invalid_remote_response');
      const chunks = []; let size = 0;
      try { for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > 2097152) { await reader.cancel(); throw new WorkflowError('response_too_large'); } chunks.push(value); } }
      finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      // Never include a response body, credentials, request parameters or raw network error.
      throw new WorkflowError(isPost ? 'submission_outcome_unknown' : error instanceof WorkflowError ? error.code : 'remote_read_failed');
    }
  }
  return {
    async submit(requestBody) { return normalizeRun(await request('/run/workflows', requestBody)); },
    async get(runId) { id(runId); return normalizeRun(await request(`/runs/${encodeURIComponent(runId)}`), runId); },
    async cancel(runId) { id(runId); await request(`/runs/${encodeURIComponent(runId)}/cancel`, {}); return { remoteId: runId, businessState:'CANCELLING', businessVerified:false }; },
  };
}
/** Ledger reservation must commit BEFORE any external call. Existing ambiguous
 * reservations fail closed; we never assume Skyvern deduplicates metadata. */
export async function dispatchBrowserWorkflow({ client, ledger, allowedWorkflowIds, approvalKey, action, approval }) {
  const request = browserRequest(action, allowedWorkflowIds), requestHash = digest(request);
  verifyApproval(approval, { actionKey: action.actionKey, requestHash }, approvalKey);
  const reservation = await ledger.reserve(action.actionKey, requestHash);
  if (!reservation.created) {
    if (reservation.requestHash !== requestHash) throw new WorkflowError('action_key_payload_conflict');
    if (!reservation.remoteId) throw new WorkflowError('submission_outcome_unknown');
    return client.get(reservation.remoteId);
  }
  try {
    const result = await client.submit(request);
    await ledger.submitted(action.actionKey, requestHash, result.remoteId);
    return result;
  } catch {
    // If the write itself failed, the earlier intent still prevents replay.
    await ledger.unknown(action.actionKey, requestHash).catch(() => {});
    throw new WorkflowError('submission_outcome_unknown');
  }
}
