import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { privateClient } from '../inference.mjs';
import { canonicalCatalog } from '../workflows/catalog.mjs';
import { canonical } from '../workflows/contracts.mjs';

const TYPES = new Set(['sales','audit']);
const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{1,62}$/;
const workflowIds = canonicalCatalog.workflows.map(w => w.id);
const schema = {
  type:'object', additionalProperties:false,
  required:['client','summary','systems','actors','processes','unknowns'],
  properties:{
    client:{type:'object',additionalProperties:false,required:['name'],properties:{name:{type:'string',maxLength:160},industry:{type:'string',maxLength:160}}},
    summary:{type:'string',maxLength:2000},
    systems:{type:'array',maxItems:50,items:{type:'object',additionalProperties:false,required:['name','purpose','evidence'],properties:{name:{type:'string',maxLength:120},purpose:{type:'string',maxLength:300},evidence:{type:'string',maxLength:300}}}},
    actors:{type:'array',maxItems:50,items:{type:'object',additionalProperties:false,required:['role','responsibility','evidence'],properties:{role:{type:'string',maxLength:120},responsibility:{type:'string',maxLength:300},evidence:{type:'string',maxLength:300}}}},
    processes:{type:'array',maxItems:60,items:{type:'object',additionalProperties:false,required:['name','trigger','outcome','steps','systems','painPoints','approval','canonicalCandidates','confidence','evidence'],properties:{
      name:{type:'string',maxLength:160},trigger:{type:'string',maxLength:400},outcome:{type:'string',maxLength:500},
      steps:{type:'array',minItems:1,maxItems:30,items:{type:'string',maxLength:400}},
      systems:{type:'array',maxItems:20,items:{type:'string',maxLength:120}},
      painPoints:{type:'array',maxItems:20,items:{type:'string',maxLength:400}},
      approval:{type:'string',enum:['none','human-before-write','human-review','unknown']},
      canonicalCandidates:{type:'array',maxItems:5,items:{type:'object',additionalProperties:false,required:['id','confidence','reason'],properties:{id:{type:'string',enum:workflowIds},confidence:{type:'number',minimum:0,maximum:1},reason:{type:'string',maxLength:500}}}},
      confidence:{type:'number',minimum:0,maximum:1},
      evidence:{type:'array',minItems:1,maxItems:10,items:{type:'string',maxLength:300}}
    }}},
    unknowns:{type:'array',maxItems:50,items:{type:'string',maxLength:500}}
  }
};

const sha = value => createHash('sha256').update(canonical(value)).digest('hex');
const safeId = value => { const v=String(value||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,63); if(!ID.test(v)) throw new Error('invalid_client_id'); return v; };
const cleanText = text => {
  if(typeof text!=='string' || !text.trim()) throw new Error('transcript_required');
  if(Buffer.byteLength(text)>MAX_TRANSCRIPT_BYTES) throw new Error('transcript_too_large');
  return text.replace(/\r\n?/g,'\n').trim();
};
export function compileClientVersion(extraction,{clientId,sourceType,sourceHash}) {
  if(!TYPES.has(sourceType)) throw new Error('invalid_transcript_type');
  const id=safeId(clientId);
  const processes=extraction.processes.map((p,index)=>{
    const ranked=[...p.canonicalCandidates].filter(c=>workflowIds.includes(c.id)).sort((a,b)=>b.confidence-a.confidence);
    const best=ranked[0];
    const canonicalMatch=best && best.confidence>=0.72 ? best.id : null;
    const canonicalDef=canonicalMatch ? canonicalCatalog.workflows.find(w=>w.id===canonicalMatch) : null;
    const writeRisk=canonicalDef?.steps.some(step=>step[2]==='write') || p.approval==='human-before-write';
    return {
      id:`process-${String(index+1).padStart(2,'0')}`,name:p.name,trigger:p.trigger,outcome:p.outcome,steps:p.steps,systems:p.systems,painPoints:p.painPoints,
      transcriptConfidence:p.confidence,evidence:p.evidence,canonicalMatch,
      canonicalConfidence:best?.confidence ?? 0,matchReason:best?.reason ?? 'No supported canonical match proposed.',
      approval:writeRisk ? 'required-before-write' : p.approval,
      readiness:canonicalMatch && p.confidence>=0.72 ? (writeRisk?'review-required':'draft') : 'needs-design',
      canonicalVersion:canonicalDef?.version ?? null
    };
  });
  const gaps=processes.filter(p=>!p.canonicalMatch).map(p=>({processId:p.id,name:p.name,reason:'No canonical workflow met the 0.72 confidence threshold.'}));
  const draft={
    schemaVersion:1,clientId:id,status:'DRAFT',source:{type:sourceType,sha256:sourceHash},
    client:extraction.client,summary:extraction.summary,systems:extraction.systems,actors:extraction.actors,processes,gaps,unknowns:extraction.unknowns,
    generatedAt:new Date().toISOString(),activation:{required:true,reviewHash:null}
  };
  draft.activation.reviewHash=sha({...draft,activation:{required:true,reviewHash:null}});
  return draft;
}
export async function extractTranscript({text,type,clientId,env=process.env,fetchImpl=fetch}) {
  if(!TYPES.has(type)) throw new Error('invalid_transcript_type');
  const transcript=cleanText(text), sourceHash=createHash('sha256').update(transcript).digest('hex');
  const instructions=`You are compiling a client operating model from a ${type} transcript. Use ONLY facts supported by the transcript. Do not infer software, roles, approvals, frequencies, outcomes, or steps that were not stated. Evidence fields must be short direct excerpts or close paraphrases tied to the transcript. When something is unclear, put it in unknowns. Map processes only to the supplied canonical workflow IDs. Confidence must reflect transcript support, not plausibility. Never treat a sales promise as an existing client process unless the speaker clearly says it is current.`;
  const client=privateClient({env,fetchImpl});
  const response=await client.responses.create({
    store:false,stream:false,max_output_tokens:10000,temperature:0,
    instructions,
    input:`Canonical workflow IDs: ${workflowIds.join(', ')}\n\nTRANSCRIPT:\n${transcript}`,
    text:{format:{type:'json_schema',name:'client_operating_model',schema,strict:true}}
  },{timeout:180000});
  let extraction; try{extraction=JSON.parse(response.output_text);}catch{throw new Error('invalid_structured_extraction');}
  return {draft:compileClientVersion(extraction,{clientId,sourceType:type,sourceHash}),sourceHash};
}
export function clientVersionDir(env=process.env){return resolve(env.BOPS_PRIVATE_DATA_DIR||'.data/private-runtime','clients');}
export function persistDraft(draft,env=process.env){
  const dir=join(clientVersionDir(env),draft.clientId); mkdirSync(dir,{recursive:true,mode:0o700});
  const file=join(dir,`draft-${draft.activation.reviewHash}.json`),tmp=`${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp,JSON.stringify(draft,null,2),{mode:0o600,flag:'wx'}); renameSync(tmp,file); return file;
}
export function activateDraft(file,approvedHash,env=process.env){
  const draft=JSON.parse(readFileSync(resolve(file),'utf8'));
  if(draft.status!=='DRAFT'||draft.activation?.reviewHash!==approvedHash) throw new Error('review_hash_mismatch');
  const active={...draft,status:'ACTIVE',activatedAt:new Date().toISOString(),activation:{...draft.activation,approvedHash}};
  const dir=join(clientVersionDir(env),draft.clientId); mkdirSync(dir,{recursive:true,mode:0o700});
  const target=join(dir,'active.json'),tmp=`${target}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp,JSON.stringify(active,null,2),{mode:0o600,flag:'wx'}); renameSync(tmp,target); return {target,active};
}
export function loadActive(clientId,env=process.env){return JSON.parse(readFileSync(join(clientVersionDir(env),safeId(clientId),'active.json'),'utf8'));}
