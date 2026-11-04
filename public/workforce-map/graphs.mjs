/** Authored design graphs, not an extraction of deployed Trigger/Skyvern graphs.
 * Existing catalogue contracts are preserved. Additional wiring is explicitly a proposal.
 */
import { FLOWS } from './catalogue.mjs';
const S = (title, owner, kind = 'step', detail = '') => ({ title, owner, kind, detail });
const D = (title, owner='Control', detail='') => S(title,owner,'decision',detail);
const E = title => S(title,'Evidence','end');
// Seven concrete steps per recipe; branches below are recipe-specific design detail.
const GRAPH_RECIPES = {
 'send-approved': [S('Approved message','Bops'),D('Recipient in scope?'),D('Approval still valid?','Owner'),D('Already submitted?','Action ledger'),S('Send the message','Mail connector'),D('Send receipt verified?','Verifier'),E('Record sent')],
 'submit-form': [S('Prepared form','Bops'),D('Destination allowed?'),D('Approve these fields?','Owner'),D('Already submitted?','Action ledger'),S('Submit form once','Skyvern'),D('Submission confirmed?','Verifier'),E('Save confirmation')],
 'crm-update': [S('Requested CRM change','Bops'),D('Record and scope valid?'),D('Approve the diff?','Owner'),D('Already applied?','Action ledger'),S('Update CRM record','CRM connector'),D('Read-back matches?','Verifier'),E('Record change')],
 'support-response': [S('Support case','Support connector'),D('Case in scope?'),D('Approve the response?','Owner'),D('Already replied?','Action ledger'),S('Post case response','Support connector'),D('Reply and case match?','Verifier'),E('Record resolution')],
 'prepare-form': [S('Field values + source','Bops'),D('Page in scope?'),D('Approve draft-only work?','Owner'),S('Open target form','Skyvern'),S('Fill without submit','Skyvern'),D('Fields match sources?','Verifier'),E('Save draft + screenshot')],
 'login': [S('Account access request','Bops'),D('Account scope valid?'),D('Owner approves login?','Owner'),S('Open sign-in page','Skyvern'),D('MFA challenge shown?','Account owner'),D('Correct account active?','Verifier'),E('Record session')],
 'research': [S('Research question','Bops'),D('Hosts approved?'),S('Queue research job','Trigger'),S('Open approved pages','Skyvern'),S('Extract facts + URLs','Skyvern'),D('Sources support result?','Verifier'),E('Return cited findings')],
 'extract': [S('URL + output schema','Bops'),D('Scope and schema valid?'),S('Queue extraction','Trigger'),S('Read the page','Skyvern'),S('Map fields to schema','Skyvern'),D('Fields verified?','Verifier'),E('Return structured data')],
 'download': [S('Document request','Bops'),D('Access permitted?'),S('Locate portal file','Skyvern'),S('Download to storage','Skyvern'),S('Hash and inspect file','Control'),D('Correct document?','Verifier'),E('Return file reference')],
 'inbox-triage': [S('Incoming message','Mail connector'),D('Already processed?','Action ledger'),S('Read allowed content','Mail connector'),S('Classify the request','Bops'),D('Confident classification?','Bops'),S('Record category + owner','Control'),E('Queue next action')],
 'followup-draft': [S('Follow-up request','Bops'),D('Source access valid?'),S('Read CRM context','CRM connector'),S('Draft from facts','Bops'),D('Claims supported?','Verifier'),S('Save for owner review','Bops'),E('Draft only; not sent')],
 'quote': [S('Quote request','Bops'),D('Required inputs present?'),S('Read approved prices','Pricing source'),S('Calculate quote','Bops'),D('Numbers verified?','Verifier'),S('Save versioned quote','Storage'),E('Ready for review')],
 'invoice-intake': [S('Invoice arrives','Document connector'),D('Invoice already seen?','Action ledger'),S('Hash source document','Control'),S('Extract invoice fields','Document parser'),D('Ledger match found?','Accounting connector'),S('Record match evidence','Control'),E('Report reconciliation')],
 'daily-report': [S('Scheduled report tick','Trigger'),D('Occurrence already ran?','Action ledger'),S('Read allowed sources','Connectors'),D('Data fresh enough?','Verifier'),S('Build operating report','Bops'),S('Persist source evidence','Storage'),E('Publish report')],
 'chat': [S('Owner message','Bops UI'),D('Owner authenticated?'),S('Load local conversation','Bops'),S('Call chosen model','Inference'),S('Persist the response','Bops'),D('Response stored?','Verifier'),E('Display the reply')],
 'delegate': [S('Chief assigns work','Bops'),D('Specialist allowed?'),D('Plan approved?','Owner'),S('Create linked child run','Bops'),S('Specialist performs task','Private computer'),D('Child outcome verified?','Verifier'),E('Return to Chief')],
 'scheduled-task': [S('Schedule occurrence','Trigger'),D('One scheduler owner?'),D('Recipe approved?','Owner'),D('Occurrence recorded?','Action ledger'),S('Dispatch recipe job','Trigger'),D('Outcome evidence valid?','Verifier'),E('Close occurrence')],
 'webhook': [S('Webhook arrives','Ingress'),D('Signature valid?'),D('Event ID already seen?','Action ledger'),S('Validate payload schema','Control'),S('Queue mapped recipe','Trigger'),D('Queue receipt stored?','Verifier'),E('Acknowledge event')],
 'install': [S('Pinned release','Operator'),D('Prerequisites pass?'),D('Upgrade approved?','Owner'),S('Back up current state','Operator'),S('Build in isolated path','Installer'),D('Acceptance checks pass?','Verifier'),E('Activate release')],
 'onboard': [S('Business setup','Owner'),D('Tenant inputs valid?'),D('Roles approved?','Owner'),S('Save owner + bot roles','Bops'),S('Provision private workers','Docker'),D('Smoke checks pass?','Verifier'),E('Onboarding recorded')],
 'credentials': [S('Connect / rotate account','Account owner'),D('Required scope allowed?'),D('Rotation approved?','Owner'),S('Store secret reference','Vault'),S('Validate account access','Connector'),D('Identity and scope match?','Verifier'),E('Activate reference')],
 'model-check': [S('Provider configuration','Operator'),D('Endpoint approved?'),S('Probe text response','Inference'),S('Probe tool + stream','Inference'),S('Probe image input','Inference'),D('Required probes pass?','Verifier'),E('Record capabilities')],
 'approval': [S('Proposed action','Bops'),D('Intent complete?'),S('Show exact change','Owner UI'),D('Owner approves?','Owner'),S('Bind actor + digest','Approval store'),D('Valid at dispatch?','Control'),E('Release permission')],
 'retry-read': [S('Read step failed','Executor'),D('Safe to repeat?','Control'),D('Attempts remain?','Control'),S('Wait for backoff','Trigger'),S('Repeat same read','Executor'),D('Read succeeded?','Verifier'),E('Resume workflow')],
 'reconcile': [S('Uncertain action','Action ledger'),S('Load intent + receipt','Control'),S('Inspect destination','Connector'),D('Action applied?','Verifier'),S('Collect outcome evidence','Operator'),D('Evidence decisive?','Verifier'),E('Resolve action record')],
 'cancel': [S('Cancellation request','Owner'),D('Run still active?'),D('Caller may cancel?','Control'),S('Record cancel request','Action ledger'),S('Ask executor to stop','Executor'),D('Stop confirmed?','Verifier'),E('Record cancellation')],
 'restart': [S('Process restarts','Runtime'),S('Load saved state','Storage'),D('Unsettled action found?','Action ledger'),S('Inspect existing runs','Executor'),S('Restore schedules once','Control'),D('Recovery checks pass?','Verifier'),E('Resume service')],
 'compact': [S('Context limit reached','Bops'),D('Tool results settled?'),S('Save original snapshot','Storage'),S('Summarize old context','Inference'),S('Link summary to hash','Control'),D('Recent context intact?','Verifier'),E('Continue, no tool replay')],
 'repair': [S('Failure evidence','Operator'),D('Root cause identified?'),D('Patch approved?','Owner'),S('Version recipe change','Repository'),S('Rehearse with fixture','CI'),D('Regression checks pass?','Verifier'),E('Release repaired recipe')],
 'backup': [S('Backup request','Operator'),D('Scope and key available?'),D('Backup approved?','Owner'),S('Capture data + volumes','Storage'),S('Restore into test instance','Operator'),D('Hashes and state match?','Verifier'),E('Record restore proof')],
 'provider-switch': [S('New provider request','Operator'),D('Endpoint and scope valid?'),D('Switch approved?','Owner'),S('Finish / pause old jobs','Control'),S('Run candidate probes','Inference'),D('Required probes pass?','Verifier'),E('Activate for new jobs')],
 'audit': [S('Audit request','Owner'),D('Caller in scope?'),S('Select run / time range','Control'),S('Read correlated records','Storage'),S('Redact sensitive content','Control'),D('Export reviewed?','Verifier'),E('Return scoped export')],
};
const issues = {
 research:['Page changed','Repair browser recipe','Missing source evidence'], extract:['Schema drift','Repair field mapping','Extraction mismatch'], download:['Download failed','Inspect source and file','Wrong or corrupt file'],
 chat:['Model unavailable','Inspect provider status','Response not persisted'], 'followup-draft':['Missing CRM context','Repair source access','Unsupported claim'], quote:['Price source unavailable','Repair pricing inputs','Totals mismatch'],
 'invoice-intake':['Unreadable invoice','Manual document review','No confident match'], 'daily-report':['Source unavailable','Repair source connector','Stale or missing data'],
 'model-check':['Probe failed','Inspect chosen provider','Required capability missing'], compact:['Summary failed','Keep original context','Snapshot check failed'], audit:['Access or export failed','Review scope / retention','Sensitive content remains'],
};
function connect(edges,from,to,label='',kind='normal',route={}) { edges.push({id:`${from}-${to}-${edges.length}`,from,to,label,kind,...route}); }
export function workflowGraph(id) {
 const flow = FLOWS.find(f=>f.id===id); if(!flow || !GRAPH_RECIPES[id]) throw new Error('Unknown mapped workflow');
 const nodes=GRAPH_RECIPES[id].map((s,i)=>({id:`n${i}`,...s,x:40+i*226,y:145,w:184,h:90,phase:['receive','validate','approve','dispatch','observe','verify','report'][i],origin:'Design detail'})), edges=[];
 const add=(id,title,owner,kind,col,row,detail='')=>{const n={id,title,owner,kind,x:40+col*226,y:row,w:184,h:90,detail,origin:'Design detail'};nodes.push(n);return n;};
 for(let i=0;i<6;i++) connect(edges,`n${i}`,`n${i+1}`,nodes[i].kind==='decision'?'Yes':'');
 const edge=(from,to,label,kind='exception',route={})=>connect(edges,from,to,label,kind,route);
 const halt=(col=1,label='Fix input / permissions')=>{add('blocked',label,'Owner / operator','stop',col,340,'Correct the input, authorization or policy before creating a new approved intent.');edge('n1','blocked','No');};
 // Explicit receipt reconciliation for consequential operations. No blind retry.
 if(['send-approved','submit-form','crm-update','support-response','scheduled-task'].includes(id)) {
  edges.find(e=>e.from==='n3').label='New';
  edges.find(e=>e.from==='n2').label='Yes';
  halt(0);
  add('denied','Stop; no action','Owner','stop',2,340);edge('n2','denied','Denied / expired');
  edge('n3','n5','Yes · inspect receipt','recovery',{viaY:60,fromPort:'top',toPort:'top'});
  add('unknown','Outcome unknown','Action ledger','failure',4,340,'The request may already have succeeded. Never send it again just because the reply was lost.');edge('n4','unknown','Timeout / lost reply');
  add('lookup','Look up destination','Operator / connector','step',5,340,'Use the stable operation ID and destination record to establish what actually happened.');edge('unknown','lookup','Check','recovery');
  edge('lookup','n5','Action found','recovery');
  add('reapprove','New approval required','Owner','approval',2,545,'Only after independent evidence that the action did NOT happen. Never reuse the uncertain request blindly.');edge('lookup','reapprove','Not applied','recovery',{viaY:495,fromPort:'bottom',toPort:'top'});
  edge('reapprove','n2','Re-plan / re-approve','recovery',{viaX:440,fromPort:'left',toPort:'left'});
  add('review','Manual review; no replay','Operator','stop',6,545);edge('lookup','review','Still unclear','exception');edge('n5','review','Mismatch','exception',{viaX:1375,fromPort:'right',toPort:'left'});
 } else if(id==='login') {
  halt(0);edges.find(e=>e.from==='n4').label='No challenge';
  add('mfa','Complete MFA manually','Account owner','approval',4,340);edge('n4','mfa','Yes');edge('mfa','n5','Then verify session','recovery');
  add('wrong','Disconnect wrong account','Account owner','stop',6,340);edge('n5','wrong','No');
  add('denied','Do not sign in','Owner','stop',2,340);edge('n2','denied','Denied');
 } else if(id==='approval') {
  halt(1,'Return incomplete intent');edges.find(e=>e.from==='n3').label='Approve';
  add('deny','Reject; do not dispatch','Owner','stop',3,340);edge('n3','deny','Reject');
  add('expiry','Expired or plan changed','Control','failure',5,340);edge('n5','expiry','No');edge('expiry','n2','Request fresh approval','recovery',{viaY:505,fromPort:'bottom',toPort:'bottom'});
 } else if(id==='retry-read') {
  halt(0,'Unsafe action: reconcile');
  add('budget','Stop; attempt limit','Operator','stop',2,340);edge('n2','budget','No');
  add('classify','Classify latest failure','Control','decision',4,340);edge('n5','classify','No');
  edge('classify','n2','Safe temporary error','recovery',{viaY:500,fromPort:'bottom',toPort:'bottom'});
  add('uncertain','Reconcile; do not retry','Operator','stop',6,340);edge('classify','uncertain','Effect uncertain');
 } else if(id==='reconcile') {
  edges.find(e=>e.from==='n3').label='Yes · verify receipt';
  add('noeffect','New approval required','Owner','approval',2,340);edge('n3','noeffect','Not applied');
  add('unresolved','Keep outcome unknown','Operator','stop',4,340);edge('n3','unresolved','Cannot establish');edge('n5','unresolved','Not decisive');
  add('retrylookup','Repair observation only','Operator','step',4,545);edge('unresolved','retrylookup','Inspect / repair','recovery');edge('retrylookup','n2','Look again; no replay','recovery',{viaY:685,fromPort:'bottom',toPort:'bottom'});
 } else if(id==='cancel') {
  halt(0,'Return existing final state');add('denied','Reject cancellation','Control','stop',2,340);edge('n2','denied','No');
  add('pending','Cancel requested ≠ stopped','Control','failure',4,340);edge('n4','pending','Lost response');edge('n5','pending','Not confirmed');
  add('poll','Inspect existing executor run','Operator','step',4,545);edge('pending','poll','Observe','recovery');edge('poll','n5','Recheck terminal status','recovery');
 } else if(id==='restart') {
  edges.find(e=>e.from==='n2').label='No unresolved writes';
  add('hold','Hold unsettled actions','Action ledger','failure',2,340);edge('n2','hold','Yes');
  add('inspect','Reconcile remote receipts','Operator','step',3,340);edge('hold','inspect','Inspect','recovery');edge('inspect','n3','Known run ID','recovery');
  add('storage','Repair storage; no dispatch','Operator','stop',0,340);edge('n1','storage','Cannot load');
  add('recovery','Stop recovery rollout','Operator','stop',5,340);edge('n5','recovery','No');
 } else if(id==='compact') {
  halt(1,'Wait for unsettled tools');edge('blocked','n1','Results settled','recovery',{viaX:235,fromPort:'left',toPort:'left'});
  add('keep','Keep original context','Bops','stop',3,340);edge('n3','keep','Summary error');edge('n5','keep','Check failed','exception',{viaY:300,fromPort:'bottom',toPort:'top'});
 } else if(['inbox-triage','invoice-intake','daily-report','webhook'].includes(id)) {
  const duplicateIndex=id==='webhook'?2:1;
  if(id==='daily-report') {edges[1].label='No';} else if(id!=='webhook') edges[1].label='No';
  if(id==='webhook') {edges[2].label='No';halt(0,'Reject unsigned event');}
  add('seen','Return recorded outcome','Action ledger','end',duplicateIndex,340);edge(`n${duplicateIndex}`,'seen','Yes · duplicate','recovery');
  const checkIndex=id==='daily-report'?3:4;
  if(id==='webhook'){add('schema','Reject invalid payload','Control','stop',4,340);edge('n3','schema','Invalid');add('queue','Investigate queue receipt','Operator','stop',6,340);edge('n5','queue','Uncertain');}
  else {add('manual',id==='daily-report'?'Wait for fresh source':'Human review required','Owner','approval',checkIndex,340);edge(`n${checkIndex}`,'manual','No');edge('manual',`n${checkIndex+1}`,'Resolved with evidence','recovery');}
 } else {
  halt(0, id==='install'?'Repair prerequisites':'Fix scope / input');
  const hasApproval=flow.effect==='write';
  if(hasApproval){add('denied','Stop; not approved','Owner','stop',2,340);edge('n2','denied','Denied');}
  const [issue,fix,mismatch]=issues[id] || ['Execution failed','Inspect and repair step','Acceptance mismatch'];
  add('fault',issue,'Executor','failure',3,340);edge('n3','fault','Failed / unavailable');
  add('fix',fix,'Operator','step',4,545);edge('fault','fix','Inspect evidence','recovery');
  const canRetry=['research','extract','download','chat','model-check','followup-draft','quote','audit'].includes(id);
  if(canRetry) edge('fix','n3','Safe read · within budget','recovery',{viaX:680,fromPort:'left',toPort:'left'});
  else {add('review','Review before repeating','Owner','stop',6,545);edge('fix','review','No blind replay','exception');}
  add('mismatch',mismatch,'Verifier','stop',5,340);edge('n5','mismatch','No');edge('mismatch','fix','Repair / recheck','recovery');
 }
 const main=['n0','n1','n2','n3','n4','n5','n6'];
 // A path is only offered if every edge exists, so no animation can imply a nonexistent transition.
 const paths=[{id:'success',label:'Success path',nodes:main}];
 if(nodes.some(n=>n.id==='unknown')) paths.push({id:'timeout',label:'Timeout → reconcile',nodes:['n0','n1','n2','n3','n4','unknown','lookup','review']},{id:'receipt',label:'Action found → verify',nodes:['n0','n1','n2','n3','n4','unknown','lookup','n5','n6']});
 else {const branch=edges.find(e=>e.kind==='exception');if(branch){const ix=main.indexOf(branch.from);if(ix>=0)paths.push({id:'failure',label:'Failure path',nodes:[...main.slice(0,ix+1),branch.to]});}}
 return {id,title:flow.title,category:flow.category,flow,nodes,edges,paths,mode:'Proposed workflow wiring, not live execution'};
}
export function systemGraph() {
 const nodes=[
 {id:'owner',...S('Owner request','Customer','start'),x:40,y:265},
 {id:'chief',...S('Chief + specialists','Bops'),x:270,y:265,open:'delegate'},
 {id:'queue',...S('Schedule and queue','Trigger.dev'),x:500,y:265,open:'scheduled-task'},
 {id:'gate',...D('Approved + deduplicated?','Control / action ledger'),x:730,y:265,open:'approval'},
 {id:'browser',...S('Website actions','Skyvern'),x:1000,y:70,open:'submit-form'},
 {id:'api',...S('Business API actions','Customer connectors'),x:1000,y:265,open:'send-approved'},
 {id:'computer',...S('Files and local tools','Private Docker'),x:1000,y:460,open:'delegate'},
 {id:'desktop',...S('Native desktop apps','Vercel Agent Desktop'),x:1000,y:610,open:'delegate'},
 {id:'verify',...D('Outcome verified?','Evidence verifier'),x:1270,y:265,open:'reconcile'},
 {id:'report',...E('Return result + evidence'),x:1500,y:265},
 {id:'evidence',...S('Redacted run evidence','Evidence archive'),x:1270,y:70,open:'audit'},
 {id:'improve',...S('Propose / probe / compose','Harness²'),x:1500,y:70,open:'repair'},
 {id:'candidate',...D('Candidate passes CI + review?','Harness review'),x:1730,y:70,open:'repair'},
 {id:'blocked',...S('Stop for owner / repair','Human operator','stop'),x:730,y:530,open:'repair'},
 {id:'unknown',...S('Reconcile before retry','Action ledger','failure'),x:1270,y:530,open:'reconcile'},
 ].map(n=>({...n,w:184,h:90,origin:'Architecture proposal',detail:'Double-click to open the associated workflow. This is a design relationship, not proof of a deployed integration.'}));
 const edges=[];[['owner','chief'],['chief','queue'],['queue','gate'],['gate','browser'],['gate','api'],['gate','computer'],['gate','desktop'],['browser','verify'],['api','verify'],['computer','verify'],['desktop','verify'],['verify','report']].forEach(([a,b])=>connect(edges,a,b,a==='gate'?'Allowed':a==='verify'?'Verified':''));
 connect(edges,'verify','evidence','Redacted evidence','normal');connect(edges,'evidence','improve','Offline improvement','normal');connect(edges,'improve','candidate','Candidate harness','normal');connect(edges,'candidate','chief','Adopt for future runs only','recovery',{viaY:20,fromPort:'top',toPort:'top'});
 connect(edges,'gate','blocked','No','exception');connect(edges,'verify','unknown','Mismatch / uncertain','exception');connect(edges,'unknown','verify','Evidence found','recovery',{viaX:1485,fromPort:'right',toPort:'right'});
 return {id:'system',title:'How the workforce connects',category:'Architecture',nodes,edges,paths:[],mode:'Architecture proposal · services not implied live'};
}
export function validateGraph(g){
 const ids=new Set(g.nodes.map(n=>n.id)); if(ids.size!==g.nodes.length)throw new Error('Duplicate node');
 if(!g.nodes.length || !g.edges.length)throw new Error('Empty graph');
 for(const e of g.edges)if(!ids.has(e.from)||!ids.has(e.to))throw new Error('Dangling edge');
 const reached=new Set([g.nodes[0].id]);for(let i=0;i<g.nodes.length;i++)for(const e of g.edges)if(reached.has(e.from))reached.add(e.to);
 if(reached.size!==g.nodes.length)throw new Error('Unreachable node');
 for(const p of g.paths)for(let i=1;i<p.nodes.length;i++)if(!g.edges.some(e=>e.from===p.nodes[i-1]&&e.to===p.nodes[i]))throw new Error('Broken illustrative path');
 return true;
}
