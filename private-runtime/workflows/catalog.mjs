/** Compatibility projection over the ONE canonical runtime registry: catalog.json.
 * Do not add workflow/state truth here. Edit catalog.json + contracts.mjs instead.
 */
import { readFileSync } from 'node:fs';
import { TRANSITIONS, expandCatalog, transition as contractTransition, validateCatalog } from './contracts.mjs';

export const canonicalCatalog = Object.freeze(JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8')));
const contractStates = Object.keys(TRANSITIONS);
if (canonicalCatalog.states.length !== contractStates.length || canonicalCatalog.states.some((s, i) => s !== contractStates[i])) {
  throw new Error('CATALOG_STATE_DRIFT');
}
export const expandedCatalog = expandCatalog(canonicalCatalog);
validateCatalog(expandedCatalog);

export const schemaVersion = canonicalCatalog.schemaVersion;
export const architecture = Object.freeze(canonicalCatalog.components.map(c => ({
  id: String(c.id).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'),
  title: c.id,
  role: c.role,
  status: 'Canonical runtime component',
})));

export const states = Object.freeze(Object.fromEntries(
  Object.entries(TRANSITIONS).map(([from, tos]) => [from.toLowerCase(), tos.map(to => to.toLowerCase())])
));

export const recovery = Object.freeze([
  { id:'AUTH', failure:'Login or MFA required', action:'Pause and repair the scoped session.', retry:'Only after session validation' },
  { id:'SUBMISSION_UNKNOWN', failure:'Write outcome unknown', action:'Reconcile the recorded action key before any repeat.', retry:'No automatic resubmission' },
  { id:'VERIFY', failure:'Expected evidence missing', action:'Keep the business outcome unverified until independent evidence exists.', retry:'Verification reads only' },
  { id:'CANCEL', failure:'Cancellation requested', action:'Confirm remote stop and reconcile prior side effects.', retry:'Never treat cancellation as rollback' },
]);

export const workflows = Object.freeze(canonicalCatalog.workflows.map(w => ({
  id: w.id,
  version: w.version,
  title: w.name,
  group: w.category,
  trigger: w.owner,
  executor: w.steps.map(s => s[1]).filter((v,i,a)=>a.indexOf(v)===i).join(' + '),
  readiness: w.implementation,
  inputs: w.input,
  steps: w.steps.map(s => s[0]),
  approval: w.steps.some(s => s[2] === 'approval') ? 'Explicit approval step in canonical registry' : 'Workflow-specific policy',
  evidence: w.success,
  repair: w.recovery,
  source: 'private-runtime/workflows/catalog.json',
  retryPolicy: 'Reads bounded; writes reconcile before repeat',
  telemetry: ['run_id','workflow_id','workflow_version','action_key','step_id','state','error_code','evidence_ref'],
})));

export function workflow(id) {
  const value = workflows.find(w => w.id === id);
  if (!value) throw new Error('UNKNOWN_WORKFLOW');
  return value;
}

/** Backward-compatible lower-case facade, enforced by the canonical contract. */
export function transition(from, to, evidence = {}) {
  const upperFrom = String(from).toUpperCase();
  const upperTo = String(to).toUpperCase();
  return contractTransition(upperFrom, upperTo, evidence).toLowerCase();
}
