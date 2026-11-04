import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRANSITIONS, expandCatalog, validateCatalog } from '../workflows/contracts.mjs';
import { canonicalCatalog, workflows, states, workflow, transition } from '../workflows/catalog.mjs';

test('catalog.json is the single runtime workflow registry', () => {
  const raw = JSON.parse(readFileSync(new URL('../workflows/catalog.json', import.meta.url), 'utf8'));
  assert.equal(raw.workflows.length, 24);
  assert.deepEqual(raw.states, Object.keys(TRANSITIONS));
  assert.deepEqual(canonicalCatalog.workflows.map(w=>w.id), raw.workflows.map(w=>w.id));
  assert.deepEqual(workflows.map(w=>w.id), raw.workflows.map(w=>w.id));
  assert.equal(validateCatalog(expandCatalog(raw)).workflows, 24);
});

test('catalog.mjs no longer owns an independent transition graph', () => {
  assert.deepEqual(Object.keys(states), Object.keys(TRANSITIONS).map(s=>s.toLowerCase()));
  assert.equal(transition('received','validating'),'validating');
  assert.throws(() => transition('received','succeeded'));
});

test('compatibility lookup projects canonical workflow data', () => {
  const w = workflow('submit-form');
  const raw = canonicalCatalog.workflows.find(x=>x.id==='submit-form');
  assert.equal(w.title, raw.name);
  assert.deepEqual(w.steps, raw.steps.map(s=>s[0]));
  assert.equal(w.evidence, raw.success);
});
