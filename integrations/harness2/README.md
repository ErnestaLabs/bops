# Harness² improvement lab

This integration uses Google Research Harness² as an **offline improvement layer**, never as the live scheduler or live action executor.

Pinned upstream: `google-research/harness2` (Apache-2.0), Python 3.12. The framework edits eight harness components: system prompt, guardrails, memory, tool guidance, subagents, skills, scripts, and plugins.

## Safety boundary

Live business runs produce redacted evidence. Harness² may propose/probe candidate harnesses in an isolated workspace. A candidate can only become a new production harness version after deterministic tests, workflow acceptance checks, and explicit operator adoption.

It must never:
- rewrite a running agent in place;
- receive customer secrets or raw credential material;
- replay unsettled external writes;
- bypass the workflow approval/reconciliation rules;
- use unrestricted web access in production evaluation.

## Setup

```sh
cd integrations/harness2
docker build -t ernesta-harness2:0.1.0 .
docker run --rm ernesta-harness2:0.1.0 harness2-demo --output /tmp/demo --k 2
```

The demo needs no model credentials. Model-backed improvement requires a separately configured provider and should run against sanitized fixtures/evaluations first.

## Adoption path

```
run evidence
  -> sanitized improvement bundle
  -> Harness² propose / probe / compose
  -> candidate harness directory
  -> Bops + workflow CI
  -> human review
  -> immutable harness version
  -> future runs only
```

Harness² is not an officially supported Google product. Keep its Apache-2.0 license and third-party notices with redistributed copies.
