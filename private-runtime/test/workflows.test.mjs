import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workflows, states, workflow, transition } from '../workflows/catalog.mjs';
// The Skyvern task-API adapter, filesystem journal ledger and owner CLI that
// this suite used to exercise are gone: the Trigger task is the one submission
// path, and its guarantees are covered by orchestration.test.mjs and the
// real-Postgres tests under integrations/trigger.
function temp(t) { const dir = mkdtempSync(join(tmpdir(), 'workflow-test-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }

test('every mapped workflow has an owner gate, evidence, repair and exact source', () => {
  // catalog.json is the single registry now: 24 flows, one taxonomy.
  assert.equal(new Set(workflows.map(x => x.id)).size, 24);
  for (const w of workflows) { assert.ok(w.steps.length >= 3); for (const k of ['approval','evidence','repair','source','readiness']) assert.ok(w[k]); }
  assert.equal(workflow('submit-form').readiness, 'mapped'); assert.equal(workflow('chat').readiness, 'existing-core');
  assert.throws(() => workflow('missing'));
});

test('business outcomes cannot jump from queued or unknown to success', () => {
  for (const [from, targets] of Object.entries(states)) for (const to of targets) assert.ok(to in states, `${from} -> ${to}`);
  assert.throws(() => transition('queued', 'succeeded')); assert.throws(() => transition('outcome_unknown', 'dispatching'));
  // Nothing reaches success without independent evidence, and the old
  // awaiting_verification alias is gone with the single taxonomy.
  assert.throws(() => transition('awaiting_verification', 'succeeded'));
  assert.throws(() => transition('verifying', 'succeeded'));
  assert.equal(transition('verifying', 'succeeded', { verified: true, verifier: 'destination-readback', receiptId: 'receipt_1' }), 'succeeded');
});

test('every source reference exists and rendered map is deterministic', async t => {
  const { existsSync } = await import('node:fs');
  const { renderWorkflowMap } = await import('../workflows/render.mjs');
  const root = new URL('../../', import.meta.url);
  for (const w of workflows) assert.ok(existsSync(new URL(w.source, root)), w.source);
  const target = join(temp(t), 'map.html');
  renderWorkflowMap(target); renderWorkflowMap(target, true);
  assert.ok(readFileSync(target, 'utf8').includes('DESIGN MAP'));
});
