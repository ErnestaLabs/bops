# Customer-owned workforce: workflow control map

## Architecture decision

Reuse the existing Bops private application for owner interaction, agent roles and
customer-owned execution. Use self-hosted Trigger.dev as the target orchestration
platform; use self-hosted Skyvern as an optional browser execution service. Prefer
existing application APIs for well-defined writes. Do not rewrite those platforms.

The operating map is `/workflows.html` on the existing Bops private server. It also
works as a standalone HTML file. It is a DESIGN MAP, not a live monitoring dashboard.
Its simulation buttons never send requests or perform real actions.

There are 20 versioned workflow definitions in
`private-runtime/workflows/catalog.mjs`: installation, owner access, provider probes,
conversation, task execution, delegation, scheduling, website observation, portal
downloads, form preparation, external submission, CRM updates, invoice review,
lead follow-up, support, verification, reconciliation, cancellation, restart recovery
and backup/restore. These cover the currently planned operating families, not every
possible customer business process. Each customer-specific recipe needs its own
versioned inputs, steps, approval scope and measurable acceptance criteria.

Each definition contains the trigger, executor, input contract, steps, approval
boundary, success evidence, retry policy, repair path and source location. Readiness
is explicit: `existing` describes a capability in the private runtime, `adapter`
means the new REST integration contract, and `mapped` means implementation remains.
No label certifies a customer production deployment.

## Delivered in this scaffold

- A searchable, mobile-friendly visual control map, generated from the catalog.
- A self-hosted Skyvern REST adapter for start, observation and cancellation, with
  explicit endpoint/key configuration, bounded responses/timeouts, a fixed native
  Skyvern engine and no cloud defaults, redirect following or request retries.
- An owner-side dispatch journal that reserves an action before issuing its POST.
  A repeated action ID with the same request returns its existing reservation;
  different content conflicts. Partial reservations and uncertain outcomes are not
  automatically reclaimed. Receipts contain identifiers and status, not prompts,
  passwords, page output, signed artifact URLs or API keys.
- An operator CLI and a synthetic example request. No live service is contacted by
  `plan`. `start` requires acknowledgement of the exact plan hash.
- A Trigger.dev read-only observation task template, pinned for SDK 4.8.3. Its retries
  repeat GETs, never submission. It is not deployed or connected to Bops scheduling.
- Tests covering the adapter, local dispatch journal and catalog. A real local HTTP
  fixture checks routes and authentication. This is not a running Skyvern instance
  and not a live LLM quality test.

The dispatch journal is narrow application glue, not a replacement scheduler.
Do not put it on Trigger's ephemeral worker filesystem or share it between independent
hosts. Run it on the persistent owner-controlled Bops host. Before distributed
activation, place this operation behind an authenticated, tenant-scoped control
service backed by transactional storage. That bridge is mapped, not implemented here.

The approval hash detects changed input. It is NOT an authentication token, signature
or proof that a human approved. Authorization currently comes from the local operator's
access to the host, secrets and CLI. Do not expose this hash check as a public approval
API. Signed, expiring approvals and verified identity belong at the control boundary.

## Skyvern integration settings

Inspected source: `Skyvern-AI/skyvern` commit
`9ba3f1db5b52400146dd71955763a994086dd8f1`. Pin the service revision and validate
its image and dependencies before customer use; do not silently deploy `latest`.
The source and public documentation support:

- `POST /v1/run/tasks`, `GET /v1/runs/{run_id}` and `POST /v1/runs/{run_id}/cancel`.
- Native `skyvern-1.0` tasks, structured extraction, steps, screenshots and recordings.
- Configurable hosted providers including OpenAI-compatible API endpoints. The API
  format does not require using OpenAI's service or a locally hosted model.

The template `private-runtime/workflows/skyvern.env.example` separates our adapter's
settings from Skyvern's own settings. Disable native OpenAI/xAI/local-model providers,
choose a non-OpenAI/non-xAI hosted vision model, disable Skyvern telemetry and its
scheduler, and enable URL validation. Verify secondary/extraction/copilot/code-model
paths as well: changing only one model field is not a complete egress audit.

`SKYVERN_TELEMETRY=false` is supported by the inspected analytics code. The upstream
`.env.example` documents URL/SSRF validation as off by default, so set
`ENABLE_URL_VALIDATION=true` for this deployment. Neither setting is an OS firewall.

**Do not assume Skyvern automatically inherits the existing Bops Docker isolation.**
Its browser/session topology must be connected and tested separately. The adapter's
start-URL check is syntax and policy validation, NOT a navigation sandbox. Its
`proxy_location: NONE` avoids a paid Skyvern cloud proxy default but does not install
network controls. Enforce destination policy at the deployment/browser network and
verify denial of metadata, private addresses, redirects and direct bypass.
Do not expose the Skyvern API, CDP ports or a browser with live customer cookies
publicly. A read-intent prompt is not a write barrier: any autonomous browser task
can have side effects and therefore requires owner authorization in this scaffold.

Hosted inference receives relevant prompts, page observations and screenshots.
Keep local artifacts private with explicit retention; screenshots, downloads,
browser profiles and recordings may contain customer data or active sessions.
No CAPTCHA evasion or unattended credential/MFA bypass is introduced by this adapter.

## Run the control map and contract tests

From this repository:

```sh
node private-runtime/workflows/render.mjs
node private-runtime/workflows/render.mjs --check
npm run private:test
```

The generated `public/workflows.html` is served by the existing authenticated private
launcher. Open `/workflows.html` after owner login. The standalone copy contains no
customer data, tracking scripts, external fonts or network dependencies.

## Use the owner-side Skyvern adapter

Install/configure Skyvern separately on the customer server. This scaffold does not
install services, purchase inference, change firewall rules or import customer logins.
Configure these values in an owner-readable mode-0600 environment file:

```dotenv
BOPS_SKYVERN_BASE_URL=http://127.0.0.1:8000
BOPS_SKYVERN_ACCOUNT_SCOPE=customer-one
BOPS_SKYVERN_API_KEY=replace-on-server-only
BOPS_PRIVATE_DATA_DIR=/absolute/persistent/customer/data
```

Use a stable account scope across key rotations. Never reuse it for a different
Skyvern account. Requests use the API origin without a `/v1` suffix.

```sh
export BOPS_PRIVATE_ENV_FILE=/absolute/path/to/customer.env
node private-runtime/workflows/cli.mjs plan private-runtime/workflows/example-request.json
# Review the FULL request file, not merely the printed hash. Then explicitly approve:
node private-runtime/workflows/cli.mjs start private-runtime/workflows/example-request.json --approve <approvalHash>
node private-runtime/workflows/cli.mjs status <providerRunId>
node private-runtime/workflows/cli.mjs cancel <providerRunId>
```

`start` can perform real browser actions and incur hosted inference costs. It is
never run automatically by setup, the visual map or the tests. Choose a unique action
ID for each intended operation and retain it for retries/reconciliation. Do not work
around a reservation by inventing another action ID or deleting its directory.

`completed` from Skyvern maps to `awaiting_verification`, not `succeeded`. Output
schema validation and independent business verification are recipe-specific work;
the adapter deliberately does not invent verification or treat the existence of a
screenshot as proof. Cancellation acknowledgement maps to `cancel_requested`, and
observation of a canceled run still requires reconciliation of earlier effects.

If dispatch fails, the journal reports `outcome_unknown`. Inspect the remote system,
locate a run or external receipt, and record an owner-reviewed reconciliation. There
is intentionally no automatic replay or force-reset command. This prevents the local
adapter from knowingly repeating a reserved dispatch; it is NOT a guarantee of
exactly-once effects inside Skyvern, a website, or a distributed system.

## Trigger.dev hand-off

The template at `private-runtime/workflows/trigger/observe.ts.example` is a real
SDK task definition awaiting placement in a configured, pinned self-hosted Trigger
project. Copy it as `observe.ts` in the same directory structure or adjust the local
adapter import. Install `@trigger.dev/sdk@4.8.3` in that project and match CLI/server
versions. Configure `TRIGGER_API_URL` and credentials for your self-hosted instance,
and `TRIGGER_TELEMETRY_DISABLED=1` in its webapp. Do not use cloud defaults.

The observer returns separate provider and business states. Trigger marking the
observation task green does not mean the business operation is finished. New schedules
must have one owner: keep existing Bops scheduling until an explicit per-workflow
cutover, and keep Skyvern's independent scheduler disabled for Trigger-owned recipes.

Still to wire: authenticated persistent job-control bridge, transactional distributed
claims, scoped approval API, live event projection, recipe validators, schedule
migration and server deployment. These are explicit nodes in the map, not hidden
behind green status indicators. Self-hosted checkpoint availability is not assumed.

## Release gates

Use a synthetic page first. Prove actual non-OpenAI provider text/vision/tool behaviour,
local artifacts, safe egress and a schema-checked result. Then force process death
between dispatch and receipt and confirm no duplicate submission. Verify cancel races,
MFA pause/resume, independent result checks, backup restoration and secret redaction.
A credentialed customer write is enabled only after its exact recipe passes.

## Licenses and inspected sources

Skyvern is AGPL-3.0; Trigger.dev's main license is Apache-2.0; the Bops fork retains
its existing FSL terms. This scaffold does not copy Skyvern's implementation or change
any of those licenses. A service boundary is an architectural choice, not a blanket
exemption from license obligations. Preserve notices and applicable source obligations
when distributing, modifying or operating these components.

- Skyvern source: https://github.com/Skyvern-AI/skyvern/tree/9ba3f1db5b52400146dd71955763a994086dd8f1
- API source: https://github.com/Skyvern-AI/skyvern/blob/9ba3f1db5b52400146dd71955763a994086dd8f1/skyvern/forge/sdk/routes/agent_protocol.py
- Configuration: https://www.skyvern.com/docs/developers/self-hosted/llm-configuration
- Task API: https://www.skyvern.com/docs/api-reference/agent/run-a-task
- Run API: https://www.skyvern.com/docs/api-reference/agent/get-a-run-by-id
- Trigger self-hosting: https://trigger.dev/docs/self-hosting/overview
- Trigger version: https://github.com/triggerdotdev/trigger.dev/releases/tag/v4.8.3
