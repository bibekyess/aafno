---
title: Dev logger with a structural content-privacy gate
date: 2026-07-06
status: Accepted        # Proposed | Accepted | Superseded
supersedes:
superseded-by:
---

# 2026-07-06 — Dev logger with a structural content-privacy gate

## Context

Slice 1 debugging relied on ad-hoc, unleveled `console.warn` calls scattered across `worker/db.ts`
(HNSW fallback), `worker/embed.ts` (dimension mismatch), and `worker/chunk.ts` (tokenizer
fallback), with no namespacing and no discipline around logging user content — a concrete instance
of the §7 risk #3 gap ("user content in logs"). PROJECT_ANALYSIS.md's day-1 privacy posture treats
privacy as an engineering requirement (§10.1), not developer discipline alone, and two existing
ADRs already establish the mechanisms this decision reuses: `2026-07-05-dev-cloud-compile-time-
exclusion.md` uses a Vite `define`-injected constant so a branch can be dead-code-eliminated from
a production build, and `2026-07-05-central-network-client-network-purpose.md` makes privacy
enforcement structural (a single choke point) rather than reviewer-vigilance-based. Slice 2 needed
an equivalent structural guarantee for logging: document/prompt content (parsed text, chunk text,
question text, generated answers, retrieved passage bodies) must never reach an always-on log path
that could survive into a production build.

## Decision

We will provide one small, leveled, stage-namespaced logger (`lib/log.ts`,
`createLogger(namespace)`) used from both the main thread and the worker, replacing the ad-hoc
`console.warn` calls. Active level is `import.meta.env.DEV ? "debug" : "warn"` — everything fires
in dev, only `warn`/`error` fire otherwise (D8) — so `debug`/`info` metadata traces never appear
outside development by default. Metadata (sizes, counts, dimensions, timings, similarity scores,
filenames) may be logged at any level. Document/prompt **content** is confined to a single
additional channel, `content(thunk: () => unknown[])`, whose body is
`if (import.meta.env.DEV) console.debug(tag, CONTENT_LOG_SENTINEL, ...thunk())`. In a production
build, Vite replaces `import.meta.env.DEV` with the literal `false`, so this branch — the guard,
the `CONTENT_LOG_SENTINEL` reference, and the thunk invocation — is dead-code-eliminated, the same
`define`/tree-shaking mechanism `dev-cloud-compile-time-exclusion.md` established. We verify this
structurally, not just by inspection: `scripts/check-no-content-logs.mjs` runs a real production
`vite build` and asserts the unique `CONTENT_LOG_SENTINEL` string is absent from every built JS
asset, wired into `npm run check:prod-logs` and the root `just check` gate. The logger writes only
to `console` — it never calls `classifiedFetch` — so it introduces no new network egress, keeping
it consistent with the central-network-client ADR's posture.

## Alternatives considered

- **Free-form content inside `debug`, relying on the level gate alone** — Rejected: the level gate
  is a runtime check, not a structural one; a stray `logger.debug(chunkText)` call could still
  survive dead-code elimination and fire in some future misconfiguration. Routing all content
  through one syntactically distinct method (`content()`, thunk-wrapped, DEV-guarded inline) gives
  the build check something precise and greppable to assert against.
- **A third-party logging library** — Rejected as over-scoped for a spike: none of `pino`,
  `loglevel`, etc. provide this project's specific content/metadata split or the DEV-gated
  dead-code-elimination seam already used elsewhere in this codebase.
- **Reviewer vigilance only** — Rejected: this is exactly the non-structural pattern the
  central-network-client ADR already rejected for network egress; the same reasoning applies to
  logging.

## Consequences

Content logging now requires the slightly more verbose `content(() => [...])` thunk form, which is
an intentional friction — it makes "this call carries content" visible at the call site. Production
builds are verifiably free of the content-logging path, not just believed to be, because the check
runs a real build and inspects real output rather than trusting source-level review. The check is
scoped to this spike's `dist/` output and does not yet cover a production app shell, since none
exists yet (Phase 1). This ADR extends, and does not supersede, `2026-07-05-dev-cloud-compile-time-
exclusion.md` (same mechanism, different subsystem) and `2026-07-05-central-network-client-network-
purpose.md` (same "structural over disciplinary" posture, applied to logs instead of network calls).
