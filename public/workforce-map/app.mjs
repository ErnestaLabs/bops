import { FLOWS, COMPONENTS, FAILURES, VERSION, STATUS_LEGEND, validateCatalogue } from './catalogue.mjs';
import { newRun, transition, allowedControls } from './state.mjs';
const $ = id => document.getElementById(id);
const text = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; };
let flow = FLOWS.find(f => f.id === 'submit-form'), run, stepId = 'dispatch';
const counts = validateCatalogue(); $('flow-count').textContent = counts.workflows; $('step-count').textContent = counts.steps;
for (const c of COMPONENTS) {
  const b = text('button','', 'component'); b.append(text('span',c.state,'tag'),text('strong',c.name),text('small',c.role));
  b.onclick = () => $('component-detail').textContent = `${c.name}${c.version ? ` ${c.version}` : ''}: ${c.note}`;
  $('components').append(b);
}
for (const group of [...new Set(FLOWS.map(f => f.category))]) { const option = text('option',group); option.value = group; $('category').append(option); }
for (const [code] of Object.entries(FAILURES)) { const option = text('option',code.replaceAll('_',' ')); option.value = code; $('fault').append(option); }
$('fault').value = 'dispatch_uncertain';
function list() {
  $('flows').replaceChildren();
  const q = $('search').value.toLowerCase();
  for (const f of FLOWS.filter(f => (!$('category').value || f.category === $('category').value) && `${f.title} ${f.executor} ${f.category}`.toLowerCase().includes(q))) {
    const b = text('button','',`flow-link${f.id === flow.id ? ' active' : ''}`); b.append(text('span',f.category),document.createTextNode(f.title)); b.onclick = () => { flow = f; stepId = 'dispatch'; reset(); show(); }; $('flows').append(b);
  }
}
function field(label,value) { const d = text('div',''); d.append(text('b',label),document.createTextNode(value)); return d; }
function show() {
  list(); $('flow-category').textContent = `${flow.category} / ${flow.id} / version ${flow.version}`;
  $('flow-title').textContent = flow.title; $('flow-status').textContent = flow.implementation;
  $('implementation').textContent = STATUS_LEGEND[flow.implementation];
  $('contract').replaceChildren(field('Executor',flow.executor),field('Side effect',flow.effect === 'write' ? 'External or state-changing action: bound approval required' : 'Read/local intent: not a browser security guarantee'),field('Expected evidence',flow.evidence),field('Entry point / dependency',flow.entrypoint));
  $('graph').replaceChildren();
  flow.steps.forEach((s,i) => {
    const b = text('button','',`node${s.id === stepId ? ' active' : ''}`); b.append(text('span',String(i+1).padStart(2,'0'),'number'),text('strong',s.title),text('small',s.owner));
    b.onclick = () => { stepId = s.id; show(); }; $('graph').append(b);
  });
  const step = flow.steps.find(s => s.id === stepId) || flow.steps[0];
  const d = text('div','', 'details'); d.append(field('Evidence to retain',step.evidence),field('Recovery',step.recovery),field('Timeout budget',`${step.timeoutSeconds} seconds; live enforcement required by executor`),field('Attempt policy',`${step.attempts} allowed attempt(s); ${step.effect} step`));
  $('step-detail').replaceChildren(text('h3',`Step ${flow.steps.indexOf(step)+1}: ${step.title}`),d);
  renderRun();
}
function reset() { run = newRun(flow,`demo_${Date.now()}`,`demo-intent:${flow.id}:v${flow.version}`); $('error').textContent = ''; }
function act(event) { try { run = transition(run,event); $('error').textContent = ''; } catch (e) { $('error').textContent = e.message; } renderRun(); }
function advance() {
  const actions = { received: { type:'validate' }, validated: { type:'plan' }, ready: { type:'dispatch' }, dispatching: { type:'accepted',remoteId:'demo_remote_run' }, running: { type:'executor_completed' }, verifying: { type:'verified',passed:true,evidenceRefs:['demo:independent-receipt'] } };
  if (actions[run.state]) act(actions[run.state]);
}
function renderRun() {
  $('run-state').textContent = run.state.toUpperCase().replaceAll('_',' ');
  const controls = allowedControls(run);
  $('advance').disabled = !controls.includes('advance'); $('approve').disabled = !controls.includes('approve'); $('retry').disabled = !controls.includes('retry');
  $('cancel').disabled = !controls.includes('cancel'); $('confirm-cancel').disabled = !controls.includes('confirm-cancellation');
  $('inject').disabled = ['succeeded','failed','cancelled'].includes(run.state);
  $('reconcile-applied').disabled = run.state !== 'outcome_unknown'; $('reconcile-not').disabled = run.state !== 'outcome_unknown';
  const failure = FAILURES[run.failure];
  $('recovery').textContent = run.state === 'outcome_unknown' ? 'STOP: the external action may already have happened. Inspect its receipt or destination state. Automatic retry is deliberately disabled here.' : failure ? `Owner: ${failure.owner}. ${failure.fix}` : `Intent: ${run.intentHash}. Attempts: ${run.attempts}/${run.maxAttempts}. A completed executor still needs verification.`;
  $('trace').replaceChildren(...run.events.map(e => { const d = text('div','', 'event'); d.append(text('span',String(e.seq).padStart(2,'0')),text('span',e.type),text('span',`${e.from} → ${e.to}`)); return d; }));
  if (!run.events.length) $('trace').append(text('p','No events yet. Advance the state or inject a failure.','muted'));
}
$('search').oninput = list; $('category').onchange = list; $('advance').onclick = advance;
$('approve').onclick = () => act({ type:'approve',actor:'demo-owner',intentHash:run.intentHash,expiresAt:Date.now()+60000 });
$('retry').onclick = () => act({ type:'retry',safeToRepeat:true }); $('cancel').onclick = () => act({ type:'cancel' });
$('confirm-cancel').onclick = () => act({ type:'cancel_confirmed',evidenceRefs:['demo:remote-cancel-receipt'] });
$('inject').onclick = () => act({ type:'fault',code:$('fault').value });
$('reconcile-applied').onclick = () => act({ type:'reconcile',actor:'demo-operator',outcome:'applied',evidenceRefs:['demo:external-lookup'] });
$('reconcile-not').onclick = () => act({ type:'reconcile',actor:'demo-operator',outcome:'not_applied',evidenceRefs:['demo:external-lookup'] });
$('reset').onclick = () => { reset(); renderRun(); };
$('export').onclick = () => {
  const blob = new Blob([JSON.stringify({ mode:'simulation-only',catalogueVersion:VERSION,workflow:flow,run },null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `rehearsal-${flow.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url),500);
};
$('refresh').onclick = async () => {
  $('live-data').textContent = '';
  if (location.protocol === 'file:') { $('live-status').textContent = 'Offline preview. Open this board through the authenticated Bops server to observe real sessions.'; return; }
  try {
    const response = await fetch('/api/workforce/status',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error(`Unavailable or not authenticated (${response.status})`);
    const s = await response.json(); if (s.mode !== 'observed-bops-state') throw new Error('Snapshot contract mismatch');
    $('live-status').textContent = `Observed at ${s.observedAt}. ${s.coverage}`;
    $('live-data').textContent = JSON.stringify(s,null,2);
  } catch (e) { $('live-status').textContent = `${e.message}. No live status is inferred.`; }
};
for (const [title,status,detail] of [
  ['Contracts + rehearsal','AVAILABLE','32 mapped workflows. Inspect each step and rehearse failure handling without external effects.'],
  ['Existing Bops private core','PREVIOUS CI EVIDENCE','The base commit has recorded app, Docker and egress tests. This is not a current customer deployment.'],
  ['Trigger deployment','NOT ACTIVATED','Pinned SDK task scaffold. One scheduler owner per recipe; migrate schedules deliberately.'],
  ['Skyvern deployment','NOT ACTIVATED','Self-hosted HTTP adapter. Model/vision, cancellation, approval and egress must pass together.'],
  ['Business connectors','NOT ACTIVATED','CRM, email, accounting and portal recipes need customer-scoped credentials and evidence verifiers.'],
  ['Customer release','BLOCKED UNTIL VERIFIED','Run restart, uncertain-write, cancellation, permissions, backup and live-provider acceptance on the target server.'],
]) { const d = text('div','', 'gate'); d.append(text('strong',title),text('em',status),text('p',detail)); $('gates').append(d); }
reset(); show();
