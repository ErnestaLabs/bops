/** Executor-agnostic write dispatch: reserve, submit exactly once, never replay.
 * Every consequential write goes through here, whatever executes it. A lost
 * response is OUTCOME_UNKNOWN, never a reason to try the call again.
 */
import { WorkflowError } from './contracts.mjs';
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const hash = (v, code) => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) throw new WorkflowError(code); };
export async function dispatchWriteOnce({ client, ledger, actionKey, requestHash, request }) {
  if (!client || typeof client.submit !== 'function') throw new WorkflowError('executor_client_required');
  if (!ledger || typeof ledger.reserve !== 'function') throw new WorkflowError('ledger_required');
  hash(actionKey, 'invalid_action_identity'); hash(requestHash, 'invalid_action_identity');
  const reservation = await ledger.reserve(actionKey, requestHash);
  if (!reservation.created) {
    if (reservation.requestHash !== requestHash) throw new WorkflowError('action_key_payload_conflict');
    // Intent recorded with no remote id: we do not know whether the write happened.
    if (!reservation.remoteId) throw new WorkflowError('submission_outcome_unknown');
    if (typeof client.get !== 'function') throw new WorkflowError('executor_client_required');
    return client.get(reservation.remoteId);
  }
  try {
    const result = await client.submit(request);
    await ledger.submitted(actionKey, requestHash, result.remoteId);
    return result;
  } catch {
    // The intent was committed before the call, so it already blocks a replay.
    await ledger.unknown(actionKey, requestHash).catch(() => {});
    throw new WorkflowError('submission_outcome_unknown');
  }
}
/** Ask the destination whether the action happened before deciding anything.
 * Found: record the existing action so it is never sent twice. Absent: a
 * consequential retry needs fresh owner approval, so fail closed instead.
 */
export async function reconcileByLookup({ ledger, actionKey, requestHash, lookup }) {
  if (!ledger || typeof ledger.reconcile !== 'function') throw new WorkflowError('ledger_required');
  if (typeof lookup !== 'function') throw new WorkflowError('lookup_required');
  hash(actionKey, 'invalid_action_identity'); hash(requestHash, 'invalid_action_identity');
  let found;
  try { found = await lookup(); }
  catch { throw new WorkflowError('reconciliation_unavailable'); }
  if (!found || typeof found.remoteId !== 'string' || !ID.test(found.remoteId)) throw new WorkflowError('action_absent_fresh_approval_required');
  await ledger.reconcile(actionKey, requestHash, found.remoteId);
  return found;
}
