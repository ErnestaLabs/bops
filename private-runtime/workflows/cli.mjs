/** Owner-side CLI. No credentials, task prompts or returned page content are printed. */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { plan, dispatchOnce } from './ledger.mjs';
import { skyvernClient, WorkflowError } from './skyvern.mjs';
const [command, fileOrRun, ...rest] = process.argv.slice(2);
try {
  if (process.env.BOPS_PRIVATE_ENV_FILE) process.loadEnvFile(resolve(process.env.BOPS_PRIVATE_ENV_FILE));
  const baseUrl = process.env.BOPS_SKYVERN_BASE_URL;
  const accountScope = process.env.BOPS_SKYVERN_ACCOUNT_SCOPE;
  let result;
  if (command === 'plan' || command === 'start') {
    const data = readFileSync(resolve(fileOrRun));
    if (data.length > 40000) throw new WorkflowError('REQUEST_TOO_LARGE');
    const payload = JSON.parse(data);
    const { actionId, request } = payload;
    if (Object.keys(payload).some(k => !['actionId','request'].includes(k))) throw new WorkflowError('INVALID_ENVELOPE');
    const input = { actionId, accountScope, baseUrl, request };
    if (command === 'plan') result = plan(input);
    else {
      if (rest.length !== 2 || rest[0] !== '--approve') throw new WorkflowError('USE_EXPLICIT_APPROVAL_HASH');
      if (!process.env.BOPS_PRIVATE_DATA_DIR) throw new WorkflowError('PERSISTENT_DATA_DIRECTORY_REQUIRED');
      result = await dispatchOnce({ ...input, approvalHash: rest[1], directory: join(process.env.BOPS_PRIVATE_DATA_DIR, 'workflow-dispatch'),
        client: skyvernClient({ baseUrl, apiKey: process.env.BOPS_SKYVERN_API_KEY }) });
    }
  } else if (command === 'status' || command === 'cancel') {
    const client = skyvernClient({ baseUrl, apiKey: process.env.BOPS_SKYVERN_API_KEY });
    result = command === 'status' ? await client.observe(fileOrRun) : await client.cancel(fileOrRun);
  } else throw new WorkflowError('USE_PLAN_START_STATUS_OR_CANCEL');
  console.log(JSON.stringify(result, null, 2));
  if (result.state === 'outcome_unknown') process.exitCode = 2;
} catch (e) {
  console.error(JSON.stringify({ error: e instanceof WorkflowError ? e.code : 'LOCAL_CONFIGURATION_OR_REQUEST_ERROR',
    uncertain: e instanceof WorkflowError && e.uncertain, ...(e.providerRunId ? { providerRunId: e.providerRunId } : {}) }));
  process.exitCode = 1;
}
