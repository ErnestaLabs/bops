# Ernesta customer-owned runtime

This branch is an integration in progress, not a production release. The application, bots,
routines, delegation and existing approval logic remain Bops code, under its original license.
Upstream implementation files are preserved as `*-legacy.ts` for review and compatibility.
They are not a claim that dependencies have been physically purged from the repository.

## Actual integration

- `lib/server/openai-client.ts` selects the new transport in private mode. Existing chat and
  computer-turn callers receive response-shaped objects, but the wire protocol is ordinary
  hosted Chat Completions. The private transport imports no vendor SDK. History is local.
- `lib/server/orgo.ts` dispatches computer lifecycle, shell, input and screenshots to Docker.
  `plan.ts` provisions fresh customer-owned workers instead of querying Orgo plans or cloning
  another bot's browser credentials. Named work and home volumes survive computer removal.
- `models.ts` replaces upstream model defaults with the operator's selected hosted model.
- Orgo credentials and sign-in are not used in private mode. Private API access requires the
  deployment's owner-token cookie. The launcher binds only to loopback; use an SSH tunnel.
- The Linux vault uses authenticated AES-256-GCM encryption, a customer-controlled key and
  separate atomic files. Back up the key separately from encrypted vault files.
- The launcher disables upstream telemetry and cloud credentials. A preloaded Node network
  guard blocks Orgo/OpenAI/xAI destinations in fetch and HTTP(S) request paths. It is NOT an
  OS firewall and does not govern arbitrary browsers or native processes.

## Run on an owner-controlled Linux server

Requirements: Node 22+, Docker, existing Bops npm dependencies, and a hosted model that supports
function/tool calling. Visual tasks also require image input. No local model or GPU is required.

```sh
npm ci
node --test private-runtime/test/*.test.mjs
docker build -f private-runtime/worker/Dockerfile -t ernesta-bops-worker:private .
node private-runtime/docker-smoke.mjs
```

Set configuration in the server's secret manager or a private environment file (never Git):

```dotenv
BOPS_INFERENCE_BASE_URL=https://your-chosen-provider.example/v1
BOPS_INFERENCE_MODEL=the-provider-model-id
BOPS_INFERENCE_API_KEY=your-private-key
# Optional: a stable ID is generated locally if omitted.
BOPS_PRIVATE_INSTALL_ID=your-installation-id
# Owner authorisation for computer input; otherwise screenshot-only model actions.
BOPS_PRIVATE_COMPUTER_ACTIONS=1
```

`https://integrate.api.nvidia.com/v1` and `https://openrouter.ai/api/v1` use the documented Chat
Completions route. Support still depends on the exact model and account; neither was live-tested
in this change. Select a non-OpenAI/non-xAI model. No automatic provider fallback occurs.

```sh
BOPS_PRIVATE_ENV_FILE=/secure/path/private.env node private-runtime/start.mjs build
BOPS_PRIVATE_ENV_FILE=/secure/path/private.env node private-runtime/start.mjs start
# Development, instead of build/start:
BOPS_PRIVATE_ENV_FILE=/secure/path/private.env node private-runtime/start.mjs dev
```

Open `http://127.0.0.1:3210/api/private-login`. The owner token is in
`.data/private-runtime/ui-token` unless the data directory or token is supplied externally.
Never expose the server directly without a separately reviewed authenticated TLS gateway.

Workers default to `--network none`. To allow real web work, the deployment owner must configure
an egress-controlled Docker network and set `BOPS_WORKER_NETWORK` to its name. Do not use host
networking. Docker isolation is not a substitute for a separate VM when running hostile code.
The worker never receives the inference key, UI token, vault key, Docker socket or host mounts.
Host compute, memory, storage and third-party inference may have costs; there is no Orgo fee.

## Verification recorded for this change

- 32 Node unit/contract tests passed in the editing sandbox: inference conversion, local history,
  malformed/truncated output rejection, cancellation, no automatic fallback, worker ownership,
  Docker argv isolation, computer-input configuration, destination policy and encrypted vault.
- Node syntax checks, Python byte-compilation and shell syntax checks were run locally.
- Real Xvfb and Chromium started locally, their CDP endpoint responded, and the exact screenshot
  helper produced a valid 640x480 PNG at scale 0.5.
- Page navigation in that sandbox was blocked by Chromium's managed site policy. The policy was
  not changed or bypassed. This is not a successful browser task acceptance test.
- Docker is not installed in the editing sandbox. The Docker build and real worker acceptance
  script are supplied in CI but have NOT been claimed as passing.
- A full Next build/typecheck, complete Bops user journey and live paid/free provider request
  remain unverified. Source-level adapters are not proof of feature parity.

## Explicit gaps, with no silent vendor fallback

Live VNC/WebRTC, realtime voice, image generation, provider-native Agents APIs, old remote
conversation resumption, context compaction, and memory/disk cloning are not implemented by
this private transport. Unsupported calls fail explicitly. Screenshots and input use the new
computer interface. Hosted web-search tools are not advertised; research must use a browser
or report the lack of live sources. Existing optional integrations can still send data to their
configured providers. Hosted inference receives prompts: this is not an air-gapped system.

The original SDK and legacy implementations remain in the dependency graph during migration;
removing them from the entire source tree requires completing the remaining features and tests.
Do not merge this draft as a completed, fully private, all-feature Bops replacement.
