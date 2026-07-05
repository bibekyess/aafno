---
title: Central network client with NetworkPurpose classification
date: 2026-07-05
status: Accepted        # Proposed | Accepted | Superseded
supersedes:
superseded-by:
---

# 2026-07-05 — Central network client with NetworkPurpose classification

## Context

AAFNO's privacy model depends on two things being true at once: content-bearing network requests
must actually be rare and intentional (§4, §6), and the user must be able to *see* that this is
true without opening browser DevTools (§6 "Privacy should be observable", §9 Privacy Console spec).
Browsers do not let a normal web page introspect every network request the page makes the way
DevTools can, so making network activity observable requires the application itself to record
its own requests. PROJECT_ANALYSIS.md §9 specifies a `NetworkPurpose` classification
(`"app_asset" | "model_download" | "dev_cloud_inference" | "update_check" | "unknown"`) and a
central network client recording URL, domain, method, purpose, timestamp, status, and whether user
content was included — but until Phase 0 this existed only as a specification, not as working code
enforcing anything.

## Decision

We will route every intentional, content-bearing `fetch` the application makes through one
`classifiedFetch` client (`lib/network.ts`) that records `{ url, domain, method, purpose,
timestamp, status, sentUserContent }` into an observable, subscribable log, using the
`NetworkPurpose` type verbatim from PROJECT_ANALYSIS.md §9. Phase 0 slice 1
(`spikes/rag-pipeline/`) implements the runtime seam this depends on: the dev-cloud generation
call (the *only* content-bearing egress point in the slice) is classified as
`dev_cloud_inference` with `sentUserContent: true` and is the sole caller of `classifiedFetch` from
application code; app-asset fetches are classified `app_asset`. Because `transformers.js`'s
internal model-weight fetches cannot be routed through an application-level `fetch` wrapper (they
happen inside the library, off the main thread, inside the worker), those are instead surfaced via
the library's `progress_callback` as `network` worker events (`purpose: "model_download"`) and fed
into the same observable log from the main thread — a documented seam, not a gap. This makes the
slice's AC-2 ("no network request carrying document or chunk content when cloud is off")
structurally true rather than merely policy-true: with the cloud toggle off, no code path in the
application calls `classifiedFetch` with document/chunk/prompt content, because the only code path
that ever does (`lib/generate.ts`) is gated behind that toggle.

## Alternatives considered

- **Ad-hoc `fetch` calls, reviewed by convention** — rely on code review to catch any new network
  call that might leak content. Rejected: this makes privacy enforcement a matter of reviewer
  vigilance rather than a structural guarantee, and does not give the *user* any visibility either
  — it only helps engineers, not the observable-privacy goal in §6/§9.
- **DevTools-only inspection** — tell privacy-conscious users to check the browser's Network tab
  themselves. Rejected as the primary mechanism: it is technical, requires trust that nothing was
  missed, and directly contradicts §6's "the user should be able to inspect this activity without
  opening browser DevTools."

## Consequences

A single choke point for content-bearing egress means verifying "can this code path leak document
content" becomes a matter of checking whether it calls `classifiedFetch` with `sentUserContent:
true` — a structural, greppable guarantee rather than a matter of trusting every call site. It
also gives the Privacy Console (§9, Phase 1) its data source for free: the network log this ADR
establishes is exactly what that organism will render. The trade-off is that the client cannot
observe truly out-of-band network activity (a compromised dependency issuing its own raw `fetch`,
or `transformers.js`'s downloads, which needed the documented `progress_callback` workaround
above) — this is a known limitation of what a web page can observe about itself, not a gap unique
to this design. Follow-up work: Phase 1 builds the actual Privacy Console organism (network,
local activity, and storage sections) on top of this log; this ADR only establishes the underlying
client and classification the organism will consume.
