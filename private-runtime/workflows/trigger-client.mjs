import { WorkflowError } from './contracts.mjs';
const LOOPBACK=new Set(['localhost','127.0.0.1','[::1]']);
const PRIVATE=/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
export function triggerEndpoint(value){
  let u;try{u=new URL(value);}catch{throw new WorkflowError('trigger_endpoint_invalid');}
  if(u.username||u.password||u.search||u.hash||(u.pathname!=='/'&&u.pathname!==''))throw new WorkflowError('trigger_endpoint_invalid');
  const host=u.hostname.toLowerCase().replace(/\.$/,'');
  if(host==='trigger.dev'||host.endsWith('.trigger.dev'))throw new WorkflowError('trigger_cloud_forbidden');
  const internal=LOOPBACK.has(host)||PRIVATE.test(host)||(!host.includes('.')&&!host.includes(':'));
  if(u.protocol!=='https:'&&!(u.protocol==='http:'&&internal))throw new WorkflowError('trigger_https_required');
  return u.origin;
}
const runId=value=>{if(typeof value!=='string'||value.length<3||value.length>200||!/^[A-Za-z0-9_-]+$/.test(value))throw new WorkflowError('trigger_response_invalid');return value;};
async function boundedJson(response){
  const reader=response.body?.getReader();if(!reader)throw new WorkflowError('trigger_response_invalid');
  let size=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024){await reader.cancel();throw new WorkflowError('trigger_response_too_large');}chunks.push(value);}}finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new WorkflowError('trigger_response_invalid');}
}
export async function triggerTask({baseURL,secretKey,taskId,payload,idempotencyKey,fetchImpl=fetch,timeoutMs=15000}){
  const origin=triggerEndpoint(baseURL);
  if(typeof secretKey!=='string'||!secretKey.trim()||/[\r\n]/.test(secretKey))throw new WorkflowError('trigger_key_missing');
  if(typeof taskId!=='string'||!/^[A-Za-z0-9_.-]{1,128}$/.test(taskId))throw new WorkflowError('trigger_task_invalid');
  if(typeof idempotencyKey!=='string'||!/^[a-f0-9]{64}$/.test(idempotencyKey))throw new WorkflowError('trigger_idempotency_invalid');
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw new WorkflowError('trigger_timeout_invalid');
  let response;
  try{response=await fetchImpl(`${origin}/api/v1/tasks/${encodeURIComponent(taskId)}/trigger`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:`Bearer ${secretKey}`,'Content-Type':'application/json'},body:JSON.stringify({payload,options:{idempotencyKey}})});}
  catch{throw new WorkflowError('trigger_submission_outcome_unknown');}
  if(!response.ok){await response.body?.cancel();throw new WorkflowError(response.status>=500?'trigger_submission_outcome_unknown':`trigger_http_${response.status}`);}
  const data=await boundedJson(response);return {triggerRunId:runId(data.id),idempotencyKey};
}
