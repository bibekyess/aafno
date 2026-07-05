---
title: Phase 0 POC — Slice 1 (end-to-end local RAG walking skeleton)
date: 2026-07-05
status: Ratified        # Draft | Ratified | Delivered
---

# 2026-07-05 — Phase 0 POC — Slice 1 (end-to-end local RAG walking skeleton)

## Objective

AAFNO's entire product bet rests on an unproven claim: that a full document-Q&A pipeline —
parse, chunk, embed, store, retrieve, generate — can run **client-side in the browser** with
durable local persistence. Before investing in the polished app shell (Phase 1), we must prove
the pipeline is real and de-risk the scariest unknowns from `PROJECT_ANALYSIS.md` §5. Slice 1 is
the **thinnest possible end-to-end walking skeleton** that takes a single document all the way to
a generated answer, living as isolated, messy-but-typed spike code under `spikes/` (§10). Its
value is not UX polish — it is **evidence**: measured load/latency numbers and documented answers
to the targeted §5 verification unknowns, so the team can decide with confidence whether the
locked stack (§3) holds. The two unknowns it must answer first, because they block everything
else, are (1) **PGlite + pgvector persistence across reload** (and whether an HNSW index builds,
with exact/flat scan as an acceptable fallback), and (2) **model cold/warm load timing** plus the
"use a small model or dev cloud while the big model is unavailable" generation flow.

## Scope

**In scope (the vertical slice):** select/upload ONE document → `liteparse-wasm` parse (local) →
`chonkie-ts` chunk → `EmbeddingGemma` embed via `transformers.js`/WebGPU (local) → store
chunks + vectors in PGlite + pgvector → retrieve top-k for a user question → generate an answer.
Persist the store across reload. Measure and record the targeted §5 numbers.

**Out of scope (explicitly deferred to later slices/phases):**
- Full **Gemma-4-E2B** local generation (later slice — see FR-8 / accepted decision D2).
- The production app shell, Atomic-Design UI, routing, and the real Privacy Console organism
  (Phase 1). Slice 1 shows a minimal activity/measurement panel only.
- Multi-document ingestion, hybrid (BM25 + vector) search, citation UX, and the Tiptap editor.
- Compile-time exclusion of cloud code paths as a *build* mechanism (Phase 1 concern); slice 1
  is dev-only by nature and instead enforces cloud-is-opt-in-and-visible at runtime (FR-11).
- Full WASM-fallback parity and Firefox/Safari support (observed-and-documented only, not gated).

## User stories

- As an **AAFNO engineer**, I want a running end-to-end client-side RAG demo over one document,
  so that I can confirm the locked stack (§3) composes into a working pipeline before Phase 1.
- As an **AAFNO engineer**, I want the PGlite + pgvector store to survive a page reload without
  re-parsing or re-embedding, so that I know persistence (a day-1 non-negotiable, §4) is
  achievable on this stack.
- As an **AAFNO engineer**, I want cold-load, warm-load, and retrieval timings recorded, so that
  I can characterize the #1 product UX risk (model download) with real numbers rather than guesses.
- As an **AAFNO engineer**, I want the answer-generation step to work via a dev-only cloud
  endpoint (and, as a stretch, a small local model), so that generation does not block me from
  proving the harder local-embedding-and-storage path.
- As a **privacy-conscious reviewer**, I want any content leaving the device (dev-cloud
  generation) to be an explicit, visible choice, so that even the spike honors the observable-
  privacy principle (§4, §6).

## Functional requirements

1. **Document input.** The spike must accept exactly one document per run, via (a) a bundled
   fixed sample document shipped in the spike, and (b) a local file picker for an ad-hoc file.
   Supported input for slice 1 is a text-based PDF (see accepted decision D4).
2. **Local parse.** The selected document must be parsed to text using `liteparse-wasm` running
   locally in the browser. No document bytes may be sent over the network for parsing.
3. **Local chunk.** Parsed text must be chunked with `chonkie-ts` (Recursive chunker at minimum).
   Chunk sizing must respect the EmbeddingGemma tokenizer's token limit (see informational
   assumption R1); where exact tokenizer integration is unavailable, an explicit documented
   approximation is acceptable for slice 1.
4. **Local embed.** Each chunk must be embedded with `EmbeddingGemma` via `transformers.js` on
   WebGPU, running locally. Embeddings must NOT be produced via any cloud endpoint (embedding is
   the core local capability being de-risked — see accepted decision D7).
5. **Persistent store.** Documents, chunks, chunk metadata, and vectors must be written to a
   PGlite + pgvector database persisted to OPFS/IndexedDB. The schema records the embedding
   vector dimension and the source document/chunk offsets needed to attribute a retrieved chunk
   to its source location.
6. **Index strategy.** The spike must attempt to create a pgvector **HNSW** index and record
   whether it succeeds under PGlite; if HNSW is unavailable or fails, it must fall back to an
   exact/flat scan and record that outcome. Both outcomes are acceptable — answering the unknown
   is the requirement, not a specific index type.
7. **Retrieve.** Given a user question, the spike must embed the question locally and retrieve the
   top-k most similar chunks from PGlite (default k configurable; see accepted decision D8).
8. **Generate.** The spike must generate an answer from the question plus retrieved chunks using
   a dev-only OpenAI-compatible endpoint (default primary path) and/or, as a stretch, a local
   `SmolLM2-360M` model via `transformers.js`. Gemma-4-E2B local generation is out of slice 1.
9. **Persistence across reload.** After a full pipeline run, reloading the page must restore the
   store from OPFS/IndexedDB such that the same question can be answered **without** re-parsing,
   re-chunking, or re-embedding the document.
10. **Measurement capture.** The spike must measure and surface (on screen and/or console, and in
    a committed measurement note) at minimum: model **cold-load** time (first download+init),
    model **warm-load** time (cached init after reload), embedding throughput for the sample
    document, top-k **retrieval latency**, and the browser/GPU environment the run was performed
    on. See §"Non-functional requirements" for targets.
11. **Cloud is opt-in and visible.** Sending the question and retrieved chunks to the dev-cloud
    endpoint must be an explicit user action (e.g., a toggle/button that is off by default), and
    the spike must visibly indicate, when it happens, that prompt + retrieved document content is
    leaving the device and to which destination domain.
12. **Local activity visibility.** The spike must display a minimal running log of local pipeline
    events (parsed locally, chunked, embedded locally, stored locally, retrieved locally,
    answer source) — a precursor to the Privacy Console (§9), not the full organism.
13. **Capability detection.** On start, the spike must detect and display whether WebGPU is
    available; if not, it must state this plainly rather than failing silently.

## Edge cases

- **WebGPU unavailable / driver failure** (§5 #5; AMD/Linux bugs): the spike must report the
  condition and, where feasible, attempt the transformers.js WASM fallback; if it cannot proceed
  it must say so clearly. WASM parity is observed-and-documented, not gated for slice 1.
- **Model download interrupted / fails:** the spike must surface the failure state rather than
  hanging indefinitely (retry may be manual — full resumable download is a Phase 1 concern).
- **OPFS/IndexedDB unavailable or blocked** (e.g., private-browsing quirks): the spike must
  detect and report that persistence is unavailable rather than silently losing data.
- **Empty / image-only / non-text PDF:** parse yields little or no text — the spike must report
  "no extractable text" instead of embedding an empty corpus.
- **Document larger than expected / memory pressure:** the spike should not crash the tab
  silently; if it hits a limit it should report it (informs the §7 memory-pressure risk).
- **Question with no relevant chunks:** retrieval returns low-similarity results — the spike must
  still return a defined response (e.g., "no strongly relevant passages found") rather than error.
- **Dev-cloud endpoint not configured / unreachable:** if generation is attempted with no valid
  endpoint (and no local model), the spike must report a clear configuration error.
- **Reload mid-pipeline** (before store is committed): behavior must be defined — either the run
  is discarded cleanly or resumes from persisted state; partial/corrupt state must not be
  presented as complete.

## Acceptance criteria

Binary and testable (Given/When/Then):

- **AC-1 (end-to-end local Q&A).** **Given** the bundled sample document, **when** the engineer
  runs the full pipeline (parse → chunk → embed → store → retrieve → generate) and asks a
  question whose answer is present in the document, **then** the spike returns an answer that is
  grounded in the retrieved chunks (the retrieved chunks used are inspectable).
- **AC-2 (local parse/embed, no content egress).** **Given** a pipeline run with cloud generation
  toggled **off**, **when** parse, chunk, embed, store, and retrieve execute, **then** no network
  request carrying document or chunk content is made (verifiable via the network log / DevTools).
- **AC-3 (persistence across reload).** **Given** a completed run that stored chunks + vectors,
  **when** the page is fully reloaded and the same question is asked, **then** an answer is
  produced **without** re-parsing, re-chunking, or re-embedding the document, and the local
  activity log shows the store was restored (not rebuilt).
- **AC-4 (HNSW-or-fallback answered).** **Given** the storage step, **when** the spike attempts to
  build a pgvector HNSW index, **then** it records a definitive result — HNSW built successfully,
  or HNSW failed and exact/flat scan was used — in the committed measurement note.
- **AC-5 (warm-load target).** **Given** model weights already cached in OPFS, **when** the model
  is initialized after a reload, **then** the measured warm-load time is recorded, with a target
  of **≤ 3s** for the embedding model; missing the target does not fail the spike but must be
  recorded and explained.
- **AC-6 (cold-load measured).** **Given** a first run with no cached weights, **when** the model
  downloads and initializes, **then** the cold-load time is measured and recorded (this is a
  characterization, not a pass/fail gate — see accepted decision D5).
- **AC-7 (retrieval latency).** **Given** the sample document indexed, **when** a top-k retrieval
  query runs, **then** the measured retrieval latency is recorded, with a target of **≤ 500ms**
  for a single-document personal-corpus scale.
- **AC-8 (cloud is opt-in and visible).** **Given** the spike at rest, **when** the engineer has
  taken no action, **then** cloud generation is **off by default**; and **when** the engineer
  enables it and generates, **then** the UI visibly states that prompt + retrieved content is
  being sent and names the destination domain.
- **AC-9 (capability + failure honesty).** **Given** a browser without WebGPU (or with OPFS
  blocked), **when** the spike starts, **then** it displays the unsupported/blocked condition in
  plain language rather than failing silently or appearing hung.
- **AC-10 (measurement note committed).** **Given** a completed spike run, **when** the engineer
  finishes, **then** a measurement note exists in the spike directory recording cold-load,
  warm-load, embedding throughput, retrieval latency, index strategy outcome, and the
  browser/GPU environment — satisfying the Phase 0 "measurement notes / documented answers to §5
  unknowns" output.

## Non-functional requirements

- **Targeted §5 unknowns (the real Definition of Done).** Slice 1 must produce documented answers
  to §5 **#1** (PGlite+pgvector persistence across reload; HNSW-vs-flat) and §5 **#3/#4** (model
  cold/warm load timing; the small-model-or-dev-cloud generation flow). It should also record
  observations for §5 **#2** (chonkie-ts + EmbeddingGemma tokenizer integration) and §5 **#5**
  (WebGPU coverage / WASM fallback), even if those are not fully resolved in this slice.
- **Performance targets** (targets, not hard gates unless stated): warm-load ≤ 3s (AC-5);
  retrieval latency ≤ 500ms (AC-7); cold-load measured and recorded (AC-6). Persistence-across-
  reload (AC-3) and cloud-off-by-default (AC-8) ARE hard requirements.
- **Privacy / day-1 constraints (§4) honored even in the spike:** no production backend (the
  spike is served as static assets by the Vite dev server; there is no application server logic);
  cloud generation is dev-only, opt-in, and visibly disclosed (FR-11, AC-8); local processing is
  visible (FR-12); persistence is exercised, not stubbed (FR-9, AC-3).
- **Off-main-thread work (§10).** Default: heavy pipeline steps (parse, chunk, embed, retrieve,
  PGlite access) run in a **single Web Worker** so the main thread stays responsive; typed
  request/response messages are encouraged but full four-worker split is out of scope. See
  accepted decision D3.
- **Isolation (§10 principle 5).** Slice 1 lives under `spikes/rag-pipeline/` (per §10 layout),
  is not wired into the (nonexistent) production shell, and may be messy — but must be typed.
- **Target environment.** Primary: latest desktop Chrome with WebGPU enabled (§5 ≈82% coverage).
  Firefox/Safari and the WASM fallback path are observed-and-documented, not gated. Desktop-first;
  mobile is explicitly not a constraint (§4).
- **Reproducibility.** The measurement note must record enough environment detail (browser +
  version, OS, GPU) that another engineer can interpret and re-run the numbers.

## §7 risks this slice touches

- **Risk #1 (model download UX):** partially — slice 1 *measures* cold/warm load and exercises
  the small-model/dev-cloud fallback, but does not build the full onboarding UX.
- **Risk #2 (browser capability differences):** WebGPU detection + WASM-fallback observation.
- **Risk #3 ("local only" enforcement):** slice 1 enforces the *runtime* half (cloud opt-in +
  visible egress); compile-time exclusion is deferred to Phase 1 and noted as such.
- **Risk #4 (persistence not optional):** core — AC-3 directly validates it.
- **Risk #5 (ambitious stack):** slice 1 exists precisely to validate the combined stack.
- Register items exercised: WebGPU compatibility, large model download, OPFS/IndexedDB
  persistence, PGlite+pgvector limitations, memory pressure with large documents.

## Assumptions & open questions

All nine decisions below were surfaced with sensible defaults and **accepted by the project owner
via the orchestrator**, who was explicitly pre-authorized to ratify on the owner's behalf using
these defaults. No open question remains unresolved-and-unaccepted; this spec is therefore
**Ratified**. Impact ranks the effect on the slice-1 outcome, not on the wider product.

- `[ASSUMPTION | HIGH]` **D1 — Slice boundary.** Accepted (owner pre-authorized, 2026-07-05):
  full vertical slice — one document → parse → chunk → embed → store → retrieve → generate
  (neither stopping at retrieval nor extending to multi-doc / citations).
- `[ASSUMPTION | HIGH]` **D2 — Generation path.** Accepted (owner pre-authorized, 2026-07-05):
  the **dev-cloud OpenAI-compatible endpoint** is the primary generation path for slice 1;
  **SmolLM2-360M local** is an optional stretch; **Gemma-4-E2B local generation is OUT** of
  slice 1 (deferred to a later slice).
- `[ASSUMPTION | HIGH]` **D3 — Worker vs inline.** Accepted (owner pre-authorized, 2026-07-05):
  heavy work runs in a **single Web Worker** (not inline on the main thread, and not the full
  four-worker split).
- `[ASSUMPTION | HIGH]` **D7 — Embeddings stay local.** Accepted (owner pre-authorized,
  2026-07-05): embeddings are produced **only** by local EmbeddingGemma, never via a cloud
  endpoint.
- `[ASSUMPTION | MEDIUM]` **D4 — Sample document.** Accepted (owner pre-authorized, 2026-07-05):
  bundle one fixed **text-based, public-domain PDF of ~10–20 pages** plus a local file picker;
  the exact file is to be chosen at implementation time.
- `[ASSUMPTION | MEDIUM]` **D5 — Success thresholds.** Accepted (owner pre-authorized,
  2026-07-05): warm-load target ≤ 3s (target, not gate); retrieval latency target ≤ 500ms
  (target, not gate); cold-load measured-not-gated; **persistence-across-reload and
  cloud-off-by-default are HARD gates**.
- `[ASSUMPTION | MEDIUM]` **D6 — Browser scope.** Accepted (owner pre-authorized, 2026-07-05):
  gate only on **latest desktop Chrome + WebGPU**; treat Firefox/Safari and the WASM fallback as
  observed-and-documented, not required to pass.
- `[ASSUMPTION | LOW]` **D8 — Retrieval k.** Accepted (owner pre-authorized, 2026-07-05): top-k
  with **k = 5, configurable**.
- `[ASSUMPTION | LOW]` **D9 — Measurement note location/format.** Accepted (owner pre-authorized,
  2026-07-05): a **Markdown note inside `spikes/rag-pipeline/`** (findings later fold into the
  plan / risk register per §8).

### Informational assumptions — confirmed during the spike (non-blocking)

These three factual unknowns are being resolved in parallel and feed the **implementation plan**,
not this spec. They do **not** block ratification; the spike will confirm each empirically. Where
a value is needed before the answer lands (e.g., the pgvector column dimension), the spike uses a
documented provisional value and corrects it once confirmed.

- `R1` — Does `chonkie-ts` expose or accept the **EmbeddingGemma tokenizer** so chunk sizing can
  be token-accurate, or must slice 1 approximate token counts? (Informs FR-3 and §5 #2; a
  documented approximation is acceptable per FR-3 if exact integration is unavailable.)
- `R2` — Which **EmbeddingGemma** ONNX variant/quantization is available for `transformers.js`,
  its approximate download size, and its output **vector dimension** (needed for the pgvector
  column definition in FR-5 and to set the cold-load expectation in AC-6).
- `R3` — Does the **pgvector build shipped with PGlite** support **HNSW** index creation at the
  version we would use? (Informs FR-6/AC-4; the spike confirms empirically, and exact/flat scan is
  an accepted fallback regardless of the answer.)
