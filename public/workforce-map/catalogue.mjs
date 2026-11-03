/** Versioned launch-scope contracts. Mapping is not proof of a deployed integration. */
export const VERSION = '2026-11-03.1';
export const BASE_COMMIT = '7e0ffbfdf1b3bdde7c0781e1a79c82bc90869aa9';
export const COMPONENTS = [
  { id: 'bops', name: 'Bops', role: 'Owner interface, Chief and specialists', state: 'existing-core', note: 'Existing core passed its recorded CI; customer deployment still unverified.' },
  { id: 'trigger', name: 'Trigger.dev', role: 'One top-level scheduler, queues and attempts', state: 'scaffold', version: '4.8.3', note: 'Adapter scaffold, not a running service. Do not activate alongside the same Bops schedules.' },
  { id: 'control', name: 'Workflow contract', role: 'Validation, permissions, action receipts and evidence', state: 'contract-tested', note: 'Executable state model and local action journal. Not a distributed workflow engine.' },
  { id: 'skyvern', name: 'Skyvern', role: 'Browser actions, extraction and artifacts', state: 'scaffold', version: '1.0.56', note: 'Self-hosted API adapter. Live model, browser and network acceptance remain required.' },
  { id: 'harness2', name: 'Harness²', role: 'Offline harness improvement: propose, probe, compose, review', state: 'scaffold', version: '0.1.0', note: 'Apache-2.0 research framework. Runs outside live jobs; candidate harnesses require tests and explicit adoption.' },
  { id: 'docker', name: 'Private computers', role: 'Customer-owned browsers, files and approved egress', state: 'existing-core', note: 'Existing Docker and public-page egress acceptance passed; not yet certified for Skyvern.' },
  { id: 'inference', name: 'Chosen hosted model', role: 'Reasoning and vision, no mandatory local GPU', state: 'deployment-required', note: 'Provider receives selected prompts/screenshots. No Orgo/OpenAI/xAI fallback.' },
];
export const FAILURES = {
  invalid_input: { state: 'failed', retry: false, owner: 'Workflow owner', fix: 'Correct the schema or missing input; create a new intent version.' },
  auth_expired: { state: 'blocked', retry: false, owner: 'Account owner', fix: 'Reconnect the scoped account. Never put passwords in run logs.' },
  needs_mfa: { state: 'blocked', retry: false, owner: 'Account owner', fix: 'Complete the permitted login challenge manually, then revalidate the session.' },
  policy_denied: { state: 'blocked', retry: false, owner: 'Customer administrator', fix: 'Review scope and hostname policy. Do not bypass a denied action.' },
  rate_limited: { state: 'retry_wait', retry: true, owner: 'Execution operator', fix: 'Honor Retry-After within the step budget. Retry only a safe read.' },
  provider_unavailable: { state: 'retry_wait', retry: true, owner: 'Execution operator', fix: 'Check provider health and budget. No silent provider switch.' },
  page_changed: { state: 'blocked', retry: false, owner: 'Browser workflow maintainer', fix: 'Inspect the redacted screenshot/DOM, repair the versioned recipe, and rehearse again.' },
  schema_drift: { state: 'blocked', retry: false, owner: 'Integration maintainer', fix: 'Compare the pinned API contract. Unknown statuses must never count as success.' },
  dispatch_uncertain: { state: 'outcome_unknown', retry: false, owner: 'Execution operator', fix: 'Reconcile remote run IDs and actual external state. Never replay the entire write blindly.' },
  result_mismatch: { state: 'blocked', retry: false, owner: 'Workflow owner', fix: 'Compare the expected receipt or persisted artifact with observed evidence.' },
  budget_exhausted: { state: 'blocked', retry: false, owner: 'Budget owner', fix: 'Stop new calls. Review cost, time and step limits before granting a new budget.' },
  worker_lost: { state: 'outcome_unknown', retry: false, owner: 'Infrastructure operator', fix: 'Recover receipts and inspect remote state before resuming an unsettled action.' },
  storage_unavailable: { state: 'blocked', retry: false, owner: 'Infrastructure operator', fix: 'Restore the journal/database. Never perform a write without durable intent storage.' },
};
const stage = (id, title, owner, effect, timeoutSeconds, attempts, evidence, recovery) => ({ id, title, owner, effect, timeoutSeconds, attempts, evidence, recovery });
const stages = {
  receive: stage('receive', 'Receive and deduplicate', 'Trigger / ingress', 'local', 10, 1, 'Stable operation ID and input digest', 'Reuse the same receipt; reject an ID with different input.'),
  validate: stage('validate', 'Validate scope and input', 'Control layer', 'local', 10, 1, 'Schema version, tenant, permissions and limits', 'Reject unknown inputs; repair configuration, not the live payload.'),
  plan: stage('plan', 'Select the versioned recipe', 'Bops Chief', 'read', 60, 2, 'Recipe version, executor, expected output and plan hash', 'Re-plan only before any external write; keep the prior plan.'),
  approve: stage('approve', 'Obtain bound approval', 'Customer owner', 'local', 3600, 1, 'Actor, exact plan digest, expiry and allowed action', 'Reject expired or changed plans. No waiting browser container required.'),
  dispatch: stage('dispatch', 'Record intent and submit once', 'Control / executor', 'write', 30, 1, 'Durable intent followed by remote run ID', 'A lost response is OUTCOME UNKNOWN, not a retry signal.'),
  observe: stage('observe', 'Observe execution', 'Trigger / executor', 'read', 900, 3, 'Remote status, heartbeat, step ID and artifact references', 'Poll the existing run; never create another run to check progress.'),
  verify: stage('verify', 'Verify the real outcome', 'Evidence verifier', 'read', 60, 2, 'Independent output check and verifiable receipt', 'Executor-completed alone is insufficient. Hold mismatches for review.'),
  report: stage('report', 'Persist outcome and notify', 'Bops / control', 'local', 15, 3, 'Final state, evidence references and notification receipt', 'Retry reporting independently, without redoing the business action.'),
};
// id, category, title, executor, effect, evidence, source/entrypoint, scope status.
const definitions = [
  ['install','Foundation','Install / upgrade a customer instance','operator','write','Version checks, isolated build, health and rollback point','README.md','mapped'],
  ['onboard','Foundation','Onboard a business and bot team','bops','write','Owner identity, tenant scope, bot roles and acceptance record','app/api/owner; app/api/bots','existing-core'],
  ['credentials','Foundation','Connect or rotate credentials','operator','write','Scoped account validation; secret reference only','private-runtime/vault.mjs','existing-core'],
  ['model-check','Foundation','Verify the chosen model','inference','read','Text, tool-call, streaming and vision probe results','private-runtime/doctor.mjs','existing-core'],
  ['chat','Core','Owner conversation','bops','read','Persisted response and local conversation ID','app/api/chats/[id]/messages','existing-core'],
  ['delegate','Core','Chief delegates to a specialist','bops','write','Parent/child run IDs and specialist output','lib/server/sessions.ts','existing-core'],
  ['scheduled-task','Core','Scheduled business task','trigger','write','Unique schedule occurrence and one execution receipt','Trigger adapter; existing Bops scheduler','mapped'],
  ['webhook','Core','Receive an external event','trigger','read','Signature validation, event ID and deduplication record','Signed ingress adapter required','mapped'],
  ['research','Browser','Research approved public websites','skyvern','read','Source URLs, capture times, structured facts and artifacts','Skyvern /v1/run/tasks','adapter'],
  ['login','Browser','Login with human MFA handoff','skyvern','write','Session identity and account-owner confirmation','Skyvern browser / credential setup required','mapped'],
  ['extract','Browser','Extract schema-bound data','skyvern','read','Schema-valid data cross-checked against page evidence','Skyvern /v1/run/tasks','adapter'],
  ['download','Browser','Download a portal document','skyvern','read','File hash, source, size and access scope','Skyvern artifacts; controlled local storage','mapped'],
  ['prepare-form','Browser','Prepare a form without submission','skyvern','write','Field-by-field draft and before-submit evidence','Reviewed bounded browser recipe required','mapped'],
  ['submit-form','Browser','Submit an approved form','skyvern','write','Destination receipt and independent submission lookup','Reviewed browser recipe plus action ledger','mapped'],
  ['inbox-triage','Business','Classify incoming requests','connector','read','Classification, source message ID and routing decision','Mail connector required','mapped'],
  ['crm-update','Business','Create or update a CRM record','connector','write','Record ID, before/after diff and read-back','Customer CRM connector required','mapped'],
  ['followup-draft','Business','Draft a follow-up','bops','read','Draft tied to source facts; no message sent','Business template / CRM read adapter required','mapped'],
  ['send-approved','Business','Send an approved message once','connector','write','Recipient/content hash, send ID and delivery lookup','Customer mail connector + provider idempotency','mapped'],
  ['quote','Business','Prepare a quote for approval','bops','read','Approved price inputs and versioned quote artifact','Pricing source and quote template required','mapped'],
  ['invoice-intake','Business','Read and reconcile an invoice','connector','read','Invoice hash, extracted fields and matching evidence','Document parser and accounting read adapter required','mapped'],
  ['support-response','Business','Resolve or escalate a support case','connector','write','Case history, approved response and resolved-state read-back','Support connector required','mapped'],
  ['daily-report','Business','Produce the daily operating report','trigger','read','Data freshness, source counts and report artifact','Versioned metrics sources required','mapped'],
  ['approval','Recovery','Approve, reject or expire a plan','control','local','Immutable actor/intent/expiry record','Executable state contract; production approval store required','contract-tested'],
  ['retry-read','Recovery','Retry a safe failed read','control','read','Attempt count, backoff and unchanged input digest','Executable state contract','contract-tested'],
  ['reconcile','Recovery','Resolve an uncertain action','operator','write','Independent evidence: applied, not applied or unresolved','Executable state contract; service-specific verifier required','contract-tested'],
  ['cancel','Recovery','Request and confirm cancellation','operator','write','Cancel request plus remote terminal confirmation','Existing Bops stop; Skyvern cancel integration pending','mapped'],
  ['restart','Recovery','Recover after a process restart','control','read','Restored receipts, state and unresolved-action list','Existing Bops restart tests; external ledger contract','existing-core'],
  ['compact','Recovery','Compact context without replay','bops','read','Original snapshot, summary hash and settled-tool references','private-runtime/compaction.mjs','existing-core'],
  ['repair','Operations','Diagnose and repair a failed recipe','harness2','write','Incident bundle, candidate harness diff, probe evidence, reviewed patch and successful rehearsal','Harness² sandbox + versioned source + CI','mapped'],
  ['backup','Operations','Back up and test restore','operator','write','Encrypted backup manifest and separate restore check','Operator runbook required','mapped'],
  ['provider-switch','Operations','Change the inference provider','operator','write','Owner approval, new probes and no in-flight silent switch','private-runtime/doctor.mjs','mapped'],
  ['audit','Operations','Inspect retention and access history','operator','read','Run/step/action correlation and redacted export','Workflow status endpoint; retention policy required','mapped'],
];
export const FLOWS = definitions.map(([id,category,title,executor,effect,evidence,entrypoint,implementation]) => ({
  id, version: 1, category, title, executor, effect, evidence, entrypoint, implementation,
  launch: implementation === 'existing-core' ? 'Existing component, not complete workflow certification' : 'Not enabled for live dispatch',
  inputs: ['tenantId','operationId','workflowVersion','inputDigest','budget','permissionScope'],
  outputs: ['state','executorRunId','evidenceRefs','attemptCount','errorCode','nextAction'],
  steps: ['receive','validate','plan', ...(effect === 'write' ? ['approve'] : []),'dispatch','observe','verify','report'].map(key => ({ ...stages[key], ...(key === 'verify' ? { evidence } : {}) })),
  failurePaths: Object.keys(FAILURES),
  limits: { maxAttempts: 3, maxRunSeconds: 900, maxBrowserSteps: 30, maxModelCalls: 40, costCeiling: 'Customer must configure before live activation' },
}));
export const STATUS_LEGEND = {
  'existing-core': 'Existing component with recorded CI evidence; not a claim that this mapped workflow is deployed.',
  adapter: 'HTTP adapter contract implemented and locally testable; live service unverified.',
  'contract-tested': 'State contract implemented; not a live business integration.',
  mapped: 'Specified interface and recovery path; executor/configuration still required.',
};
export function validateCatalogue(flows = FLOWS) {
  const ids = new Set();
  for (const f of flows) {
    if (ids.has(f.id) || !/^[a-z][a-z0-9-]+$/.test(f.id)) throw new Error('Invalid or duplicate workflow ID');
    ids.add(f.id);
    if (!f.evidence || !f.entrypoint || !STATUS_LEGEND[f.implementation]) throw new Error(`Incomplete contract: ${f.id}`);
    if (f.effect === 'write' && !f.steps.some(s => s.id === 'approve')) throw new Error('Write workflow needs approval');
    for (const s of f.steps) if (!s.evidence || !s.recovery || s.timeoutSeconds < 1 || (s.effect === 'write' && s.attempts !== 1)) throw new Error('Unsafe step contract');
    if (f.steps.findIndex(s => s.id === 'verify') < f.steps.findIndex(s => s.id === 'dispatch')) throw new Error('Missing outcome verification');
    for (const key of Object.keys(FAILURES)) if (!f.failurePaths.includes(key)) throw new Error('Missing failure path');
  }
  return { workflows: flows.length, steps: flows.reduce((n,f) => n + f.steps.length,0), failureClasses: Object.keys(FAILURES).length };
}
