#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractTranscript,persistDraft,activateDraft } from './transcript.mjs';
const [cmd,...args]=process.argv.slice(2);
const flag=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
if(cmd==='adapt'){
  const file=args.find(x=>!x.startsWith('--')); const type=flag('--type'); const clientId=flag('--client');
  if(!file||!type||!clientId) throw new Error('usage: adapt <transcript.txt> --type sales|audit --client <id>');
  const {draft}=await extractTranscript({text:readFileSync(resolve(file),'utf8'),type,clientId});
  const path=persistDraft(draft); console.log(JSON.stringify({status:'DRAFT',path,reviewHash:draft.activation.reviewHash,processes:draft.processes.length,gaps:draft.gaps.length,unknowns:draft.unknowns.length},null,2));
}else if(cmd==='activate'){
  const file=args.find(x=>!x.startsWith('--')); const hash=flag('--approve');
  if(!file||!hash) throw new Error('usage: activate <draft.json> --approve <reviewHash>');
  const result=activateDraft(file,hash); console.log(JSON.stringify({status:'ACTIVE',path:result.target,clientId:result.active.clientId,reviewHash:hash},null,2));
}else throw new Error('usage: node private-runtime/onboarding/cli.mjs adapt|activate ...');
