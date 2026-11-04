/** The orchestration body behind the deployed Trigger task.
 *
 * It lives here, not in the task file, so the Trigger task and the local slice
 * runner execute identically. Otherwise the thing that is tested locally and
 * the thing that runs in production drift apart, which is how "it works on my
 * machine" becomes a duplicate truth of its own.
 *
 * Three endings exist, and they are not interchangeable:
 *   - verificationRequired: the destination finished. Whether that is success is
 *     the verifier's decision, not this function's.
 *   - interventionRequired: the destination is waiting for a human (an MFA or
 *     2FA challenge, a login wall). Resubmitting cannot clear it and would
 *     create a second run, so the run parks in WAITING_APPROVAL instead.
 *   - cancelled: the owner asked to stop. The state only becomes CANCELLED once
 *     a read confirms the destination stopped; otherwise the write is still
 *     ambiguous and it stays OUTCOME_UNKNOWN.
 */
import { WorkflowError, transition } from './contracts.mjs';
import { dispatchBrowserWorkflow } from './skyvern-client.mjs';

export const TERMINAL_REMOTE_STATUSES = Object.freeze(['completed', 'failed', 'terminated', 'canceled', 'timed_out']);
const defaultPoll = () => new Promise(resolve => { const timer = setTimeout(resolve, 5000); timer.unref?.(); });

/** Ask the destination to stop, then wait for it to say so. A cancel request
 * that is merely accepted is not evidence that the run stopped. */
async function stopRun({ client, actionKey, observed, poll, now, cancelDeadlineMs, onState }) {
  onState('CANCELLING');
  let cancelAccepted = true;
  try { await client.cancel(observed.remoteId); } catch { cancelAccepted = false; }
  let last = observed;
  const until = now() + cancelDeadlineMs;
  while (now() < until) {
    try { last = await client.get(observed.remoteId); } catch { last = last; }
    if (TERMINAL_REMOTE_STATUSES.includes(last.remoteStatus)) break;
    await poll();
  }
  if (last.remoteStatus === 'completed') {
    // It finished first. Claiming "cancelled" here would hide a completed write.
    onState('VERIFYING');
    return { observed: last, actionKey, cancelAccepted, cancelled: false, verificationRequired: true };
  }
  if (last.remoteStatus === 'canceled') {
    const finalState = transition('CANCELLING', 'CANCELLED', { stopped: true });
    onState(finalState);
    return { observed: last, actionKey, cancelAccepted, cancelled: true, stopped: true, finalState };
  }
  // Never confirmed, or failed while stopping: the external write is still
  // ambiguous, so this is reconciliation work, not a clean cancellation.
  const finalState = transition('CANCELLING', 'OUTCOME_UNKNOWN');
  onState(finalState);
  return { observed: last, actionKey, cancelAccepted, cancelled: true, stopped: false, finalState };
}

/** Reserve, submit once, observe.
 *
 * @param {{client: any, ledger: any, allowedWorkflowIds: string[], approvalKey: string,
 *   action: any, approval: any, onState?: (state: string) => void,
 *   onRemoteId?: (remoteId: string) => void, onIntervention?: (observed: any) => void,
 *   poll?: () => Promise<unknown>, deadlineMs?: number, cancelDeadlineMs?: number,
 *   signal?: { aborted: boolean }, now?: () => number}} options
 */
export async function runApprovedBrowserWorkflow({
  client, ledger, allowedWorkflowIds, approvalKey, action, approval,
  onState = () => {}, onRemoteId = () => {}, onIntervention = () => {},
  poll = defaultPoll, deadlineMs = 11 * 60 * 1000, cancelDeadlineMs = 30_000,
  signal, now = Date.now,
}) {
  onState('VALIDATING');
  // Throws before any remote id exists, so there is nothing to reconcile yet.
  let observed = await dispatchBrowserWorkflow({ client, ledger, allowedWorkflowIds, approvalKey, action, approval });
  onRemoteId(observed.remoteId);
  const deadline = now() + deadlineMs;
  for (;;) {
    onState(observed.businessState);
    // A human is required. Do not cancel (that would abandon the owner's task)
    // and do not resubmit (that would be the duplicate write).
    if (observed.businessState === 'WAITING_APPROVAL') {
      onIntervention(observed);
      return { observed, actionKey: action.actionKey, interventionRequired: true, finalState: 'WAITING_APPROVAL' };
    }
    if (TERMINAL_REMOTE_STATUSES.includes(observed.remoteStatus)) {
      // Operator or verifier must reconcile the actual receipt, record or file
      // before the business state changes. Never trust the executor's report.
      return { observed, actionKey: action.actionKey, verificationRequired: true };
    }
    if (signal?.aborted) return stopRun({ client, actionKey: action.actionKey, observed, poll, now, cancelDeadlineMs, onState });
    if (now() >= deadline) throw new WorkflowError('observation_deadline_exceeded');
    await poll();
    observed = await client.get(observed.remoteId);
  }
}
