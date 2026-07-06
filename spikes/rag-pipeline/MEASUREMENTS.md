# Measurements — Phase 0 POC (slices 1 + 2)

The committed measurement note (D9, FR-10, FR-17..FR-21, AC-10). Slice 2 adds a one-click "Copy as
Markdown" export in the app's Measurements panel (`ui/MeasurementPanel.tsx`,
`lib/measure.ts#buildMeasurementMarkdown`) that renders a block matching this file's section
structure exactly — paste it in below after a real run instead of hand-transcribing numbers.

**Numbers require a real WebGPU browser run by the owner and cannot be produced in CI/headless**
(NFR "Measurement numbers require a real run"). The automated test suite exercises persistence,
dedup, cascade delete, and multi-document restore under Node/PGlite (`test/db.persistence.test.ts`)
but not real-browser timing, IndexedDB/OPFS reload, or WebGPU availability.

Status: **template — not yet run.** Replace every `TBD` after a real run by pasting the panel's
Markdown export below.

## Environment

| Field | Value |
|---|---|
| Browser / user agent | TBD |
| WebGPU available | TBD (yes/no) |
| WASM fallback observed | TBD (yes/no/not exercised) |
| OS | TBD |
| GPU / adapter | TBD |
| Sample / test documents used | TBD (filenames, page counts) |

## Model load (cold vs warm)

| Metric | Target | Result |
|---|---|---|
| Cold-load (first download + init) | measured, not gated | TBD ms |
| Warm-load (cached init after reload) | ≤ 3s (target, not a gate) | TBD ms |
| Load kind (this run) | — | TBD (cold / warm / already-loaded) |
| Model backend used | — | TBD (webgpu / wasm) |

## Embedding + retrieval

| Metric | Target | Result |
|---|---|---|
| Embedding throughput | — | TBD chunks/s, TBD chars/s |
| Chunk count | — | TBD |
| Retrieval latency (top-k) | ≤ 500ms (target, not a gate) | TBD ms |
| Index strategy | — | TBD (`hnsw` / `flat`) |

## Persistence self-check (AC-11)

| Check | Result |
|---|---|
| Restored from storage without re-parse/chunk/embed | TBD (pass / fail / no-prior-corpus) |

## Privacy / hard gates

| Requirement | Result |
|---|---|
| No content egress with cloud off | TBD (yes/no) |
| Cloud off by default (slice-1 AC-8) | TBD (pass/fail) |
| Capability + failure honesty (slice-1 AC-9) | TBD (pass/fail) |
| No content-logging path in a production build (slice-2 AC-8, `npm run check:prod-logs`) | TBD (pass/fail) |

## Multi-document / dedup observations (slice 2, R1, EC-7)

- HNSW index survival across a multi-document corpus and after a delete (R1): TBD (`hnsw` held /
  rebuild via `attemptHnswIndex` needed) — either outcome is acceptable; flat scan is the accepted
  slice-1 AC-4 fallback.
- Byte-exact dedup behavior observed (AC-1/AC-2): TBD.
- Content-only duplicates (same extracted text, different raw bytes) correctly treated as distinct
  documents, not a bug (EC-7): TBD (observed/not exercised).

## §5 unknown #2 — chonkie-ts + EmbeddingGemma tokenizer (observation only)

- Tokenizer integration used: TBD (`@chonkiejs/token` HuggingFace tokenizer / character-based
  fallback — see the `[chunk]` logger warning if the fallback was used).
- Any integration issues observed: TBD.

## §5 unknown #5 — WebGPU coverage / WASM fallback (observation only)

- WebGPU worked out of the box: TBD (yes/no).
- If WASM fallback was exercised (embedding and/or generation), any issues observed: TBD.

## Notes / anomalies

TBD — record anything surprising here (memory pressure, empty-PDF handling, unexpected errors,
schema-reset notice firing unexpectedly, etc.) per the spec's edge cases.
