import { actionIdentity, digest, signApproval, WorkflowError } from './contracts.mjs';
import { canonicalCatalog } from './catalog.mjs';
import { browserRequest } from './skyvern-client.mjs';
import { approvalEnv, skyvernEnv } from './env.mjs';
import { triggerTask } from './trigger-client.mjs';
const TASK_ID='ernesta-approved-browser-workflow';
const obj=value=>value&&typeof value==='object'&&!Array.isArray(value);
const SECRET_KEY=/(?:password|passwd|secret|token|cookie|authorization|api[_-]?key|private[_-]?key)/i;
function rejectSecrets(value,path='parameters'){
  if(Array.isArray(value)){for(let i=0;i<value.length;i++)rejectSecrets(value[i],`${path}[${i}]`);return;}
  if(!obj(value))return;
  for(const [k,v] of Object.entries(value)){if(SECRET_KEY.test(k))throw new WorkflowError('workflow_parameter_secret_forbidden');rejectSecrets(v,`${path}.${k}`);}
}
const text=(value,max=256)=>typeof value==='string'&&value.trim()&&value.length<=max;
export const CANONICAL_WORKFLOW_IDS=Object.freeze(canonicalCatalog.workflows.map(w=>w.id));
export function triggerConfigured(env=process.env){
  return !!(env.TRIGGER_API_URL&&env.TRIGGER_SECRET_KEY&&env.BOPS_PRIVATE_INSTALL_ID&&env.WORKFLOW_APPROVAL_KEY&&(env.SKYVERN_API_BASE_URL||env.BOPS_SKYVERN_BASE_URL)&&(env.SKYVERN_API_KEY||env.BOPS_SKYVERN_API_KEY)&&env.SKYVERN_ALLOWED_WORKFLOW_IDS);
}
function canonicalWorkflow(id){const w=canonicalCatalog.workflows.find(x=>x.id===id);if(!w)throw new WorkflowError('unknown_canonical_workflow');return w;}
export function workflowDispatchPlan(args,env=process.env){
  if(!obj(args))throw new WorkflowError('workflow_dispatch_invalid');
  const {canonicalWorkflowId,executorWorkflowId,objectId,operation,parameters}=args;
  const workflow=canonicalWorkflow(canonicalWorkflowId);
  if(!text(executorWorkflowId,160)||!text(objectId)||!text(operation)||!obj(parameters))throw new WorkflowError('workflow_dispatch_invalid');
  rejectSecrets(parameters);
  const {allowedWorkflowIds}=skyvernEnv(env);if(!allowedWorkflowIds.includes(executorWorkflowId))throw new WorkflowError('executor_workflow_not_allowed');
  const installationId=env.BOPS_PRIVATE_INSTALL_ID;if(!text(installationId,256))throw new WorkflowError('installation_id_missing');
  const actionKey=actionIdentity({installationId,workflowId:workflow.id,version:workflow.version,objectId,operation});
  const request=browserRequest({actionKey,workflowId:executorWorkflowId,parameters},[executorWorkflowId]);
  const requestHash=digest(request);
  return {canonicalWorkflowId:workflow.id,canonicalVersion:workflow.version,canonicalName:workflow.name,executor:'Skyvern via Trigger.dev',executorWorkflowId,objectId,operation,actionKey,requestHash,parameters};
}
export async function queueApprovedWorkflow(args,{env=process.env,fetchImpl=fetch}={}){
  const plan=workflowDispatchPlan(args,env);
  const key=approvalEnv(env);
  const approval=signApproval({actionKey:plan.actionKey,requestHash:plan.requestHash,expiresAt:Date.now()+15*60_000},key);
  const queued=await triggerTask({baseURL:env.TRIGGER_API_URL,secretKey:env.TRIGGER_SECRET_KEY,taskId:TASK_ID,payload:{canonicalWorkflowId:plan.canonicalWorkflowId,action:{actionKey:plan.actionKey,workflowId:plan.executorWorkflowId,parameters:plan.parameters},approval},idempotencyKey:plan.actionKey,fetchImpl});
  return {status:'QUEUED',canonicalWorkflowId:plan.canonicalWorkflowId,canonicalVersion:plan.canonicalVersion,actionKey:plan.actionKey,triggerRunId:queued.triggerRunId};
}
