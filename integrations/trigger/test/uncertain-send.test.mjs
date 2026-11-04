/** P5: a write whose response is lost must be reconciled, never resent.
 * Real HTTP destination, real Postgres ledger, production dispatch/verify code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { postgresLedger } from '../../../private-runtime/workflows/postgres-ledger.mjs';
import { dispatchWriteOnce, reconcileByLookup } from '../../../private-runtime/workflows/dispatch.mjs';
import { closeVerified, verifySentMessage } from '../../../private-runtime/workflows/verify.mjs';
import { actionIdentity, digest } from '../../../private-runtime/workflows/contracts.mjs';

const url = process.env.ERNESTA_LEDGER_TEST_DATABASE_URL;
if (!url) throw new Error('Set an isolated test database; never run against customer production.');
const pool = new Pool({ connectionString: url, max: 8 });
await pool.query(readFileSync(new URL('../../../private-runtime/workflows/ledger.sql', import.meta.url), 'utf8'));
test.after(() => pool.end());

const hash = () => randomBytes(32).toString('hex');

/** A connector-shaped destination: POST commits first, then answers.
 * With loseResponse the commit happens and the socket dies before any status,
 * which is exactly the case that must never become a second POST.
 */
async function destination(t, { loseResponse }) {
  const messages = new Map();
  let posts = 0;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const target = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST' && target.pathname === '/send') {
      posts++;
      const body = JSON.parse(raw);
      const stored = { messageId: `msg_${body.operationId.slice(-12)}`, to: body.to, subject: body.subject, status: 'sent' };
      messages.set(body.operationId, stored); // the action is committed here
      if (loseResponse) return req.socket.destroy(); // ...and the response never arrives
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ messageId: stored.messageId }));
    }
    const found = target.pathname.match(/^\/messages\/(.+)$/);
    if (req.method === 'GET' && found) {
      const stored = messages.get(decodeURIComponent(found[1]));
      if (!stored) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(stored));
    }
    res.writeHead(404); res.end();
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    posts: () => posts,
    base,
    client: {
      async submit(request) {
        const response = await fetch(`${base}/send`, { method: 'POST', body: JSON.stringify(request) });
        if (!response.ok) throw new Error('destination rejected');
        const body = await response.json();
        return { remoteId: body.messageId };
      },
    },
    lookupMessage: async operationId => {
      const response = await fetch(`${base}/messages/${encodeURIComponent(operationId)}`);
      if (response.status === 404) return null;
      const body = await response.json();
      return { remoteId: body.messageId, ...body };
    },
  };
}

const events = async actionKey => {
  const { rows } = await pool.query('SELECT event_type FROM ernesta_workflow_events WHERE action_key=$1 ORDER BY event_id', [actionKey]);
  return rows.map(r => r.event_type);
};

test('a lost response after the destination committed sends exactly one POST, then reconciles and closes once', async t => {
  const dest = await destination(t, { loseResponse: true });
  const ledger = postgresLedger(pool);
  const intended = { to: 'dana@example.test', subject: 'Quote 1184' };
  const operationId = `op_${hash().slice(0, 16)}`;
  const actionKey = actionIdentity({ installationId: 'inst_test', workflowId: 'send-approved', version: 1, objectId: operationId, operation: 'send' });
  const requestHash = digest(intended);
  const request = { operationId, ...intended };

  // The write happens, the answer never comes back.
  await assert.rejects(
    dispatchWriteOnce({ client: dest.client, ledger, actionKey, requestHash, request }),
    error => error.code === 'submission_outcome_unknown',
  );
  assert.equal(dest.posts(), 1, 'exactly one POST reached the destination');
  let row = (await pool.query('SELECT status, remote_id FROM ernesta_workflow_actions WHERE action_key=$1', [actionKey])).rows[0];
  assert.deepEqual([row.status, row.remote_id], ['OUTCOME_UNKNOWN', null], 'unknown, with no remote id to trust');

  // A retry is the duplicate-send bug. It must refuse, and must not reach the wire.
  await assert.rejects(
    dispatchWriteOnce({ client: dest.client, ledger, actionKey, requestHash, request }),
    error => error.code === 'submission_outcome_unknown',
  );
  assert.equal(dest.posts(), 1, 'no second POST, ever');

  // Reconcile from the destination itself, not from what the executor claims.
  const found = await reconcileByLookup({ ledger, actionKey, requestHash, lookup: () => dest.lookupMessage(operationId) });
  assert.equal(found.to, intended.to);
  row = (await pool.query('SELECT status, remote_id FROM ernesta_workflow_actions WHERE action_key=$1', [actionKey])).rows[0];
  assert.deepEqual([row.status, row.remote_id], ['SUBMITTED', found.remoteId], 'the action that happened is now recorded');

  // Closing is once-only.
  await assert.rejects(
    reconcileByLookup({ ledger, actionKey, requestHash, lookup: () => dest.lookupMessage(operationId) }),
    error => error.code === 'not_reconcilable',
  );

  // Success needs evidence from the destination.
  const evidence = verifySentMessage({ intended, observed: await dest.lookupMessage(operationId) });
  assert.equal(closeVerified('VERIFYING', evidence), 'SUCCEEDED');
  assert.equal(closeVerified('OUTCOME_UNKNOWN', evidence), 'SUCCEEDED', 'reconciling a lost write is a legal path to success');

  assert.deepEqual(await events(actionKey), ['SUBMISSION_RESERVED', 'RECONCILIATION_REQUIRED', 'RECONCILED']);
  assert.equal(dest.posts(), 1);
});

test('an action that never happened cannot be reconciled into a success', async t => {
  const dest = await destination(t, { loseResponse: true });
  const ledger = postgresLedger(pool);
  const operationId = `op_${hash().slice(0, 16)}`;
  const actionKey = actionIdentity({ installationId: 'inst_test', workflowId: 'send-approved', version: 1, objectId: operationId, operation: 'send' });
  const requestHash = digest({ to: 'dana@example.test', subject: 'Never sent' });

  await assert.rejects(
    dispatchWriteOnce({ client: dest.client, ledger, actionKey, requestHash, request: { operationId, to: 'dana@example.test', subject: 'Never sent' } }),
    error => error.code === 'submission_outcome_unknown',
  );
  // The destination has nothing for this operation, so this is not a success.
  await assert.rejects(
    reconcileByLookup({ ledger, actionKey, requestHash, lookup: () => dest.lookupMessage('op_absent') }),
    error => error.code === 'action_absent_fresh_approval_required',
  );
  const row = (await pool.query('SELECT status, remote_id FROM ernesta_workflow_actions WHERE action_key=$1', [actionKey])).rows[0];
  assert.deepEqual([row.status, row.remote_id], ['OUTCOME_UNKNOWN', null], 'still unknown; a consequential retry needs fresh approval');
  assert.equal(dest.posts(), 1);
});

test('verification refuses self-report and a read-back that does not match', async () => {
  const intended = { to: 'dana@example.test', subject: 'Quote 1184' };
  assert.throws(
    () => closeVerified('VERIFYING', { verified: true, verifier: 'executor-self-report', receiptId: 'msg_1' }),
    error => error.code === 'independent_verifier_required',
  );
  assert.throws(
    () => verifySentMessage({ intended, observed: { messageId: 'msg_1', to: intended.to, subject: 'Quote 9999', status: 'sent' } }),
    error => error.code === 'result_mismatch',
  );
  assert.throws(
    () => closeVerified('QUEUED', verifySentMessage({ intended, observed: { messageId: 'msg_1', ...intended, status: 'sent' } })),
    error => error.code === 'invalid_transition',
  );
});
