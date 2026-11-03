/** Owner-side CLI. Input contains the action, not secrets. Do not expose this
 * signing environment to agents, browser workers or untrusted callers. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { browserRequest } from './skyvern-client.mjs';
import { digest, signApproval } from './contracts.mjs';
try {
  const [input,output]=process.argv.slice(2);
  if(!input||!output)throw new Error('usage');
  if(process.env.WORKFLOW_APPROVAL_ENV_FILE)process.loadEnvFile(resolve(process.env.WORKFLOW_APPROVAL_ENV_FILE));
  const action=JSON.parse(readFileSync(resolve(input),'utf8'));
  const ids=(process.env.SKYVERN_ALLOWED_WORKFLOW_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
  const request=browserRequest(action,ids);
  const approval=signApproval({actionKey:action.actionKey,requestHash:digest(request),expiresAt:Date.now()+3600000},process.env.WORKFLOW_APPROVAL_KEY);
  writeFileSync(resolve(output),JSON.stringify({action,approval},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Scoped approval written to the requested file. No action was submitted.');
} catch { console.error('Approval not written. Check arguments, allowlisted workflow, secret configuration, or existing output file. No secrets were printed.');process.exitCode=1; }
