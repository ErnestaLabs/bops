# Acceptance: real Trigger + Skyvern

What is already proven on a machine without Docker, and the exact run that is
left for a Docker-capable host.

## Proven here (no Docker required)

```bash
# contract, ledger, dispatch and recovery suites
node --test private-runtime/test/*.test.mjs                    # 208 pass
cd integrations/trigger && \
  ERNESTA_LEDGER_TEST_DATABASE_URL=postgresql://... \
  node --test test/ledger.test.mjs test/uncertain-send.test.mjs # 6 pass

# the same path the deployed task runs, over real HTTP + real Postgres
ERNESTA_LEDGER_DATABASE_URL=postgresql://... \
  node private-runtime/workflows/slice.mjs --stand-in            # SUCCEEDED
ERNESTA_LEDGER_DATABASE_URL=postgresql://... \
  node private-runtime/workflows/slice.mjs --stand-in --lose-response
```

The stand-in is a local wire stand-in, not Skyvern. `--stand-in` reports
`businessOutcomeVerified: false` and the live mode refuses a stand-in endpoint,
so a stand-in result cannot be read as a live one.

## Remaining step

1. **Start the pinned services** on the Docker-capable host (customer-owned, not
   Trigger Cloud, not Skyvern Cloud). Trigger 4.8.3 and Skyvern 1.0.56, per the
   versions in the image tags you deploy; a Postgres for the application ledger
   that is *separate* from Trigger's own database.

2. **Configure secrets** from a secret store, never a file in Git:

   ```bash
   TRIGGER_API_URL=https://trigger.internal      # self-hosted only
   TRIGGER_PROJECT_REF=proj_...
   TRIGGER_SECRET_KEY=...                        # in the worker/CLI environment only
   SKYVERN_API_BASE_URL=https://skyvern.internal # origin, no /v1 suffix
   SKYVERN_API_KEY=...
   SKYVERN_ALLOWED_WORKFLOW_IDS=wpid_...         # must be pre-published in Skyvern
   ERNESTA_LEDGER_DATABASE_URL=postgresql://...  # application ledger
   WORKFLOW_APPROVAL_KEY=<64 hex>                # owner approval process only
   ```

3. **Migrate the ledger** before enabling anything: apply
   `private-runtime/workflows/ledger.sql` to `ERNESTA_LEDGER_DATABASE_URL`.
   Without it a task aborts on purpose rather than writing without durable intent.

4. **Deploy the tasks**: `npm run deploy` in `integrations/trigger`. One config
   (`trigger.config.ts`) covers `./src` and `./tasks`; the CLI refuses to deploy
   against a `trigger.dev` host.

5. **Run the real slice**:

   ```bash
   cd integrations/trigger && npm run slice:live
   ```

   Expected on success: `finalState: SUCCEEDED`, `businessOutcomeVerified: true`,
   ledger events `SUBMISSION_RESERVED` then `REMOTE_ID_RECORDED`, and a run id
   you can open in the Skyvern UI. A `result_mismatch` means Skyvern finished but
   did not produce the fields the owner asked for — the action stays unverified.

6. **Prove the lost-write path against the real service**: run the same action
   with the destination reachable but its response discarded (kill the connection
   from the proxy, or stop the worker at the POST). The expected sequence is
   `OUTCOME_UNKNOWN` → lookup of the recorded action in Skyvern →
   `RECONCILED`, with exactly one run created in the Skyvern UI.

## Do not

- Do not point Bops routines and Trigger at the same schedules: one scheduler
  owns each workflow.
- Do not resubmit an action stuck in `OUTCOME_UNKNOWN`; reconcile it. Replaying
  it is the duplicate-write bug this path exists to prevent.
