/** One place that decides what an environment variable is called.
 *
 * The two reconciled branches shipped different spellings for the same
 * services (SKYVERN_API_* vs BOPS_SKYVERN_*, TRIGGER_PROJECT_REF vs
 * WORKFORCE_TRIGGER_PROJECT). Reading both here means there is exactly one
 * definition of each name, and a caller can never half-configure a service by
 * reading one spelling while a deploy script writes the other.
 */
import { WorkflowError } from './contracts.mjs';

const str = value => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** Canonical name first, then the legacy spelling from the other branch. */
const either = (env, canonical, legacy) => str(env[canonical]) ?? str(env[legacy]);

/** Skyvern credentials for the one deployed dispatch path.
 * The API origin is the service root; the adapter appends its own /v1 path. */
export function skyvernEnv(env = process.env) {
  const baseURL = either(env, 'SKYVERN_API_BASE_URL', 'BOPS_SKYVERN_BASE_URL');
  const apiKey = either(env, 'SKYVERN_API_KEY', 'BOPS_SKYVERN_API_KEY');
  if (!baseURL) throw new WorkflowError('skyvern_base_url_required');
  if (!apiKey) throw new WorkflowError('skyvern_api_key_required');
  const allowedWorkflowIds = (str(env.SKYVERN_ALLOWED_WORKFLOW_IDS) ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return { baseURL, apiKey, allowedWorkflowIds };
}

/** The action ledger is a separate database from Trigger's own storage. */
export function ledgerEnv(env = process.env) {
  const connectionString = str(env.ERNESTA_LEDGER_DATABASE_URL);
  if (!connectionString) throw new WorkflowError('ledger_database_required');
  return { connectionString };
}

/** Owner approval signing key. 64 hex characters, never given to a model. */
export function approvalEnv(env = process.env) {
  const key = str(env.WORKFLOW_APPROVAL_KEY);
  if (!key) throw new WorkflowError('approval_key_missing');
  return key;
}

/** Customer-owned Trigger instance. There is no cloud default. */
export function triggerEnv(env = process.env) {
  const projectRef = either(env, 'TRIGGER_PROJECT_REF', 'WORKFORCE_TRIGGER_PROJECT');
  if (!projectRef) throw new WorkflowError('trigger_project_ref_required');
  const apiURL = str(env.TRIGGER_API_URL);
  if (!apiURL) throw new WorkflowError('trigger_api_url_required');
  return { projectRef, apiURL };
}
