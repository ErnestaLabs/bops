/** Deployable contract and read-only observation tasks. No business dispatch
 * happens here: observation of an existing run is a read, and the only path
 * that submits work is ernesta-approved-browser-workflow in src/.
 *
 * Task completion means this inspection finished, not that the observed action
 * succeeded.
 */
import { task } from "@trigger.dev/sdk";
import { FLOWS, validateCatalogue, VERSION } from "../../../public/workforce-map/catalogue.mjs";
import { skyvernClient } from "../../../private-runtime/workflows/skyvern-client.mjs";
import { skyvernEnv } from "../../../private-runtime/workflows/env.mjs";

export const workforceContract = task({
  id: "ernesta-workforce-contract",
  maxDuration: 30,
  retry: { maxAttempts: 1 },
  run: async (payload: { workflowId?: unknown }) => {
    if (!payload || typeof payload.workflowId !== "string") throw new Error("workflowId required");
    const flow = FLOWS.find(f => f.id === payload.workflowId);
    if (!flow) throw new Error("Unknown workflow; no improvised execution is allowed");
    validateCatalogue([flow]);
    return { mode: "contract-only", catalogueVersion: VERSION, workflow: flow, liveExecution: false };
  },
});

export const observeSkyvernRun = task({
  id: "ernesta-observe-skyvern",
  maxDuration: 45,
  queue: { concurrencyLimit: 4 },
  retry: { maxAttempts: 1 },
  run: async (payload: { remoteId?: unknown }) => {
    if (!payload || typeof payload.remoteId !== "string") throw new Error("Existing remoteId required");
    // Reads an existing run through the same adapter the dispatch task uses.
    const { baseURL, apiKey } = skyvernEnv();
    const result = await skyvernClient({ baseURL, apiKey }).get(payload.remoteId);
    return { observationCompleted: true, businessOutcomeVerified: false, ...result };
  },
});
