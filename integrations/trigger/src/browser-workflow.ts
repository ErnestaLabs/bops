import { task, wait, metadata, AbortTaskRunError } from "@trigger.dev/sdk";
import { Pool } from "pg";
import { selfHostedEndpoint, skyvernClient } from "../../../private-runtime/workflows/skyvern-client.mjs";
import { postgresLedger } from "../../../private-runtime/workflows/postgres-ledger.mjs";
import { runApprovedBrowserWorkflow } from "../../../private-runtime/workflows/browser-run.mjs";
import { approvalEnv, ledgerEnv, skyvernEnv } from "../../../private-runtime/workflows/env.mjs";
import { canonicalCatalog } from "../../../private-runtime/workflows/catalog.mjs";

type Payload = {
  canonicalWorkflowId: string;
  action: { actionKey: string; workflowId: string; parameters: Record<string, unknown> };
  approval: { actionKey: string; requestHash: string; expiresAt: number; signature: string };
};

/** Thin Trigger wrapper. The orchestration itself is in
 * private-runtime/workflows/browser-run.mjs so this task and the local runner
 * execute the same code; only the environment, the pool and Trigger's wait
 * primitive differ here.
 *
 * Approval is signed outside this task by the owner-controlled approval
 * process. Only pre-published, explicitly allowlisted Skyvern workflow IDs may
 * execute. Task completion means observation completed, NEVER business
 * verification.
 */
export const browserWorkflow = task({
  id: "ernesta-approved-browser-workflow",
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 1 },
  maxDuration: 1200,
  run: async (payload: Payload) => {
    const canonical = canonicalCatalog.workflows.find(w => w.id === payload.canonicalWorkflowId);
    if (!canonical) throw new AbortTaskRunError("unknown_canonical_workflow");
    const triggerURL = selfHostedEndpoint(process.env.TRIGGER_API_URL);
    if (new URL(triggerURL).hostname.endsWith("trigger.dev")) throw new AbortTaskRunError("Customer-owned Trigger endpoint required");
    if (!process.env.ERNESTA_LEDGER_DATABASE_URL) throw new AbortTaskRunError("Action ledger must be configured and migrated first");
    const { connectionString } = ledgerEnv();
    const { baseURL, apiKey, allowedWorkflowIds } = skyvernEnv();
    const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
    let remoteId: string | undefined;
    try {
      const client = skyvernClient({ baseURL, apiKey });
      const ledger = postgresLedger(pool);
      metadata.set("canonicalWorkflowId", canonical.id);
      metadata.set("businessState", "VALIDATING");
      return await runApprovedBrowserWorkflow({
        client,
        ledger,
        allowedWorkflowIds,
        approvalKey: approvalEnv(),
        action: payload.action,
        approval: payload.approval,
        onState: state => metadata.set("businessState", state),
        onRemoteId: id => { remoteId = id; metadata.set("skyvernRunId", id); },
        // Self-hosted waits may retain compute: this is not a checkpoint claim.
        poll: () => wait.for({ seconds: 5 }),
      });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "orchestration_failed_reconcile_existing_action";
      metadata.set("businessState", remoteId || code === "submission_outcome_unknown" ? "OUTCOME_UNKNOWN" : "FAILED");
      // Raw provider/DB bodies and customer task parameters never enter logs.
      throw new AbortTaskRunError(code);
    } finally { await pool.end(); }
  },
});
