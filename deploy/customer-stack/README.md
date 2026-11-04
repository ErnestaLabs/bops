# Customer-owned workforce bootstrap

This directory is the one place to prepare the four foundations without rebuilding them:

- **Bops** — owner UI, Chief/specialists, private state and computers.
- **Trigger.dev 4.8.3** — scheduler, queues, attempts and run observability.
- **Skyvern 1.0.56** — browser execution and browser artifacts.
- **Harness² 0.1.0** — offline harness improvement only.

Run on the customer's Linux server:

```sh
bash deploy/customer-stack/bootstrap.sh
```

The script pins and verifies the inspected upstream revisions, builds the existing private Bops worker and Harness² image, and creates local data/config directories. It deliberately **does not launch Trigger, Skyvern, or a model provider**, because those need customer-specific secrets, storage, domains and network policy.

## Launch order

1. Configure and verify the chosen hosted model with `npm run private:check -- --live`.
2. Start Bops with `npm start`.
3. Bring up the pinned Trigger self-hosted stack using its upstream Docker guide. Set `TRIGGER_TELEMETRY_DISABLED=1`.
4. Bring up pinned Skyvern from its upstream `docker-compose.yml`; configure its model/provider and make its browser traffic use the customer-approved egress policy.
5. Point the Bops adapters at the **self-hosted** service URLs.
6. Migrate one scheduled recipe to Trigger and disable the corresponding Bops scheduler before enabling it.
7. Keep Harness² off the live execution path. Feed it sanitized evidence, review/probe candidate harnesses, and adopt only new immutable versions for future runs.

## Why not one giant Compose file?

Trigger and Skyvern already ship and maintain substantial Compose stacks. Copying them into Bops would fork infrastructure we explicitly want to reuse. This bootstrap pins their upstream source and lets each project keep its own migrations, health checks and upgrade path.

## Release gate

"Prepared" is not "running". "Running" is not "verified". Before customer use, record:
- Trigger health and a queued task surviving restart.
- Skyvern live browser task against an approved public page.
- selected model text/tool/stream/vision probes.
- one end-to-end Bops → Trigger → Skyvern → verifier run.
- duplicate/timeout reconciliation showing no repeated external write.
- backup/restore evidence.
