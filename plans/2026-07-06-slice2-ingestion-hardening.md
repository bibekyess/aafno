# Plan — 2026-07-06 — Slice 2: ingestion hardening + dev ergonomics

Spec: `specs/2026-07-06-slice2-ingestion-hardening.md` (Ratified)
Branch: `claude/project-analysis-poc-plan-nfq3mw` (restarted from merged main; not a separate worktree)

## Overview

Slice 1 (`spikes/rag-pipeline/`) proved the client-side RAG pipeline end-to-end. Slice 2 hardens it
along four axes, all still inside the spike (typed, not production-polished; §10 principle 5):

- **A1 — Byte-hash dedup.** `content_hash TEXT UNIQUE` on `documents`; SHA-256 of raw file bytes is
  the dedup key. Re-uploading identical bytes is warned-and-skipped (no re-parse/chunk/embed/store).
- **A2 — Document management + multi-doc.** `listDocuments` / `deleteDocument` worker messages;
  restore **all** documents on reload (drop `LIMIT 1`); corpus-wide retrieval (already true in SQL); a
  document-list UI with per-doc delete + lightweight confirm, disabled during in-flight jobs.
- **A3 — Dev logger.** `src/lib/log.ts`: leveled (`debug/info/warn/error`), namespaced per stage,
  gated by `import.meta.env.DEV`; a hard privacy gate keeps document/prompt **content** out of any
  production log path, verified by a production-build check.
- **A4/B — Measurement capture + export.** Auto-timed cold-vs-warm load, recorded HNSW-vs-flat outcome,
  a persistence-across-reload self-check, and a one-click copyable-Markdown export matching an updated
  `MEASUREMENTS.md`.

Plus **schema-version handling (D5)**: on reopen, a pre-slice-2 DB lacking `content_hash` is
dropped/recreated in place with a visible user notice (no real migration).

**In scope:** the four areas above and the schema-version reset. **Out of scope** (per spec Scope):
production app shell, Atomic-Design UI, real Privacy Console, local Gemma generation, hybrid search,
compile-time cloud exclusion as a build mechanism, real migrations, near-duplicate/content-addressed
dedup, and producing actual measurement numbers (they require a real WebGPU browser run).

## Architecture & Design

All paths under `spikes/rag-pipeline/`.

### New modules

- **`src/lib/hash.ts`** — `computeContentHash(bytes: Uint8Array): Promise<string>` returning a
  lowercase hex SHA-256 via `crypto.subtle.digest("SHA-256", bytes)`. No worker/DOM globals →
  Node-testable (Node exposes global `crypto.subtle`). **R2 placement decision:** hashing runs in the
  **worker**, on the already-resolved `Uint8Array` in `resolveSourceBytes`, before `parsePdf`. Rationale:
  the worker already holds the raw bytes for both `bundled` (fetched `ArrayBuffer`) and `uploaded`
  (transferred `ArrayBuffer`) sources with no extra copy, and the dedup lookup needs the DB, which the
  worker owns — keeping hash + lookup + skip in one place. WebCrypto is available on both threads, so
  the module itself is thread-agnostic.
- **`src/lib/log.ts`** — leveled, namespaced logger (see A3 below). Thread-agnostic (uses only
  `console` + `import.meta.env.DEV`, both available in worker and main-thread Vite modules).
- **`src/ui/DocumentList.tsx`** — renders the indexed-document list with per-doc delete + inline confirm.
- **`scripts/check-no-content-logs.mjs`** — production-build content-logging check (AC-8); wired as an
  npm script and into `just check`.

### Modified modules

- **`src/lib/schema.sql.ts`** — add `content_hash TEXT UNIQUE` to `documents`; add `SCHEMA_VERSION`
  constant and a `schema_meta(version INTEGER NOT NULL)` table; keep `chunks.document_id … ON DELETE
  CASCADE` (already present — it satisfies FR-7's cascade) and the corpus-wide `RETRIEVE_SQL`
  (already has no `document_id` filter — no change).
- **`src/worker/db.ts`** — `DocumentInsert` gains `contentHash`; `insertDocument` writes it and its
  `ON CONFLICT (id) DO NOTHING` becomes `ON CONFLICT (content_hash) DO NOTHING` (the durable dedup
  backstop); add `findDocumentByContentHash`, `listDocuments`, `deleteDocument`; replace `restoreState`
  with `restoreAllDocuments`; add `ensureSchemaVersion` (drop/recreate on version mismatch) called from
  `openDb`, which now returns `{ db, wasReset }`.
- **`src/lib/messages.ts`** — new/changed variants + `DocumentSummary` / `DedupOutcome` types (full
  contract below); extend the round-trip switch coverage.
- **`src/worker/pipeline.worker.ts`** — hash + dedup short-circuit in `handleParse`; thread `contentHash`
  into `handleIngest`; new `handleListDocuments` / `handleDeleteDocument`; `restoreAllDocuments` in
  `handleInit`; surface `schemaReset`; route existing `console.warn`s and new I/O traces through `log.ts`.
- **`src/worker/embed.ts`, `src/worker/chunk.ts`** — replace their `console.warn` calls with the logger.
- **`src/lib/measure.ts`** — add `MeasurementSnapshot` type, `buildMeasurementMarkdown(snapshot)` (pure,
  Node-testable), and a small localStorage-backed `measurementStore` (persist cold-load ms so warm-load
  after reload can be compared).
- **`src/ui/MeasurementPanel.tsx`** — cold-vs-warm rows, index outcome, persistence self-check row, and a
  "Copy as Markdown" button + on-screen copyable block (D9).
- **`src/App.tsx`** — `documents` state, dedup handling on parse result, list refresh after
  ingest/delete, delete disabled while busy, schema-reset notice, measurement snapshot wiring.
- **`spikes/rag-pipeline/MEASUREMENTS.md`** — restructure to match the exporter output; keep the explicit
  "numbers require a real WebGPU browser run, not CI/headless" statement.

### Typed worker contract (full new/changed variants)

Add to `src/lib/messages.ts`:

```ts
export interface DocumentSummary {
  documentId: string;
  title: string;
  chunkCount: number;
  sourceKind: "bundled" | "uploaded";
  charLength: number;
}

export type DedupOutcome =
  | { skipped: false }
  | { skipped: true; existingDocumentId: string; existingTitle: string };
```

Changed results:

```ts
export interface InitResult {
  webgpuAvailable: boolean;
  opfsAvailable: boolean;
  indexedDbAvailable: boolean;
  restoredDocuments: DocumentSummary[];   // replaces restoredDocumentId (FR-9, AC-6)
  restoredChunkCount: number;             // total across the corpus (kept for existing UI text)
  schemaReset: boolean;                   // D5/EC-1/AC-9 — DB was dropped/recreated on version bump
  modelLoadMs: number;
  modelLoadKind: ModelLoadKind;
  modelDevice: "webgpu" | "wasm";
}

export interface ParseResult {
  documentId: string;
  text: string;
  charLength: number;
  title: string;
  sourceKind: "bundled" | "uploaded";
  byteSize: number | null;
  contentHash: string;                    // FR-1/FR-2 — threaded to ingest
  dedup: DedupOutcome;                     // FR-3/FR-11 — skip short-circuit
}

export interface IngestResult {
  chunkCount: number;
  indexStrategy: IndexStrategy;
  embedMs: number;
  storeMs: number;
  chunksPerSecond: number;
  charsPerSecond: number;
  dedup: DedupOutcome;                     // FR-11 — always { skipped: false } on a real ingest
}

export interface ListDocumentsResult { documents: DocumentSummary[]; }
export interface DeleteDocumentResult { documentId: string; deletedChunkCount: number; }
```

Union + requests:

```ts
export type PipelineResult =
  | InitResult | ParseResult | IngestResult | RetrieveResult | GenerateResult
  | ListDocumentsResult | DeleteDocumentResult;

export type PipelineRequest =
  | { type: "init"; jobId: string }
  | { type: "parse"; jobId: string; source: DocumentSource }
  | { type: "ingest"; jobId: string; docId: string; text: string; charLength: number;
      title: string; sourceKind: "bundled" | "uploaded"; contentHash: string; byteSize: number | null }
  | { type: "retrieve"; jobId: string; question: string; k: number }
  | { type: "restore"; jobId: string }
  | { type: "listDocuments"; jobId: string }
  | { type: "deleteDocument"; jobId: string; documentId: string }
  | { type: "generateLocal"; jobId: string; question: string; contexts: RetrievedChunk[] }
  | { type: "cancel"; jobId: string };
```

The existing `isPipelineRequest` / `isPipelineEvent` guards check only `type` + `jobId` string, so new
variants pass with no guard change. `PipelineStage` is unchanged; map `listDocuments`/`deleteDocument`
to `"store"` in the worker's `REQUEST_STAGE`.

### Dedup control flow (reconciling FR-3 and FR-11)

FR-3 forbids re-parse/chunk/embed on a duplicate; FR-1 requires hashing **before** parsing. The dedup
decision therefore happens at the **start of `handleParse`** (the earliest point that can avoid a
re-parse), not at ingest. Flow:

1. `handleParse` → `resolveSourceBytes` → `computeContentHash(bytes)`.
2. `findDocumentByContentHash(db, hash)`. If a row exists → post a `ParseResult` with
   `dedup = { skipped: true, existingDocumentId, existingTitle }` (and empty `text`); **do not** parse,
   chunk, embed, or store. `App` shows "This file is already indexed" naming the existing document,
   highlights it in the list, and does **not** dispatch `ingest`. (FR-3, FR-4, AC-1, EC-2, D6 —
   existing title kept.)
3. Otherwise parse as today; `ParseResult` carries `contentHash` + `dedup: { skipped: false }`. `App`
   dispatches `ingest` with the hash; `insertDocument` writes `content_hash`; `IngestResult.dedup` is
   `{ skipped: false }` (satisfies FR-11's "ingest result carries a dedup outcome"). The `UNIQUE`
   constraint + `ON CONFLICT (content_hash) DO NOTHING` is the durable backstop against a race.

This is the one place the plan interprets a Ratified FR: FR-11 literally says the *ingest* result
carries the outcome, but honoring FR-3 (no re-parse) forces the actual skip decision to parse-start.
Both messages carry a `DedupOutcome` so the UI distinguishes "ingested N" from "skipped — already
indexed", satisfying the intent of FR-11 and the letter for the non-duplicate path.

### A3 logger design (privacy-gated)

`createLogger(namespace)` returns `{ debug, info, warn, error, content }`. Active level =
`import.meta.env.DEV ? "debug" : "warn"` (D8); levels below active are no-ops.

- `debug`/`info`/`warn`/`error` carry **metadata only** (sizes, counts, dims, timings, similarity
  scores, filenames). `warn`/`error` survive a production build — so by rule they never receive content.
- `content(thunk: () => unknown[])` is the **only** channel for document/prompt content (parsed text,
  chunk text, question text, generated answer, retrieved passage bodies). Its body is
  `if (import.meta.env.DEV) console.debug(ns, CONTENT_LOG_SENTINEL, ...thunk())`. In a production build
  Vite replaces `import.meta.env.DEV` with `false`; the branch — and the `CONTENT_LOG_SENTINEL`
  constant reference and the thunk call — are dead-code-eliminated. `CONTENT_LOG_SENTINEL` is a unique
  string (e.g. `"__AAFNO_CONTENT_LOG__"`) that exists nowhere else, giving the AC-8 build check a
  precise absence assertion.

Namespaces used verbatim per FR-12: `[parse] [chunk] [embed] [db] [retrieve] [generate]`. I/O traces
(FR-14): metadata via `debug` (file name/size, chunk count, embed dim + timing, top-k **scores**,
prompt/response **sizes**); content (retrieval **query** text, chunk/passage bodies, answer text) via
`content`.

### A4/B measurement design

`MeasurementSnapshot` aggregates: environment (where detectable), cold/warm load ms + kind + device,
embedding throughput, chunk counts, retrieval latency, index strategy, persistence self-check result,
and privacy/hard-gate observations. `buildMeasurementMarkdown(snapshot)` renders it to Markdown
matching the updated `MEASUREMENTS.md` section structure; `null`/unknown fields render as `TBD` so an
export before a full run is well-formed (EC-9). `measurementStore` (localStorage) persists the
cold-load ms keyed by model id so a warm load after reload can display both.

Persistence self-check (FR-19/AC-11): tri-state `pass | fail | no-prior-corpus`. On init, if
`restoredDocuments.length > 0 && restoredChunkCount > 0` and the init path ran no parse/chunk/embed
job (structurally true) → `pass`; if a prior corpus was expected (localStorage recorded a prior
ingest) but nothing restored → `fail`; if the store was empty and none expected → `no-prior-corpus`.

## Architecture Decisions (ADRs)

### ADRs to add or update

**1. `adr/2026-07-06-content-hash-dedup-multi-document-store.md`** (status `Proposed`) — extends, does
not supersede, `2026-07-05-pglite-pgvector-local-vector-store.md` (whose "re-evaluate once
multi-document corpora are in scope" follow-up this fulfills).

- **Context:** slice-1 minted a fresh UUID per upload so `ON CONFLICT (id)` never fired (duplicate
  chunks); `restoreState` restored only the latest document though retrieval already scans the whole
  corpus; there was no way to remove indexed data. Multi-document + delete under PGlite/pgvector was
  flagged as unverified by the slice-1 store ADR.
- **Decision:** a document's dedup identity is the SHA-256 of its raw file bytes, stored as
  `content_hash TEXT UNIQUE`; duplicate uploads are warned-and-skipped before parse. Restore is
  corpus-wide (all documents) and retrieval remains corpus-wide (unfiltered `RETRIEVE_SQL`). Per-document
  delete cascades chunks via the existing `ON DELETE CASCADE`. HNSW-vs-flat survival across multi-doc +
  deletes is confirmed empirically (see below); flat scan remains the accepted fallback (slice-1 AC-4).
  A `schema_meta` version gate drops/recreates the local DB in place on a version bump, with a visible
  notice — a deliberate spike-only choice instead of a real migration (D5).
- **Alternatives:** per-selected-document retrieval scoping (rejected — D4 corpus-wide); parsed-text or
  content-addressed dedup (rejected for slice 2 — byte-exact only, EC-7); a real migration (rejected —
  throwaway spike, D5); keeping `ON CONFLICT (id)` (rejected — never fires).
- **Consequences:** exact-byte dedup only (EC-7 noted, not a bug); the schema bump discards any local
  slice-1 index (accepted); index-rebuild-on-delete is a recorded empirical finding, not an assumption.

**2. `adr/2026-07-06-dev-logger-content-privacy-gate.md`** (status `Proposed`) — relates to
`2026-07-05-dev-cloud-compile-time-exclusion.md` (same `import.meta.env`/`define` tree-shaking
mechanism) and `2026-07-05-central-network-client-network-purpose.md` (privacy-observability posture);
extends both, supersedes neither.

- **Context:** slice-1 debugging used ad-hoc `console.warn`s with no levels, no namespaces, and no
  discipline around logging user content — a §7 risk #3 gap ("user content in logs").
- **Decision:** a single leveled, stage-namespaced logger gated by `import.meta.env.DEV`
  (default `debug` in dev, `warn` otherwise). Metadata may be logged at any level; document/prompt
  **content** is confined to a `content()` channel wrapped in an `import.meta.env.DEV` guard carrying a
  unique `CONTENT_LOG_SENTINEL`, so it is dead-code-eliminated from production builds. A build-output
  check asserts the sentinel is absent from `dist/`, making the guarantee structural, not disciplinary.
  The logger writes only to `console` — never through `classifiedFetch` — so it introduces no egress.
- **Alternatives:** free-form content in `debug` relying on the level gate alone (rejected — arguments
  can survive tree-shaking if the guard is only inside the method); a third-party logging library
  (rejected — over-scoped for a spike); reviewer-vigilance only (rejected — non-structural, mirrors the
  central-network-client ADR's reasoning).
- **Consequences:** content logging requires the `content()` thunk form (slightly more verbose);
  production builds are verifiably content-free in log paths; the check is spike-scoped and does not yet
  cover the (nonexistent) production app shell.

### Relevant ADRs for the implementer

- `adr/2026-07-05-pglite-pgvector-local-vector-store.md` (Accepted) — schema/index/HNSW-or-flat posture.
- `adr/2026-07-05-central-network-client-network-purpose.md` (Accepted) — logger must not become egress;
  no new content-bearing network path.
- `adr/2026-07-05-dev-cloud-compile-time-exclusion.md` (Proposed) — the `import.meta.env`/`define`
  tree-shaking mechanism the logger's content gate reuses.
- `adr/2026-07-05-in-browser-only-inference.md` (Accepted) — parse/chunk/embed/retrieve stay local
  (unaffected; do not contradict).

## Implementation Steps (ordered)

Ordered highest-risk-first (durable-store correctness before UI, logger, then measurement).

1. **Schema + version gate** — in `src/lib/schema.sql.ts`: add `content_hash TEXT UNIQUE` to
   `documents`; add `export const SCHEMA_VERSION = 2` and a `CREATE TABLE IF NOT EXISTS schema_meta
   (version INTEGER NOT NULL)`. Keep `chunks … ON DELETE CASCADE` and `RETRIEVE_SQL` unchanged. (FR-2,
   FR-7, FR-10, D5.)
2. **DB layer** — in `src/worker/db.ts`:
   - `DocumentInsert` gains `contentHash: string`; `insertDocument` writes `content_hash` and uses
     `ON CONFLICT (content_hash) DO NOTHING`.
   - Add `findDocumentByContentHash(db, hash): Promise<{ id; title } | null>`.
   - Add `listDocuments(db): Promise<DocumentSummary[]>` — `LEFT JOIN chunks … GROUP BY documents.id`,
     ordered `parsed_at ASC`.
   - Add `deleteDocument(db, id): Promise<number>` — count chunks, `DELETE FROM documents WHERE id=$1`
     (chunks cascade), return deleted chunk count.
   - Replace `restoreState` with `restoreAllDocuments(db): Promise<{ documents: DocumentSummary[];
     totalChunkCount: number }>` (drop `LIMIT 1`).
   - Add `ensureSchemaVersion(db): Promise<boolean>` — reads `schema_meta`; if the table is absent, or
     `documents` lacks `content_hash` (slice-1 DB), or `version < SCHEMA_VERSION` →
     `DROP TABLE IF EXISTS chunks, documents, schema_meta CASCADE`, re-apply `SCHEMA_SQL`, insert
     `SCHEMA_VERSION`, return `true`; else return `false`. `openDb` runs the schema, then
     `ensureSchemaVersion`, and returns `{ db, wasReset }`. (FR-2, FR-6, FR-7, FR-9, D5, EC-1.)
3. **Hash util** — add `src/lib/hash.ts` `computeContentHash`. (FR-1, R2.)
4. **Message contract** — apply the full contract in `src/lib/messages.ts` above. (FR-6, FR-7, FR-9,
   FR-11.)
5. **Worker wiring** — in `src/worker/pipeline.worker.ts`:
   - `getDb` awaits the new `openDb` shape; keep `wasReset` for `handleInit` to surface `schemaReset`.
   - `resolveSourceBytes` guards zero-byte input (EC-6) and returns `contentHash`.
   - `handleParse` computes hash, calls `findDocumentByContentHash`, and short-circuits with a dedup
     `ParseResult` when matched (no parse/chunk/embed/store); otherwise carries `contentHash` forward.
   - `handleIngest` accepts `contentHash`/`byteSize`, passes them to `insertDocument`, and sets
     `IngestResult.dedup = { skipped: false }`.
   - Add `handleListDocuments` and `handleDeleteDocument`; extend the dispatch `switch` and
     `REQUEST_STAGE` (`listDocuments`/`deleteDocument` → `"store"`).
   - `handleInit` uses `restoreAllDocuments` and sets `restoredDocuments` + `restoredChunkCount` +
     `schemaReset`. (FR-1..FR-11, EC-1, EC-6.)
6. **Logger** — add `src/lib/log.ts` per A3 design; replace the `console.warn`s in `worker/db.ts`
   (HNSW fallback), `worker/embed.ts` (dim mismatch), `worker/chunk.ts` (tokenizer fallback) with
   `logger.warn` (metadata); add `debug` metadata traces + `content` traces at the parse/chunk/embed/
   retrieve/generate boundaries. (FR-12..FR-16.)
7. **Document-list UI** — add `src/ui/DocumentList.tsx`: props `{ documents, onDelete, busy,
   highlightedId }`; per-row title + chunk count + source kind; per-row Delete with an inline two-step
   confirm (`confirmingId` local state); delete disabled when `busy` (D10). (FR-5, FR-8, D7, EC-5.)
8. **App wiring** — in `src/App.tsx`: `documents` state; on init result set from `restoredDocuments` and
   show the schema-reset notice when `schemaReset`; on parse dedup show "already indexed" naming the
   existing document + set `highlightedId` and skip ingest; after ingest/delete completion send
   `listDocuments` to refresh; derive `busy` from any running job for `DocumentList` + delete
   serialization; render `DocumentList`; map `RetrievedChunk.documentId` → title for attribution (AC-5).
   (FR-3, FR-5, FR-8, FR-9, FR-10, FR-11, AC-1, AC-5, AC-6, AC-9, EC-2, EC-3, EC-5.)
9. **Measurement capture + export** — extend `src/lib/measure.ts` (`MeasurementSnapshot`,
   `buildMeasurementMarkdown`, localStorage `measurementStore`) and `src/ui/MeasurementPanel.tsx`
   (cold/warm rows, index outcome, persistence self-check row, "Copy as Markdown" button +
   `navigator.clipboard.writeText` + on-screen copyable `<textarea readOnly>`). Compute the persistence
   self-check tri-state in `App`. (FR-17..FR-20, D9, EC-9, AC-10, AC-11.)
10. **MEASUREMENTS.md** — restructure `spikes/rag-pipeline/MEASUREMENTS.md` to match
    `buildMeasurementMarkdown` output; keep/strengthen the "numbers require a real WebGPU browser run,
    not CI/headless" statement. (FR-21.)
11. **Production-build content check** — add `scripts/check-no-content-logs.mjs`: run `vite build`,
    then assert no `dist/assets/*.js` contains `CONTENT_LOG_SENTINEL` (and no `console.debug`/
    `console.info` from our logger survive). Add npm script `"check:prod-logs"` and append it to
    `just check` (new `just` recipe delegating to it). (FR-16, AC-8, EC-8.)
12. **Tests** — implement the Test Strategy below.
13. **Run `just check`** — format, lint, typecheck, test, and the new prod-logs check must all pass.

## Interface & Compatibility

- **Preserve:** `RETRIEVE_SQL` corpus-wide semantics; `RetrievedChunk` shape (retrieval attribution via
  `documentId`); the single-worker/typed-message boundary (no untyped `postMessage`); the slice-1 §4
  privacy invariants (no content egress with cloud off; logger adds no egress).
- **Intentional changes:** `InitResult` drops `restoredDocumentId`, adds `restoredDocuments` +
  `schemaReset` (App reads `restoredDocuments`, not the old field); `ParseResult`/`IngestResult` gain
  `dedup`; `ingest` request gains `contentHash`/`byteSize`; `restoreState` → `restoreAllDocuments`
  (the persistence test updates accordingly); `insertDocument` `ON CONFLICT` target changes from `id`
  to `content_hash`. A pre-slice-2 persisted DB is intentionally reset (D5/AC-9), not migrated.

## Data / Migration Notes

- `documents`: `+ content_hash TEXT UNIQUE` (dedup key, FR-2). New `schema_meta(version INTEGER NOT
  NULL)` holding `SCHEMA_VERSION = 2`.
- `chunks`: unchanged; `document_id … REFERENCES documents(id) ON DELETE CASCADE` already present and is
  the delete cascade (FR-7).
- **HNSW across multi-doc + delete (R1):** `HNSW_INDEX_SQL` uses `CREATE INDEX IF NOT EXISTS`, so it is a
  no-op once built and remains valid across inserts/deletes (pgvector marks deleted rows; no rebuild
  needed for correctness). Empirical check (Node db test, step 12): after deleting a document, retrieval
  must never return its chunks whether the index is `hnsw` or `flat`. If the run shows stale hits under
  `hnsw`, the fallback is to re-run `attemptHnswIndex` (REINDEX) after delete; default is **no rebuild**.
  Either outcome is acceptable (flat scan is the slice-1 AC-4 fallback) and is recorded in
  `MEASUREMENTS.md`.
- **No real migration:** version mismatch → drop/recreate in place with a visible notice (D5/EC-1).

## Test Strategy

Tests live in `src/test/**/*.test.ts` (Vitest, Node env), matching existing patterns.

- **`src/test/hash.test.ts` (new):** identical bytes → identical hash; different bytes → different hash;
  filename-independence is a property of the byte input (hash ignores name); a zero-byte buffer hashes
  deterministically (EC-6 guard is enforced upstream in the worker). (FR-1, FR-4.)
- **`src/test/log.test.ts` (new):** level gating — with active level `warn`, `debug`/`info` are no-ops
  and `warn`/`error` fire (spy on `console`); `content()` invokes its thunk and logs only when
  `import.meta.env.DEV` (drive via a stubbed env), proving the metadata-vs-content split. (FR-13, FR-16.)
- **`src/test/db.persistence.test.ts` (extend):**
  - *Dedup-skip:* `findDocumentByContentHash` returns the existing row for a stored hash and `null`
    otherwise; a second `insertDocument` with the same `content_hash` inserts no new row and creates no
    chunks (AC-1); a different hash inserts a second document (AC-2).
  - *Cascade delete:* insert two documents; `deleteDocument` on one removes it and its chunks, leaves the
    other intact, and a subsequent `retrieveTopK` never returns the deleted document's chunks (AC-3,
    R1 empirical check); deleting the last document leaves an empty corpus and `retrieveTopK` returns
    `belowRelevanceThreshold` (EC-3, EC-4).
  - *Multi-doc restore:* insert N≥2 documents, close, reopen, `restoreAllDocuments` returns all N with
    correct chunk counts (AC-6); `listDocuments` matches.
  - *Schema reset:* create a DB with a slice-1-shaped `documents` (no `content_hash`, no `schema_meta`),
    close, reopen via new `openDb` → `wasReset === true` and the new schema is present (AC-9/EC-1).
  - Update the existing assertions that used `restoreState`/`restoredDocumentId`.
- **`src/test/messages.test.ts` (extend):** add `listDocuments`/`deleteDocument` cases to the round-trip
  `handle` switch (exhaustiveness) and assert `jobId` preservation + `type` narrowing for the new
  results; assert a dedup `ParseResult` narrows correctly.
- **`src/test/measure.test.ts` (new):** `buildMeasurementMarkdown` produces valid Markdown matching the
  `MEASUREMENTS.md` structure with all fields present (AC-10) and renders `TBD` for `null` fields without
  crashing (EC-9); persistence self-check tri-state maps correctly.
- **Production-build content check (`scripts/check-no-content-logs.mjs`, step 11):** `vite build` then
  assert `CONTENT_LOG_SENTINEL` and our `console.debug`/`console.info` do not appear in `dist/assets/*.js`
  (AC-8, EC-8). This is the build-check counterpart to the unit tests, run under `just check`.
- **Manual (recorded via exporter, not CI):** true browser reload restore, WebGPU cold/warm timings,
  HNSW-vs-flat, and clipboard export — the actual numbers require a real run (NFR).

Scenarios covered: happy path (multi-doc ingest/retrieve/restore), permission/privacy failure
(production content-logging leak → build check), validation (dedup skip, zero-byte file), not-found
(delete last doc / empty-corpus retrieve), concurrency (delete disabled during in-flight job, D10/EC-5).

## Risk & Sequencing

- **Ordering rationale:** schema + version gate (1) and DB layer (2) are the durable-correctness
  foundation and land first; hash (3) and the contract (4) unblock worker wiring (5); UI (7–8) depends on
  the contract; logger (6) is independent and slots before UI wiring cleanly; measurement (9–10) and the
  build check (11) are last as they consume finished behavior. Tests (12) follow each unit but must all
  pass before `just check` (13).
- **Highest risks + mitigations:**
  - *Dedup regressions / duplicate chunks* — the primary bug this slice fixes: mitigated by the
    parse-start hash check plus the `UNIQUE`/`ON CONFLICT (content_hash)` backstop and AC-1/AC-2 tests.
  - *Delete not cascading or index returning ghost chunks (R1)* — mitigated by the cascade + post-delete
    retrieval db tests; flat scan is the accepted fallback if HNSW misbehaves.
  - *Silent data loss on schema bump* — mitigated by the visible reset notice (AC-9) and the reset db
    test; the loss is an accepted, documented spike tradeoff (D5).
  - *Content leaking into a production log path* — mitigated structurally by the `content()` DEV gate +
    sentinel and the failing-if-present build check (AC-8/EC-8).
  - *Export before a run producing malformed Markdown* — mitigated by `TBD` handling + the measure unit
    test (EC-9).
