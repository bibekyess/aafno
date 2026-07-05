---
title: In-browser-only inference for parse, embed, retrieve, and generate
date: 2026-07-05
status: Accepted        # Proposed | Accepted | Superseded
supersedes:
superseded-by:
---

# 2026-07-05 — In-browser-only inference for parse, embed, retrieve, and generate

## Context

AAFNO's product identity rests on privacy-by-construction: user documents must not leave the
device unless the user explicitly and visibly opts into a remote path (PROJECT_ANALYSIS.md §4, §6).
That requires the core pipeline — PDF parsing, chunking, embedding, vector retrieval, and answer
generation — to run entirely client-side, in the browser, with no application server performing
any of these steps. The locked stack (PROJECT_ANALYSIS.md §3) names `liteparse-wasm`, `chonkie-ts`,
`EmbeddingGemma`/`transformers.js` on WebGPU, and (later) `Gemma-4-E2B` for exactly this reason, but
until Phase 0 slice 1 this was an assumption, not a demonstrated fact: it was unconfirmed whether
WASM-compiled parsing, an ONNX embedding model via WebGPU, and (eventually) a multi-billion
parameter generation model could actually compose into a working pipeline inside a browser tab
(§5 unknowns #2–#5).

## Decision

We will run parsing, chunking, embedding, and retrieval entirely client-side via WebAssembly
(`liteparse-wasm`, `chonkie-ts`) and `transformers.js` on WebGPU (`EmbeddingGemma`), with automatic
fallback to the WASM backend where WebGPU is unavailable. No production backend performs any of
these steps; there is no server-side inference path. Generation follows the same principle in
production (local `Gemma-4-E2B` via `transformers.js`); a dev-only cloud OpenAI-compatible endpoint
exists purely for local development iteration and is addressed separately (see ADR
`2026-07-05-dev-cloud-compile-time-exclusion.md`). Phase 0 slice 1 (`spikes/rag-pipeline/`)
exercises the local embed path end-to-end (parse → chunk → embed → store → retrieve) and confirms
it composes: `liteparse-wasm` extracts text locally, `@chonkiejs/core` chunks it locally (with a
documented HuggingFace-tokenizer-or-character-based-fallback split, §5 #2), and
`@huggingface/transformers` embeds it locally via `onnx-community/embeddinggemma-300m-ONNX`
(q8, WebGPU with automatic WASM fallback, §5 #5) — with embeddings produced only on-device, never
via any cloud endpoint (a hard requirement, not merely a default).

## Alternatives considered

- **Server-side inference** — a backend service performs parsing/embedding/generation and returns
  results to the browser. Rejected: this violates AAFNO's day-1 "no production backend" constraint
  (PROJECT_ANALYSIS.md §4) and reintroduces exactly the privacy surface (documents transiting and
  potentially logging on a server) the product is meant to eliminate.
- **Hybrid (local retrieval, remote generation by default)** — keep embedding/storage local but
  route every generation call through a remote model in production. Rejected as the *default*
  path: it would mean the product's signature "your documents never leave your device" claim is
  false for the single most visible feature (asking a question). A dev-only, explicitly opt-in
  remote path remains available for iteration speed (see the dev-cloud ADR).

## Consequences

Running inference in-browser makes privacy enforcement structural rather than policy-based: a
document's bytes and its derived text/chunks/vectors simply never have a code path to a remote
server in the local flow, so there is nothing for a reviewer to misconfigure at the network layer
for that flow. It also means AAFNO's UX must directly confront the cold-start/model-download
problem (§5 #3/#4, §7 risk #1) as a first-class concern rather than hiding it behind a fast
server response — slice 1's cold/warm-load measurement (`MEASUREMENTS.md`) is a direct consequence
of accepting this trade-off. It constrains model choice to what fits and runs acceptably on
consumer-grade GPUs (or WASM/CPU as a slower fallback) rather than whatever is easiest to host, and
it means browser/driver coverage gaps (§5 #5, e.g. AMD/Linux WebGPU driver bugs) are the product's
problem to detect and communicate, not a backend team's problem to route around. Follow-up work:
Phase 1 must build the full onboarding UX around model download/caching (§7 risk #1) that slice 1
only measures.
