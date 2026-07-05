# Plan — 2026-07-05 — Phase 0 POC — Slice 1 (end-to-end local RAG walking skeleton)

Spec: `specs/2026-07-05-phase0-poc-slice1.md` (Ratified)
Branch: **current working branch, in-place at repo root** — per orchestrator instruction this POC
is authored directly (no feature worktree). All new code lives under `spikes/rag-pipeline/`.

## Overview

Build the thinnest end-to-end client-side RAG "walking skeleton" that proves the locked stack
(PROJECT_ANALYSIS §3) composes in the browser: one document → `liteparse-wasm` parse (local) →
`chonkie-ts` chunk → `EmbeddingGemma` embed via `@huggingface/transformers` on WebGPU (local) →
store chunks + `vector(768)` in PGlite + pgvector (persisted) → retrieve top-k → generate an
answer. The deliverable is **evidence**, not polish: measured cold/warm load, retrieval latency,
the HNSW-vs-flat outcome, and a persistence-across-reload result, all captured in a committed
Markdown measurement note (spec D9). Slice 1 de-risks the two scariest §5 unknowns first —
(1) PGlite+pgvector persistence + HNSW, and (2) model load timing + the small-model/dev-cloud
generation flow.

**In scope:** the full vertical slice above for ONE document (bundled sample PDF + file picker),
in a React+Vite spike harness with heavy steps in a **single Web Worker** (D3); runtime cloud
opt-in + visible egress (FR-11); a minimal local activity log (FR-12); WebGPU/OPFS capability
detection (FR-13); the measurement note (FR-10, AC-10). Typed but not production-polished (§10 #5).

**Out of scope (deferred):** Gemma-4-E2B local generation (D2); the production app shell / Atomic
Design UI / real Privacy Console organism (Phase 1); multi-doc, hybrid BM25+vector search, citation
UX, Tiptap; compile-time cloud exclusion as a *build* mechanism (Phase 1 — slice 1 establishes the
runtime seam only); gated Firefox/Safari/WASM parity (observed-and-documented only, D6).

## Architecture & Design

### Directory layout (all new, under `spikes/rag-pipeline/`)

```text
spikes/rag-pipeline/
  package.json            # deps + scripts (format/lint/typecheck/test) — first package.json in repo
  tsconfig.json           # strict TS; DOM + WebWorker libs
  vite.config.ts          # React plugin; exclude PGlite/transformers from dep pre-bundle as needed
  .env.local.example      # documents VITE_DEV_CLOUD_* keys; real .env.local is gitignored
  index.html
  README.md               # how-to-run + points at MEASUREMENTS.md
  MEASUREMENTS.md          # the D9 measurement note (committed; template filled at run time)
  public/sample/           # the one bundled text-based public-domain PDF (D4)
  src/
    main.tsx               # React entry, mounts <App/>
    App.tsx                # spike harness: wires panels, owns cloud toggle + generate step
    vite-env.d.ts
    lib/
      messages.ts          # typed worker request/response/progress/error contract (see below)
      capabilities.ts      # detectWebGPU(), detectOpfs(), detectIndexedDb()
      network.ts           # central network client + NetworkPurpose; the ONLY content egress point
      generate.ts          # dev-cloud OpenAI-compatible call (guarded); shapes RAG prompt
      measure.ts           # timing helpers (mark/measure), throughput calc
      schema.sql.ts        # the PGlite DDL as a typed string constant
    worker/
      pipeline.worker.ts   # single Web Worker: owns PGlite + model; parse/chunk/embed/store/retrieve
      parse.ts             # liteparse-wasm wrapper -> {text, charLength}
      chunk.ts             # chonkie-ts wrapper (Recursive chunker, EmbeddingGemma tokenizer)
      embed.ts             # transformers.js EmbeddingGemma pipeline (q8, WebGPU->WASM fallback)
      db.ts                # PGlite open/restore, DDL apply, HNSW-attempt-then-fallback, store, retrieve
    ui/
      CapabilityBanner.tsx # WebGPU/OPFS/IndexedDB status (FR-13, AC-9)
      ActivityLog.tsx      # local pipeline events (FR-12)
      NetworkPanel.tsx     # cloud opt-in toggle (off by default) + egress disclosure (FR-11, AC-8)
      MeasurementPanel.tsx # live cold/warm load, embed throughput, retrieval latency (FR-10)
    test/
      chunk.test.ts
      network.test.ts
      db.persistence.test.ts
      messages.test.ts
```

### Data / control flow (thread ownership matters for AC-2)

- **Main thread (`App.tsx`)** owns the UI, the cloud toggle, and the **only** content-bearing
  network egress (the dev-cloud generate call, via `lib/network.ts`). It never touches heavy
  compute. It posts typed requests to the worker and renders progress/results.
- **Single Web Worker (`pipeline.worker.ts`)** owns PGlite (the DB connection lives for the
  worker's lifetime), the transformers.js embedding pipeline, and all local steps
  (parse → chunk → embed → store → retrieve). The worker makes **no content network requests**;
  its only network activity is transformers.js **model weight download** to `huggingface.co`,
  which it surfaces to the main thread as `model_download` progress events so the network log
  records it. This split makes AC-2 structurally true: with the cloud toggle off, no code path
  can send document/chunk/prompt content off-device.
- **Generation (D2):** primary path is the dev-cloud OpenAI-compatible endpoint on the main thread
  (content leaves device only when the toggle is on and the egress is disclosed). Optional stretch:
  local `SmolLM2-360M` generation runs in the worker (`generateLocal` message) — no egress.

Flow for a fresh run: `init` (open/restore DB, warm model) → `parse` → `ingest` (chunk+embed+store,
attempt HNSW) → `retrieve(question,k)` → main thread calls `generate` (cloud, if opted in) or posts
`generateLocal`. Flow after reload: `init`/`restore` reopens the persisted DB; if the document +
chunks + vectors are present, jump straight to `retrieve` — no re-parse/chunk/embed (AC-3).

### Typed worker contract (`lib/messages.ts`) — §10 worker guidelines

Reuse the `WorkerJobStatus` union from PROJECT_ANALYSIS §10
(`"queued" | "running" | "progress" | "complete" | "failed" | "cancelled"`). Every request carries
a `jobId: string`; every worker event echoes it. Define discriminated unions:

- `PipelineRequest` (main → worker):
  - `{ type: "init"; jobId }` — open/restore PGlite, apply DDL, load embedding model, report capabilities.
  - `{ type: "parse"; jobId; source: { kind: "bundled" } | { kind: "file"; bytes: ArrayBuffer; name: string } }`
  - `{ type: "ingest"; jobId; docId: string; text: string; charLength: number }` — chunk + embed + store + index.
  - `{ type: "retrieve"; jobId; question: string; k: number }`
  - `{ type: "restore"; jobId }` — reopen persisted DB and report whether the sample doc's chunks exist.
  - `{ type: "generateLocal"; jobId; question: string; contexts: RetrievedChunk[] }` — stretch only.
  - `{ type: "cancel"; jobId }`
- `PipelineEvent` (worker → main):
  - `{ type: "status"; jobId; status: WorkerJobStatus }`
  - `{ type: "progress"; jobId; stage: PipelineStage; pct?: number; note: string }`
  - `{ type: "network"; jobId; purpose: NetworkPurpose; domain: string; note: string }` — for model_download surfacing.
  - `{ type: "result"; jobId; result: InitResult | ParseResult | IngestResult | RetrieveResult | GenerateResult }`
  - `{ type: "error"; jobId; stage: PipelineStage; message: string }`
- Supporting types: `PipelineStage = "init" | "parse" | "chunk" | "embed" | "store" | "index" | "retrieve" | "generate"`;
  `RetrievedChunk = { chunkId; documentId; ordinal; text; charStart; charEnd; similarity }`;
  `IngestResult = { chunkCount; indexStrategy: "hnsw" | "flat"; embedMs; storeMs }`.

`NetworkPurpose` is imported from `lib/network.ts` and matches §9 exactly:
`"app_asset" | "model_download" | "dev_cloud_inference" | "update_check" | "unknown"`.

### New dependencies (version-pinned; confirm latest patch at install)

| Package | Pin | Purpose |
|---|---|---|
| `react`, `react-dom` | `18.3.1` | spike harness UI |
| `vite`, `@vitejs/plugin-react` | `^6.0.0`, `^4.3.0` | dev server / bundler (static assets only; no server logic) |
| `typescript` | `~5.6.0` | strict typing (spike is typed per §10 #5) |
| `@huggingface/transformers` | `^3.3.0` | transformers.js v3 — WebGPU + automatic WASM fallback; EmbeddingGemma + optional SmolLM2 |
| `@electric-sql/pglite` | `^0.2.0` | Postgres-in-WASM, persists to IndexedDB/OPFS |
| pgvector extension for PGlite | matching PGlite | `@electric-sql/pglite-pgvector` (research finding) — confirm exact package/entry (`@electric-sql/pglite/vector`) at install |
| `chonkie-ts` (`@chonkiejs/token` etc.) | latest | in-browser Recursive/Token chunking; accepts the EmbeddingGemma tokenizer (research finding) |
| `liteparse-wasm` | team's confirmed version | local PDF→text parse (§3 confirmed; do NOT use MuPDF.js) |
| `vitest` | `^2.1.0` | unit + node-persistence tests |
| `prettier`, `eslint` + TS plugins | latest | format/lint for `just check` |

Research findings baked in (do not re-litigate): EmbeddingGemma model id
`onnx-community/embeddinggemma-300m-ONNX`, **q8** quantization (~155 MB), output **dimension 768** →
pgvector column `vector(768)`; chonkie-ts TokenChunker/RecursiveChunker accepts the EmbeddingGemma
tokenizer for token-accurate sizing (no approximation fallback needed); PGlite persists to IndexedDB
(all browsers) and OPFS (Web Worker only, not Safari); HNSW under PGlite is **unconfirmed** and is an
explicit spike step with flat/exact fallback.

## Architecture Decisions (ADRs)

### ADRs to add or update

Per orchestrator instruction, the ADR **content is not authored here** — this plan lists the ADRs
the implementer should author (following `adr/TEMPLATE.md`, status `Proposed`, filename
`adr/2026-07-05-<slug>.md`). This POC directly exercises the decisions, so recording them now is
warranted. Recommended ADRs:

1. **`adr/2026-07-05-in-browser-only-inference.md`** — parse/embed/retrieve/generate run client-side
   via WebGPU/transformers.js with automatic WASM fallback; no production backend. Alternatives:
   server-side inference, hybrid. Exercised by slice 1's local embed path (D7).
2. **`adr/2026-07-05-pglite-pgvector-local-vector-store.md`** — PGlite + pgvector as the single
   durable local store for documents + chunks + metadata + vectors, persisted to IndexedDB/OPFS;
   index strategy is HNSW-if-available else flat/exact scan. Alternatives: IndexedDB-only, in-memory
   vector search, LanceDB WASM (see §10 example). This is the highest-value ADR — slice 1 produces
   its empirical basis (AC-3, AC-4).
3. **`adr/2026-07-05-central-network-client-network-purpose.md`** — all intentional network requests
   route through one client that records URL/domain/method/`NetworkPurpose`/timestamp/status/whether
   user content was included; foundation of the Privacy Console (§9). Alternatives: ad-hoc `fetch`,
   DevTools-only inspection. Slice 1 implements the runtime seam (FR-11/12, AC-8).
4. **`adr/2026-07-05-dev-cloud-compile-time-exclusion.md`** — dev-cloud generation is dev-only and
   *compile-time* excluded from production builds (not merely config-gated), depending on the network
   seam from ADR #3. Author now as `Proposed` (records the decision + the `import.meta.env.DEV`/build-
   define seam slice 1 establishes); the full build mechanism is implemented in Phase 1. Note this in
   the ADR's Consequences.

No existing ADR is superseded (the `adr/` corpus is currently empty apart from `README.md`/`TEMPLATE.md`).

### Relevant ADRs for the implementer

- None exist yet. Read `adr/README.md` (status lifecycle: author as `Proposed`; the implementer sets
  `Accepted` on the branch before merge) and `adr/TEMPLATE.md` before authoring the four above.

## Implementation Steps (ordered)

Ordered by dependency **and** highest-risk-first (see Risk & Sequencing): scaffold, then the two
scariest unknowns (persistence+HNSW, then model load), then the rest of the pipeline, then UX/notes.

1. **Scaffold the spike** (FR/§10 isolation). Create `spikes/rag-pipeline/` with `package.json`
   (deps + scripts: `dev`, `build`, `format`, `lint`, `typecheck`, `test`), `tsconfig.json` (strict,
   `lib: ["DOM","DOM.Iterable","WebWorker","ES2022"]`), `vite.config.ts`, `index.html`, `main.tsx`,
   and an empty `App.tsx` shell. Add `.env.local.example` documenting `VITE_DEV_CLOUD_BASE_URL`,
   `VITE_DEV_CLOUD_MODEL`, `VITE_DEV_CLOUD_API_KEY`; add `.env.local` to `.gitignore` (never commit
   secrets — AGENTS.md). Verify `npm run dev` serves and `npm run typecheck` passes.
2. **Capability detection** (FR-13, AC-9, edge cases). Implement `lib/capabilities.ts`:
   `detectWebGPU()` (`navigator.gpu` + `requestAdapter()`), `detectOpfs()`
   (`navigator.storage?.getDirectory`), `detectIndexedDb()`. Render `ui/CapabilityBanner.tsx` on
   start stating each in plain language; never fail silently.
3. **Worker contract + skeleton** (§10). Implement `lib/messages.ts` (all types above) and
   `worker/pipeline.worker.ts` handling `init`/`cancel` with typed `postMessage`, echoing `jobId`,
   emitting `status`/`progress`/`error`. `App.tsx` opens the worker and round-trips `init`.
4. **[RISK 1a] PGlite persistence + schema** (FR-5, FR-9, AC-3). In `worker/db.ts`: open PGlite with
   a persistent `dataDir` (`idb://aafno-slice1` in browser; OPFS path when available/worker-only —
   not Safari), load the pgvector extension, apply the DDL from `lib/schema.sql.ts` (see Data section).
   Implement `storeDocumentAndChunks(...)`, `restore()` (reopen + report whether sample chunks exist),
   and confirm a close→reopen cycle preserves rows.
5. **[RISK 1b] HNSW-attempt-then-fallback** (FR-6, AC-4). In `db.ts`, after inserting chunks, run
   `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)` inside a try/catch; on failure log and
   fall back to no index (exact/flat scan). Return `indexStrategy: "hnsw" | "flat"` in `IngestResult`
   and record the definitive outcome for the measurement note. This is the empirical answer to §5 #1.
6. **[RISK 2] Embedding model load + measurement** (FR-4, FR-10, AC-5, AC-6, D7). In `worker/embed.ts`:
   create the transformers.js feature-extraction pipeline for `onnx-community/embeddinggemma-300m-ONNX`
   with **q8** quant, `device: "webgpu"` and automatic WASM fallback. Wire `progress_callback` to emit
   `network` (`model_download`, `huggingface.co`) + `progress` events. Use `lib/measure.ts` to record
   **cold-load** (first download+init) and **warm-load** (post-reload cached init) separately; assert
   output vector length is **768** (correct the pinned dim if the model reports otherwise, per R2).
   Embeddings are produced **only** here — never via any cloud path (D7).
7. **Local parse** (FR-2, AC-2). In `worker/parse.ts`: wrap `liteparse-wasm` to turn the input
   (bundled sample or picked file bytes) into `{ text, charLength }`, entirely in the worker. Handle
   the empty/image-only PDF edge case: if extracted text is empty/negligible, emit an error stage
   `parse` with "no extractable text" rather than embedding an empty corpus.
8. **Local chunk** (FR-3). In `worker/chunk.ts`: use `chonkie-ts` RecursiveChunker configured with the
   **EmbeddingGemma tokenizer** (research: token-accurate; no approximation needed), sized to the
   model's token limit. Return chunks with `text`, `tokenCount`, and `charStart`/`charEnd` offsets into
   the parsed text for source attribution (FR-5). Record any tokenizer-integration observation for §5 #2.
9. **Ingest wiring** (FR-3–6). Implement the worker `ingest` handler: chunk → embed each chunk →
   `storeDocumentAndChunks` → attempt HNSW → return `IngestResult`. Emit `progress` per stage and
   measure embedding throughput (chunks/sec and chars/sec) for the note.
10. **Retrieve** (FR-7, AC-7, D8). In `db.ts` `retrieve(question, k)`: embed the question locally
    (reuse `embed.ts`), run `SELECT ... ORDER BY embedding <=> $1 LIMIT $k` (cosine), default **k=5,
    configurable** from the UI. Return `RetrievedChunk[]` with `similarity`. Measure retrieval latency
    (target ≤ 500ms, recorded not gated). Handle the no-relevant-chunks edge case: if top similarity is
    below a documented threshold, still return a defined "no strongly relevant passages found" result.
11. **Central network client** (FR-11, §9, ADR #3). Implement `lib/network.ts`: a `fetch` wrapper that
    records `{ url, domain, method, purpose: NetworkPurpose, timestamp, status, sentUserContent }` into
    an observable log. Dev-cloud calls are `dev_cloud_inference` with `sentUserContent: true`; app
    assets `app_asset`. The worker's model-download events feed the same log as `model_download`.
12. **Generation — dev-cloud (primary, D2) + local stretch.** In `lib/generate.ts`: build the RAG
    prompt (question + retrieved chunk texts) and POST to the OpenAI-compatible
    `/v1/chat/completions` using `VITE_DEV_CLOUD_*` config, **through `lib/network.ts`**. Guard this
    entire path behind `import.meta.env.DEV` / a build-time define (`__DEV_CLOUD__`) so it is
    tree-shakeable — the seam ADR #4 formalizes. If no endpoint is configured and no local model,
    report a clear configuration error (edge case). Optional stretch: `generateLocal` in the worker
    via SmolLM2-360M (no egress).
13. **Cloud opt-in + visible egress UI** (FR-11, AC-8). `ui/NetworkPanel.tsx`: a toggle **off by
    default**; generation is disabled until enabled. When enabled and a generate runs, visibly state
    that prompt + retrieved content is leaving the device and name the destination domain (derived from
    the base URL). Reflect every `lib/network.ts` entry here.
14. **Local activity log** (FR-12). `ui/ActivityLog.tsx`: render the worker's `progress`/`status`/
    `result` stream as plain-language events ("Parsed locally", "Created N chunks", "Generated
    embeddings on this device", "Stored vectors locally", "Restored store from browser storage",
    "Retrieved K passages", "Answer generated via <source>") — the Privacy Console precursor (§9).
15. **Measurement panel + committed note** (FR-10, AC-10, D9). `ui/MeasurementPanel.tsx` surfaces live
    numbers. Create `MEASUREMENTS.md` with the table template in the Data/Test sections below; the
    engineer fills real numbers after a run: cold-load, warm-load, embedding throughput, retrieval
    latency, HNSW-vs-flat outcome, persistence-across-reload result, and browser+version/OS/GPU. This
    committed note is the Phase-0 exit artifact.
16. **Bundle the sample document** (FR-1, D4). Add one text-based public-domain PDF (~10–20 pages) to
    `public/sample/` and wire the "bundled sample" `parse` source plus a file-picker `<input type=file>`.
17. **Tests** (see Test Strategy). Add `test/chunk.test.ts`, `test/network.test.ts`,
    `test/db.persistence.test.ts`, `test/messages.test.ts`.
18. **Wire `just check` to the spike.** Update the root `justfile` `format`/`lint`/`typecheck`/`test`
    recipes to run the spike's npm scripts (e.g. `cd spikes/rag-pipeline && npm run <x>`), replacing
    the current no-op echoes, now that a `package.json` exists. Keep `docs` as-is. Do not scaffold the
    production `src/` app — that is Phase 1 (avoid over-scoping slice 1).
19. **Run `just check`** — the project's quality gate. It must pass (format, lint, typecheck, test).

## Interface & Compatibility

- No existing runtime contracts exist to preserve (empty repo apart from docs/justfile). The one
  observable-contract change is the **`justfile`**: `format`/`lint`/`typecheck`/`test` stop being
  no-ops and start delegating to the spike's npm scripts (Step 18) — called out explicitly because
  CI/AGENTS.md depend on `just check` semantics.
- The typed worker message contract (`lib/messages.ts`) is the internal interface between main thread
  and worker; keep it the single source of truth (no untyped `postMessage`).
- `NetworkPurpose` must match PROJECT_ANALYSIS §9 verbatim so Phase 1 can adopt it unchanged.

## Data / Migration Notes

PGlite schema (fresh DB; no migration — first schema). DDL lives in `lib/schema.sql.ts`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  source_kind  TEXT NOT NULL,          -- 'bundled' | 'uploaded'
  byte_size    INTEGER,
  char_length  INTEGER NOT NULL,
  parsed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  embed_model  TEXT NOT NULL,          -- 'onnx-community/embeddinggemma-300m-ONNX'
  embed_dim    INTEGER NOT NULL        -- 768 (records R2's confirmed dimension)
);

CREATE TABLE IF NOT EXISTS chunks (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal      INTEGER NOT NULL,       -- chunk order within the document
  text         TEXT NOT NULL,
  token_count  INTEGER NOT NULL,
  char_start   INTEGER NOT NULL,       -- offset into parsed text (source attribution, FR-5)
  char_end     INTEGER NOT NULL,
  embedding    vector(768) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS chunks_doc_ordinal ON chunks (document_id, ordinal);
```

- **Index (Step 5, conditional):** attempt
  `CREATE INDEX chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);`
  inside try/catch; on failure use no index + exact/flat scan. Record which succeeded.
- **Retrieval query (cosine):**
  `SELECT id, document_id, ordinal, text, char_start, char_end, 1 - (embedding <=> $1) AS similarity FROM chunks ORDER BY embedding <=> $1 LIMIT $2;`
- **Persistence dir:** `idb://aafno-slice1` (IndexedDB, all browsers); OPFS variant only inside the
  worker where supported (not Safari — D6). If both are unavailable/blocked, `capabilities.ts`
  reports "persistence unavailable" rather than silently losing data (edge case).
- **`MEASUREMENTS.md` table template** (fill after a run): cold-load (s), warm-load (s, target ≤3s),
  embedding throughput (chunks/s, chars/s), retrieval latency (ms, target ≤500ms), index strategy
  (`hnsw`|`flat`), persistence-across-reload (pass/fail), browser+version, OS, GPU/adapter, WebGPU
  yes/no, WASM-fallback observed yes/no.

## Test Strategy

Proportional to spike risk (§10 testing strategy): automate the cheap, deterministic, high-signal
checks; validate genuinely browser-only behavior manually and record it in `MEASUREMENTS.md`.

- **`test/chunk.test.ts`** (unit — parsing/chunking helper): given fixed input text, chunks are
  non-empty, ordered, `charStart`/`charEnd` offsets are monotonic and slice back to the source text,
  and `tokenCount` respects the configured limit. Covers FR-3 + AC-1's attribution requirement.
- **`test/network.test.ts`** (unit — network classification): `lib/network.ts` classifies dev-cloud
  requests as `dev_cloud_inference` with `sentUserContent: true`, asset fetches as `app_asset`, and
  records domain/method/status; the log is observable. Covers FR-11 / AC-8 and §10 "network
  classification" test category.
- **`test/db.persistence.test.ts`** (integration — persistence, AC-3): run PGlite in node with a
  temp filesystem `dataDir`, apply DDL, insert a document + chunks with 768-dim vectors, close,
  reopen with the same `dataDir`, assert rows survive and a cosine-`ORDER BY` retrieval returns them.
  This validates the persistence + retrieval **logic** in CI. The true browser reload (IndexedDB/OPFS)
  is validated manually and its pass/fail recorded in `MEASUREMENTS.md` (AC-3, AC-10).
- **`test/messages.test.ts`** (worker-contract sanity): the discriminated unions type-check and a
  fake message round-trip (request → handler stub → typed event) preserves `jobId` and narrows on
  `type`; guards against untyped `postMessage` drift.
- **Manual / recorded (browser-only, not automated):** end-to-end Q&A grounded in retrieved chunks
  (AC-1); AC-2 verified via DevTools network log showing no content egress with the toggle off;
  cold/warm-load and retrieval-latency measurement (AC-5/6/7); HNSW-vs-flat outcome (AC-4);
  WebGPU-absent / OPFS-blocked honesty (AC-9). All results go into `MEASUREMENTS.md` (AC-10).
- Scenario coverage mapping: happy path = AC-1 (manual) + chunk/persistence tests; "validation/empty"
  = empty/image-only PDF (Step 7) and no-relevant-chunks (Step 10); "permission/egress" = network
  test + AC-8 manual; "not-found/config error" = unreachable/unconfigured dev-cloud (Step 12);
  "concurrency" is minimal for a single-worker single-doc spike — the `cancel` message + `jobId`
  echoing is the only concurrency surface and is covered by the messages test.

## Risk & Sequencing

**Highest-risk-first ordering** (why the steps are grouped as they are): the spike exists to answer
§5 unknowns, so the two that could invalidate the whole stack are attacked before building the rest.

1. **PGlite + pgvector persistence & HNSW (Steps 4–5) — do first.** If persistence across reload
   fails (a hard gate, AC-3) or pgvector/HNSW is unusable under PGlite, the storage architecture
   (ADR #2) is in question. Mitigation: flat/exact scan is an accepted fallback (FR-6) so a failed
   HNSW does not block the slice; a failed *persistence* path is reported honestly, not stubbed.
2. **Model cold/warm load (Step 6) — do second.** The #1 product UX risk (§7). Prefer q8 (~155 MB)
   to keep cold-load tolerable; measure both load phases; WASM fallback is automatic and
   observed-not-gated (D6). If WebGPU is absent, `capabilities.ts` says so plainly (AC-9).
3. **Rest of the local pipeline (Steps 7–10)** depends on both above (chunk/embed feed store;
   retrieve needs the index). Straightforward once the model and DB work.
4. **Generation + privacy UX (Steps 11–14)** depends on retrieval. Isolating content egress to the
   main-thread network client (Step 11) is the mitigation that makes AC-2 structurally guaranteed and
   keeps cloud opt-in visible (AC-8, a hard gate).
5. **Measurement note, tests, gate (Steps 15, 17–19)** last — they characterize and verify the above.

**Other risks / mitigations:** transformers.js internal fetches can't route through `lib/network.ts`,
so model downloads are surfaced via `progress_callback` → `network` events instead (documented seam,
not a gap). Memory pressure on a large doc (edge case) is reported, not silently crashed. Safari lacks
worker-OPFS — IndexedDB is the portable persistence path; OPFS is a worker-only optimization. Exact
package entry for the PGlite pgvector extension and chonkie-ts scoped-package names are confirmed at
install (R1/R3 style) — both have accepted fallbacks (flat scan; documented tokenizer approximation)
so neither blocks the slice.
