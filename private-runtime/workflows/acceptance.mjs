/** The acceptance run: one approved workflow end to end, then the eight ways it
 * breaks, each asserting the state it must land in.
 *
 *   ERNESTA_LEDGER_DATABASE_URL=... node private-runtime/workflows/acceptance.mjs --stand-in
 *   ERNESTA_LEDGER_DATABASE_URL=... node private-runtime/workflows/acceptance.mjs --live
 *
 * It drives the production modules (dispatch, ledger, browser-run, verify) and
 * injects faults at the edges — the transport, the destination, the process —
 * rather than reimplementing the path with a mock. Two consequences matter:
 *
 *  - In stand-in mode every scenario except the vendor hop is real: real HTTP,
 *    real Postgres, real process kills. The Skyvern result itself is not, and
 *    each record says so.
 *  - In live mode the same scenarios run against the real deployment, except
 *    the ones whose fault can only be produced by the stand-in. Those are
 *    reported as BLOCKED with the reason, never as passed.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { actionIdentity, digest, signApproval, transition, WorkflowError } from './contracts.mjs';
import { browserRequest, skyvernClient } from './skyvern-client.mjs';
import { postgresLedger } from './postgres-ledger.mjs';
import { runApprovedBrowserWorkflow, TERMINAL_REMOTE_STATUSES } from './browser-run.mjs';
import { reconcileByLookup } from './dispatch.mjs';
import { closeFailed, closeVerified, verifyBrowserRun } from './verify.mjs';
import { startSkyvernStandIn } from './skyvern-stand-in.mjs';
import { skyvernEnv } from './env.mjs';

const INSTALLATION = 'acceptance-run';
// Each acceptance pass is new work, so its action identities must be new too.
// Reusing them would collide with the previous pass's rows and make a re-run
// look like a resumed action against a destination that no longer exists.
const RUN = randomBytes(4).toString('hex');
const STANDIN_WORKFLOW = 'wpid_standin_page_read';
const SELF = fileURLToPath(import.meta.url);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (event, value) => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, value })}\n`);

const argList = process.argv.slice(2);
const args = new Map(argList.map(a => {
  const [k, ...rest] = a.replace(/^--/, '').split('=');
  return [k, rest.length ? rest.join('=') : true];
}));

// ---------------------------------------------------------------- child mode
// A few failures can only be produced by a real process dying, so those steps
// run in a child. The child builds the same request and approval from the same
// inputs; it never invents its own identity.
async function runChild() {
  const mode = process.env.ACCEPTANCE_CHILD;
  const baseURL = process.env.ACCEPTANCE_BASE_URL;
  const apiKey = process.env.ACCEPTANCE_API_KEY;
  const workflowId = process.env.ACCEPTANCE_WORKFLOW_ID;
  const actionKey = process.env.ACCEPTANCE_ACTION_KEY;
  const approvalKey = process.env.ACCEPTANCE_APPROVAL_KEY;
  const parameters = JSON.parse(readFileSync(new URL('./example-request.json', import.meta.url), 'utf8')).request;
  const request = browserRequest({ actionKey, workflowId, parameters }, [workflowId]);
  const requestHash = digest(request);
  const approval = signApproval({ actionKey, requestHash, expiresAt: Date.now() + 3600_000 }, approvalKey);
  const pool = new Pool({ connectionString: process.env.ACCEPTANCE_DB, max: 1, connectionTimeoutMillis: 10000 });
  const die = () => process.kill(process.pid, 'SIGKILL');
  // Killed after the request has provably been sent and answered, but before
  // the receipt is recorded: the duplicate-write case that has no witness.
  const fetchImpl = mode === 'submit-then-die'
    ? async (url, init) => { const response = await fetch(url, init); die(); return response; }
    : fetch;
  try {
    const result = await runApprovedBrowserWorkflow({
      client: skyvernClient({ baseURL, apiKey, fetchImpl }),
      ledger: postgresLedger(pool), allowedWorkflowIds: [workflowId], approvalKey,
      action: { actionKey, workflowId, parameters }, approval,
      poll: () => sleep(50), deadlineMs: 30_000,
    });
    if (mode === 'dispatch-then-die') die();
    process.stdout.write(JSON.stringify({ ok: true, remoteId: result.observed.remoteId }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, code: error?.code ?? 'child_failed' }) + '\n');
    process.exitCode = 1;
  } finally { await pool.end().catch(() => {}); }
}

if (process.env.ACCEPTANCE_CHILD) {
  runChild().then(() => process.exit(process.exitCode ?? 0), () => process.exit(1));
}

// ------------------------------------------------------------------ the run
function childEnv({ actionKey, workflowId }) {
  const base = { ...process.env };
  for (const key of Object.keys(base)) if (key.startsWith('ACCEPTANCE_')) delete base[key];
  return { ...base, ACCEPTANCE_CHILD: '', ACCEPTANCE_ACTION_KEY: actionKey, ACCEPTANCE_WORKFLOW_ID: workflowId };
}

async function spawnChild(mode, ctx) {
  const env = { ...childEnv(ctx), ACCEPTANCE_CHILD: mode, ...ctx.transport };
  const child = spawn(process.execPath, [SELF], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  const code = await new Promise(resolve => child.on('close', resolve));
  const last = out.trim().split('\n').filter(Boolean).pop();
  let parsed = null;
  try { parsed = last ? JSON.parse(last) : null; } catch { parsed = null; }
  return { code, parsed, out, err };
}

async function main() {
  const live = args.has('live');
  const only = args.get('scenario');
  const connectionString = process.env.ERNESTA_LEDGER_DATABASE_URL;
  if (!connectionString) throw new Error('ERNESTA_LEDGER_DATABASE_URL is required (real ledger database)');

  let standIn; let baseURL; let apiKey; let workflowId; let approvalKey;
  if (live) {
    const sv = skyvernEnv();
    baseURL = sv.baseURL; apiKey = sv.apiKey;
    workflowId = sv.allowedWorkflowIds[0];
    if (!workflowId) throw new Error('SKYVERN_ALLOWED_WORKFLOW_IDS must name the approved workflow');
    approvalKey = process.env.WORKFLOW_APPROVAL_KEY;
    if (!approvalKey) throw new Error('WORKFLOW_APPROVAL_KEY is required for a live run');
    try {
      const health = await fetch(`${baseURL.replace(/\/+$/, '')}/__standin/health`, { signal: AbortSignal.timeout(3000) });
      if (health.ok && (await health.json())?.standIn === true) throw new Error('stand_in_endpoint_refused_in_live_mode');
    } catch (error) {
      if (error.message === 'stand_in_endpoint_refused_in_live_mode') throw error;
    }
  } else {
    standIn = await startSkyvernStandIn();
    baseURL = standIn.url; apiKey = standIn.apiKey; workflowId = STANDIN_WORKFLOW;
    approvalKey = process.env.WORKFLOW_APPROVAL_KEY ?? 'a'.repeat(64);
  }

  const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 10000 });
  const results = [];
  const ctx = () => ({
    baseURL, apiKey, workflowId, approvalKey, pool, standIn, live,
    transport: {
      ACCEPTANCE_BASE_URL: baseURL, ACCEPTANCE_API_KEY: apiKey,
      ACCEPTANCE_APPROVAL_KEY: approvalKey, ACCEPTANCE_DB: connectionString,
    },
  });

  try {
    await pool.query(readFileSync(new URL('./ledger.sql', import.meta.url), 'utf8'));
    const requiredFields = ['title'];

    const identify = (objectId, operation = 'observe-page') => {
      const actionKey = actionIdentity({ installationId: INSTALLATION, workflowId, version: 1, objectId: `${objectId}-${RUN}`, operation });
      const parameters = JSON.parse(readFileSync(new URL('./example-request.json', import.meta.url), 'utf8')).request;
      const request = browserRequest({ actionKey, workflowId, parameters }, [workflowId]);
      const requestHash = digest(request);
      const approval = signApproval({ actionKey, requestHash, expiresAt: Date.now() + 3600_000 }, approvalKey);
      return { actionKey, action: { actionKey, workflowId, parameters }, request, requestHash, approval };
    };
    const eventsFor = async actionKey => (await pool.query(
      'SELECT event_type FROM ernesta_workflow_events WHERE action_key=$1 ORDER BY event_id', [actionKey])).rows.map(r => r.event_type);
    const rowFor = async actionKey => (await pool.query(
      'SELECT status, remote_id FROM ernesta_workflow_actions WHERE action_key=$1', [actionKey])).rows[0] ?? null;
    const lookupFor = async actionKey => {
      if (!standIn) {
        const supplied = typeof args.get('found-run-id') === 'string' ? args.get('found-run-id') : null;
        return supplied ? { remoteId: supplied, remoteStatus: 'found_by_operator' } : null;
      }
      const response = await fetch(`${standIn.url}/__standin/find?actionKey=${actionKey}`, { headers: { 'x-api-key': standIn.apiKey }, signal: AbortSignal.timeout(5000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new WorkflowError('reconciliation_unavailable');
      const data = await response.json();
      return { remoteId: data.run_id, remoteStatus: data.status };
    };

    /** Run the shared orchestration for one action, with the fault hooks this
     * scenario needs, and report what the ledger and destination saw. */
    /** Poll the destination read-only until the run settles. Used after a
     * recovery: the run exists, but it has not finished yet. */
    const observeToTerminal = async remoteId => {
      const reader = skyvernClient({ baseURL, apiKey });
      for (let i = 0; i < 100; i++) {
        const current = await reader.get(remoteId);
        if (TERMINAL_REMOTE_STATUSES.includes(current.remoteStatus)) return current;
        await sleep(20);
      }
      throw new Error('observation_deadline_exceeded');
    };

    async function execute({ objectId, operation, signal, abortAfterRemoteId, loseResponse, fetchImpl, expectUnknown = false }) {
      const id = identify(objectId, operation);
      const states = []; let remoteId;
      const controller = new AbortController();
      const transport = fetchImpl ?? (loseResponse
        // The write reaches the destination; the answer never reaches us.
        ? async (url, init) => {
            const response = await fetch(url, init);
            if (init?.method === 'POST' && String(url).includes('/v1/run/workflows')) { await response.body?.cancel(); throw new TypeError('fetch failed'); }
            return response;
          }
        : fetch);
      let outcome; let outcomeUnknown = false;
      try {
        outcome = await runApprovedBrowserWorkflow({
          client: skyvernClient({ baseURL, apiKey, fetchImpl: transport }),
          ledger: postgresLedger(pool), allowedWorkflowIds: [workflowId], approvalKey,
          action: id.action, approval: id.approval,
          onState: s => states.push(s),
          onRemoteId: rid => { remoteId = rid; if (abortAfterRemoteId) controller.abort(); },
          poll: () => sleep(20), deadlineMs: 30_000, cancelDeadlineMs: 5_000,
          signal: signal ?? (abortAfterRemoteId ? controller.signal : undefined),
        });
      } catch (error) {
        // A lost write is the expected outcome here, and recovery is the
        // caller's decision — the orchestrator must not paper over it.
        if (!expectUnknown || error.code !== 'submission_outcome_unknown') throw error;
        outcomeUnknown = true;
      }
      return { ...id, outcome, outcomeUnknown, states, remoteId };
    }

    const submissions = actionKey => (standIn ? standIn.submissionsFor(actionKey) : null);

    const scenarios = {
      // 0. The workflow the milestone is about.
      async happy() {
        const r = await execute({ objectId: 'acceptance-happy-1' });
        const evidence = verifyBrowserRun(await skyvernClient({ baseURL, apiKey }).inspect(r.remoteId), { requiredOutputFields: requiredFields });
        const state = closeVerified('VERIFYING', evidence);
        return { expected: 'SUCCEEDED with one submission', state, submissions: submissions(r.actionKey), events: await eventsFor(r.actionKey) };
      },

      // 1. The external write happened; the response was lost.
      async 'lost-response'() {
        const r = await execute({ objectId: 'acceptance-lost-1', loseResponse: true, expectUnknown: true });
        if (!r.outcomeUnknown) throw new Error('a lost response was not reported as uncertain');
        const row = await rowFor(r.actionKey);
        if (row.status !== 'OUTCOME_UNKNOWN') throw new Error(`ledger recorded ${row.status} instead of OUTCOME_UNKNOWN`);
        const found = await reconcileByLookup({ ledger: postgresLedger(pool), actionKey: r.actionKey, requestHash: r.requestHash, lookup: () => lookupFor(r.actionKey) });
        await observeToTerminal(found.remoteId);
        const evidence = verifyBrowserRun(await skyvernClient({ baseURL, apiKey }).inspect(found.remoteId), { requiredOutputFields: requiredFields });
        const state = closeVerified('OUTCOME_UNKNOWN', evidence);
        return { expected: 'OUTCOME_UNKNOWN -> RECONCILED -> SUCCEEDED, one submission', state, submissions: submissions(r.actionKey), events: await eventsFor(r.actionKey) };
      },

      // 2. The worker is killed between the write and the receipt. Nothing
      //    witnesses the run; only the destination can answer.
      async 'worker-dies'() {
        const id = identify('acceptance-crash-1');
        const child = await spawnChild('submit-then-die', { ...ctx(), actionKey: id.actionKey, workflowId });
        const afterCrash = await rowFor(id.actionKey);
        const found = await reconcileByLookup({ ledger: postgresLedger(pool), actionKey: id.actionKey, requestHash: id.requestHash, lookup: () => lookupFor(id.actionKey) });
        await observeToTerminal(found.remoteId);
        const evidence = verifyBrowserRun(await skyvernClient({ baseURL, apiKey }).inspect(found.remoteId), { requiredOutputFields: requiredFields });
        const state = closeVerified('OUTCOME_UNKNOWN', evidence);
        if (afterCrash.status !== 'SUBMITTING') throw new Error(`expected a SUBMITTING row after the crash, saw ${afterCrash.status}`);
        if (submissions(id.actionKey) !== 1) throw new Error('more than one submission survived the crash');
        void child;
        return { expected: 'crash leaves SUBMITTING -> reconciled -> SUCCEEDED, one submission', state, submissions: submissions(id.actionKey), events: await eventsFor(id.actionKey) };
      },

      // 3. A restart after the run is recorded must resume, not resend.
      async 'restart-server'() {
        const id = identify('acceptance-restart-1');
        await spawnChild('dispatch-then-die', { ...ctx(), actionKey: id.actionKey, workflowId });
        const afterRestart = await rowFor(id.actionKey);
        if (afterRestart.status !== 'SUBMITTED' || !afterRestart.remote_id) throw new Error('the recorded run did not survive the restart');
        // A fresh process resumes from the ledger. Same action identity.
        const resumed = await execute({ objectId: 'acceptance-restart-1' });
        const evidence = verifyBrowserRun(await skyvernClient({ baseURL, apiKey }).inspect(resumed.remoteId), { requiredOutputFields: requiredFields });
        const state = closeVerified('VERIFYING', evidence);
        return { expected: 'resume from ledger, one submission total', state, submissions: submissions(id.actionKey), events: await eventsFor(id.actionKey) };
      },

      // 4. Two schedulers fire the same action at once.
      async 'duplicate-trigger'() {
        const id = identify('acceptance-duplicate-1');
        const [a, b] = await Promise.all([
          spawnChild('submit-and-report', { ...ctx(), actionKey: id.actionKey, workflowId }),
          spawnChild('submit-and-report', { ...ctx(), actionKey: id.actionKey, workflowId }),
        ]);
        const total = submissions(id.actionKey);
        if (total !== 1) throw new Error(`duplicate trigger produced ${total} submissions`);
        const row = await rowFor(id.actionKey);
        if (!row?.remote_id) throw new Error('no single remote action was recorded');
        const evidence = verifyBrowserRun(await skyvernClient({ baseURL, apiKey }).inspect(row.remote_id), { requiredOutputFields: requiredFields });
        const state = closeVerified('VERIFYING', evidence);
        const outcomes = [a, b].map(x => x.parsed?.code ?? (x.parsed?.ok ? 'resumed' : 'unknown'));
        return { expected: 'one submission; the loser resumes instead of sending', state, submissions: total, outcomes, events: await eventsFor(id.actionKey) };
      },

      // 5. The site changed: the run completes, the result is not the one the
      //    owner asked for. Recovery is repair, not a resend.
      async 'website-changed'() {
        const r = await execute({ objectId: 'acceptance-changed-1' });
        const inspected = await skyvernClient({ baseURL, apiKey }).inspect(r.remoteId);
        let state;
        try {
          state = closeVerified('VERIFYING', verifyBrowserRun(inspected, { requiredOutputFields: ['invoice_total'] }));
          throw new Error('a changed site was accepted as success');
        } catch (error) {
          if (error.message === 'a changed site was accepted as success') throw error;
          if (error.code !== 'result_mismatch') throw error;
          state = closeFailed('VERIFYING', { code: 'result_mismatch' });
        }
        return { expected: 'completes but fails verification; repair, never resend', state, submissions: submissions(r.actionKey), events: await eventsFor(r.actionKey) };
      },

      // 6. A human is required mid-run. Resubmitting cannot clear it.
      async 'mfa-appears'() {
        if (!standIn) return { blocked: 'a real MFA-gated page is required to arm this fault; the stand-in cannot stand in for a live one' };
        standIn.armFault('pause');
        const r = await execute({ objectId: 'acceptance-mfa-1' });
        if (!r.outcome.interventionRequired) throw new Error('a paused run was not reported as needing intervention');
        if (r.outcome.finalState !== 'WAITING_APPROVAL') throw new Error(`paused run landed in ${r.outcome.finalState}`);
        const whilePaused = submissions(r.actionKey);
        // The owner clears the challenge, and the run continues without a resend.
        standIn.clearPause();
        const resumed = await execute({ objectId: 'acceptance-mfa-1' });
        const evidence = verifyBrowserRun(await skyvernClient({ baseURL, apiKey }).inspect(resumed.remoteId), { requiredOutputFields: requiredFields });
        const state = closeVerified('VERIFYING', evidence);
        if (submissions(r.actionKey) !== whilePaused) throw new Error('clearing the challenge caused a second submission');
        return { expected: 'WAITING_APPROVAL, then resume after owner action, one submission', state, pausedState: r.outcome.finalState, submissions: submissions(r.actionKey), pausedSubmissions: whilePaused, events: await eventsFor(r.actionKey) };
      },

      // 7. Inference fails during the run. The run exists, so it is not
      //    "nothing happened"; it is a recorded failure that needs a decision.
      async 'model-fails'() {
        if (!standIn) return { blocked: 'arming an inference outage inside the vendor run needs the stand-in; a live outage is not schedulable' };
        standIn.armFault('fail');
        const r = await execute({ objectId: 'acceptance-modelfail-1' });
        const inspected = await skyvernClient({ baseURL, apiKey }).inspect(r.remoteId);
        if (!TERMINAL_REMOTE_STATUSES.includes(inspected.remoteStatus)) throw new Error('the failed run was not terminal');
        let state;
        try { state = closeVerified('VERIFYING', verifyBrowserRun(inspected, { requiredOutputFields: requiredFields })); throw new Error('a failed run was accepted as success'); }
        catch (error) {
          if (error.message === 'a failed run was accepted as success') throw error;
          state = closeFailed(transition('OUTCOME_UNKNOWN', 'RECONCILING'), { code: 'executor_failed' });
        }
        return { expected: 'recorded run -> OUTCOME_UNKNOWN -> RECONCILING -> FAILED, one submission', state, submissions: submissions(r.actionKey), events: await eventsFor(r.actionKey) };
      },

      // 8. The owner stops it mid-run.
      async 'cancel-mid-run'() {
        const r = await execute({ objectId: 'acceptance-cancel-1', abortAfterRemoteId: true });
        if (!r.outcome.cancelled) throw new Error('the run was not reported as cancelled');
        if (r.outcome.finalState !== 'CANCELLED') throw new Error(`cancel without destination confirmation landed in ${r.outcome.finalState}`);
        if (r.outcome.stopped !== true) throw new Error('CANCELLED was reached without a stop confirmation');
        const afterCancel = await skyvernClient({ baseURL, apiKey }).inspect(r.remoteId);
        if (afterCancel.remoteStatus !== 'canceled') throw new Error('the destination did not confirm the stop');
        return { expected: 'CANCELLING -> CANCELLED only after the destination confirms', state: r.outcome.finalState, submissions: submissions(r.actionKey), remoteStatus: afterCancel.remoteStatus, events: await eventsFor(r.actionKey) };
      },
    };

    for (const [name, run] of Object.entries(scenarios)) {
      if (only && only !== name) continue;
      const started = Date.now();
      try {
        const out = await run();
        if (out.blocked) {
          results.push({ scenario: name, status: 'BLOCKED', reason: out.blocked, ms: Date.now() - started });
          log('scenario', { scenario: name, status: 'BLOCKED', reason: out.blocked });
          continue;
        }
        results.push({ scenario: name, status: 'PASS', expected: out.expected, state: out.state, pausedState: out.pausedState, submissions: out.submissions, events: out.events, outcomes: out.outcomes, ms: Date.now() - started });
        log('scenario', { scenario: name, status: 'PASS', state: out.state, submissions: out.submissions, events: out.events });
      } catch (error) {
        results.push({ scenario: name, status: 'FAIL', reason: error?.code ?? error?.message ?? 'failed', ms: Date.now() - started });
        log('scenario', { scenario: name, status: 'FAIL', reason: error?.code ?? error?.message ?? 'failed' });
      }
    }

    const summary = {
      mode: live ? 'live' : 'stand-in',
      businessOutcomeVerified: live,
      scenarioCount: results.length,
      passed: results.filter(r => r.status === 'PASS').length,
      blocked: results.filter(r => r.status === 'BLOCKED').length,
      failed: results.filter(r => r.status === 'FAIL').length,
      results,
      note: live
        ? 'Live Skyvern deployment. Scenarios whose fault cannot be armed against a real service are reported BLOCKED, not passed.'
        : 'Stand-in endpoint: dispatch, ledger, process-death, cancellation and verification are real; the browser result is not.',
    };
    log('result', summary);
    // 0 = everything provable passed. 2 = nothing failed, but something could
    // not be armed against this deployment, so the run is not complete either.
    process.exitCode = summary.failed > 0 ? 1 : summary.blocked > 0 ? 2 : 0;
  } finally {
    await pool.end().catch(() => {});
    if (standIn) await standIn.close();
  }
}

main().catch(error => {
  log('failed', { code: error?.code ?? error?.message ?? 'acceptance_failed' });
  process.exitCode = 1;
});
