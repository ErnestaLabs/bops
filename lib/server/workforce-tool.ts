import "server-only";
import { NeedsOk } from "./permission";
import { CANONICAL_WORKFLOW_IDS, queueApprovedWorkflow, triggerConfigured, workflowDispatchPlan } from "@/private-runtime/workflows/workforce-dispatch.mjs";

export const WORKFORCE_TOOL = {
  type: "function",
  name: "queue_workflow",
  description:
    "Queue one reviewed canonical Ernesta workflow on the customer's self-hosted Trigger runtime. Use only for a top-level business workflow that matches a canonical workflow ID. Never invent workflow IDs, credentials, passwords, cookies or API keys in parameters. This always requires the owner's approval before dispatch.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["canonicalWorkflowId", "executorWorkflowId", "objectId", "operation", "parameters"],
    properties: {
      canonicalWorkflowId: { type: "string", enum: CANONICAL_WORKFLOW_IDS },
      executorWorkflowId: { type: "string", description: "A pre-published executor workflow ID configured on this customer server." },
      objectId: { type: "string", description: "Stable business-object identity, e.g. invoice-42 or lead-abc." },
      operation: { type: "string", description: "Stable operation name, e.g. submit, research, update." },
      parameters: { type: "object", additionalProperties: true, description: "Executor parameters. Never include credentials or secrets." },
    },
  },
  strict: true,
} as const;

export const workforceToolAvailable = () => process.env.BOPS_PRIVATE_RUNTIME === "1" && triggerConfigured(process.env);

const preview = (plan: ReturnType<typeof workflowDispatchPlan>) =>
  JSON.stringify(
    {
      canonicalWorkflow: `${plan.canonicalWorkflowId}@${plan.canonicalVersion}`,
      canonicalName: plan.canonicalName,
      executor: plan.executor,
      executorWorkflowId: plan.executorWorkflowId,
      objectId: plan.objectId,
      operation: plan.operation,
      actionKey: plan.actionKey,
      requestHash: plan.requestHash,
      parameters: plan.parameters,
    },
    null,
    2,
  );

export async function runWorkforceTool(args: Record<string, unknown>, opts: { approved?: boolean } = {}): Promise<string> {
  if (!workforceToolAvailable()) throw new Error("Self-hosted Trigger workflow execution is not configured.");
  const plan = workflowDispatchPlan(args, process.env);
  if (!opts.approved) {
    throw new NeedsOk({
      action: `Queue ${plan.canonicalName}`,
      resources: [plan.canonicalWorkflowId, plan.executorWorkflowId, plan.objectId],
      preview: preview(plan),
      kind: "api",
    });
  }
  const result = await queueApprovedWorkflow(args, { env: process.env });
  return JSON.stringify(result);
}
