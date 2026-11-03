import { task, wait, metadata, AbortTaskRunError } from "@trigger.dev/sdk";
import { Pool } from "pg";
import { dispatchBrowserWorkflow, selfHostedEndpoint, skyvernClient } from "../../../private-runtime/workflows/skyvern-client.mjs";
import { postgresLedger } from "../../../private-runtime/workflows/postgres-ledger.mjs";

type Payload = {
  action: { actionKey: string; workflowId: string; parameters: Record<string, unknown> };
  approval: { actionKey: string; requestHash: string; expiresAt: number; signature: string };
};

/** Existing Trigger orchestration, not a replacement queue/scheduler.
 * Approval is signed outside this task by the owner-controlled approval process.
 * Only pre-published, explicitly allowlisted Skyvern workflow IDs may execute.
 * Task completion means observation completed, NEVER business verification.
 */
export const browserWorkflow = task({
  id: "ernesta-approved-browser-workflow",
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 1 },
  maxDuration: 1200,
  run: async (payload: Payload) => {
    const triggerURL = selfHostedEndpoint(process.env.TRIGGER_API_URL);
    if (new URL(triggerURL).hostname.endsWith("trigger.dev")) throw new AbortTaskRunError("Customer-owned Trigger endpoint required");
    if (!process.env.ERNESTA_LEDGER_DATABASE_URL) throw new AbortTaskRunError("Action ledger must be configured and migrated first");
    const pool = new Pool({ connectionString: process.env.ERNESTA_LEDGER_DATABASE_URL, max: 2, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
    let remoteId: string | undefined;
    try {
      const client = skyvernClient({ baseURL: process.env.SKYVERN_API_BASE_URL, apiKey: process.env.SKYVERN_API_KEY });
      const allowedWorkflowIds = (process.env.SKYVERN_ALLOWED_WORKFLOW_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
      const ledger = postgresLedger(pool);
      metadata.set("businessState", "VALIDATING");
      let observed = await dispatchBrowserWorkflow({ client, ledger, allowedWorkflowIds, approvalKey: process.env.WORKFLOW_APPROVAL_KEY, ...payload });
      remoteId = observed.remoteId;
      metadata.set("skyvernRunId", observed.remoteId);
      const deadline = Date.now() + 11 * 60 * 1000;
      for (;;) {
        metadata.set("businessState", observed.businessState);
        if (["completed", "failed", "terminated", "canceled", "timed_out"].includes(observed.remoteStatus)) {
          // Operator/verifier must reconcile actual receipt/record/file before
          // changing the business state to SUCCEEDED. Never trust self-report.
          return { ...observed, actionKey: payload.action.actionKey, verificationRequired: true };
        }
        if (Date.now() >= deadline) {
          metadata.set("businessState", "OUTCOME_UNKNOWN");
          throw new AbortTaskRunError("Observation deadline exceeded; reconcile existing remote run, never resubmit");
        }
        // Self-hosted waits may retain compute: this is not a checkpoint claim.
        await wait.for({ seconds: 5 });
        observed = await client.get(observed.remoteId);
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "orchestration_failed_reconcile_existing_action";
      metadata.set("businessState", remoteId || code === "submission_outcome_unknown" ? "OUTCOME_UNKNOWN" : "FAILED");
      // Raw provider/DB bodies and customer task parameters never enter logs.
      throw new AbortTaskRunError(code);
    } finally { await pool.end(); }
  },
});
