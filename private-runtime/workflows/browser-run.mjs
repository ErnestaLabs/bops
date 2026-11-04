/** The orchestration body behind the deployed Trigger task.
 *
 * It lives here, not in the task file, so the Trigger task and the local slice
 * runner execute identically. Otherwise the thing that is tested locally and
 * the thing that runs in production drift apart, which is how "it works on my
 * machine" becomes a duplicate truth of its own.
 */
import { WorkflowError } from './contracts.mjs';
import { dispatchBrowserWorkflow } from './skyvern-client.mjs';

export const TERMINAL_REMOTE_STATUSES = Object.freeze(['completed', 'failed', 'terminated', 'canceled', 'timed_out']);
const defaultPoll = () => new Promise(resolve => { const timer = setTimeout(resolve, 5000); timer.unref?.(); });

/** Reserve, submit once, observe. Returns with verificationRequired: true —
 * a remote "completed" is an observation, never a business outcome.
 *
 * @param {{client: any, ledger: any, allowedWorkflowIds: string[], approvalKey: string,
 *   action: any, approval: any, onState?: (state: string) => void,
 *   onRemoteId?: (remoteId: string) => void, poll?: () => Promise<unknown>,
 *   deadlineMs?: number, now?: () => number}} options
 */
export async function runApprovedBrowserWorkflow({
  client, ledger, allowedWorkflowIds, approvalKey, action, approval,
  onState = () => {}, onRemoteId = () => {}, poll = defaultPoll,
  deadlineMs = 11 * 60 * 1000, now = Date.now,
}) {
  onState('VALIDATING');
  // Throws before any remote id exists, so there is nothing to reconcile yet.
  let observed = await dispatchBrowserWorkflow({ client, ledger, allowedWorkflowIds, approvalKey, action, approval });
  onRemoteId(observed.remoteId);
  const deadline = now() + deadlineMs;
  for (;;) {
    onState(observed.businessState);
    if (TERMINAL_REMOTE_STATUSES.includes(observed.remoteStatus)) {
      // Operator or verifier must reconcile the actual receipt, record or file
      // before the business state changes. Never trust the executor's report.
      return { observed, actionKey: action.actionKey, verificationRequired: true };
    }
    if (now() >= deadline) throw new WorkflowError('observation_deadline_exceeded');
    await poll();
    observed = await client.get(observed.remoteId);
  }
}
