# Workflow taxonomy decision

There is one runtime workflow registry: `private-runtime/workflows/catalog.json`.

Owner decision, 2026-11-04:

- The 24 entries in `catalog.json` are executable workflow identities.
- Their state vocabulary is exactly `contracts.mjs::TRANSITIONS`.
- `catalog.mjs` is now only a compatibility projection over that JSON and contract; it owns no workflow list or state machine.
- The 32 entries in `public/workforce-map/catalogue.mjs` are visual/product scenarios. They may split one runtime workflow into several views (for example form preparation vs submission) or show operational concerns that are not independent dispatch identities.
- A visual scenario must never be used as a runtime workflow ID unless it resolves to a canonical `catalog.json` entry.
- New executable workflow IDs are added only to `catalog.json`, then validated through `expandCatalog()` / `validateCatalog()`.
- New UI scenarios may be added without creating a new dispatch identity.

Why: the old `catalog.mjs` contained 20 workflows and an unrelated lower-case transition graph, while `catalog.json` contained 24 workflows and the exact executable state vocabulary. Keeping both editable allowed recovery, retry and observability semantics to drift.

This decision does not make all 24 business integrations live. Readiness remains explicit per workflow.
