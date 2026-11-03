# Ernesta customer-owned Bops

A server-owned team of agents: private execution and storage, with an explicitly
chosen hosted inference provider. This is the ErnestaLabs fork of Bops, not the
upstream Mac download and not an official xAI/Grok product.

**Normal `npm run build` and `npm start` use the authenticated private runtime in
this fork.** No Orgo account, OpenAI account, local model or GPU is required for its
core chat, Docker-task, delegation and routine workflows.

## Start on your Linux server

You need Node 22.16 or newer, npm, a reachable Linux Docker daemon, and a hosted
model supporting function calls. Visual computer work also needs image input.
The worker defaults to 2 CPUs and 4 GiB RAM; inference runs at your provider.

```sh
git switch feat/private-provider-foundation
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run setup
docker build -f private-runtime/worker/Dockerfile -t ernesta-bops-worker:private .
```

Setup creates `.env.private` with owner-only permissions and a persistent data
path. It never replaces an existing file, installs anything or changes networking.
Edit that file **on the server** to set `BOPS_INFERENCE_BASE_URL`,
`BOPS_INFERENCE_MODEL` and `BOPS_INFERENCE_API_KEY`. Never commit keys or paste them
in a chat. Do not use this fork's old `.env.example` as the private configuration.

```sh
export BOPS_PRIVATE_ENV_FILE="$PWD/.env.private"
npm run private:check
# Explicit opt-in: small synthetic requests, potentially billable.
npm run private:check -- --live --stream --vision
npm run private:test
NODE_OPTIONS=--max-old-space-size=4096 npm run build
npm start
```

The server listens on `127.0.0.1:3210`. Open `/api/private-login` there, or use an
owner-controlled SSH tunnel from your computer:

```sh
ssh -N -L 3210:127.0.0.1:3210 your-user@your-server
```

Use the owner token from the file path printed by the launcher. The token is not
printed or placed in a URL. Keep the data directory, install ID and vault key stable
across upgrades. Read the [full installation and operations guide](docs/PRIVATE_RUNTIME_MIGRATION.md)
for backups, worker ownership, provider checks and updates.

## What stays yours, and what leaves

| Component | Location |
|---|---|
| Application, tasks, conversations and response history | Your server |
| Browser/computer execution and work files | Your Docker workers |
| Vault and owner credentials | Your server |
| Inference prompts and selected tool observations | Your chosen hosted provider |

This is **not** air-gapped inference. Hosted inference receives the input required
for generation. Optional business integrations contact the services you configure.
Workers start offline (`BOPS_WORKER_NETWORK=none`); website work needs an existing
owner-approved, egress-controlled network. The Node destination guard is not an
OS firewall, and Docker is not VM-grade isolation for hostile code.

## Current functionality

The private runtime supports owner login, chat, task execution, four-screen Docker
computers with screenshot viewing, specialist delegation, scheduled work, local
persistence and graceful restart. Explicit task compaction retains original records
and a source snapshot; its model-written summary is lossy, not perfect memory.
Requests that opt into streaming use real provider SSE, with complete tool calls
released only after response validation. Streaming transport does not make every
ordinary chat UI response stream token by token.

Live VNC/WebRTC, realtime voice, image generation, native provider Agents APIs,
legacy remote conversation resumption and computer cloning are not implemented
by this private transport. Unsupported operations fail rather than switching back
to Orgo or OpenAI. Legacy modules and dependencies remain for source compatibility;
the repository is not a physical purge of all vendor code.

## Verification and deployment

`private:test` runs focused protocol and safety tests without provider credentials.
The Private runtime CI workflow builds the real app and Docker worker and tests
login, chat, tasks, delegation, scheduling, persistence, compaction and restart.
Its inference provider is a deterministic local fixture, **not a hosted model**.
The live preflight probes are a separate operator action on the target server.
A green CI run is not proof of live-model accuracy or customer deployment.

The `private:*` aliases remain available. `upstream:*` commands retain the original
entrypoints for maintainers only; they are not the private deployment path. The
upstream desktop packaging/release scripts are also not the Linux private product.

## Provenance and license

This fork is based on [OrgoAI/Bops](https://github.com/OrgoAI/bops). Original authors,
[LICENSE](LICENSE), [AUTHORS](AUTHORS), [third-party notices](THIRD_PARTY_NOTICES.md)
and [trademark guidance](TRADEMARK.md) are retained. The original upstream README is
preserved in [docs/UPSTREAM_README.md](docs/UPSTREAM_README.md) as reference, not as
instructions or a feature promise for this fork. Provider replacement does not
change the FSL license terms.
