# AAFNO Phase 0 POC — RAG pipeline spike (slices 1 + 2)

End-to-end client-side RAG walking skeleton: document(s) → `liteparse-wasm` parse (local) →
`chonkie-ts`/`@chonkiejs/core` chunk (local) → `EmbeddingGemma` embed via `@huggingface/transformers`
on WebGPU (local) → store chunks + vectors in PGlite + pgvector (persisted, corpus-wide) →
retrieve top-k across the whole corpus → generate an answer via a dev-only OpenAI-compatible
endpoint. Slice 2 adds byte-hash dedup, a document list with delete, a dev-only leveled logger with
a hard content-privacy gate, and measurement capture/export tooling.

See `specs/2026-07-05-phase0-poc-slice1.md` + `specs/2026-07-06-slice2-ingestion-hardening.md`
(requirements) and `plans/2026-07-05-phase0-poc-slice1.md` +
`plans/2026-07-06-slice2-ingestion-hardening.md` (implementation plans) at the repo root.

This is **spike code** (PROJECT_ANALYSIS.md §10 #5): typed, but not production-polished. It is not
wired into any production app shell — there isn't one yet (Phase 1).

## Running it

```bash
npm install
npm run dev
```

Open the printed local URL in the latest desktop Chrome with WebGPU enabled (primary target
environment, D6). Click "Use bundled sample document" to run the full pipeline against the bundled
sample PDF, or use the file picker for another text-based PDF.

Dev-cloud generation (the primary generation path, D2) is **off by default** (AC-8). To enable it,
copy `.env.local.example` to `.env.local`, fill in a real OpenAI-compatible endpoint, and toggle
"Enable dev-cloud generation" in the app. Never commit `.env.local` (it is gitignored).

## What to look at

- **Capabilities** — WebGPU/OPFS/IndexedDB detection (FR-13, AC-9).
- **Document** — load the bundled sample or upload a PDF; the pipeline chunks, embeds, and stores
  it automatically after parsing. Re-uploading an already-indexed file is detected and skipped
  (slice-2 A1, AC-1).
- **Indexed documents** — the full corpus with per-document delete (with a lightweight confirm) and
  chunk counts; delete is disabled while a job is in flight (slice-2 A2, AC-3/AC-4).
- **Ask** — retrieve top-k chunks across the whole corpus for a question, attributed to their
  source document, then (if cloud is enabled) generate an answer (slice-2 AC-5).
- **Network & privacy** — the cloud opt-in toggle and the observable network log (FR-11, AC-8, §9).
- **Measurements** — live cold/warm load, embedding throughput, retrieval latency, index outcome,
  and a persistence self-check, plus a "Copy as Markdown" export (slice-2 A4/B, AC-10/AC-11).
- **Local activity** — plain-language local pipeline events (FR-12).
- **Dev console** — in dev, leveled/namespaced pipeline traces (`[parse] [chunk] [embed] [db]
[retrieve] [generate]`); document/prompt content only ever appears here, never in a production
  build (slice-2 A3, AC-7/AC-8).

## Measuring a real run (manual)

1. Fully clear site data (or use a fresh profile) so the embedding model has not been downloaded.
2. Load the app, click "Use bundled sample document", and note the **cold-load** time reported in
   Measurements (AC-6).
3. Reload the page (weights now cached in OPFS/browser cache) and note the **warm-load** time
   (target ≤3s, AC-5).
4. Ask a question and note **retrieval latency** (target ≤500ms, AC-7).
5. Reload the page again and ask the same question **without** clicking "Use bundled sample
   document" again — the activity log should show "Restored store from browser storage" and answer
   without re-parsing/chunking/embedding (AC-3).
6. Check the browser console / worker logs for the HNSW-vs-flat outcome (AC-4).
7. Record all of the above, plus your browser/OS/GPU, in `MEASUREMENTS.md` (AC-10, D9).

## Quality gate

```bash
npm run format          # prettier --check
npm run lint            # eslint
npm run typecheck       # tsc --noEmit
npm run test            # vitest run
npm run check:prod-logs # real `vite build` + assert no content-logging path survives (AC-8)
```

These are wired into the root `just check` gate (see the root `justfile`).

## Deviations from the plan

Installed dependency versions drifted from the plan's pins beyond a patch bump:

- `vitest ^3.2.4` (plan pinned `^2.1.0`) — vitest 3.x is required for compatibility with vite 6.
- `@electric-sql/pglite ^0.5.4` (plan pinned `^0.2.0`) and `@huggingface/transformers ^3.8.1` (plan
  pinned `^3.3.0`) — both installed at the newer version available at implementation time; no known
  behavioral incompatibility was hit.

## Known limitations (by design, see spec "Out of scope")

- Gemma-4-E2B local generation is not implemented (D2) — dev-cloud is primary; local SmolLM2-360M
  generation is an unimplemented stretch goal (`generateLocal` reports a clear error).
- No production app shell, Atomic Design UI, routing, or full Privacy Console organism.
- Multi-document corpus + delete are supported (slice 2); no hybrid BM25+vector search, citation
  UX, or Tiptap editor.
- Firefox/Safari and the WASM fallback path are observed-and-documented only, not gated (D6).
- Dedup is byte-exact only — two files with identical extracted text but different raw bytes are
  distinct documents, by design (slice-2 EC-7).
- A pre-slice-2 local database is dropped and recreated (not migrated) on first open, with a
  visible notice (slice-2 D5/EC-1/AC-9).
