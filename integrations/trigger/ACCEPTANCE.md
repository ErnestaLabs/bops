# Acceptance: one real workflow, then the eight ways it breaks

The milestone is a single run that goes owner task → Chief → Trigger → specialist
→ executor → ledger → verifier → report → trace, and then the same run put
through every failure that matters, proving each lands in a state an operator can
recover from.

`private-runtime/workflows/acceptance.mjs` is that run. It drives the production
modules (`browser-run`, `skyvern-client`, `postgres-ledger`, `dispatch`,
`verify`) and injects faults at the edges — the transport, the destination, the
process — instead of mocking the path.

```bash
ERNESTA_LEDGER_DATABASE_URL=postgresql://... \
  node private-runtime/workflows/acceptance.mjs --stand-in   # here
ERNESTA_LEDGER_DATABASE_URL=postgresql://... \
  node private-runtime/workflows/acceptance.mjs --live       # on the Docker host
```

Exit `0` = every provable scenario passed. `1` = something failed. `2` = nothing
failed but something could not be armed against this deployment, so the run is
not complete either.

## What each scenario asserts

| Scenario | Fault | Must land in | Proven by |
| --- | --- | --- | --- |
| `happy` | none | `SUCCEEDED` | independent read-back, one submission |
| `lost-response` | write lands, answer discarded | `OUTCOME_UNKNOWN` → `RECONCILED` → `SUCCEEDED` | ledger row stayed `OUTCOME_UNKNOWN`; one submission |
| `worker-dies` | `SIGKILL` between write and receipt | `SUBMITTING` row → reconciled → `SUCCEEDED` | no witness existed; the destination answered; one submission |
| `restart-server` | `SIGKILL` after the run is recorded | resumed, never resent | row survived with `remote_id`; one submission total |
| `duplicate-trigger` | two schedulers, same action | one submission | loser resumes or reports uncertainty, never posts again |
| `website-changed` | run completes, output is wrong | `FAILED` at verification, repair not resend | `result_mismatch`; one submission |
| `mfa-appears` | destination needs a human | `WAITING_APPROVAL`, then resumes | not cancelled, not resubmitted; one submission |
| `model-fails` | inference outage mid-run | `OUTCOME_UNKNOWN` → `RECONCILING` → `FAILED` | the run exists, so it is a recorded failure |
| `cancel-mid-run` | owner stops it | `CANCELLING` → `CANCELLED` | only after the destination confirms it stopped |

Every scenario asserts the submission count from the destination side, because
"exactly one write" is a property of the destination, not of our bookkeeping.

## Already proven here (no Docker)

Run on a machine with no Docker socket access and no vendor credentials:

- `node --test private-runtime/test/*.test.mjs` — 213 pass.
- `integrations/trigger`: `test/ledger.test.mjs test/uncertain-send.test.mjs`
  against real Postgres — 6 pass.
- `node private-runtime/workflows/acceptance.mjs --stand-in` — 9/9, exit 0.

The stand-in is a local wire stand-in, not Skyvern. It marks every response
`x-bops-stand-in: true`, and `--live` refuses to run against it, so a stand-in
result cannot be read as a live one. In stand-in mode the summary reports
`businessOutcomeVerified: false`.

## Remaining step: the live run

1. **Start the pinned services** on a customer-owned Docker host: Trigger 4.8.3,
   Skyvern 1.0.56, and a Postgres for the application ledger that is *separate*
   from Trigger's own database.

2. **Configure secrets** from a secret store, never a file in Git:

   ```bash
   TRIGGER_API_URL=https://trigger.internal      # self-hosted only
   TRIGGER_PROJECT_REF=proj_...
   TRIGGER_SECRET_KEY=...
   SKYVERN_API_BASE_URL=https://skyvern.internal # origin, no /v1 suffix
   SKYVERN_API_KEY=...
   SKYVERN_ALLOWED_WORKFLOW_IDS=wpid_...         # pre-published in Skyvern
   ERNESTA_LEDGER_DATABASE_URL=postgresql://...  # application ledger
   WORKFLOW_APPROVAL_KEY=<64 hex>                # owner approval process only
   ```

3. **Migrate the ledger** first: apply `private-runtime/workflows/ledger.sql` to
   `ERNESTA_LEDGER_DATABASE_URL`. Without it a task aborts on purpose rather
   than writing without durable intent.

4. **Deploy the tasks**: `npm run deploy` in `integrations/trigger`. One config
   (`trigger.config.ts`) covers `./src` and `./tasks`; the CLI refuses a
   `trigger.dev` host.

5. **Run the acceptance**:

   ```bash
   cd integrations/trigger && npm run acceptance:live
   ```

   Expect `happy`, `lost-response`, `restart-server`, `duplicate-trigger`,
   `website-changed`, `cancel-mid-run` to pass, and `mfa-appears` /
   `model-fails` to report `BLOCKED` (exit 2). Those two faults can only be armed
   inside the vendor run; proving them live needs a real MFA-gated page and a
   scheduled inference outage, which is a separate exercise.

6. **Close the live lost-write case by hand.** `--live` cannot search Skyvern for
   the action, so reconciliation needs the run id an operator found:

   ```bash
   node private-runtime/workflows/acceptance.mjs --live \
     --scenario=lost-response --found-run-id=wr_...
   ```

   Then confirm in the Skyvern UI that exactly one run exists for that action.
   If the deployed Skyvern version exposes run listing, `findByActionKey` belongs
   next to `client.inspect()`; the adapter deliberately does not guess a vendor
   search API.

## Launch blockers this run does not cover

These are missing from the chain, not merely unproven:

- **Agent Desktop is installed but cannot be dispatched to.** `agent-desktop@1.1.0`
  is in the private worker image and `docker-smoke.mjs` asserts the binary runs,
  and the taxonomy names it as an execution surface. Nothing in the workflow
  runtime hands it work: there is no client, no task, and no `dispatchWriteOnce`
  caller for it. So the acceptance chain still has exactly one executor, Skyvern.
- **No API-connector sender.** `verifySentMessage()` is a read-back contract with
  no sender behind it. No connector client exists, so no connector workflow can
  be dispatched.
- **Chief is not wired to dispatch.** The Bops app has no Trigger client at all —
  nothing in `app/` or `lib/` imports `@trigger.dev/sdk` — and the task takes a
  pre-signed approval payload. So "Chief decides what to do" is real in the
  product while "Trigger creates the run" is still a separate world; that join is
  the missing link in the chain as drawn.

## Do not

- Do not point Bops routines and Trigger at the same schedules: one scheduler
  owns each workflow.
- Do not resubmit an action stuck in `OUTCOME_UNKNOWN`; reconcile it. Replaying
  it is the duplicate-write bug this path exists to prevent.
- Do not report a stand-in run, or a task's own completion, as business success.
