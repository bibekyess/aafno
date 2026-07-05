---
title: PGlite + pgvector as the local vector store
date: 2026-07-05
status: Accepted        # Proposed | Accepted | Superseded
supersedes:
superseded-by:
---

# 2026-07-05 — PGlite + pgvector as the local vector store

## Context

AAFNO's "persistence is not optional" day-1 constraint (PROJECT_ANALYSIS.md §4) requires
documents, chunks, chunk metadata, and embedding vectors to survive a page reload without forcing
the user to wait through re-parsing and re-embedding — the single biggest threat to the product
feeling reliable (§7 risk #4). The locked stack (§3) named PGlite + pgvector — a WASM build of
Postgres with the pgvector extension, persisted to IndexedDB/OPFS — as the intended local store,
chosen over brute-force in-memory search or a simpler key-value store because it offers durable
storage, a real query engine (needed for future hybrid BM25 + vector search), and a single place
to hold documents, chunks, metadata, and vectors together. But two things were unconfirmed before
Phase 0: whether pgvector's HNSW index actually builds under PGlite's WASM Postgres build, and
whether the database genuinely persists across a browser reload via OPFS/IndexedDB rather than only
appearing to persist within a single page session (§5 unknown #1).

## Decision

We will use PGlite (`@electric-sql/pglite`) with the pgvector extension
(`@electric-sql/pglite-pgvector`) as the single local store for documents, chunks, chunk metadata,
and embedding vectors, opened with a persistent `dataDir` (`idb://…`, IndexedDB-backed, portable
across all browsers; OPFS as a worker-only optimization where available). The schema
(`lib/schema.sql.ts`) defines `documents` and `chunks` tables with a `vector(768)` column sized to
EmbeddingGemma's confirmed output dimension. Index strategy is **HNSW-if-it-builds, else
exact/flat scan**: `CREATE INDEX … USING hnsw (embedding vector_cosine_ops)` is attempted inside a
try/catch; on failure, the code proceeds with no index (an exact scan), and the outcome
— which one actually happened — is recorded rather than assumed. Phase 0 slice 1
(`spikes/rag-pipeline/`, `worker/db.ts`) is the empirical basis for this decision: its Node-level
persistence test (`test/db.persistence.test.ts`) opens PGlite with a filesystem `dataDir`, inserts
a document + 768-dim vector chunks, closes, reopens with the same `dataDir`, and asserts rows and
cosine-ordered retrieval survive; the equivalent real-browser IndexedDB/OPFS reload is validated
manually and recorded in `MEASUREMENTS.md` (AC-3, AC-4, AC-10).

## Alternatives considered

- **IndexedDB-only (no relational engine)** — store chunks/vectors as IndexedDB records and
  compute similarity in application code. Rejected as the primary store: it forfeits a real query
  engine for the hybrid BM25 + vector search planned for later phases, and pushes index-building
  and query planning into hand-written application code that Postgres already provides.
- **In-memory vector search (rebuilt on load)** — keep vectors in memory and rebuild from a
  simpler persisted representation on every reload. Rejected: rebuilding on every reload is
  exactly the "re-indexing on every reload" outcome §4 calls a dealbreaker, even if the underlying
  chunk text were persisted elsewhere.
- **LanceDB WASM** — a purpose-built embedded vector database with a WASM build
  (PROJECT_ANALYSIS.md §10 example). Not chosen for this slice: PGlite + pgvector was already the
  team's locked choice (§3) specifically because it unifies documents/chunks/metadata/vectors (and
  future full-text search) in one engine; LanceDB would add a second storage engine alongside
  whatever holds document/chunk metadata. Not exercised by slice 1; remains a fallback option if
  the HNSW-or-flat outcome recorded here turns out to be unacceptable at larger scale.

## Consequences

Because HNSW-vs-flat is now an empirically recorded fact rather than an assumption, later phases
can plan index strategy (and any scale limits) around the real number instead of guessing. Keeping
documents, chunks, metadata, and vectors in one Postgres-compatible engine keeps the door open for
hybrid BM25 + vector search in a single query later, without a second storage system to keep in
sync. The trade-off is WASM Postgres's overhead (binary size, init cost) compared to a
purpose-built embedded vector store, and dependence on IndexedDB (all browsers) or OPFS
(worker-only, not Safari) as the persistence substrate — Safari's lack of worker-OPFS means
IndexedDB is the portable path and OPFS is only an optimization where available. Follow-up work:
if HNSW proved unavailable in slice 1's run, exact/flat scan remains acceptable at
single/personal-document scale but should be re-evaluated once multi-document corpora are in
scope (Phase 1+).
