/** The vertical slice: Bops intent -> approval -> single Skyvern submission ->
 * independent read-back -> verified close, with every state change journalled in
 * real Postgres.
 *
 * It runs the production modules (browser-run, skyvern-client, postgres-ledger,
 * verify), not a copy of them. What it cannot prove on a machine without Docker
 * or Skyvern credentials is the vendor hop itself, so it has two modes:
 *
 *   node private-runtime/workflows/slice.mjs --stand-in
 *       exercises everything against a local Skyvern *wire stand-in*. The
 *       stand-in says so in its own output; nothing here is a live result.
 *
 *   ERNESTA_LEDGER_DATABASE_URL=... SKYVERN_API_BASE_URL=... SKYVERN_API_KEY=... \
 *   SKYVERN_ALLOWED_WORKFLOW_IDS=... WORKFLOW_APPROVAL_KEY=... \
 *   node private-runtime/workflows/slice.mjs
 *       the same code against a real Skyvern. It refuses a stand-in endpoint,
 *       so a stand-in result can never be reported as a live one.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { actionIdentity, digest, signApproval } from './contracts.mjs';
import { browserRequest, skyvernClient } from './skyvern-client.mjs';
import { postgresLedger } from './postgres-ledger.mjs';
import { runApprovedBrowserWorkflow, TERMINAL_REMOTE_STATUSES } from './browser-run.mjs';
import { reconcileByLookup } from './dispatch.mjs';
import { closeVerified, verifyBrowserRun } from './verify.mjs';
import { startSkyvernStandIn } from './skyvern-stand-in.mjs';

const args = new Map(process.argv.slice(2).map(a => {
  const [k, ...rest] = a.replace(/^--/, '').split('=');
  return [k, rest.length ? rest.join('=') : true];
}));
const standInMode = args.has('stand-in');
const loseResponse = args.has('lose-response');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function log(event, value) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, value })}\n`);
}

async function refuseStandInInLiveMode(baseURL) {
  try {
    const response = await fetch(`${baseURL.replace(/\/+$/, '')}/__standin/health`, { signal: AbortSignal.timeout(3000) });
    if (response.ok && (await response.json())?.standIn === true) throw new Error('stand_in_endpoint_refused_in_live_mode');
  } catch (error) {
    if (error.message === 'stand_in_endpoint_refused_in_live_mode') throw error;
    // Unreachable health probe is not proof either way; the dispatch path will
    // fail closed on its own if the endpoint is wrong.
  }
}

async function main() {
  const requestPath = args.get('request') || new URL('./example-request.json', import.meta.url).pathname;
  const bopsRequest = JSON.parse(readFileSync(requestPath, 'utf8'));
  const summary = { mode: standInMode ? 'stand-in' : 'live', endpointIsStandIn: standInMode, bopsRequest: requestPath };

  let standIn;
  let baseURL, apiKey, allowedWorkflowIds, approvalKey;
  if (standInMode) {
    standIn = await startSkyvernStandIn();
    if (loseResponse) standIn.loseNextResponse();
    baseURL = standIn.url;
    apiKey = standIn.apiKey;
    allowedWorkflowIds = ['wpid_standin_page_read'];
    // Ephemeral, in-memory, and only for the stand-in. A real run must supply
    // the owner's key from the secret store.
    approvalKey = process.env.WORKFLOW_APPROVAL_KEY ?? randomBytes(32).toString('hex');
    summary.approvalKey = process.env.WORKFLOW_APPROVAL_KEY ? 'from environment' : 'ephemeral (stand-in only)';
  } else {
    const { skyvernEnv, ledgerEnv } = await import('./env.mjs');
    const sv = skyvernEnv();
    baseURL = sv.baseURL; apiKey = sv.apiKey; allowedWorkflowIds = sv.allowedWorkflowIds;
    summary.ledgerDatabase = Boolean(ledgerEnv().connectionString);
    approvalKey = process.env.WORKFLOW_APPROVAL_KEY;
    if (!approvalKey) throw new Error('WORKFLOW_APPROVAL_KEY is required for a live run');
    await refuseStandInInLiveMode(baseURL);
    if (!allowedWorkflowIds.length) throw new Error('SKYVERN_ALLOWED_WORKFLOW_IDS must name the approved workflow');
  }
  summary.endpoint = baseURL;

  const connectionString = process.env.ERNESTA_LEDGER_DATABASE_URL;
  if (!connectionString) throw new Error('ERNESTA_LEDGER_DATABASE_URL is required (real ledger database)');
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 10000 });
  try {
    // Idempotent: the same schema the migration ships.
    await pool.query(readFileSync(new URL('./ledger.sql', import.meta.url), 'utf8'));

    const workflowId = allowedWorkflowIds[0];
    // Bops-side identity: stable for this installation, workflow, version,
    // object and operation, so a resend can never look like new work. Repeating
    // the same identity resumes the recorded action instead of sending again.
    const objectId = String(args.get('object-id') || bopsRequest.actionId);
    const actionKey = actionIdentity({ installationId: 'local-slice', workflowId, version: 1, objectId, operation: 'observe-page' });
    const action = { actionKey, workflowId, parameters: bopsRequest.request };
    const request = browserRequest(action, allowedWorkflowIds);
    const requestHash = digest(request);
    const approval = signApproval({ actionKey, requestHash, expiresAt: Date.now() + 3600_000 }, approvalKey);
    Object.assign(summary, { actionKey, requestHash, workflowId, objectId });

    const client = skyvernClient({ baseURL, apiKey });
    const ledger = postgresLedger(pool);
    // Read-only, because reserving here would itself create the intent row and
    // make the real dispatch look like a replay. Reported so a resumed action is
    // never mistaken for a fresh submission.
    const prior = await pool.query('SELECT remote_id FROM ernesta_workflow_actions WHERE action_key=$1', [actionKey]);
    summary.resumedExistingAction = prior.rowCount > 0;
    if (prior.rowCount > 0) log('resumed_existing_action', prior.rows[0].remote_id ?? 'recorded_without_remote_id');
    const requiredOutputFields = Array.isArray(bopsRequest.request?.data_extraction_schema?.required)
      ? bopsRequest.request.data_extraction_schema.required : [];

    let remoteId; let reconciled = false;
    try {
      const result = await runApprovedBrowserWorkflow({
        client, ledger, allowedWorkflowIds, approvalKey, action, approval,
        onState: state => log('business_state', state),
        onRemoteId: id => { remoteId = id; log('remote_id', id); },
        poll: () => sleep(200), deadlineMs: 60_000,
      });
      remoteId = result.observed.remoteId;
    } catch (error) {
      // A lost write is only expected here when this run is deliberately losing
      // one; anything else must surface instead of being papered over.
      if (error.code !== 'submission_outcome_unknown' || !loseResponse) throw error;
      // The write may have landed. Ask the destination before doing anything.
      reconciled = true;
      log('outcome_unknown', 'reconciling by looking up the action');
      const found = await reconcileByLookup({
        ledger, actionKey, requestHash,
        lookup: async () => {
          const response = await fetch(`${baseURL}/__standin/find?actionKey=${actionKey}`, { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(5000) });
          if (response.status === 404) return null;
          if (!response.ok) throw new Error('lookup_failed');
          const data = await response.json();
          return { remoteId: data.run_id, remoteStatus: data.status };
        },
      });
      remoteId = found.remoteId;
      log('reconciled', remoteId);
      // Finish observing the run we just proved exists.
      for (let i = 0; i < 50; i++) {
        const current = await client.get(remoteId);
        if (TERMINAL_REMOTE_STATUSES.includes(current.remoteStatus)) break;
        await sleep(200);
      }
    }

    const inspected = await client.inspect(remoteId);
    const evidence = verifyBrowserRun(inspected, { requiredOutputFields });
    const finalState = closeVerified(reconciled ? 'OUTCOME_UNKNOWN' : 'VERIFYING', evidence);
    const events = (await pool.query('SELECT event_type FROM ernesta_workflow_events WHERE action_key=$1 ORDER BY event_id', [actionKey])).rows.map(r => r.event_type);

    Object.assign(summary, {
      remoteId, remoteStatus: inspected.remoteStatus, reconciled,
      evidence, finalState, ledgerEvents: events,
      businessOutcomeVerified: !standInMode,
      note: standInMode
        ? 'Stand-in endpoint: the dispatch, ledger, recovery and verification path is real; the Skyvern result is not.'
        : 'Live Skyvern endpoint; result reflects that deployment.',
    });
    log('result', summary);
    process.exitCode = finalState === 'SUCCEEDED' ? 0 : 1;
  } finally {
    await pool.end().catch(() => {});
    if (standIn) await standIn.close();
  }
}

main().catch(error => {
  log('failed', { code: error?.code ?? error?.message ?? 'slice_failed' });
  process.exitCode = 1;
});
