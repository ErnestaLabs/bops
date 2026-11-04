/** The two endings that are not "verification required": a run that parks for a
 * human, and a stop that is only a stop once the destination says so.
 *
 * These use a fake client on purpose — they are contract tests for the state the
 * orchestration reports. The real HTTP, ledger and process-death behaviour is
 * covered by private-runtime/workflows/acceptance.mjs, which is not a mock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runApprovedBrowserWorkflow } from '../workflows/browser-run.mjs';
import { actionIdentity, digest, signApproval } from '../workflows/contracts.mjs';
import { browserRequest } from '../workflows/skyvern-client.mjs';

const workflowId = 'wpid_test';
const approvalKey = 'b'.repeat(64);
const parameters = { url: 'https://example.com/', prompt: 'Read the page.', max_steps: 3 };
const actionKey = actionIdentity({ installationId: 'test', workflowId, version: 1, objectId: 'object-1', operation: 'observe-page' });
const request = browserRequest({ actionKey, workflowId, parameters }, [workflowId]);
const approval = signApproval({ actionKey, requestHash: digest(request), expiresAt: Date.now() + 60_000 }, approvalKey);
const action = { actionKey, workflowId, parameters };

function reserveOnce() {
  let reserved = false;
  return {
    async reserve(key, hash) {
      if (reserved) throw new Error('should have been called once');
      reserved = true;
      return { created: true, requestHash: hash, remoteId: null };
    },
    async submitted() {},
    async unknown() {},
    async reconcile() {},
  };
}

const run = (client, extra = {}) => runApprovedBrowserWorkflow({
  client, ledger: reserveOnce(), allowedWorkflowIds: [workflowId], approvalKey, action, approval,
  poll: () => {}, onState: () => {}, ...extra,
});

test('a run parked for a human reports WAITING_APPROVAL and is not cancelled or resent', async () => {
  let cancels = 0; let polls = 0;
  const client = {
    async submit() { return { remoteId: 'wr_paused', remoteStatus: 'paused', businessState: 'WAITING_APPROVAL' }; },
    async get() { polls += 1; return { remoteId: 'wr_paused', remoteStatus: 'paused', businessState: 'WAITING_APPROVAL' }; },
    async cancel() { cancels += 1; },
  };
  const result = await run(client, { signal: { aborted: true } });
  assert.equal(result.interventionRequired, true);
  assert.equal(result.finalState, 'WAITING_APPROVAL');
  assert.equal(polls, 0, 'must not keep polling a run that needs a person');
  assert.equal(cancels, 0, 'must not abandon the owner task just because it is paused');
});

test('a stop is only CANCELLED once the destination confirms it', async () => {
  const states = [];
  const client = {
    async submit() { return { remoteId: 'wr_cancel', remoteStatus: 'running', businessState: 'RUNNING' }; },
    async get() { return { remoteId: 'wr_cancel', remoteStatus: 'running', businessState: 'RUNNING' }; },
    async cancel() { return { remoteId: 'wr_cancel', businessState: 'CANCELLING' }; },
  };
  const controller = new AbortController();
  const result = await run(client, { signal: controller.signal, onRemoteId: () => controller.abort(), onState: s => states.push(s), cancelDeadlineMs: 0 });
  assert.equal(result.cancelled, true);
  assert.equal(result.stopped, false);
  assert.equal(result.finalState, 'OUTCOME_UNKNOWN', 'an unconfirmed stop is still an ambiguous write');
  assert.deepEqual(states.slice(0, 2), ['VALIDATING', 'RUNNING']);
  assert.ok(states.includes('CANCELLING'));
});

test('a confirmed stop is CANCELLED with stop evidence', async () => {
  let reads = 0;
  const client = {
    async submit() { return { remoteId: 'wr_cancel2', remoteStatus: 'running', businessState: 'RUNNING' }; },
    async get() { reads += 1; return { remoteId: 'wr_cancel2', remoteStatus: reads > 1 ? 'canceled' : 'running', businessState: reads > 1 ? 'CANCELLED' : 'RUNNING' }; },
    async cancel() {},
  };
  const controller = new AbortController();
  const result = await run(client, { signal: controller.signal, onRemoteId: () => controller.abort() });
  assert.equal(result.finalState, 'CANCELLED');
  assert.equal(result.stopped, true);
});

test('a run that finishes while being stopped is verified, not reported cancelled', async () => {
  const client = {
    async submit() { return { remoteId: 'wr_race', remoteStatus: 'running', businessState: 'RUNNING' }; },
    async get() { return { remoteId: 'wr_race', remoteStatus: 'completed', businessState: 'VERIFYING' }; },
    async cancel() {},
  };
  const controller = new AbortController();
  const result = await run(client, { signal: controller.signal, onRemoteId: () => controller.abort() });
  assert.equal(result.cancelled, false);
  assert.equal(result.verificationRequired, true, 'a completed write cannot be reported as stopped');
});

test('resuming a recorded action reuses the remote run instead of submitting again', async () => {
  let submits = 0;
  const ledger = {
    async reserve(key, hash) { return { created: false, requestHash: hash, remoteId: 'wr_existing' }; },
    async submitted() { throw new Error('must not record a second submission'); },
    async unknown() {}, async reconcile() {},
  };
  const client = {
    async submit() { submits += 1; throw new Error('must not submit again'); },
    async get() { return { remoteId: 'wr_existing', remoteStatus: 'completed', businessState: 'VERIFYING' }; },
  };
  const result = await runApprovedBrowserWorkflow({
    client, ledger, allowedWorkflowIds: [workflowId], approvalKey, action, approval, poll: () => {}, onState: () => {},
  });
  assert.equal(submits, 0);
  assert.equal(result.verificationRequired, true);
  assert.equal(result.observed.remoteId, 'wr_existing');
});
