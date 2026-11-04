/** Dispatch reservations for ONE owner-controlled filesystem, not a distributed workflow engine.
 * Persist before POST. Never reclaim a partial reservation or replay an ambiguous submission.
 *
 * The submit skeleton is NOT reimplemented here: this file is a journal-backed
 * ledger adapter plus the approval/scope policy, and dispatchWriteOnce does the
 * reserve -> submit once -> never replay work. Keeping one skeleton is what
 * makes the no-duplicate-write guarantee reviewable in one place.
 */
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { digest, requestBody, serviceURL, WorkflowError } from './skyvern.mjs';
import { dispatchWriteOnce } from './dispatch.mjs';
const key = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(value);
export function plan({ actionId, accountScope, baseUrl, request }) {
  if (!key(actionId) || !key(accountScope)) throw new WorkflowError('INVALID_ACTION_SCOPE');
  const origin = serviceURL(baseUrl), payload = requestBody(request);
  const approvalHash = digest({ actionId, accountScope, origin, payload, policy: 'owner-approved-v1' });
  return { actionId, accountScope, origin, approvalHash, reservationKey: digest({ actionId, accountScope, origin }),
    startHost: new URL(payload.url).hostname, maxSteps: payload.max_steps,
    policy: 'Owner approves the full task; a read-intent prompt is not a read-only enforcement boundary.' };
}
function writeAtomic(path, value) {
  const tmp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  const fd = openSync(tmp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  const dir = openSync(resolve(path, '..'), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
}
const now = () => new Date().toISOString();
/** The journal as a ledger for the shared skeleton. Reserve fails closed, and a
 * reservation whose receipt is unreadable stays reserved rather than being
 * treated as free. */
function journalLedger({ directory, reservationKey, intent, outcome }) {
  const dir = join(directory, reservationKey), file = join(dir, 'receipt.json');
  const read = () => JSON.parse(readFileSync(file, 'utf8'));
  const update = patch => { const prior = read(); writeAtomic(file, { ...prior, ...patch, events: [...prior.events, ...(patch.events ?? [])] }); };
  return {
    reserve(_actionKey, requestHash) {
      try { mkdirSync(dir, { mode: 0o700 }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw new WorkflowError('JOURNAL_UNAVAILABLE');
        let prior; try { prior = read(); } catch { throw new WorkflowError('PARTIAL_RESERVATION_REQUIRES_RECONCILIATION', true); }
        if (prior.approvalHash !== requestHash) throw new WorkflowError('ACTION_ID_CONFLICT');
        return { created: false, requestHash, remoteId: typeof prior.providerRunId === 'string' ? prior.providerRunId : null };
      }
      const parent = openSync(directory, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
      // Failure here means no POST is sent, and the directory remains reserved.
      try { writeAtomic(file, intent); } catch { throw new WorkflowError('JOURNAL_UNAVAILABLE'); }
      return { created: true, requestHash, remoteId: null };
    },
    async submitted(_actionKey, _requestHash, remoteId) {
      update({ providerRunId: remoteId, state: outcome.state, events: [{ event: 'remote_run_recorded', at: now(), providerRunId: remoteId }] });
    },
    async unknown() {
      update({ state: 'outcome_unknown', errorCode: 'DISPATCH_ERROR', events: [{ event: 'reconciliation_required', at: now() }] });
    },
    /** Record an action that reconciliation proved already happened, once.
     * 'dispatching' is included because a process killed between the POST and
     * the receipt leaves the journal in exactly that state, and it is the same
     * ambiguity as a lost response. */
    async reconcile(_actionKey, _requestHash, remoteId) {
      const prior = read();
      if (!['outcome_unknown', 'dispatching'].includes(prior.state)) throw new WorkflowError('NOT_RECONCILABLE');
      update({ state: 'running', providerRunId: remoteId, events: [{ event: 'reconciled', at: now(), providerRunId: remoteId }] });
      return { remoteId };
    },
  };
}
/** The journal and its plan, shared by dispatch and by operator recovery so the
 * two can never compute a different reservation key for the same action. */
function journalFor({ directory, approvalHash, ...input }) {
  if (typeof directory !== 'string' || !directory) throw new WorkflowError('JOURNAL_DIRECTORY_REQUIRED');
  const p = plan(input);
  if (approvalHash !== p.approvalHash) throw new WorkflowError('APPROVAL_REQUIRED');
  const root = resolve(directory); mkdirSync(root, { recursive: true, mode: 0o700 });
  const intent = { ...p, state: 'dispatching', createdAt: now(), events: [{ event: 'dispatch_reserved', at: now() }] };
  const outcome = { state: 'running' };
  const ledger = journalLedger({ directory: root, reservationKey: p.reservationKey, intent, outcome });
  return { plan: p, ledger, outcome, file: join(root, p.reservationKey, 'receipt.json') };
}
/** Operator recovery for an action whose write outcome was lost. Records the
 * remote run the operator found by searching the destination, once; an already
 * settled action refuses instead of reopening. */
export async function reconcileJournal({ directory, approvalHash, providerRunId, ...input }) {
  if (typeof providerRunId !== 'string' || !providerRunId) throw new WorkflowError('REMOTE_RUN_ID_REQUIRED');
  const { plan: p, ledger } = journalFor({ directory, approvalHash, ...input });
  return ledger.reconcile(p.reservationKey, p.approvalHash, providerRunId);
}
export async function dispatchOnce({ directory, approvalHash, client, ...input }) {
  const p = plan(input);
  if (client.origin !== p.origin) throw new WorkflowError('SERVICE_SCOPE_MISMATCH');
  const { ledger, file } = journalFor({ directory, approvalHash, ...input });
  // The journal speaks providerRunId; the shared skeleton speaks remoteId.
  const executor = {
    async submit(request) { const result = await client.start(request); outcome.state = result.businessState; return { ...result, remoteId: result.providerRunId }; },
    async get(remoteId) { return { ...(await client.observe(remoteId)), remoteId }; },
  };
  try {
    await dispatchWriteOnce({ client: executor, ledger, actionKey: p.reservationKey, requestHash: p.approvalHash, request: input.request });
  } catch (error) {
    // An existing reservation with no remote id is the ambiguous case: report the
    // journal state instead of implying a fresh dispatch happened.
    if (error.code !== 'submission_outcome_unknown') throw error;
    let prior; try { prior = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new WorkflowError('PARTIAL_RESERVATION_REQUIRES_RECONCILIATION', true); }
    return { ...prior, replayed: false, existingReservation: true };
  }
  try { return { ...JSON.parse(readFileSync(file, 'utf8')), replayed: false }; }
  catch { throw new WorkflowError('REMOTE_RUN_RECEIPT_WRITE_FAILED', true); }
}
