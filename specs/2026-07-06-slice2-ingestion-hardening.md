---
title: Phase 0 POC — Slice 2 (ingestion hardening + dev ergonomics)
date: 2026-07-06
status: Delivered        # Draft | Ratified | Delivered
---

# 2026-07-06 — Phase 0 POC — Slice 2 (ingestion hardening + dev ergonomics)

## Objective

Slice 1 proved the client-side RAG pipeline is real end-to-end (`specs/2026-07-05-phase0-poc-slice1.md`,
Ratified). Exercising it exposed three sharp edges that make the spike hard to trust and hard to
iterate on: (1) **re-uploading the same file stacks duplicate chunks** — a fresh `crypto.randomUUID()`
is minted per upload in `handleParse`, so `insertDocument`'s `ON CONFLICT (id)` guard never fires and
retrieval returns the same passage multiple times; (2) there is **no way to see or remove indexed
documents**, and reload restores only the single latest document (`restoreState` does
`ORDER BY parsed_at DESC LIMIT 1`) even though the retrieval SQL already scans the whole `chunks`
corpus — so the store silently accumulates and can never be pruned; and (3) pipeline debugging relies
on ad-hoc `console.warn`s (`db.ts`, `embed.ts`, `chunk.ts`) with no leveled, namespaced tracing and no
privacy discipline around logging document content. Separately, Phase 0's exit artifact — the §5
measurement evidence in `MEASUREMENTS.md` — is still filled in by hand, which is error-prone and
discourages re-running.

Slice 2 hardens ingestion (dedup + document management + real multi-document support), adds a
dev-only leveled logger with a hard privacy guardrail, and builds **measurement capture/export
tooling** so a real browser run produces paste-ready evidence with one click. This slice raises the
quality of the spike so Phase 1 can be planned on trustworthy foundations; it does **not** build the
production app shell. It remains isolated spike code under `spikes/rag-pipeline/` (§10 principle 5).

## Scope

**In scope:**
- **A1 — Duplicate-upload dedup** by raw-file-bytes SHA-256, with a UNIQUE `content_hash` on
  `documents`; re-upload of an already-indexed file is warned-and-skipped (not re-ingested).
- **A2 — Document management + multi-document support**: a document list in the UI, a per-document
  delete (cascading its chunks), restore of **all** indexed documents on reload, and retrieval across
  the whole indexed corpus.
- **A3 — Dev-only leveled logger**: `debug/info/warn/error`, namespaced per pipeline stage, gated by
  `import.meta.env.DEV`, replacing the ad-hoc `console.warn`s; document/prompt **content** logging is
  behind the dev flag so it can never appear in a production build.
- **B — Measurement capture/export tooling**: auto-timed cold-vs-warm model load, recorded
  HNSW-vs-flat outcome, a persistence-across-reload self-check, and a one-click "export measurements
  as Markdown" the owner pastes into `MEASUREMENTS.md`; plus an updated `MEASUREMENTS.md` structure.

**Out of scope (deferred):**
- The production app shell, Atomic-Design UI, routing, and the real Privacy Console organism (Phase 1).
- Full Gemma-4-E2B local generation, hybrid (BM25 + vector) search, citation UX, and the Tiptap editor.
- Compile-time exclusion of cloud code paths as a *build* mechanism (Phase 1); slice 2 keeps the
  slice-1 runtime posture (cloud opt-in + visible) and adds the logging privacy guardrail below.
- A real schema **migration** for pre-existing slice-1 databases (see edge case EC-1 / D5).
- Producing the actual measurement **numbers** — those require a real WebGPU browser run by the owner
  and cannot be produced in CI/headless (see NFR "Measurement numbers require a real run").
- Content-addressed dedup that survives text edits, near-duplicate detection, or cross-format
  de-duplication — slice 2 dedups exact raw bytes only.

## User stories

- As an **AAFNO engineer**, I want re-uploading the same file to be detected and skipped, so that my
  corpus doesn't accumulate duplicate chunks that pollute retrieval.
- As an **AAFNO engineer**, I want to see every indexed document and delete any of them, so that I can
  reset or curate the local corpus without wiping the whole database by hand.
- As an **AAFNO engineer**, I want reload to restore *all* my indexed documents and retrieval to search
  across the whole corpus, so that the spike behaves like the multi-document product will.
- As an **AAFNO engineer**, I want leveled, stage-namespaced pipeline logs in dev, so that I can trace
  inputs/outputs when something misbehaves without hand-editing `console.warn`s.
- As a **privacy-conscious reviewer**, I want document/prompt content to be logged only behind the dev
  flag, so that no user content can ever reach an always-on log path in a production build.
- As an **AAFNO engineer**, I want a one-click export of the §5 measurement evidence as Markdown, so
  that recording a real run into `MEASUREMENTS.md` is fast and not transcription-error-prone.

## Functional requirements

### A1 — Duplicate-upload dedup

1. **Content hash.** On document input (bundled or uploaded), the spike must compute a SHA-256 digest
   of the **raw file bytes** using WebCrypto (`crypto.subtle.digest`), before parsing. The hash is the
   dedup key; it is computed over the original bytes, not the parsed text.
2. **Hash-derived identity + uniqueness.** The `documents` table must carry a `content_hash` column
   with a UNIQUE constraint. A document's identity for dedup purposes is its content hash; a fresh
   random UUID must **not** be minted per upload for an identical file.
3. **Warn-and-skip.** On input of a file whose content hash already matches an indexed document, the
   spike must **not** re-parse, re-chunk, re-embed, or re-store it. It must surface a clear
   user-facing message ("This file is already indexed") and point at the existing document (e.g., by
   title, and by selecting/highlighting it in the document list).
4. **Dedup is byte-exact and filename-independent.** Two uploads with identical bytes but different
   filenames are the same document (dedup fires); two files with the same filename but different bytes
   are distinct documents (dedup does not fire). See D6 for the chosen title-on-collision behavior.

### A2 — Document management + multi-document support

5. **Document list.** The UI must display a list of all indexed documents, showing at minimum each
   document's title and chunk count (other slice-1 metadata such as source kind may be shown).
6. **List message.** A new worker request `listDocuments` must return the indexed documents (id, title,
   chunk count, and enough metadata to render the list) so the main thread can render item 5 without
   reaching into DB internals.
7. **Delete.** The UI must provide a per-document **delete** action. A new worker request
   `deleteDocument` must remove the document and cascade-delete its chunks (the existing
   `ON DELETE CASCADE` on `chunks.document_id` satisfies the cascade). After delete, the document and
   its chunks must no longer appear in the list nor be retrievable.
8. **Delete confirmation.** Delete must require a lightweight confirmation step before it executes (see
   D7).
9. **Restore all documents on reload.** On reload/init, the spike must restore **all** indexed
   documents from the persisted store (replacing slice-1's latest-doc-only `restoreState`), and the
   document list (item 5) must reflect the full restored corpus without re-parsing/chunking/embedding.
10. **Corpus-wide retrieval.** Retrieval must search across the whole indexed corpus (all documents'
    chunks), returning top-k by similarity regardless of source document; retrieved chunks must remain
    attributable to their source document (the `document_id` on results already supports this). See D4.
11. **Dedup outcome on ingest.** The `ingest` message result must carry a dedup outcome so the main
    thread can distinguish "ingested N chunks" from "skipped — already indexed (pointing at document
    X)" and drive the item-3 message.

### A3 — Dev-only leveled logger

12. **Leveled, namespaced logger.** The spike must provide a small logger supporting `debug`, `info`,
    `warn`, and `error` levels, namespaced per pipeline stage using the tags `[parse]`, `[chunk]`,
    `[embed]`, `[db]`, `[retrieve]`, `[generate]`. It must be usable from both the main thread and the
    worker.
13. **Dev gating.** Logging must be gated by `import.meta.env.DEV`. The default active level is `debug`
    in dev and `warn` otherwise (see D8). A production build must not emit `debug`/`info` traces.
14. **I/O tracing.** In dev, the logger must trace pipeline inputs/outputs to the terminal/console:
    at minimum file name/size, chunk count, embedding dimension + timing, retrieval query + top-k
    scores, and generation prompt/response sizes.
15. **Replace ad-hoc logging.** The existing ad-hoc `console.warn` calls in `worker/db.ts`,
    `worker/embed.ts`, and `worker/chunk.ts` must be replaced by the leveled logger.
16. **Content privacy guardrail (hard requirement).** Any log statement that includes actual document
    or prompt **content** (chunk text, parsed text, question text, generated answer text, retrieved
    passage bodies) must be behind the dev flag such that it is compiled/branched out of a production
    build. No always-on log path (any level that survives a production build) may contain user content.
    Sizes, counts, timings, dimensions, and similarity **scores** are metadata and may be logged; the
    query/prompt/answer **text** may not appear in an always-on path.

### B — Measurement capture/export tooling

17. **Auto-timed cold vs warm load.** The measurement tooling must capture model **cold-load** (first
    download+init) vs **warm-load** (cached init after reload) automatically, reusing slice-1's
    cold/warm heuristic (`modelLoadKind`), without the user hand-timing anything.
18. **Recorded index outcome.** The tooling must record the HNSW-vs-flat index outcome
    (`indexStrategy`) from the ingest step for export.
19. **Persistence self-check.** The tooling must run a persistence-across-reload self-check that
    reports, after reload, whether the corpus was restored from storage (documents + chunk counts
    present) without re-parsing/chunking/embedding — a machine-evaluated pass/fail the export records.
20. **One-click Markdown export.** The tooling must provide a one-click action that renders the
    captured evidence (environment where detectable, cold/warm load ms + kind + device, embedding
    throughput, chunk counts, retrieval latency, index strategy, persistence self-check result,
    privacy/hard-gate observations) as **valid Markdown** matching the updated `MEASUREMENTS.md`
    structure, ready to paste. Export must be to clipboard and/or an on-screen copyable block (see D9).
21. **Updated MEASUREMENTS.md structure.** `MEASUREMENTS.md` must be updated so its section structure
    matches the exporter's output (so a paste drops in cleanly), and must state explicitly that the
    numbers require a real WebGPU browser run by the owner and are not producible in CI/headless.

## Edge cases

- **EC-1 — Pre-existing slice-1 DB lacks `content_hash`.** A persisted slice-1 database
  (`idb://aafno-slice1`) has no `content_hash` column and no UNIQUE constraint on it. Chosen behavior
  (D5): since this is a throwaway spike, on a schema-version bump the local DB is **dropped and
  recreated** with a visible user-facing notice ("Local index reset for the new schema — re-add your
  documents"), rather than performing a real migration. The notice must be shown, not silent.
- **EC-2 — Bundled sample re-added.** Re-adding the bundled sample after it is already indexed must hit
  the same warn-and-skip path as any duplicate (its bytes are stable), not create a second copy.
- **EC-3 — Delete the last document.** Deleting the only/last document must leave a clean empty corpus
  (empty document list, retrieval returns the defined "no strongly relevant passages" / empty-corpus
  response), not an error or a half-restored state.
- **EC-4 — Retrieval on an empty corpus.** With zero indexed documents, retrieval must return a defined
  empty/`belowRelevanceThreshold` response rather than erroring (slice-1 behavior preserved).
- **EC-5 — Delete during an in-flight ingest/retrieve.** Deleting a document while another job is
  running must not corrupt the store or present partial state as complete; behavior is defined by D10
  (delete is disabled/serialized during an in-flight job).
- **EC-6 — Hash of a zero-byte / unreadable file.** Hashing must handle a zero-byte or unreadable input
  without crashing; an empty/failed read is surfaced as a clear error (consistent with slice-1's
  "no extractable text" honesty), not silently indexed.
- **EC-7 — Content-only vs full-file duplicate.** Two PDFs with identical extracted text but different
  raw bytes are **distinct** documents under byte-exact dedup (dedup does not fire). This is accepted
  for slice 2 and must be noted so it isn't mistaken for a bug.
- **EC-8 — Production build content-logging leak.** A `debug`/`info` log line carrying content that is
  not properly dev-gated would violate FR-16; the acceptance criteria include a production-build check
  that no user content appears in the built output's log paths.
- **EC-9 — Export before any run.** Triggering the Markdown export before a full run has produced
  numbers must export a well-formed document with clearly-marked missing/`TBD` fields, not malformed
  Markdown or a crash.

## Acceptance criteria

Binary and testable (Given/When/Then):

- **AC-1 (dedup warn-and-skip).** **Given** a file already indexed, **when** the same file (identical
  bytes) is added again, **then** exactly **one** document exists for that content, **no** additional
  chunks are created, and a "This file is already indexed" message is shown pointing at the existing
  document.
- **AC-2 (distinct files still ingest).** **Given** an indexed document, **when** a file with different
  bytes is added, **then** a second document is created and both documents appear in the list.
- **AC-3 (delete removes doc + chunks).** **Given** an indexed document, **when** the engineer confirms
  deleting it, **then** the document disappears from the list, its chunks are gone from the store, and a
  subsequent retrieval never returns any of that document's chunks.
- **AC-4 (delete requires confirmation).** **Given** the delete action, **when** it is invoked, **then**
  no deletion occurs until a lightweight confirmation is accepted; cancelling leaves the document intact.
- **AC-5 (multi-doc corpus retrieval).** **Given** two or more distinct indexed documents, **when** a
  question is asked, **then** the top-k results are drawn from across the whole corpus (results from
  more than one document are possible) and each result is attributable to its source document.
- **AC-6 (reload restores all documents).** **Given** N (N≥2) indexed documents, **when** the page is
  fully reloaded, **then** all N documents appear in the list with their chunk counts and are
  retrievable, **without** any re-parse/chunk/embed occurring.
- **AC-7 (dev logger emits namespaced I/O traces).** **Given** a dev build (`import.meta.env.DEV`),
  **when** the pipeline runs, **then** the console shows leveled, stage-namespaced traces
  (`[parse]/[chunk]/[embed]/[db]/[retrieve]/[generate]`) including file name/size, chunk count,
  embedding dim + timing, retrieval query + top-k scores, and generation prompt/response sizes.
- **AC-8 (no content in a production build).** **Given** a production build, **when** the built output
  is inspected (build-output check per §10 "production build checks"), **then** no document/prompt
  **content** appears in any log path and `debug`/`info` traces are absent; only metadata-level
  `warn`/`error` may remain.
- **AC-9 (schema-bump reset is visible).** **Given** a persisted slice-1 DB without `content_hash`,
  **when** slice 2 opens the store, **then** the DB is recreated under the new schema **and** a visible
  notice informs the user the local index was reset (no silent data loss, no crash).
- **AC-10 (measurement export is valid Markdown).** **Given** a completed run, **when** the engineer
  clicks "export measurements as Markdown", **then** the output is valid Markdown matching the updated
  `MEASUREMENTS.md` structure, with the captured cold/warm load, throughput, retrieval latency, index
  strategy, and persistence self-check result filled in and pasteable without hand-editing structure.
- **AC-11 (persistence self-check reported).** **Given** a reload after indexing, **when** the
  persistence self-check runs, **then** it reports a definitive pass/fail on "restored from storage
  without re-parse/chunk/embed", and that result is included in the export.
- **AC-12 (privacy/no-backend invariants intact).** **Given** any slice-2 run with cloud generation
  off, **when** parse/chunk/embed/store/retrieve and the new list/delete/dedup operations execute,
  **then** no network request carrying document or chunk content is made, there is no production
  backend, and persistence is exercised (not stubbed) — the slice-1 §4 invariants (AC-2/AC-3/AC-8 of
  slice 1) still hold.

## Non-functional requirements

- **Measurement numbers require a real run (explicit).** The deliverable of item B is the
  capture/export **tooling** plus the updated `MEASUREMENTS.md` **structure** — not filled-in numbers.
  The actual §5 numbers (cold/warm load, throughput, retrieval latency, HNSW-vs-flat, persistence)
  require a real WebGPU browser run by the owner and cannot be produced in CI/headless. `MEASUREMENTS.md`
  must say so plainly.
- **§4 day-1 invariants preserved.** No production backend; cloud generation stays opt-in and visibly
  disclosed (slice-1 posture); persistence is exercised across reload, not stubbed; desktop-first.
- **Privacy is an engineering requirement (§10.1).** The FR-16 content guardrail is enforced in code
  and verified by a production-build check (AC-8), not by developer discipline alone.
- **Off-main-thread work (§10, D3).** New heavy/DB operations (`listDocuments`, `deleteDocument`, hash
  compare, restore-all) run in the existing single Web Worker via typed messages; no untyped
  `postMessage`. Hashing may run on either side but must not block the UI thread perceptibly.
- **Isolation (§10 principle 5).** Slice 2 stays under `spikes/rag-pipeline/`, typed but not
  production-polished; it is not wired into the (nonexistent) production shell.
- **Testability.** Dedup, delete-cascade, multi-doc restore, and corpus-wide retrieval must be
  exercisable in the existing Node-testable DB layer (`test/db.persistence.test.ts` pattern); the true
  browser reload remains a manual step recorded via the exporter. Logger dev-gating and the
  production-build content check are unit/build-check testable.
- **Target environment.** Latest desktop Chrome + WebGPU (slice-1 D6); Firefox/Safari and WASM fallback
  observed-and-documented, not gated.

## §7 risks this slice touches

- **Risk #3 ("local only" enforcement):** the FR-16 content-logging guardrail + AC-8 production-build
  check extend runtime enforcement toward the compile-time exclusion Phase 1 will complete; slice 2
  closes the "user content in logs" gap specifically.
- **Risk #4 (persistence not optional):** directly — real multi-document restore (AC-6), the delete
  data-management action (§7.4 "ability to delete local data"), and the persistence self-check (AC-11)
  all harden persistence. EC-1's schema-bump reset is a deliberate spike-only tradeoff against a real
  migration and is flagged as such.
- **Risk register items exercised:** OPFS/IndexedDB persistence, PGlite + pgvector limitations
  (multi-doc scan, delete cascade, UNIQUE constraint), accidental cloud/content leak (logging path),
  memory pressure (larger multi-document corpus).

## Assumptions & open questions

All business/intent decisions below were surfaced as ranked defaults and **reviewed by the owner on
2026-07-06, who accepted every default (D1–D11) exactly as proposed**. No open question remains
unresolved; the spec is therefore **Ratified**. Impact ranks the original effect on the slice-2
outcome and is retained for traceability.

- `[ASSUMPTION | HIGH]` **D1 — Three-in-one Tier 2 scope.** Accepted (owner-confirmed, 2026-07-06):
  ship A1 (dedup), A2 (doc management + multi-doc), A3 (dev logger), and B (measurement tooling) as one
  Tier 2 slice, not split.
- `[ASSUMPTION | HIGH]` **D2 — Dedup key = raw-file-bytes SHA-256.** Accepted (owner-confirmed,
  2026-07-06): dedup is by SHA-256 over raw file bytes via `crypto.subtle.digest`, with a UNIQUE
  `content_hash` on `documents` and warn-and-skip on collision.
- `[ASSUMPTION | HIGH]` **D3 — Content-logging privacy guardrail is a hard gate.** Accepted
  (owner-confirmed, 2026-07-06): content logging must be dev-flag-gated so it can never appear in a
  production build; this is a HARD gate verified by a production-build check (AC-8), not a target.
- `[ASSUMPTION | MEDIUM]` **D4 — Retrieval is corpus-wide.** Accepted (owner-confirmed, 2026-07-06):
  retrieval searches across all indexed documents' chunks (corpus-wide), not per-selected-document
  scoping.
- `[ASSUMPTION | MEDIUM]` **D5 — Pre-existing slice-1 DB handling.** Accepted (owner-confirmed,
  2026-07-06): on a schema-version bump the local DB is dropped and recreated with a visible notice
  (EC-1/AC-9), with no real migration; losing any local slice-1 index on upgrade is accepted.
- `[ASSUMPTION | MEDIUM]` **D6 — Title on dedup collision.** Accepted (owner-confirmed, 2026-07-06):
  a duplicate upload keeps the existing indexed document's title (does not overwrite with the new
  filename); the warn-and-skip message names the existing document.
- `[ASSUMPTION | MEDIUM]` **D7 — Delete requires confirmation.** Accepted (owner-confirmed,
  2026-07-06): delete requires a lightweight confirm (e.g., inline confirm or `window.confirm`) before
  it executes (AC-4).
- `[ASSUMPTION | LOW]` **D8 — Logger default level.** Accepted (owner-confirmed, 2026-07-06): logger
  default active level is `debug` in dev and `warn` otherwise (FR-13).
- `[ASSUMPTION | LOW]` **D9 — Export delivery mechanism.** Accepted (owner-confirmed, 2026-07-06):
  export renders the Markdown into an on-screen copyable block plus a copy-to-clipboard button (the
  owner pastes into `MEASUREMENTS.md`); a file download is not required.
- `[ASSUMPTION | LOW]` **D10 — Delete vs in-flight job.** Accepted (owner-confirmed, 2026-07-06):
  delete is disabled/serialized during an in-flight pipeline job to avoid mid-run store mutation
  (EC-5).
- `[ASSUMPTION | LOW]` **D11 — No "clear all" / bulk delete.** Accepted (owner-confirmed, 2026-07-06):
  slice 2 provides per-document delete only; bulk "clear all local data" is deferred to Phase 1's
  storage management.

### Informational assumptions — for the planner to resolve empirically (non-blocking)

These are factual unknowns about the codebase/domain, not intent ambiguities. They are **not blockers**
to ratification; the planner/implementer resolves each empirically during implementation, and both
listed outcomes already satisfy the requirements above.

- `[ASSUMPTION | informational]` **R1 — HNSW index survival across multi-doc + deletes.** Whether the
  pgvector build under PGlite honors the existing HNSW index across a multi-document corpus and after
  deletes, or whether the index needs a rebuild on delete, is to be confirmed empirically by the plan.
  (Informs FR-7/FR-10; flat scan remains an accepted fallback per slice-1 AC-4, so either outcome is
  acceptable.)
- `[ASSUMPTION | informational]` **R2 — `crypto.subtle.digest` placement.** Whether
  `crypto.subtle.digest` is best called on the bundled sample's fetched `ArrayBuffer` in the worker
  (without an extra copy) or on the main thread before `postMessage` is an implementation-placement
  detail for the plan to decide empirically; both placements satisfy FR-1.
