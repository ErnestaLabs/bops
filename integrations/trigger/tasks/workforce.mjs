/** Deployable scaffold: manifest and read-only observation. No automatic business dispatch.
 * Task completion means this inspection finished, not that the observed action succeeded.
 */
import { task } from '@trigger.dev/sdk';
import { FLOWS, validateCatalogue, VERSION } from '../../../public/workforce-map/catalogue.mjs';
import { skyvernClient } from '../../../private-runtime/workflows/skyvern.mjs';
export const workforceContract = task({
  id: 'ernesta-workforce-contract', maxDuration: 30, retry: { maxAttempts: 1 },
  run: async payload => {
    if (!payload || typeof payload.workflowId !== 'string') throw new Error('workflowId required');
    const flow = FLOWS.find(f => f.id === payload.workflowId);
    if (!flow) throw new Error('Unknown workflow; no improvised execution is allowed');
    validateCatalogue([flow]);
    return { mode: 'contract-only', catalogueVersion: VERSION, workflow: flow, liveExecution: false };
  },
});
export const observeSkyvernRun = task({
  id: 'ernesta-observe-skyvern', maxDuration: 45,
  queue: { concurrencyLimit: 4 }, retry: { maxAttempts: 1 },
  run: async payload => {
    if (!payload || typeof payload.remoteId !== 'string') throw new Error('Existing remoteId required');
    const result = await skyvernClient({ baseUrl: process.env.BOPS_SKYVERN_BASE_URL, apiKey: process.env.BOPS_SKYVERN_API_KEY }).observe(payload.remoteId);
    return { observationCompleted: true, businessOutcomeVerified: false, ...result };
  },
});
