# Measurements — Phase 0 POC Slice 1

The committed measurement note (D9, FR-10, AC-10). Fill in the table below after running the spike
in a real browser per the README's "Measuring a real run" steps. This is the Phase-0 exit artifact
that answers the targeted §5 unknowns (PROJECT_ANALYSIS.md §5 #1, #3, #4) and records observations
for §5 #2 and #5.

Status: **template — not yet run.** Replace every `TBD` after a real run.

## Environment

| Field | Value |
|---|---|
| Browser + version | TBD |
| OS | TBD |
| GPU / adapter | TBD |
| WebGPU available | TBD (yes/no) |
| WASM fallback observed | TBD (yes/no/not exercised) |
| Sample document | TBD (filename, page count) |

## §5 unknown #1 — PGlite + pgvector persistence & HNSW (hard gate: persistence)

| Metric | Result |
|---|---|
| Persistence across reload (AC-3) | TBD (pass/fail) — restored without re-parse/chunk/embed? |
| HNSW index build (AC-4) | TBD (`hnsw` built / `hnsw` failed, fell back to `flat`) |
| HNSW failure reason (if applicable) | TBD |

## §5 unknowns #3/#4 — Model load timing + generation flow

| Metric | Target | Result |
|---|---|---|
| Cold-load (first download + init) | measured, not gated (AC-6) | TBD s |
| Warm-load (cached init after reload) | ≤ 3s (AC-5, target not gate) | TBD s |
| Model backend used | — | TBD (webgpu / wasm) |
| Model download size observed | — | TBD MB |
| Generation path used | — | TBD (dev-cloud / local stretch / none) |

## Embedding + retrieval

| Metric | Target | Result |
|---|---|---|
| Embedding throughput | — | TBD chunks/s, TBD chars/s |
| Chunk count (sample document) | — | TBD |
| Retrieval latency (top-k) | ≤ 500ms (AC-7, target not gate) | TBD ms |
| k used | — | 5 (default, D8) |

## §5 unknown #2 — chonkie-ts + EmbeddingGemma tokenizer (observation only)

- Tokenizer integration used: TBD (`@chonkiejs/token` HuggingFace tokenizer / character-based
  fallback — see console warning from `worker/chunk.ts` if fallback was used).
- Any integration issues observed: TBD.

## §5 unknown #5 — WebGPU coverage / WASM fallback (observation only)

- WebGPU worked out of the box: TBD (yes/no).
- If WASM fallback was exercised (embedding and/or generation), any issues observed: TBD.

## Privacy / hard gates

| Requirement | Result |
|---|---|
| Cloud off by default (AC-8) | TBD (pass/fail) |
| No content egress with cloud off (AC-2, verified via DevTools) | TBD (pass/fail) |
| Capability + failure honesty (AC-9) | TBD (pass/fail) |

## Notes / anomalies

TBD — record anything surprising here (memory pressure, empty-PDF handling, unexpected errors,
etc.) per the spec's edge cases.
