# AAFNO Phase 0 POC — Slice 1: RAG pipeline spike

End-to-end client-side RAG walking skeleton: one document → `liteparse-wasm` parse (local) →
`chonkie-ts`/`@chonkiejs/core` chunk (local) → `EmbeddingGemma` embed via `@huggingface/transformers`
on WebGPU (local) → store chunks + vectors in PGlite + pgvector (persisted) → retrieve top-k →
generate an answer via a dev-only OpenAI-compatible endpoint.

See `specs/2026-07-05-phase0-poc-slice1.md` (requirements) and
`plans/2026-07-05-phase0-poc-slice1.md` (implementation plan) at the repo root.

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
  it automatically after parsing.
- **Ask** — retrieve top-k chunks for a question, then (if cloud is enabled) generate an answer.
- **Network & privacy** — the cloud opt-in toggle and the observable network log (FR-11, AC-8, §9).
- **Measurements** — live cold/warm load, embedding throughput, retrieval latency (FR-10).
- **Local activity** — plain-language local pipeline events (FR-12).

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
npm run format      # prettier --check
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
```

These are wired into the root `just check` gate (see the root `justfile`).

## Known limitations (by design, see spec "Out of scope")

- Gemma-4-E2B local generation is not implemented (D2) — dev-cloud is primary; local SmolLM2-360M
  generation is an unimplemented stretch goal (`generateLocal` reports a clear error).
- No production app shell, Atomic Design UI, routing, or full Privacy Console organism.
- Single document only; no hybrid BM25+vector search, citation UX, or Tiptap editor.
- Firefox/Safari and the WASM fallback path are observed-and-documented only, not gated (D6).
