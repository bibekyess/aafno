---
title: Content-hash dedup and multi-document store
date: 2026-07-06
status: Accepted        # Proposed | Accepted | Superseded
supersedes:
superseded-by:
---

# 2026-07-06 — Content-hash dedup and multi-document store

## Context

Slice 1 minted a fresh `crypto.randomUUID()` per upload in `handleParse`, so `insertDocument`'s
`ON CONFLICT (id)` guard could never fire — re-uploading the same file stacked duplicate chunks and
polluted retrieval. `restoreState` restored only the single latest document
(`ORDER BY parsed_at DESC LIMIT 1`) even though the retrieval SQL already scanned the whole `chunks`
corpus, so the store could accumulate but never be pruned, and there was no document list or delete
action. Multi-document + delete under PGlite/pgvector was explicitly flagged as unverified follow-up
work by the slice-1 store ADR (`2026-07-05-pglite-pgvector-local-vector-store.md`, "Consequences":
"exact/flat scan remains acceptable at single/personal-document scale but should be re-evaluated
once multi-document corpora are in scope").

## Decision

We will identify a document for dedup purposes by the SHA-256 hash of its raw file bytes
(`crypto.subtle.digest`, computed before parsing), stored as `content_hash TEXT UNIQUE` on
`documents`. A file whose hash matches an already-indexed document is warned-and-skipped before
parse/chunk/embed/store — the real skip decision happens at the start of `handleParse` (not at
ingest) so a duplicate never re-parses. `insertDocument`'s `ON CONFLICT` target moves from `id`
(which never fired) to `content_hash` (a durable backstop against a race, since the primary skip
decision already happened earlier). Restore (`restoreAllDocuments`, replacing `restoreState`) and
`listDocuments` return the whole corpus, not just the latest document; retrieval remains
corpus-wide (`RETRIEVE_SQL` already carries no `document_id` filter — unchanged). Per-document
delete (`deleteDocument`) removes a document and cascades its chunks via the existing
`chunks.document_id … ON DELETE CASCADE`. We confirmed empirically
(`test/db.persistence.test.ts`) that a document deleted from a multi-document corpus never
resurfaces in `retrieveTopK`, whether the pgvector index built as `hnsw` or fell back to `flat` —
flat scan remains the accepted slice-1 AC-4 fallback either way. A `schema_meta(version)` table
backs a version gate (`ensureSchemaVersion`): a DB missing `content_hash` or below the current
`SCHEMA_VERSION` is dropped and recreated in place, with the caller (`App`) surfacing a visible
notice — a deliberate spike-only choice instead of a real migration.

## Alternatives considered

- **Per-selected-document retrieval scoping** — let the user pick which document(s) to search.
  Rejected for slice 2 (D4): retrieval stays corpus-wide, matching the eventual product's
  multi-document behavior; per-document scoping can be added later as a UI filter over the same
  corpus-wide query.
- **Parsed-text or content-addressed dedup** — hash the extracted text (or a fuzzy/near-duplicate
  signature) instead of raw bytes, so re-exports or edited copies would also dedup. Rejected for
  slice 2: byte-exact dedup is simpler, has no false-positive risk, and is what D2 specified;
  content-only duplicates (identical text, different bytes) are accepted as distinct documents
  (EC-7), not mistaken for a bug.
- **A real schema migration** — write forward migrations for the `content_hash` column and
  `schema_meta` table. Rejected (D5): this is a throwaway Phase 0 spike; a drop-and-recreate with a
  visible notice is proportionate, and a real migration strategy is deferred to whenever the
  product has an actual production schema to migrate.
- **Keeping `ON CONFLICT (id)`** — Rejected: it never fires, because every upload already gets a
  fresh random id; it was silently dead code disguised as a dedup guard.

## Consequences

Re-uploading an identical file no longer creates duplicate chunks, and the corpus can now be
inspected and pruned via the document list. Exact-byte dedup is a known, documented limitation
(EC-7) rather than a silent gap — near-duplicate or cross-format dedup remains future work if the
product needs it. The schema-version bump means any locally persisted slice-1 database is
discarded on first slice-2 open; this is an accepted, visibly-notified trade-off (D5), not silent
data loss. HNSW-vs-flat survival across multi-document inserts and deletes is now an empirically
recorded fact (via the Node-level PGlite persistence test) rather than an assumption, so later
phases can plan around the real behavior instead of guessing — consistent with, and extending, the
slice-1 store ADR's stated follow-up.
