# Ernesta private runtime migration

Work-in-progress integration, not a complete Bops replacement.

Goals: eliminate Orgo cloud computers and OpenAI execution; use customer-owned Docker workers and hosted model inference configured by the customer.

Phase 1: inference endpoint adapter and standalone worker prototype.

Remaining: wire worker lifecycle into Bops sessions/screens, replace Responses/Agents/Codex and realtime flows, review model routing, test end-to-end on Linux, and check FSL commercial terms.

Configuration for an inference gateway:

```dotenv
BOPS_SELF_HOSTED=1
BOPS_PRIVATE_RUNTIME=1
BOPS_INFERENCE_BASE_URL=https://customer-gateway.example/v1
BOPS_INFERENCE_API_KEY=<secret>
```

An OpenAI-compatible chat-completions endpoint does NOT necessarily implement the Responses and computer APIs Bops requires. Do not present this as production-ready.