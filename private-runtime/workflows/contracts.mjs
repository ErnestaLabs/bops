/** Business-state contracts, not a second scheduler or agent framework. */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
export class WorkflowError extends Error {
  constructor(code, message = code) { super(message); this.name = 'WorkflowError'; this.code = code; }
}
export const TRANSITIONS = Object.freeze({
  RECEIVED: ['VALIDATING','CANCELLED'], VALIDATING: ['QUEUED','WAITING_APPROVAL','FAILED'],
  QUEUED: ['RUNNING','CANCELLING'], RUNNING: ['WAITING_APPROVAL','VERIFYING','RETRYABLE_FAILURE','FAILED','OUTCOME_UNKNOWN','CANCELLING'],
  WAITING_APPROVAL: ['QUEUED','RUNNING','FAILED','CANCELLING'], VERIFYING: ['SUCCEEDED','FAILED','OUTCOME_UNKNOWN','CANCELLING'],
  RETRYABLE_FAILURE: ['QUEUED','FAILED','CANCELLING'], OUTCOME_UNKNOWN: ['RECONCILING'],
  RECONCILING: ['VERIFYING','FAILED','OUTCOME_UNKNOWN','CANCELLED'], CANCELLING: ['CANCELLED','OUTCOME_UNKNOWN'],
  SUCCEEDED: [], FAILED: [], CANCELLED: [],
});
/** An executor or model reporting its own success is never verification, and an
 * empty verifier name is not one either. Shared so every gate agrees.
 */
const SELF_REPORT = /^(?:model|executor|agent|trigger|worker|llm)-self-report$/;
export const isIndependentVerifier = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 64 && !SELF_REPORT.test(v.trim());
export function transition(from, to, evidence = {}) {
  if (!TRANSITIONS[from]?.includes(to)) throw new WorkflowError('invalid_transition');
  if (to === 'SUCCEEDED' && !(evidence.verified === true && isIndependentVerifier(evidence.verifier) && typeof evidence.receiptId === 'string' && evidence.receiptId.trim().length > 0)) throw new WorkflowError('verification_required');
  if (from === 'CANCELLING' && to === 'CANCELLED' && evidence.stopped !== true) throw new WorkflowError('stop_confirmation_required');
  return to;
}
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  throw new WorkflowError('non_json_value');
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export function actionIdentity({ installationId, workflowId, version, objectId, operation }) {
  for (const v of [installationId, workflowId, objectId, operation]) if (typeof v !== 'string' || !v.trim() || v.length > 256) throw new WorkflowError('invalid_action_identity');
  if (!Number.isInteger(version) || version < 1) throw new WorkflowError('invalid_workflow_version');
  return digest({ installationId, workflowId, version, objectId, operation });
}
function approvalKey(key) {
  if (typeof key !== 'string' || !/^[a-f\d]{64}$/i.test(key)) throw new WorkflowError('approval_key_missing');
  return Buffer.from(key, 'hex');
}
/** Call only in an owner-controlled approval process. Never give its key to a browser/model. */
export function signApproval({ actionKey, requestHash, expiresAt }, key) {
  if (!/^[a-f\d]{64}$/.test(actionKey) || !/^[a-f\d]{64}$/.test(requestHash) || !Number.isSafeInteger(expiresAt)) throw new WorkflowError('invalid_approval');
  const body = { actionKey, requestHash, expiresAt };
  return { ...body, signature: createHmac('sha256', approvalKey(key)).update(canonical(body)).digest('hex') };
}
export function verifyApproval(approval, { actionKey, requestHash }, key, now = Date.now()) {
  if (!approval || approval.actionKey !== actionKey || approval.requestHash !== requestHash || !Number.isSafeInteger(approval.expiresAt) || approval.expiresAt <= now || approval.expiresAt > now + 86400000) throw new WorkflowError('approval_invalid_or_expired');
  const expected = signApproval(approval, key).signature;
  if (typeof approval.signature !== 'string' || !/^[a-f\d]{64}$/.test(approval.signature) || !timingSafeEqual(Buffer.from(approval.signature, 'hex'), Buffer.from(expected, 'hex'))) throw new WorkflowError('approval_signature_invalid');
  return true;
}
export function validateCatalog(catalog) {
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.workflows)) throw new WorkflowError('invalid_catalog');
  const ids = new Set();
  for (const w of catalog.workflows) {
    if (ids.has(w.id) || !w.owner || !w.input || !w.success || !w.recovery || !w.runbook) throw new WorkflowError('invalid_workflow');
    ids.add(w.id); const nodes = new Set(); let approval = false;
    for (const n of w.nodes) {
      if (nodes.has(n.id) || !n.evidence?.length || !n.repair || !Number.isInteger(n.timeoutSeconds) || n.timeoutSeconds < 1 || n.timeoutSeconds > 1800 || !Number.isInteger(n.maxAttempts) || n.maxAttempts < 1 || n.maxAttempts > 3) throw new WorkflowError('invalid_step');
      if (n.kind === 'approval') approval = true;
      if (n.kind === 'write' && (n.maxAttempts !== 1 || (n.approvalRequired && !approval) || n.onFailure !== 'OUTCOME_UNKNOWN')) throw new WorkflowError('unsafe_write_contract');
      nodes.add(n.id);
    }
    if (w.edges.length !== w.nodes.length - 1 || w.edges.some((e, i) => e.from !== w.nodes[i].id || e.to !== w.nodes[i+1].id || !e.when)) throw new WorkflowError('invalid_edges');
  }
  return { workflows: ids.size, steps: catalog.workflows.reduce((n,w) => n + w.nodes.length, 0) };
}

/** Expand the compact editable registry into explicit per-step contracts. */
export function expandCatalog(catalog) {
  if (catalog.format !== 'compact-v1') return catalog;
  const correlation = ['installation_id','workflow_id','workflow_version','run_id','step_id','action_key','trigger_run_id','skyvern_run_id','evidence_id'];
  return { ...catalog, format: 'expanded-v1', workflows: catalog.workflows.map(w => {
    const nodes = w.steps.map(([label,component,kind], i) => ({
      id: `${w.id}.${String(i+1).padStart(2,'0')}`, label, component, kind,
      timeoutSeconds: component === 'Skyvern' ? 300 : 60,
      maxAttempts: ['write','approval'].includes(kind) ? 1 : 3,
      approvalRequired: kind === 'write' && w.id !== 'cancel',
      evidence: [i === w.steps.length-1 ? w.success : `${label}: timestamped result or explicit failure`],
      onFailure: kind === 'write' ? 'OUTCOME_UNKNOWN' : kind === 'approval' ? 'WAITING_APPROVAL' : 'FAILED',
      repair: w.recovery,
    }));
    const { steps, ...definition } = w;
    return { ...definition, deployment:'not-activated', nodes, edges:nodes.slice(0,-1).map((n,i)=>({from:n.id,to:nodes[i+1].id,when:'step evidence accepted'})), correlation,
      limits:{maxRuntimeSeconds:1800,maxReadAttempts:3,writeAttempts:1,concurrencyPerBusinessObject:1}, runbook:`RB-${w.id.toUpperCase()}` };
  }) };
}
