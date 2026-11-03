import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOWS, FAILURES, validateCatalogue } from '../../public/workforce-map/catalogue.mjs';
import { newRun, transition, allowedControls } from '../../public/workforce-map/state.mjs';
import { snapshot } from '../workflows/snapshot.mjs';
const writeFlow = FLOWS.find(f => f.id === 'send-approved');
function ready(flow = writeFlow) {
  let r = newRun(flow,'run_1','exact-hash');
  for (const type of ['validate','plan']) r = transition(r,{type},1000);
  if (r.state === 'awaiting_approval') r = transition(r,{type:'approve',actor:'owner',intentHash:'exact-hash',expiresAt:5000},1000);
  return r;
}
test('catalogue maps 32 workflows with complete evidence and failure routes', () => {
  assert.deepEqual(validateCatalogue(),{workflows:32,steps:240,failureClasses:13});
  assert.throws(() => validateCatalogue([FLOWS[0],FLOWS[0]]));
  const bad = structuredClone(writeFlow); bad.steps = bad.steps.filter(s => s.id !== 'approve');
  assert.throws(() => validateCatalogue([bad]));
});
for (const flow of FLOWS) test(`contract happy path: ${flow.id} requires verified evidence`, () => {
  let r = ready(flow);
  for (const event of [{type:'dispatch'},{type:'accepted',remoteId:'remote_1'},{type:'executor_completed'}]) r = transition(r,event,1000);
  assert.equal(r.state,'verifying');
  assert.throws(() => transition(r,{type:'verified',passed:true,evidenceRefs:[]},1000));
  r = transition(r,{type:'verified',passed:true,evidenceRefs:['receipt:1']},1000);
  assert.equal(r.state,'succeeded'); assert.deepEqual(allowedControls(r),[]);
  assert.throws(() => transition(r,{type:'dispatch'},1000));
});
test('all failures have an owner and explicit repair action; writes never enter blind retry', () => {
  const running = transition(transition(ready(),{type:'dispatch'},1000),{type:'accepted',remoteId:'r'},1000);
  for (const [code,failure] of Object.entries(FAILURES)) {
    assert.ok(failure.owner && failure.fix);
    const r = transition(running,{type:'fault',code},1000);
    assert.equal(r.state,'outcome_unknown'); assert.ok(!allowedControls(r).includes('retry'));
  }
});
test('approval must match the plan, be unexpired at dispatch, and identify an actor', () => {
  let r = newRun(writeFlow,'r','exact-hash'); r = transition(transition(r,{type:'validate'}),{type:'plan'});
  for (const extra of [{actor:'owner',intentHash:'wrong',expiresAt:5000},{actor:'owner',intentHash:'exact-hash',expiresAt:999},{intentHash:'exact-hash',expiresAt:5000}]) assert.throws(() => transition(r,{type:'approve',...extra},1000));
  assert.throws(() => transition(ready(),{type:'dispatch'},5001));
});
test('uncertain dispatch needs reconciliation and new approval before a write can repeat', () => {
  let r = transition(ready(),{type:'dispatch'},1000); r = transition(r,{type:'fault',code:'dispatch_uncertain'},1000);
  assert.throws(() => transition(r,{type:'retry',safeToRepeat:true},1000));
  assert.throws(() => transition(r,{type:'reconcile',outcome:'not_applied'},1000));
  r = transition(r,{type:'reconcile',actor:'owner',outcome:'not_applied',evidenceRefs:['receipt:absence']},1000);
  assert.equal(r.state,'awaiting_approval'); assert.equal(r.approval,null);
});
test('cancellation request is not cancellation confirmation', () => {
  let r = transition(transition(ready(),{type:'dispatch'},1000),{type:'accepted',remoteId:'r'},1000);
  r = transition(r,{type:'cancel'},1000); assert.equal(r.state,'cancel_requested');
  assert.throws(() => transition(r,{type:'cancel_confirmed'},1000));
  assert.equal(transition(r,{type:'cancel_confirmed',evidenceRefs:['remote:cancelled']},1000).state,'cancelled');
});
test('safe read retries are bounded; unknown events are rejected', () => {
  let r = ready(FLOWS.find(f => f.id === 'research'));
  for (let i=0;i<3;i++) {
    r = transition(r,{type:'dispatch'},1000); r = transition(r,{type:'accepted',remoteId:`r${i}`},1000);
    r = transition(r,{type:'fault',code:'rate_limited'},1000);
    if (i<2) r = transition(r,{type:'retry',safeToRepeat:true},1000);
  }
  assert.equal(r.state,'blocked'); assert.throws(() => transition(r,{type:'retry',safeToRepeat:true},1000));
  assert.throws(() => transition(r,{type:'invented'},1000));
});
test('read-only snapshot excludes all payloads, credentials and customer names', () => {
  const value = snapshot({sessions:[{id:'s',botId:'b',status:'running',goal:'private customer text',error:'secret password'}]}, {BOPS_PRIVATE_RUNTIME:'1',BOPS_SKYVERN_BASE_URL:'http://skyvern:8000',BOPS_SKYVERN_API_KEY:'secret-key'},0);
  const out = JSON.stringify(value);
  for (const secret of ['private customer text','secret password','secret-key','http://skyvern']) assert.ok(!out.includes(secret));
  assert.equal(value.integrations.skyvern.configured,true); assert.equal(value.integrations.skyvern.connected,false);
});

test('an uncertain read submission cannot be relabelled into a retryable failure', () => {
  let r = transition(ready(FLOWS.find(f => f.id === 'research')), {type:'dispatch'}, 1000);
  r = transition(r,{type:'fault',code:'dispatch_uncertain'},1000);
  r = transition(r,{type:'fault',code:'rate_limited'},1000);
  assert.equal(r.state,'outcome_unknown');
  assert.ok(!allowedControls(r).includes('retry'));
});
