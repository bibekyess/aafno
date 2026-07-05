---
title: Dev-cloud generation is compile-time excluded from production builds
date: 2026-07-05
status: Proposed        # Proposed | Accepted | Superseded
supersedes:
superseded-by:
---

# 2026-07-05 — Dev-cloud generation is compile-time excluded from production builds

## Context

AAFNO's day-1 constraints (PROJECT_ANALYSIS.md §4) state that cloud generation is "dev only, and
compile-time excluded from production" — not merely disabled by a runtime flag or config value,
because a runtime-only guard can be flipped on by accident (a stray environment variable, a
misconfigured build, a copy-pasted deployment). PROJECT_ANALYSIS.md §10's production requirements
for the network layer repeat this: "cloud inference should be compile-time excluded." Phase 0
slice 1 needs a dev-only OpenAI-compatible generation path to prove the retrieval half of the
pipeline without waiting on local `Gemma-4-E2B` generation (a separate, later slice — decision D2),
but slice 1 is, by construction, a dev-only spike with no production build to exclude anything
from yet (PROJECT_ANALYSIS.md §10 #5, spec "Out of scope": "Compile-time exclusion of cloud code
paths as a build mechanism (Phase 1 concern)").

## Decision

We will record now, and implement fully in Phase 1, that dev-cloud generation code must be
excluded from production builds at compile time, not merely gated by a runtime flag. Slice 1
establishes the seam this will attach to: the dev-cloud call in `lib/generate.ts` is guarded by a
build-time constant (`__DEV_CLOUD__`, injected via Vite's `define`) rather than only by a runtime
`if (cloudEnabled)` check, and the request itself additionally requires an explicit runtime opt-in
(the off-by-default toggle, FR-11/AC-8) and a configured endpoint before it will ever fire. This
gives dead-code elimination a concrete boolean to eliminate the branch on, once a production build
target exists to set that constant to `false`. Because slice 1 has no production build — it is
dev-only by nature and is never deployed — this ADR is recorded as **Proposed**, not Accepted: the
decision is made, but the actual build-time exclusion (a real production bundle configuration that
sets `__DEV_CLOUD__` to `false` and verifies via a build-output check that no dev-cloud code
survives tree-shaking) is Phase 1 work, tracked here as a named follow-up rather than silently
assumed.

## Alternatives considered

- **Runtime flag only (current interim state)** — gate the dev-cloud path behind an environment
  variable check evaluated at runtime, with no build-time exclusion. Rejected as the *final*
  state: this is exactly the "disabled by config" pattern §4 explicitly distinguishes from
  "compiled out," because a misconfigured production deploy could still ship and execute the code
  path. Slice 1 uses this pattern as an interim/dev-only measure precisely because it has no
  production build to protect yet — not as a substitute for the compile-time mechanism.
- **Separate build entry point per environment (no shared bundle)** — maintain fully separate dev
  and production entry files with no shared conditional code. Not chosen now: heavier to maintain
  for a two-path (dev-cloud vs. local) generation seam than a single guarded module; may be
  revisited in Phase 1 if `define`-based elimination proves insufficient to fully remove the
  dev-cloud dependency graph (e.g., its imports) from the production bundle.

## Consequences

Recording this now means the Phase 1 app shell inherits an established seam (`__DEV_CLOUD__` and
the `lib/network.ts` classification from the companion ADR) rather than needing to retrofit one
after dev-cloud code has spread through the codebase. The cost of deferring full implementation is
that slice 1's production-build guarantee is weaker than the eventual target: today, "no cloud in
production" is enforced by "there is no production build of this spike," not by verified dead-code
elimination. Follow-up work (Phase 1, required before this ADR can move to Accepted): configure the
real production build to set `__DEV_CLOUD__` to `false`, add a build-output check (e.g., grepping
the production bundle for the dev-cloud module's distinctive strings) that fails CI if the code
survives, and confirm `lib/generate.ts`'s import graph is fully tree-shaken rather than merely
dead-branched.
