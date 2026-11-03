/** Dispatch reservations for ONE owner-controlled filesystem, not a distributed workflow engine.
 * Persist before POST. Never reclaim a partial reservation or replay an ambiguous submission.
 */
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { digest, requestBody, serviceURL, WorkflowError } from './skyvern.mjs';
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
export async function dispatchOnce({ directory, approvalHash, client, ...input }) {
  const p = plan(input);
  if (client.origin !== p.origin) throw new WorkflowError('SERVICE_SCOPE_MISMATCH');
  if (approvalHash !== p.approvalHash) throw new WorkflowError('APPROVAL_REQUIRED');
  if (typeof directory !== 'string' || !directory) throw new WorkflowError('JOURNAL_DIRECTORY_REQUIRED');
  const root = resolve(directory); mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = join(root, p.reservationKey), file = join(dir, 'receipt.json');
  try { mkdirSync(dir, { mode: 0o700 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw new WorkflowError('JOURNAL_UNAVAILABLE');
    let prior; try { prior = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new WorkflowError('PARTIAL_RESERVATION_REQUIRES_RECONCILIATION', true); }
    if (prior.approvalHash !== p.approvalHash) throw new WorkflowError('ACTION_ID_CONFLICT');
    return { ...prior, replayed: false, existingReservation: true };
  }
  const parent = openSync(root, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
  const intent = { ...p, state: 'dispatching', createdAt: new Date().toISOString(), events: [{ event: 'dispatch_reserved', at: new Date().toISOString() }] };
  // Failure here means no POST is sent, and the directory remains reserved.
  try { writeAtomic(file, intent); } catch { throw new WorkflowError('JOURNAL_UNAVAILABLE'); }
  let result;
  try { result = await client.start(input.request); }
  catch (e) {
    const failed = { ...intent, state: 'outcome_unknown', errorCode: e instanceof WorkflowError ? e.code : 'DISPATCH_ERROR',
      events: [...intent.events, { event: 'reconciliation_required', at: new Date().toISOString() }] };
    try { writeAtomic(file, failed); } catch { /* Existing durable reservation still prevents replay. */ }
    return failed;
  }
  const receipt = { ...intent, ...result, state: result.businessState,
    events: [...intent.events, { event: 'remote_run_recorded', at: new Date().toISOString(), providerRunId: result.providerRunId }] };
  try { writeAtomic(file, receipt); }
  catch { const e = new WorkflowError('REMOTE_RUN_RECEIPT_WRITE_FAILED', true); e.providerRunId = result.providerRunId; throw e; }
  return receipt;
}
