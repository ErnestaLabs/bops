/** Independent outcome verification. An executor reporting "done" is not a
 * result: a success needs a receipt the owner can look up themselves.
 */
import { WorkflowError, transition, isIndependentVerifier } from './contracts.mjs';
export function attestedEvidence({ verifier, receiptId, matches }) {
  if (!isIndependentVerifier(verifier)) throw new WorkflowError('independent_verifier_required');
  if (typeof receiptId !== 'string' || !receiptId.trim() || receiptId.length > 256) throw new WorkflowError('receipt_missing');
  if (matches !== true) throw new WorkflowError('result_mismatch');
  return { verified: true, verifier, receiptId };
}
/** Close a run only from VERIFYING, or through RECONCILING after a lost write. */
export function closeVerified(from, evidence) {
  if (!evidence || evidence.verified !== true) throw new WorkflowError('verification_required');
  if (!isIndependentVerifier(evidence.verifier)) throw new WorkflowError('independent_verifier_required');
  if (typeof evidence.receiptId !== 'string' || !evidence.receiptId.trim()) throw new WorkflowError('receipt_missing');
  let state = from;
  if (state === 'OUTCOME_UNKNOWN') state = transition(state, 'RECONCILING');
  if (state === 'RECONCILING') state = transition(state, 'VERIFYING');
  if (state !== 'VERIFYING') throw new WorkflowError('invalid_transition');
  return transition(state, 'SUCCEEDED', evidence);
}
/** A Skyvern run that reports "completed" is an observation, not an outcome.
 * The verifier re-reads the destination itself and requires the fields the
 * owner actually asked for, so a run that finished without producing them
 * stays unverified instead of becoming a success.
 */
export function verifyBrowserRun(inspected, { requiredOutputFields = [] } = {}) {
  if (!inspected || typeof inspected.remoteId !== 'string' || !inspected.remoteId) throw new WorkflowError('evidence_missing');
  if (inspected.remoteStatus !== 'completed') throw new WorkflowError('result_mismatch');
  if (!inspected.output || typeof inspected.output !== 'object') throw new WorkflowError('evidence_missing');
  for (const field of requiredOutputFields) {
    const value = inspected.output[field];
    if (value === undefined || value === null || value === '') throw new WorkflowError('result_mismatch');
  }
  return attestedEvidence({ verifier: 'skyvern-run-readback', receiptId: inspected.remoteId, matches: true });
}
/** Read-back comparison for a connector send: identity and content must match. */
export function verifySentMessage({ intended, observed }) {
  if (!intended || !observed) throw new WorkflowError('evidence_missing');
  for (const key of ['to','subject']) if (observed[key] !== intended[key]) throw new WorkflowError('result_mismatch');
  if (observed.status !== 'sent') throw new WorkflowError('result_mismatch');
  return attestedEvidence({ verifier: 'connector-readback', receiptId: String(observed.messageId ?? ''), matches: true });
}
