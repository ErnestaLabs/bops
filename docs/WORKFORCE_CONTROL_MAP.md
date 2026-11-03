# Workforce control map: Bops + Trigger.dev + Skyvern

## Open the scaffold now

From the repository root, Node 22 is sufficient; no API key, GPU, Docker daemon or
package install is required for the visual rehearsal:

```sh
node private-runtime/workflows/preview.mjs
# http://127.0.0.1:4310
node --test private-runtime/test/workflow-board.test.mjs
node private-runtime/workflows/export-map.mjs /absolute/path/workforce-control-map.html
```

On the authenticated Bops server, open `/workforce-map/index.html`. Its optional
`GET /api/workforce/status` projection reads actual Bops session state and strips
prompts, names, secrets and raw errors. Configuration-present is not health or
connectivity. The standalone preview has no live API and never invents live data.
The portable HTML is the same catalogue/state machine/UI bundled without a CDN.

The earlier `docs/WORKFLOW_CONTROL_MAP.md` and owner-side CLI are preserved.
This board expands that operating map; the existing `skyvern.mjs`/`ledger.mjs`
remain the single production-facing submission implementation. The visual state
model is a rehearsal contract, not a second live scheduler or approval authority.

## Scope

Catalogue version 2026-11-03.1 maps 32 launch-scope workflow families, 240 steps and
13 failure classes. It is the known product scope, not every possible business
process. New IDs fail closed until a reviewed, versioned contract is added.

- Foundation: install/update, business onboarding, credentials and model checks.
- Core: owner chat, specialist delegation, scheduled tasks and external events.
- Browser: research, login/MFA, extraction, downloads, form preparation/submission.
- Business: inbox triage, CRM updates, follow-up drafts, approved sends, quotes,
  invoice intake, support cases and operating reports.
- Recovery: approval, safe retries, uncertain outcomes, cancellation, restart,
  context compaction, recipe repair, backups, provider changes and audit.

Each step specifies owner, side-effect classification, deadline, attempt budget,
evidence, and recovery. Those values are contracts to enforce in the executor;
a metadata field alone does not enforce a timeout, spend cap or permission.
The UI distinguishes existing components, tested contracts, adapters and maps.
Nothing in the simulator performs an external action.

## Roles and one source of execution truth

Bops keeps its owner interface, Chief/specialist roles and existing private computer
runtime. Trigger owns top-level scheduling and queued attempts after a deliberate
migration. Skyvern executes bounded browser jobs. Do not turn on Trigger cron for a
recipe while the same Bops routine remains active. Do not rebuild their schedulers.

Trigger workers must not import Bops' in-memory store or concurrently write its state
JSON. Use a narrow authenticated control service. Stable identifiers are tenantId,
workflowId/version, operationId, inputDigest, parentRunId, executorRunId and stepId.
Keep prompts/secrets out of log metadata. Store sensitive artifacts behind scoped
access, redact screenshots, and apply retention before customer rollout.

## Executable reliability rules

`public/workforce-map/state.mjs` is a deterministic contract simulator, not a replacement
for Trigger's execution engine. It proves transition rules:

1. Approval binds actor, exact intent and expiry, and is rechecked at dispatch.
2. A POST receipt means submitted, not completed. Remote completed means verifying.
3. Success requires a separate verifier result and evidence references.
4. A lost submission response is outcome_unknown; blind retries are forbidden.
5. Reconciliation needs an actor and independent evidence. Not-applied writes need
   new approval; applied writes go to verification without executing again.
6. Cancellation request is not cancellation confirmation.
7. Safe-read retries are bounded. Unknown workflow/event/status values are rejected.

An LLM's plan or confidence cannot stand in for an external receipt. The simulator's
synthetic verifier is NOT a production verifier. AI choices and external websites
remain nondeterministic; the states, permissions and recovery paths are explicit.

## Skyvern adapter and owner-side CLI

The existing `private-runtime/workflows/skyvern.mjs` and `ledger.mjs` from the
concurrent branch work are reused, not overwritten with another dispatcher.
They provide self-hosted submission, observation and cancellation requests; a
cancel request does not certify rollback or completed cancellation. The transport
has no cloud default, no automatic POST retries, bounded responses and sanitized
errors. Unknown provider states fail closed.

Configure the customer instance on the server, never in chat or Git:

```dotenv
BOPS_SKYVERN_BASE_URL=http://127.0.0.1:8000
BOPS_SKYVERN_API_KEY=<customer-instance-key>
BOPS_SKYVERN_ACCOUNT_SCOPE=<customer-account-id>
BOPS_PRIVATE_DATA_DIR=/absolute/persistent/customer/data
```

Use the existing reviewed request file and operator commands:

```sh
node private-runtime/workflows/cli.mjs plan /absolute/path/request.json
# Review the entire request and returned approval hash before starting.
node private-runtime/workflows/cli.mjs start /absolute/path/request.json --approve <reviewed-hash>
node private-runtime/workflows/cli.mjs status <recorded-run-id>
node private-runtime/workflows/cli.mjs cancel <recorded-run-id>
```

The reservation binds action ID, account, service origin, normalized payload and
step budget. It is durably written before POST. Reusing an action returns its
receipt rather than another submission; changed payloads conflict, and partial
reservations remain unresolved. No public submission route or live-submit button
is added by this board. The CLI is an owner-operated interface, not a remote
multi-user approval service. The board's approval-expiry checks are a rehearsed
contract; the current CLI hash is not a time-bound remote approval token.

The journal is single-host storage, not a distributed database. Do NOT mount it
into many independent Trigger workers. Integrate a transactional authenticated
bridge before distributed dispatch, with production approval expiry, permissions,
independent verifiers, retention and cancel reconciliation. The board calls none
of these mutating methods and stores no live credentials.

Skyvern must have independently enforced egress and credential scopes. The adapter's
start-URL validation does not constrain redirects, page links, uploads or model
choices. Existing Bops Docker egress tests are NOT proof that a separate Skyvern
installation shares those controls. Verify that explicitly. A read-intent prompt
does not technically make the browser read-only. Use an explicitly selected hosted
vision-capable non-OpenAI/non-xAI model; disclose selected prompts/screenshots sent
to it. No local model or anti-bot bypass service is added.

## Trigger adapter

`integrations/trigger` is isolated from the Bops dependency graph and pins the SDK
and CLI to 4.8.3. It declares two tasks: validate/inspect a mapped workflow, and observe
an EXISTING Skyvern run. They have explicit attempt/duration/concurrency settings.
They do not submit business actions or activate schedules. A successful observation
task does not imply a successful business outcome; the output says so explicitly.

```sh
cd integrations/trigger
npm install --ignore-scripts
# Retain/review the generated package-lock.json before reproducible deployment.
# Set TRIGGER_API_URL and WORKFORCE_TRIGGER_PROJECT for YOUR self-hosted instance.
# Use that instance's scoped secret via the operator's secret store, not chat/Git.
npm run dev
```

This is task scaffolding, not an installed Trigger platform. Use the upstream pinned
self-hosted distribution rather than a hand-built imitation of its infrastructure.
Its self-hosting documentation excludes checkpoint snapshots; explicit receipt and
state recovery must therefore be verified, not inferred from Cloud marketing.
Disable upstream telemetry (Trigger documents TRIGGER_TELEMETRY_DISABLED=1), and
verify outbound behavior for the chosen Skyvern release before calling it private.

## Release gates

Required before enabling live dispatch: provision the pinned customer services;
verify model text/tools/vision; verify the browser really uses approved egress; wire
the authenticated bridge and approval store; test independent outcome verifiers;
force a lost-response/restart without duplicate actions; confirm cancellation; test
backup/restore; migrate exactly one scheduler owner; and run a customer-scoped task.

No customer production deployment, live Trigger server, live Skyvern run or real
hosted model result is claimed by the scaffold tests. Existing private-runtime CI is
separate evidence. This change does not merge the branch or modify customer servers.

## Source and license references

Inspected 2026-11-03. These are sources, not runtime dependencies or CDN calls:

- Skyvern source/tag: https://github.com/Skyvern-AI/skyvern/tree/v1.0.56
- Skyvern task API: https://www.skyvern.com/docs/developers/getting-started/quickstart
- Skyvern self-hosting: https://www.skyvern.com/docs/developers/self-hosted/overview
- Skyvern artifacts: https://www.skyvern.com/docs/developers/debugging/using-artifacts
- Trigger release: https://github.com/triggerdotdev/trigger.dev/releases/tag/v4.8.3
- Trigger tasks: https://trigger.dev/docs/tasks/overview
- Trigger self-hosting: https://trigger.dev/docs/self-hosting/overview

The inspected Skyvern LICENSE is AGPL-3.0; Trigger's is Apache-2.0. Keep each service's
license, notices and applicable source obligations. This adapter does not copy Skyvern
implementation code or change the existing Bops FSL license. Separate processes are
an architectural boundary, not a legal guarantee about license compatibility.
