# Ernesta customer-owned runtime

This is the private server path in the existing Bops application, not a separate demo.
Use the `private:*` commands below. The upstream Mac download, setup script and plain
`npm start` are **not** the private launcher and retain upstream behavior.

## Supported core path

The owner signs in, chats with a bot, starts a task, and the bot runs commands on a
customer-owned Docker computer. The existing screen endpoint returns that computer's
screenshots. Chat, completed tasks, owner settings and response history are local.
The inference transport uses an explicitly configured hosted Chat Completions endpoint.
No local model, GPU, Orgo account or OpenAI account is required for this path.

The private launcher binds HTTP to `127.0.0.1`, authenticates requests before Next,
disables upstream cloud credentials and telemetry, and preloads a Node destination
guard. The guard is **not an OS firewall** and does not control browsers/native programs.
Hosted inference necessarily receives prompts and selected tool observations. This is
not an air-gapped system or a promise that no data leaves the customer server.

## Install on the customer's Linux server

Use Node 22.16 or newer, npm and a reachable Linux Docker daemon. Build memory and
worker memory are separate from inference. Each worker defaults to 2 CPUs / 4 GiB.
The CI build uses a 4 GiB Node heap; size the server for the build, workers and OS.
Run one Bops server per data directory. Do not point two instances at the same files.

```sh
git switch feat/private-provider-foundation
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
docker build -f private-runtime/worker/Dockerfile -t ernesta-bops-worker:private .
cp private-runtime/private.env.example .env.private
chmod 600 .env.private
```

Edit `.env.private` **on the server**, never in chat or Git. Set:

```dotenv
BOPS_INFERENCE_BASE_URL=https://your-provider.example/v1
BOPS_INFERENCE_MODEL=your-non-OpenAI-non-xAI-model-id
BOPS_INFERENCE_API_KEY=your-secret-key
BOPS_PRIVATE_DATA_DIR=/absolute/persistent/customer/data
BOPS_PRIVATE_COMPUTER_ACTIONS=1
PORT=3210
```

Choose a model supporting function calls. Visual computer tasks additionally need image
input. A text-only model passing the tool check does not prove visual task capability.
The launcher loads the environment file before choosing paths. Environment variables
already set by the operator take precedence; avoid mixing conflicting configuration.

```sh
export BOPS_PRIVATE_ENV_FILE="$PWD/.env.private"
npm run private:check
# Explicit opt-in: two small synthetic provider requests, potentially billable.
# No customer data, conversation storage or actual tool execution.
npm run private:check -- --live
npm run private:test
NODE_OPTIONS=--max-old-space-size=4096 npm run private:build
npm run private:start
```

A successful local preflight is not a live-provider or internet-connectivity certificate.
`--live` checks text plus a harmless forced function call. It never switches providers.
Provider errors are reported without printing credentials or provider response bodies.

Open `http://127.0.0.1:3210/api/private-login` on that server. From a different computer,
keep this SSH connection open and use the same URL in your browser:

```sh
ssh -N -L 3210:127.0.0.1:3210 your-user@your-customer-server
```

The launcher reports the **path** to the owner token, normally
`BOPS_PRIVATE_DATA_DIR/ui-token`; retrieve it locally and paste only into the login form.
When `BOPS_UI_TOKEN` is supplied externally, use the operator's secret store instead.
Never post tokens in chat, URLs, screenshots, Git or build logs. Do not bind the server
to a public address or expose Docker's daemon socket over the network.

## Worker network: offline versus web work

Workers default to `BOPS_WORKER_NETWORK=none`. Chat and local-file tasks work, but those
workers **cannot browse websites**. For real web work, the customer administrator must
supply an existing egress-controlled Docker network, put its name in the environment
file, and restart Bops. Newly created computers use the selected network. Existing
computers retain their original network configuration; changing the setting is not a
migration of existing computers.

```sh
npm run private:check -- --require-web
```

This rejects `none`, host networking and an internal-only network. It checks network
configuration, not DNS, external reachability or the quality of a firewall policy.
Use an owner-approved public-page task as the final deployment test. No code here
silently enables internet access, changes a firewall or shares the host network.

The worker receives neither inference credentials nor UI/vault keys, host directories
or the Docker socket. Work/home named volumes survive computer deletion. Docker is
not VM-grade isolation for hostile code. A user with access to the host Docker daemon
has powerful host-level privileges; isolate the deployment appropriately.

## Updates, shutdown and backups

Private builds use disposable storage and inert build-time persistence. Existing customer
state is not read or migrated by the private build. Runtime still loads the configured
persistent directory. Stop the server before replacing its `.next` build files.
SIGTERM/SIGINT stop new connections and drain the existing exit-work/save path before
closing Next. This is graceful-shutdown protection, not a guarantee against power loss.

Back up the customer data directory and worker work/home volumes. Keep `install-id`
stable to retain worker ownership. Back up the vault key separately and securely;
losing it prevents decrypting existing vault entries. Do not rotate or delete these files
as part of an update. Restore backups on a separate test instance before relying on them.

## Evidence and release boundary

The private CI workflow runs dependency-free contract/security tests, builds the real
Docker image, exercises four displays/browser navigation/screenshot capture, builds the
actual Next application, and runs real HTTP/chat/task acceptance. Its inference endpoint
is a deterministic test server, **not a live hosted model**.

The expanded acceptance also checks an existing state file remains byte-for-byte unchanged
during build, verifies an actual worker-created file, saves immediately before shutdown,
restarts, and checks owner/chat/task/file persistence. Chromium signs in through the form
and sends through the real chat composer. Read the workflow's `result.json` artifact for
which checks actually passed; supplying a test is not evidence that it passed.

A deployment is not ready merely because CI passed. Its chosen provider/model, visual
capability, web egress, host permissions and resource limits must be verified on that
customer's server. No such customer production deployment or live hosted-provider result
is claimed by the deterministic CI test.

## Longer tasks and provider streaming

Task **Compact** now creates a summary using the selected hosted model, with no tools
available to that summary request. Pending calls must be settled first; complete recent
message/tool-result groups stay together. The summary is explicitly lossy and marked as
untrusted context, not an instruction or new authorization. Older screenshots are omitted
from summarization and must be re-observed. This is explicit compaction, not automatic
truncation at a context limit. It costs inference tokens on the configured provider.

Original response records remain unchanged. Each successful compaction also retains a
mode-600 source snapshot, including the newly settled tool outputs, and records its SHA-256.
The new response is committed only after all summary batches succeed. Provider errors,
invalid summaries or cancellation leave the original conversation usable. Deleting a
compacted response removes its associated source snapshot, not its preceding responses.
No guarantee is made that a model-written summary preserves every detail.

Requests that ask for streaming now use real provider SSE. Text arrives incrementally,
including in the existing app-generation path that requests streaming. This does not
change every ordinary chat/task call into a streamed UI. Complete tool calls are withheld
until final framing and argument validation pass. Interrupted/refused/truncated responses
are not marked complete or written to history, and no other provider is silently tried.

For an endpoint that accepts only JSON, set `BOPS_INFERENCE_STREAM=0` explicitly to use
buffered compatibility. `BOPS_INFERENCE_STREAM_USAGE=0` disables the optional streaming
usage extension for providers that do not support it. Neither setting changes provider.

## Explicit unsupported features

Live VNC/WebRTC, realtime voice, image generation, provider-native Agents APIs, legacy
remote conversation resumption and memory/disk cloning are not
implemented by this private transport. Unsupported calls fail explicitly. The SDK-style
event-emitter `.responses.stream()` API is not implemented; use `.create({ stream: true })`. Hosted-native web
search is not advertised; research uses the assigned browser when its network permits.
Existing optional integrations may send data to the services the customer configures.

Legacy SDK dependencies and `*-legacy.ts` implementations remain for upstream compatibility.
They are not evidence of mandatory use in private mode, nor a claim that the repository
is physically purged of every vendor reference. Dependency-audit findings require separate
triage before broad production rollout.

## License

Keep the repository's original LICENSE and copyright notices. Its FSL-1.1-ALv2 text
explicitly includes internal use and professional services to a compliant licensee as
permitted purposes; it excludes the defined Competing Use. Customer-owned hosting does
not itself remove those terms. Do not present this fork as an unrestricted competing
commercial product or imply that replacing providers changes the license.
