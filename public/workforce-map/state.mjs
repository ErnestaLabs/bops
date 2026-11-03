/** Deterministic contract simulator; production orchestration belongs to Trigger. */
import { FAILURES } from './catalogue.mjs';
export const TERMINAL = new Set(['succeeded','failed','cancelled']);
export function newRun(flow, id, intentHash) {
  if (!flow || !id || !intentHash) throw new Error('Run identity and exact intent required');
  return { id, workflowId: flow.id, version: flow.version, effect: flow.effect, intentHash, state: 'received', attempts: 0, maxAttempts: flow.limits.maxAttempts, evidenceRefs: [], events: [], approval: null, remoteId: null, failure: null };
}
export function transition(previous, event, now = Date.now()) {
  const r = structuredClone(previous), from = r.state;
  const requireState = (...allowed) => { if (!allowed.includes(from)) throw new Error(`Cannot ${event.type} from ${from}`); };
  const evidence = refs => Array.isArray(refs) && refs.length > 0 && refs.every(x => typeof x === 'string' && x.length > 0 && x.length < 256);
  switch (event.type) {
    case 'validate': requireState('received'); r.state = 'validated'; break;
    case 'plan': requireState('validated'); r.state = r.effect === 'write' ? 'awaiting_approval' : 'ready'; break;
    case 'approve':
      requireState('awaiting_approval');
      if (!event.actor || event.intentHash !== r.intentHash || !Number.isFinite(event.expiresAt) || event.expiresAt <= now) throw new Error('Approval must bind the exact current intent and expiry');
      r.approval = { actor: event.actor, intentHash: event.intentHash, expiresAt: event.expiresAt }; r.state = 'ready'; break;
    case 'dispatch':
      requireState('ready');
      if (r.effect === 'write' && (!r.approval || r.approval.intentHash !== r.intentHash || r.approval.expiresAt <= now)) throw new Error('Valid bound approval required');
      if (r.attempts >= r.maxAttempts) throw new Error('Attempt budget exhausted');
      r.attempts++; r.state = 'dispatching'; break;
    case 'accepted':
      requireState('dispatching'); if (!event.remoteId) throw new Error('Remote run ID required');
      r.remoteId = event.remoteId; r.state = 'running'; break;
    case 'executor_completed': requireState('running'); r.state = 'verifying'; break;
    case 'verified':
      requireState('verifying'); if (event.passed !== true || !evidence(event.evidenceRefs)) throw new Error('Independent verifier evidence required');
      r.evidenceRefs = event.evidenceRefs; r.state = 'succeeded'; break;
    case 'fault': {
      if (TERMINAL.has(from)) throw new Error('Terminal run cannot be changed');
      const f = FAILURES[event.code]; if (!f) throw new Error('Unknown failure code');
      if (['dispatch_uncertain','worker_lost'].includes(event.code) && !['dispatching','running','verifying','cancel_requested','outcome_unknown'].includes(from)) throw new Error('No submitted action to reconcile');
      r.failure = event.code;
      r.state = ['dispatching','running','verifying','cancel_requested'].includes(from) && r.effect === 'write' ? 'outcome_unknown' : f.state;
      if (['dispatching','outcome_unknown','cancel_requested'].includes(from)) r.state = 'outcome_unknown';
      if (r.state === 'retry_wait' && (r.effect !== 'read' || r.attempts >= r.maxAttempts)) r.state = 'blocked';
      break;
    }
    case 'retry':
      requireState('retry_wait');
      if (r.effect !== 'read' || !FAILURES[r.failure]?.retry || r.attempts >= r.maxAttempts || event.safeToRepeat !== true) throw new Error('Retry not permitted');
      // This is a recipe-level rehearsal, not permission to resubmit a Skyvern POST.
      r.state = 'ready'; r.remoteId = null; break;
    case 'reconcile':
      requireState('outcome_unknown');
      if (!event.actor || !evidence(event.evidenceRefs)) throw new Error('Reconciliation requires actor and independent evidence');
      r.evidenceRefs = event.evidenceRefs;
      if (event.outcome === 'applied') r.state = 'verifying';
      else if (event.outcome === 'not_applied') { r.state = r.effect === 'write' ? 'awaiting_approval' : 'ready'; r.approval = null; r.remoteId = null; }
      else if (event.outcome !== 'unresolved') throw new Error('Unknown reconciliation result');
      break;
    case 'cancel':
      if (TERMINAL.has(from) || from === 'cancel_requested') throw new Error('Cancellation not applicable');
      r.state = ['dispatching','running','verifying','outcome_unknown'].includes(from) ? 'cancel_requested' : 'cancelled'; break;
    case 'cancel_confirmed':
      requireState('cancel_requested'); if (!evidence(event.evidenceRefs)) throw new Error('Remote cancellation evidence required');
      r.evidenceRefs = event.evidenceRefs; r.state = 'cancelled'; break;
    default: throw new Error('Unmapped event');
  }
  // No raw payloads, prompts, keys, credentials or response bodies in the trace.
  r.events.push({ seq: r.events.length + 1, at: new Date(now).toISOString(), type: event.type, from, to: r.state, ...(r.failure ? { errorCode: r.failure } : {}) });
  return r;
}
export function allowedControls(r) {
  if (TERMINAL.has(r.state)) return [];
  if (r.state === 'outcome_unknown') return ['reconcile','cancel'];
  if (r.state === 'retry_wait') return ['retry','cancel'];
  if (r.state === 'awaiting_approval') return ['approve','cancel'];
  if (r.state === 'cancel_requested') return ['confirm-cancellation'];
  if (r.state === 'blocked') return ['inspect-repair','cancel'];
  return ['advance','inject-failure','cancel'];
}
